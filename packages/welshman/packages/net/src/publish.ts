import {fromPairs, once} from "@welshman/lib"
import {normalizeRelayUrl, sanitizeRelayUrls, type SignedEvent} from "@welshman/util"
import {type RelayMessage, ClientMessageType, isRelayOk} from "./message.js"
import {AdapterEvent, type AdapterContext, getAdapter} from "./adapter.js"

export enum PublishStatus {
  Sending = "sending",
  Pending = "pending",
  Success = "success",
  Failure = "failure",
  Timeout = "timeout",
  Aborted = "aborted",
  Skipped = "skipped",
}

export type PublishResult = {
  status: PublishStatus
  detail: string
  relay: string
}

/** Synchronous local policy only. Observations are actual, matching relay OK replies. */
export type PublishPolicy = {
  check: (relay: string, event: SignedEvent) => {detail: string} | undefined
  observeAck: (relay: string, event: SignedEvent, ok: boolean, detail: string) => void
}

const publishPolicies: PublishPolicy[] = []

export const setPublishPolicy = (policy: PublishPolicy) => {
  publishPolicies.push(policy)
  return () => {
    const index = publishPolicies.lastIndexOf(policy)
    if (index >= 0) publishPolicies.splice(index, 1)
  }
}

export type PublishOneOptions = {
  event: SignedEvent
  relay: string
  signal?: AbortSignal
  timeout?: number
  context?: AdapterContext
  onSuccess?: (result: PublishResult) => void
  onFailure?: (result: PublishResult) => void
  onPending?: (result: PublishResult) => void
  onTimeout?: (result: PublishResult) => void
  onAborted?: (result: PublishResult) => void
  onSkipped?: (result: PublishResult) => void
  onComplete?: (result: PublishResult) => void
}

export const publishOne = (options: PublishOneOptions) =>
  new Promise<PublishResult>(resolve => {
    const relay = normalizeRelayUrl(options.relay)
    const policy = publishPolicies.at(-1)
    let skipped: {detail: string} | undefined
    try {
      if (!options.signal?.aborted) skipped = policy?.check(relay, options.event)
    } catch {
      // A broken local cache must not stop an ordinary publication.
    }
    if (skipped) {
      const result = {relay, status: PublishStatus.Skipped, detail: skipped.detail}
      options.onSkipped?.(result)
      options.onComplete?.(result)
      resolve(result)
      return
    }
    const adapter = getAdapter(relay, options.context)

    const result = {
      relay,
      status: PublishStatus.Pending,
      detail: "",
    }

    options.onPending?.(result)

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const abort = () => {
      if (result.status === PublishStatus.Pending) {
        result.status = PublishStatus.Aborted
        result.detail = "aborted"

        options.onAborted?.(result)
      }

      cleanup()
    }

    const cleanup = once(() => {
      options.signal?.removeEventListener("abort", abort)
      options.onComplete?.(result)
      if (timeoutId) clearTimeout(timeoutId)
      adapter.cleanup()
      resolve(result)
    })

    adapter.on(AdapterEvent.Receive, (message: RelayMessage, url: string) => {
      if (isRelayOk(message)) {
        const [_, id, ok, detail] = message

        if (id !== options.event.id) return

        try {
          policy?.observeAck(relay, options.event, ok, detail)
        } catch {
          // Capability persistence must not change the ACK or publication lifecycle.
        }

        if (ok) {
          result.status = PublishStatus.Success
          result.detail = detail

          options.onSuccess?.(result)
        } else {
          result.status = PublishStatus.Failure
          result.detail = detail

          options.onFailure?.(result)
        }

        cleanup()
      }
    })

    if (options.signal) {
      options.signal.addEventListener("abort", abort)
    }

    timeoutId = setTimeout(() => {
      if (result.status === PublishStatus.Pending) {
        result.status = PublishStatus.Timeout
        result.detail = "timed out"

        options.onTimeout?.(result)
      }

      cleanup()
    }, options.timeout || 10_000)

    adapter.send([ClientMessageType.Event, options.event])
  })

export type PublishResultsByRelay = Record<string, PublishResult>

export type PublishOptions = {
  event: SignedEvent
  relays: string[]
  signal?: AbortSignal
  timeout?: number
  context?: AdapterContext
  onSuccess?: (result: PublishResult) => void
  onFailure?: (result: PublishResult) => void
  onPending?: (result: PublishResult) => void
  onTimeout?: (result: PublishResult) => void
  onAborted?: (result: PublishResult) => void
  onSkipped?: (result: PublishResult) => void
  onComplete?: (result: PublishResult) => void
}

export const publish = async (options: PublishOptions): Promise<PublishResultsByRelay> => {
  const {event, timeout, signal, context} = options
  const completed = new Set<string>()
  const relays = sanitizeRelayUrls(options.relays)

  return fromPairs(
    await Promise.all(
      relays.map(async relay => {
        const result = await publishOne({
          event,
          relay,
          signal,
          timeout,
          context,
          onSuccess: options.onSuccess,
          onFailure: options.onFailure,
          onPending: options.onPending,
          onTimeout: options.onTimeout,
          onAborted: options.onAborted,
          onSkipped: options.onSkipped,
          onComplete: (result: PublishResult) => {
            completed.add(relay)

            if (completed.size === relays.length) {
              options.onComplete?.(result)
            }
          },
        })

        return [relay, result]
      }),
    ),
  )
}
