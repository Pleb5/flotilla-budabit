import {request as welshmanRequest, type RequestOptions} from "@welshman/net"
import type {Filter, TrustedEvent} from "@welshman/util"

export type FiniteRelayOutcome =
  | "eose"
  | "capped"
  | "timeout"
  | "closed"
  | "disconnect"
  | "aborted"
  | "error"

export type FiniteRelayResult = {
  relay: string
  outcome: FiniteRelayOutcome
  events: TrustedEvent[]
  queuedAt: number
  startedAt?: number
  finishedAt: number
  reason?: string
}

export type FiniteRelayRequestOptions = {
  relay: string
  filters: Filter[]
  timeoutMs: number
  signal?: AbortSignal
  priority?: number
  owner?: string
  maxEvents?: number
  onEvent?: (event: TrustedEvent, relay: string) => void
  onPhase?: (phase: "queued" | "authenticating" | "loading") => void
  /** AUTH has its own bounded deadline; signer approval must not consume the data deadline. */
  subscribeAuth?: (listener: (waiting: boolean) => void) => () => void
  authTimeoutMs?: number
}

type Timer = ReturnType<typeof setTimeout>

export type FiniteRelayRequestDependencies = {
  request: (options: RequestOptions) => Promise<TrustedEvent[]>
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => Timer
  clearTimer?: (timer: Timer) => void
}

export const FINITE_RELAY_ADMISSION_TIMEOUT_MS = 30_000

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error || "Unknown request error")

export const createFiniteRelayRequester = (dependencies: FiniteRelayRequestDependencies) => {
  const now = dependencies.now || Date.now
  const setTimer = dependencies.setTimer || ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = dependencies.clearTimer || (timer => clearTimeout(timer))

  return (options: FiniteRelayRequestOptions): Promise<FiniteRelayResult> => {
    const queuedAt = now()
    const eventsById = new Map<string, TrustedEvent>()
    const requestController = new AbortController()
    const signal = options.signal
      ? AbortSignal.any([options.signal, requestController.signal])
      : requestController.signal

    let outcome: FiniteRelayOutcome | undefined
    let reason: string | undefined
    let startedAt: number | undefined
    let timer: Timer | undefined
    let settled = false
    let waitingForAuth = false
    let authDeadline: number | undefined
    let unsubscribeAuth: (() => void) | undefined

    return new Promise(resolve => {
      const startTimer = (delay: number, timeoutReason: string) => {
        if (timer) clearTimer(timer)
        timer = setTimer(() => abortAndFinish("timeout", timeoutReason), delay)
      }

      const finish = (nextOutcome: FiniteRelayOutcome, nextReason?: string) => {
        if (settled) return
        settled = true
        outcome ||= nextOutcome
        reason ||= nextReason

        if (timer) clearTimer(timer)
        unsubscribeAuth?.()
        options.signal?.removeEventListener("abort", onCallerAbort)

        resolve({
          relay: options.relay,
          outcome,
          events: Array.from(eventsById.values()),
          queuedAt,
          startedAt,
          finishedAt: now(),
          ...(reason ? {reason} : {}),
        })
      }

      const abortAndFinish = (
        nextOutcome: "capped" | "timeout" | "aborted",
        nextReason?: string,
      ) => {
        outcome ||= nextOutcome
        reason ||= nextReason
        requestController.abort()
        finish(outcome, reason)
      }

      function onCallerAbort() {
        abortAndFinish("aborted")
      }

      if (options.signal?.aborted) {
        finish("aborted")
        return
      }

      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
        finish("error", "Finite relay timeout must be a positive number")
        return
      }

      if (!options.relay || options.filters.length === 0) {
        finish("error", "Finite relay requests require one relay and at least one filter")
        return
      }

      if (
        options.maxEvents !== undefined &&
        (!Number.isInteger(options.maxEvents) || options.maxEvents <= 0)
      ) {
        finish("error", "Finite relay event cap must be a positive integer")
        return
      }

      options.signal?.addEventListener("abort", onCallerAbort, {once: true})
      startTimer(
        Math.max(FINITE_RELAY_ADMISSION_TIMEOUT_MS, options.timeoutMs),
        "Request could not start because the relay subscription queue remained full",
      )
      options.onPhase?.("queued")
      const resumeDeadline = () => {
        if (settled) return
        if (waitingForAuth) {
          authDeadline ??= now() + (options.authTimeoutMs ?? 100_000)
          options.onPhase?.("authenticating")
          startTimer(Math.max(1, authDeadline - now()), "Relay authentication timed out")
        } else if (startedAt !== undefined) {
          options.onPhase?.("loading")
          startTimer(options.timeoutMs, `Request timed out after ${options.timeoutMs}ms`)
        } else {
          options.onPhase?.("queued")
          startTimer(
            Math.max(
              1,
              queuedAt + Math.max(FINITE_RELAY_ADMISSION_TIMEOUT_MS, options.timeoutMs) - now(),
            ),
            "Request could not start because the relay subscription queue remained full",
          )
        }
      }
      unsubscribeAuth = options.subscribeAuth?.(waiting => {
        if (waiting === waitingForAuth || settled) return
        waitingForAuth = waiting
        resumeDeadline()
      })
      if (settled) {
        unsubscribeAuth?.()
        return
      }

      const receiveEvent = (event: TrustedEvent, relay: string) => {
        if (settled) return
        const isNewEvent = !eventsById.has(event.id)
        eventsById.set(event.id, event)

        try {
          options.onEvent?.(event, relay)
        } catch (error) {
          outcome = "error"
          reason = getErrorMessage(error)
          requestController.abort()
          finish(outcome, reason)
          return
        }

        if (isNewEvent && options.maxEvents && eventsById.size >= options.maxEvents) {
          abortAndFinish("capped", `Request reached the ${options.maxEvents}-event cap`)
        }
      }

      let pending: Promise<TrustedEvent[]>
      try {
        pending = dependencies.request({
          relays: [options.relay],
          filters: options.filters,
          autoClose: true,
          lifetime: "finite",
          signal,
          priority: options.priority,
          owner: options.owner,
          onStart: () => {
            if (settled || startedAt !== undefined) return
            startedAt = now()
            resumeDeadline()
          },
          onEvent: receiveEvent,
          onDuplicate: receiveEvent,
          onEose: () => {
            outcome ||= "eose"
          },
          onClosed: message => {
            outcome ||= "closed"
            reason ||= message
          },
          onDisconnect: () => {
            outcome ||= "disconnect"
          },
        })
      } catch (error) {
        finish("error", getErrorMessage(error))
        return
      }

      void pending.then(
        events => {
          if (settled) return
          for (const event of events) eventsById.set(event.id, event)

          if (outcome) finish(outcome, reason)
          else if (options.signal?.aborted) finish("aborted")
          else finish("error", "Finite relay request ended without a terminal outcome")
        },
        error => {
          if (settled) return
          if (outcome) finish(outcome, reason)
          else if (options.signal?.aborted) finish("aborted")
          else finish("error", getErrorMessage(error))
        },
      )
    })
  }
}

export const requestFiniteRelay = createFiniteRelayRequester({request: welshmanRequest})
