import type {Subscriber} from "svelte/store"
import {writable} from "svelte/store"
import type {Override} from "@welshman/lib"
import {append, TaskQueue, ensurePlural, remove, defer, sleep, nth, without} from "@welshman/lib"
import {
  type HashedEvent,
  type EventTemplate,
  type SignedEvent,
  isSignedEvent,
  WRAPPED_KINDS,
  prep,
  makePow,
  sanitizeRelayUrls,
} from "@welshman/util"
import {
  publish,
  PublishStatus,
  type PublishResult,
  type PublishOptions,
  type PublishResultsByRelay,
} from "@welshman/net"
import {type ISigner, Nip01Signer, Nip59} from "@welshman/signer"
import {repository, tracker} from "./core.js"
import {pubkey, signer, wrapManager} from "./session.js"

export type ThunkOptions = Override<
  PublishOptions,
  {
    event: EventTemplate
    recipient?: string
    delay?: number
    pow?: number
    optimistic?: boolean
    presentation?: "global" | "private"
    operationId?: string
    publicationStage?: "primary" | "target"
  }
>

export type PublicationLifecycleObservation = {
  type: "created" | "started" | "result" | "completed" | "retry" | "signing-failure"
  publicationId: string
  previousPublicationId?: string
  eventKind: number
  attempt: number
  destinations?: string[]
  relay?: string
  status?: PublishStatus
  resultCounts?: Record<string, number>
  operationId?: string
  publicationStage?: "primary" | "target"
  terminalReason?: "settled" | "signing-failure" | "transport-exception" | "aborted"
}

const publicationLifecycleListeners = new Set<(event: PublicationLifecycleObservation) => void>()
let publicationDiagnosticSequence = 0

export const subscribePublicationLifecycle = (
  listener: (event: PublicationLifecycleObservation) => void,
) => {
  publicationLifecycleListeners.add(listener)
  return () => publicationLifecycleListeners.delete(listener)
}

