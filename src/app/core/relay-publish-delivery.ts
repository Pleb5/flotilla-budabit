import {get, writable} from "svelte/store"
import {
  publish,
  PublishStatus,
  type PublishResultsByRelay,
  type PublishOptions,
} from "@welshman/net"
import {isSignedEvent, type HashedEvent, type SignedEvent} from "@welshman/util"
import {getRelayPublishOutcomes, hasRelayPublishFailures} from "./relay-publish-outcomes"

export type RelayDeliveryNotice = {
  eventId: string
  ownerPubkey: string
  label: string
  results: PublishResultsByRelay
  requiredRelay?: string
  retrying: boolean
  canRetry: boolean
  error?: string
}

// Session-local recovery only. Signed payloads stay out of diagnostics and UI snapshots.
const notices = writable<Map<string, RelayDeliveryNotice>>(new Map())
const payloads = new Map<string, SignedEvent>()
type RetryValidator = (event: HashedEvent) => void | Promise<void>
const retryValidators = new Map<string, RetryValidator>()
const monitors = new Map<string, () => void>()
const MAX_NOTICES = 100
export const relayDeliveryNotices = {subscribe: notices.subscribe}

const copyResults = (results: PublishResultsByRelay) =>
  Object.fromEntries(Object.entries(results).map(([relay, result]) => [relay, {...result}]))

export const dismissRelayDelivery = (eventId: string) => {
  monitors.get(eventId)?.()
  payloads.delete(eventId)
  retryValidators.delete(eventId)
  notices.update(current => {
    const next = new Map(current)
    next.delete(eventId)
    return next
  })
}

export const recordRelayDelivery = (
  event: HashedEvent,
  results: PublishResultsByRelay,
  label = "Publication",
  requiredRelay?: string,
  validateRetry?: RetryValidator,
) => {
  if (!hasRelayPublishFailures(results)) {
    if (
      Object.keys(results).length &&
      Object.values(results).every(result => result.status === PublishStatus.Success)
    ) {
      dismissRelayDelivery(event.id)
    }
    return
  }
  const signed = isSignedEvent(event)
  if (signed) payloads.set(event.id, event as SignedEvent)
  if (validateRetry) retryValidators.set(event.id, validateRetry)
  notices.update(current => {
    const next = new Map(current)
    next.set(event.id, {
      eventId: event.id,
      ownerPubkey: event.pubkey,
      label,
      results: copyResults(results),
      requiredRelay,
      retrying: false,
      canRetry: signed,
    })
    while (next.size > MAX_NOTICES) {
      const oldest = next.keys().next().value!
      next.delete(oldest)
      payloads.delete(oldest)
      retryValidators.delete(oldest)
      monitors.get(oldest)?.()
    }
    return next
  })
}

/** A first ACK can arrive before another destination rejects. Keep observing delivery
 * after the main operation commits, without turning a partial success into a failure.
 */
export const trackConfirmedRelayDelivery = (
  thunk: {
    event: HashedEvent
    results: PublishResultsByRelay
    subscribe?: (
      callback: (value: {event: HashedEvent; results: PublishResultsByRelay}) => void,
    ) => () => void
  },
  label: string,
  requiredRelay?: string,
  validateRetry?: RetryValidator,
) => {
  const eventId = thunk.event.id
  monitors.get(eventId)?.()
  let unsubscribe: (() => void) | undefined
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(timeout)
    unsubscribe?.()
    monitors.delete(eventId)
  }
  const timeout = setTimeout(stop, 60_000)
  monitors.set(eventId, stop)
  // Bound observers independently from the number of failures recorded.
  while (monitors.size > MAX_NOTICES) monitors.values().next().value!()
  const observe = (value: {event: HashedEvent; results: PublishResultsByRelay}) => {
    recordRelayDelivery(value.event, value.results, label, requiredRelay, validateRetry)
    const outcomes = getRelayPublishOutcomes(value.results)
    if (!outcomes.some(outcome => outcome.reason === "pending")) stop()
  }
  if (thunk.subscribe) {
    unsubscribe = thunk.subscribe(observe)
    if (stopped) unsubscribe()
  } else {
    observe(thunk)
    stop()
  }
}

export const retryRelayDelivery = async (
  eventId: string,
  activePubkey: string | undefined | (() => string | undefined),
  publishEvent: (options: PublishOptions) => Promise<PublishResultsByRelay> = publish,
) => {
  const notice = get(notices).get(eventId)
  const event = payloads.get(eventId)
  if (!notice || !event) throw new Error("This signed publication is no longer available to retry.")
  const currentPubkey = () => (typeof activePubkey === "function" ? activePubkey() : activePubkey)
  if (currentPubkey() !== notice.ownerPubkey)
    throw new Error("Restore the publishing account to retry.")
  if (notice.retrying) return
  const outcomes = getRelayPublishOutcomes(notice.results)
  if (outcomes.some(outcome => outcome.reason === "pending")) {
    throw new Error("Wait for the current relay attempts to finish before retrying.")
  }
  const relays = outcomes.filter(outcome => outcome.retry !== "none").map(outcome => outcome.relay)
  if (!relays.length)
    throw new Error("The rejected event needs correcting; retrying it unchanged cannot help.")
  monitors.get(eventId)?.()
  const update = (patch: Partial<RelayDeliveryNotice>) =>
    notices.update(current => {
      if (!current.has(eventId)) return current
      return new Map(current).set(eventId, {...current.get(eventId)!, ...patch})
    })
  update({retrying: true, error: undefined})
  try {
    const validateRetry = retryValidators.get(eventId)
    if (validateRetry) await validateRetry(event)
    if (payloads.get(eventId) !== event || !get(notices).has(eventId)) {
      throw new Error("This delivery report was cleared before retry.")
    }
    if (currentPubkey() !== notice.ownerPubkey)
      throw new Error("Restore the publishing account to retry.")
    const attempt = await publishEvent({event, relays, timeout: 12_000})
    const results = {...notice.results}
    for (const relay of relays) {
      const result = attempt[relay]
      results[relay] =
        result &&
        [
          PublishStatus.Success,
          PublishStatus.Failure,
          PublishStatus.Timeout,
          PublishStatus.Aborted,
        ].includes(result.status)
          ? result
          : {
              relay,
              status: PublishStatus.Timeout,
              detail: "No terminal result returned for this relay.",
            }
    }
    if (!hasRelayPublishFailures(results)) dismissRelayDelivery(eventId)
    else update({results: copyResults(results), retrying: false})
  } catch (error) {
    update({retrying: false, error: error instanceof Error ? error.message : String(error)})
    throw error
  }
}

export const clearRelayDeliveries = () => {
  for (const stop of [...monitors.values()]) stop()
  payloads.clear()
  retryValidators.clear()
  notices.set(new Map())
}

if (import.meta.hot) import.meta.hot.dispose(clearRelayDeliveries)