const safePublicationRelay = (relay: string) => {
  try {
    const parsed = new URL(relay.includes("://") ? relay : `wss://${relay}`)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname || "/"}`
  } catch {
    return "[invalid-relay]"
  }
}

const emitPublicationLifecycle = (event: PublicationLifecycleObservation) => {
  for (const listener of publicationLifecycleListeners) {
    try {
      listener(event)
    } catch {
      // Diagnostics must never affect publication.
    }
  }
}

export class Thunk {
  _subs: Subscriber<Thunk>[] = []
  _optimisticEventId?: string

  pubkey: string
  signer: ISigner
  event: HashedEvent
  results: PublishResultsByRelay = {}
  complete = defer<void>()
  controller = new AbortController()
  wrap?: SignedEvent
  diagnosticId: string
  diagnosticAttempt: number
  _terminal = false
  readonly options: ThunkOptions

  constructor(
    options: ThunkOptions,
    diagnostic: {attempt?: number; previousPublicationId?: string} = {},
  ) {
    this.options = {...options, relays: sanitizeRelayUrls(options.relays)}
    options = this.options

    if (!options.recipient && WRAPPED_KINDS.includes(options.event.kind)) {
      throw new Error(`Attempted to publish a kind ${options.event.kind} without wrapping it`)
    }

    const $pubkey = pubkey.get()

    if (!$pubkey) {
      throw new Error(`Attempted to publish an event without an active pubkey`)
    }

    const $signer = signer.get()

    if (!$signer) {
      throw new Error(`Attempted to publish an event without an active signer`)
    }

    this.pubkey = $pubkey
    this.signer = $signer
    this.event = prep(options.event, this.pubkey)
    this.diagnosticId = `publication-${++publicationDiagnosticSequence}`
    this.diagnosticAttempt = diagnostic.attempt || 1

    for (const relay of options.relays) {
      this.results[relay] = {
        relay,
        status: PublishStatus.Sending,
        detail: "sending...",
      }
    }

    this.controller.signal.addEventListener("abort", () => {
      try {
        for (const relay of options.relays) {
          this._setAborted({
            relay,
            status: PublishStatus.Aborted,
            detail: "aborted",
          })
        }
      } finally {
        this._completeLifecycle("aborted")
      }
    })

    emitPublicationLifecycle({
      type: "created",
      publicationId: this.diagnosticId,
      ...(diagnostic.previousPublicationId
        ? {previousPublicationId: diagnostic.previousPublicationId}
        : {}),
      eventKind: this.event.kind,
      attempt: this.diagnosticAttempt,
      destinations: options.relays.map(safePublicationRelay),
      ...this._diagnosticContext(),
    })
  }

  _diagnosticContext = () => ({
    ...(this.options.operationId ? {operationId: this.options.operationId} : {}),
    ...(this.options.publicationStage ? {publicationStage: this.options.publicationStage} : {}),
  })

  _completeLifecycle = (
    terminalReason: NonNullable<PublicationLifecycleObservation["terminalReason"]>,
  ) => {
    if (this._terminal) return
    this._terminal = true
    const resultCounts = Object.values(this.results).reduce<Record<string, number>>(
      (counts, result) => ({...counts, [result.status]: (counts[result.status] || 0) + 1}),
      {},
    )
    emitPublicationLifecycle({
      type: "completed",
      publicationId: this.diagnosticId,
      eventKind: this.event.kind,
      attempt: this.diagnosticAttempt,
      resultCounts,
      terminalReason,
      ...this._diagnosticContext(),
    })
    this._subs = []
    this.complete.resolve()
  }

  _notify() {
    for (const subscriber of this._subs) {
      subscriber(this)
    }
  }

  _fail(detail: string) {
    for (const relay of this.options.relays) {
      this.results[relay] = {
        relay,
        status: PublishStatus.Failure,
        detail: detail,
      }
      this._observeResult(this.results[relay]!)
    }

    this._notify()
  }

  _observeResult = (result: PublishResult) => {
    emitPublicationLifecycle({
      type: "result",
      publicationId: this.diagnosticId,
      eventKind: this.event.kind,
      attempt: this.diagnosticAttempt,
      relay: safePublicationRelay(result.relay),
      status: result.status,
      ...this._diagnosticContext(),
    })
  }

  _setSuccess = (result: PublishResult, eventId = this.event.id) => {
    tracker.track(eventId, result.relay)
    this.options.onSuccess?.(result)
    this.results[result.relay] = result
    this._observeResult(result)
    this._notify()
  }

  _setFailure = (result: PublishResult) => {
    this.options.onFailure?.(result)
    this.results[result.relay] = result
    this._observeResult(result)
    this._notify()
  }

  _setPending = (result: PublishResult) => {
    this.options.onPending?.(result)
    this.results[result.relay] = result
    this._observeResult(result)
    this._notify()
  }

  _setTimeout = (result: PublishResult) => {
    this.options.onTimeout?.(result)
    this.results[result.relay] = result
    this._observeResult(result)
    this._notify()
  }

  _setAborted = (result: PublishResult) => {
    this.options.onAborted?.(result)
    this.results[result.relay] = result
    this._observeResult(result)
    this._notify()
  }

  async _publish(event: SignedEvent) {
    // Wait if the thunk is to be delayed
    if (this.options.delay) {
      await sleep(this.options.delay)
    }

    // Skip publishing if aborted
    if (this.controller.signal.aborted) {
      return
    }

    // Send it off
    const signal = this.options.signal
      ? AbortSignal.any([this.controller.signal, this.options.signal])
      : this.controller.signal

    try {
      await publish({
        ...this.options,
        event,
        signal,
        onSuccess: result => this._setSuccess(result, event.id),
        onFailure: this._setFailure,
        onPending: this._setPending,
        onTimeout: this._setTimeout,
        onAborted: this._setAborted,
        onComplete: (result: PublishResult) => {
          this.options.onComplete?.(result)
          this._subs = []
        },
      })
      this._completeLifecycle(signal.aborted ? "aborted" : "settled")
    } catch (error) {
      try {
        this._fail(String(error || "Failed to publish event"))
      } finally {
        this._completeLifecycle("transport-exception")
      }
      throw error
    }
  }

  async publish() {
    // Handle abort immediately if possible
    if (this.controller.signal.aborted) return

    emitPublicationLifecycle({
      type: "started",
      publicationId: this.diagnosticId,
      eventKind: this.event.kind,
      attempt: this.diagnosticAttempt,
      ...this._diagnosticContext(),
    })

    const {recipient} = this.options

    // If we're sending it privately, wrap the event using nip 59
    if (recipient) {
      if (this.wrap) return this._publish(this.wrap)

      const wrapper = Nip01Signer.ephemeral()
      const nip59 = new Nip59(this.signer, wrapper)

      this.wrap = await nip59.wrap(recipient, this.event)

      // If we're calculating pow, update the hash and re-sign
      if (this.options.pow) {
        this.wrap = await wrapper.sign(await makePow(this.wrap, this.options.pow).result, {
          signal: AbortSignal.timeout(30_000),
        })
      }

      wrapManager.add({recipient, wrap: this.wrap, rumor: this.event})

      return this._publish(this.wrap)
    }

    // If the event has been signed, we're good to go
    if (isSignedEvent(this.event)) {
      if (this.options.pow) {
        console.warn("Event is already signed, skipping proof of work calculation")
      }

      return this._publish(this.event)
    }

    // Allow for lazily signing/powing events in order to decrease apparent latency in the UI
    // that results from waiting for remote signers
    try {
      if (this.options.pow) {
        this.event = await makePow(this.event, this.options.pow).result
      }

      const signedEvent = await this.signer.sign(this.event, {
        signal: AbortSignal.timeout(30_000),
      })

      if (this.options.optimistic !== false) {
        if (this._optimisticEventId) repository.removeEvent(this._optimisticEventId)
        repository.publish(signedEvent)
        this._optimisticEventId = undefined
      }

      this.event = signedEvent

      return this._publish(signedEvent)
    } catch (e: any) {
      console.error("Failed to sign event", e)
      emitPublicationLifecycle({
        type: "signing-failure",
        publicationId: this.diagnosticId,
        eventKind: this.event.kind,
        attempt: this.diagnosticAttempt,
        ...this._diagnosticContext(),
      })
      try {
        this._fail(String(e || "Failed to sign event"))
      } finally {
        this._completeLifecycle("signing-failure")
      }
    }
  }

  enqueue() {
    thunkQueue.push(this)

    if (this.options.optimistic !== false && repository.publish(this.event)) {
      this._optimisticEventId = this.event.id
    }

    const hasGlobalPresentation = this.options.presentation !== "private"
    if (hasGlobalPresentation) {
      thunks.update($thunks => append(this, $thunks))
    }

    this.controller.signal.addEventListener("abort", () => {
      if (this.wrap) {
        wrapManager.remove(this.wrap.id)
      } else if (this.options.optimistic !== false && this._optimisticEventId) {
        repository.removeEvent(this._optimisticEventId)
        this._optimisticEventId = undefined
      }

      if (hasGlobalPresentation) {
        thunks.update($thunks => remove(this, $thunks))
      }
    })
  }

  subscribe(subscriber: Subscriber<Thunk>) {
    this._subs.push(subscriber)

    subscriber(this)

    return () => {
      this._subs = remove(subscriber, this._subs)
    }
  }
}

export class MergedThunk {
  _subs: Subscriber<MergedThunk>[] = []

  results: PublishResultsByRelay = {}

  constructor(readonly thunks: Thunk[]) {
    const {Aborted, Failure, Timeout, Pending, Sending, Success} = PublishStatus
    const relays = new Set(
      thunks.flatMap(thunk => [...thunk.options.relays, ...Object.keys(thunk.results)]),
    )

    for (const thunk of thunks) {
      thunk.subscribe($thunk => {
        this.results = {}

        for (const relay of relays) {
          for (const status of [Aborted, Failure, Timeout, Pending, Sending, Success]) {
            const thunk = thunks.find(t => t.results[relay]?.status === status)

            if (thunk) {
              this.results[relay] = thunk.results[relay]!
            }
          }
        }

        this._notify()

        if (thunks.every(thunkIsComplete)) {
          this._subs = []
        }
      })
    }
  }

  _notify() {
    for (const subscriber of this._subs) {
      subscriber(this)
    }
  }

  subscribe(subscriber: Subscriber<MergedThunk>) {
    this._subs.push(subscriber)

    subscriber(this)

    return () => {
      this._subs = remove(subscriber, this._subs)
    }
  }
}

export type AbstractThunk = Thunk | MergedThunk

export const isThunk = (thunk: AbstractThunk): thunk is Thunk => thunk instanceof Thunk

export const isMergedThunk = (thunk: AbstractThunk): thunk is MergedThunk =>
  thunk instanceof MergedThunk

// Thunk status urls

export const getThunkUrlsWithStatus = (
  statuses: PublishStatus | PublishStatus[],
  thunk: AbstractThunk,
) => {
  statuses = ensurePlural(statuses)

  return Object.entries(thunk.results)
    .filter(([_, {status}]) => statuses.includes(status))
    .map(nth(0)) as string[]
}

export const getCompleteThunkUrls = (thunk: AbstractThunk) =>
  getThunkUrlsWithStatus(
    without([PublishStatus.Sending, PublishStatus.Pending], Object.values(PublishStatus)),
    thunk,
  )

export const getIncompleteThunkUrls = (thunk: AbstractThunk) =>
  getThunkUrlsWithStatus([PublishStatus.Sending, PublishStatus.Pending], thunk)

export const getFailedThunkUrls = (thunk: AbstractThunk) =>
  getThunkUrlsWithStatus([PublishStatus.Failure, PublishStatus.Timeout], thunk)

// Thunk status checks

export const thunkHasStatus = (statuses: PublishStatus | PublishStatus[], thunk: AbstractThunk) =>
  getThunkUrlsWithStatus(statuses, thunk).length > 0

export const thunkIsComplete = (thunk: AbstractThunk) =>
  !thunkHasStatus([PublishStatus.Sending, PublishStatus.Pending], thunk)

// Thunk errors

export const getThunkError = (thunk: Thunk) => {
  for (const [_, {status, detail}] of Object.entries(thunk.results)) {
    if (status === PublishStatus.Failure) {
      return detail
    }
  }

  if (thunkIsComplete(thunk)) {
    return ""
  }
}

// Thunk utilities that return promises

export const waitForThunkError = (thunk: Thunk) =>
  new Promise<string>(resolve => {
    thunk.subscribe($thunk => {
      const error = getThunkError($thunk)

      if (error !== undefined) {
        resolve(error)
      }
    })
  })

export const waitForThunkCompletion = (thunk: Thunk) =>
  new Promise<void>(resolve => {
    thunk.subscribe($thunk => {
      if (thunkIsComplete($thunk)) {
        resolve()
      }
    })
  })

export const waitForAnyRelayAck = (
  thunk: Thunk,
  targetRelays: string[] = thunk.options.relays,
  {signal}: {signal?: AbortSignal} = {},
): Promise<PublishResult> => {
  const targets = sanitizeRelayUrls(targetRelays)
  const getAbortReason = () => {
    if (signal?.reason !== undefined) return signal.reason

    const error = new Error("Relay ACK wait was aborted")
    error.name = "AbortError"
    return error
  }

  if (targets.length === 0) {
    return Promise.reject(new Error("Cannot wait for a relay ACK without target relays"))
  }

  if (signal?.aborted) {
    return Promise.reject(getAbortReason())
  }

  const inspect = ($thunk: Thunk): PublishResult | Error | undefined => {
    for (const relay of targets) {
      const result = $thunk.results[relay]

      if (result?.status === PublishStatus.Success) return result
    }

    const isTerminal = targets.every(relay => {
      const result = $thunk.results[relay]

      return !result || ![PublishStatus.Sending, PublishStatus.Pending].includes(result.status)
    })

    if (!isTerminal) return

    const detail = targets
      .map(relay => {
        const result = $thunk.results[relay]

        if (!result) return `${relay}: no result`

        return `${relay}: ${result.status}${result.detail ? ` (${result.detail})` : ""}`
      })
      .join("; ")

    return new Error(`No target relay acknowledged publication (${detail})`)
  }

  const initial = inspect(thunk)

  if (initial instanceof Error) return Promise.reject(initial)
  if (initial) return Promise.resolve(initial)

  return new Promise<PublishResult>((resolve, reject) => {
    // subscribe may synchronously call cleanup before assignment.
    // eslint-disable-next-line prefer-const
    let unsubscribe: (() => void) | undefined
    const cleanup = () => {
      unsubscribe?.()
      signal?.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(getAbortReason())
    }

    signal?.addEventListener("abort", onAbort, {once: true})

    unsubscribe = thunk.subscribe($thunk => {
      const outcome = inspect($thunk)

      if (!outcome) return

      cleanup()

      if (outcome instanceof Error) {
        reject(outcome)
      } else {
        resolve(outcome)
      }
    })
  })
}

// Thunk state

export const thunks = writable<Thunk[]>([])

export const thunkQueue = new TaskQueue<Thunk>({
  batchSize: 10,
  batchDelay: 100,
  processItem: (thunk: Thunk) => {
    void thunk.publish().catch(e => {
      console.error("Failed to publish event", e)
      if (!thunk._terminal) {
        try {
          thunk._fail(String(e || "Failed to publish event"))
        } finally {
          thunk._completeLifecycle("transport-exception")
        }
      }
    })
  },
})

// Other thunk utilities

export const mergeThunks = (thunks: AbstractThunk[]) =>
  new MergedThunk(Array.from(flattenThunks(thunks)))

export function* flattenThunks(thunks: AbstractThunk[]): Iterable<Thunk> {
  for (const thunk of thunks) {
    if (isMergedThunk(thunk)) {
      yield* flattenThunks(thunk.thunks)
    } else {
      yield thunk
    }
  }
}

export const publishThunk = (options: ThunkOptions) => {
  const thunk = new Thunk(options)

  thunk.enqueue()

  return thunk
}

export const abortThunk = (thunk: AbstractThunk) => {
  for (const child of flattenThunks([thunk])) {
    child.controller.abort()
  }
}

export type RetryThunkOptions = {failedOnly?: boolean}

const retrySingleThunk = (thunk: Thunk, {failedOnly = false}: RetryThunkOptions = {}) => {
  const relays = failedOnly
    ? thunk.options.relays.filter(relay => thunk.results[relay]?.status !== PublishStatus.Success)
    : thunk.options.relays
  const retry = new Thunk(
    {...thunk.options, relays, event: thunk.event},
    {attempt: thunk.diagnosticAttempt + 1, previousPublicationId: thunk.diagnosticId},
  )

  // Recipient publications must retry the exact signed wrapper rather than
  // creating a new gift wrap with a different event ID.
  retry.wrap = thunk.wrap
  if (failedOnly) {
    // Keep previous ACKs visible, but never send another copy to those relays.
    for (const [relay, result] of Object.entries(thunk.results)) {
      if (result.status === PublishStatus.Success) retry.results[relay] = {...result}
    }
  }

  emitPublicationLifecycle({
    type: "retry",
    publicationId: retry.diagnosticId,
    previousPublicationId: thunk.diagnosticId,
    eventKind: retry.event.kind,
    attempt: retry.diagnosticAttempt,
    destinations: retry.options.relays.map(safePublicationRelay),
    ...retry._diagnosticContext(),
  })

  retry._optimisticEventId = thunk._optimisticEventId
  thunk._optimisticEventId = undefined
  retry.enqueue()

  return retry
}

export const retryThunk = (thunk: AbstractThunk, options: RetryThunkOptions = {}) =>
  isMergedThunk(thunk)
    ? mergeThunks(thunk.thunks.map(child => retrySingleThunk(child, options)))
    : retrySingleThunk(thunk, options)
