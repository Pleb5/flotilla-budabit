import {
  publish,
  publishOne,
  PublishStatus,
  type PublishOneOptions,
  type PublishResult,
  type PublishOptions,
  type PublishResultsByRelay,
} from "@welshman/net"
import {now} from "@welshman/lib"
import {
  deduplicateEvents,
  getAddress,
  getIdFilters,
  isReplaceable,
  PROFILE,
  type Filter,
  type SignedEvent,
  type TrustedEvent,
} from "@welshman/util"
import {normalizeRelay, normalizeRelays} from "@app/core/community"
import {loadCommunityEvents, type CommunityRelayLoadOptions} from "@app/core/community-state"
import {formatRelayPublishFailure, RelayPublishError} from "@app/core/relay-publish-outcomes"
import {recordRelayDelivery} from "@app/core/relay-publish-delivery"

export const COMMUNITY_PUBLISH_TIMEOUT = 12_000
export const COMMUNITY_PUBLISH_VERIFY_TIMEOUT = 5_000

export type CommunityPublishStatusUpdate = (message: string) => void

type ProfilePublishOptions = {
  event: SignedEvent
  relays: string[]
  setStatus?: CommunityPublishStatusUpdate
  timeout?: number
  verifyTimeout?: number
  publishToRelay?: (options: PublishOneOptions) => Promise<PublishResult>
  loadEvents?: typeof loadCommunityEvents
}

type PublishCommunityEventOptions = {
  event: SignedEvent
  relays: string[]
  requiredRelay?: string
  label: string
  setStatus?: CommunityPublishStatusUpdate
  timeout?: number
  verifyTimeout?: number
  publishEvent?: (options: PublishOptions) => Promise<PublishResultsByRelay>
  loadEvents?: typeof loadCommunityEvents
}

type VerifyCommunityEventOptions = {
  event: SignedEvent
  relays: string[]
  label: string
  timeout?: number
  loadEvents?: typeof loadCommunityEvents
}

export const getNextReplacementCreatedAt = (
  events: Array<Pick<TrustedEvent, "created_at"> | undefined>,
  currentTime = now(),
) => Math.max(currentTime, ...events.flatMap(event => (event ? [event.created_at + 1] : [])))

export const makeReplacementCurrentFilter = (event: SignedEvent): Filter | undefined => {
  if (!isReplaceable(event)) return undefined

  return getIdFilters([getAddress(event)]).map(filter => ({...filter, limit: 10}))[0]
}

export const selectCurrentReplacementEvent = (
  event: SignedEvent,
  events: TrustedEvent[],
): TrustedEvent | undefined => {
  if (!isReplaceable(event)) return undefined

  const address = getAddress(event)

  return deduplicateEvents(
    events.filter(candidate => isReplaceable(candidate) && getAddress(candidate) === address),
  )[0]
}

export const getSuccessfulPublishRelays = (results: PublishResultsByRelay) =>
  Object.entries(results).flatMap(([relay, result]) =>
    result.status === PublishStatus.Success ? [relay] : [],
  )

export const publishRequiredCommunityEvent = async ({
  event,
  relays,
  requiredRelay,
  label,
  timeout = COMMUNITY_PUBLISH_TIMEOUT,
  publishEvent = publish,
}: Omit<PublishCommunityEventOptions, "label" | "setStatus" | "verifyTimeout" | "loadEvents"> & {
  label?: string
}) => {
  const normalizedRelays = normalizeRelays(relays)
  const normalizedRequiredRelay = normalizeRelay(requiredRelay)
  if (normalizedRelays.length === 0) throw new Error("No publication relays are configured.")
  if (normalizedRequiredRelay && !normalizedRelays.includes(normalizedRequiredRelay)) {
    throw new Error(`Required relay ${normalizedRequiredRelay} is not a publication destination.`)
  }
  let received: PublishResultsByRelay
  try {
    received = await publishEvent({event, relays: normalizedRelays, timeout})
  } catch (error) {
    received = Object.fromEntries(
      normalizedRelays.map(relay => [
        relay,
        {
          relay,
          status: PublishStatus.Failure,
          detail: error instanceof Error ? error.message : String(error),
        },
      ]),
    )
  }
  const results: PublishResultsByRelay = Object.fromEntries(
    normalizedRelays.map(relay => [
      relay,
      Object.entries(received).find(([url]) => normalizeRelay(url) === relay)?.[1] || {
        relay,
        status: PublishStatus.Timeout,
        detail: "No result returned for this relay.",
      },
    ]),
  )
  const acceptedRelays = getSuccessfulPublishRelays(results)
  const requiredResult = normalizedRequiredRelay
    ? Object.entries(results).find(
        ([relay]) => normalizeRelay(relay) === normalizedRequiredRelay,
      )?.[1]
    : undefined
  const accepted = normalizedRequiredRelay
    ? requiredResult?.status === PublishStatus.Success
    : acceptedRelays.length > 0

  recordRelayDelivery(
    event,
    results,
    label || `Community event (kind ${event.kind})`,
    normalizedRequiredRelay,
  )
  if (!accepted)
    throw new RelayPublishError(event.id, results, normalizedRelays, normalizedRequiredRelay)

  return {
    results,
    acceptedRelays: normalizeRelays(
      normalizedRequiredRelay ? [normalizedRequiredRelay] : acceptedRelays,
    ),
  }
}

export const verifyCommunityEventReadback = async ({
  event,
  relays,
  label,
  timeout = COMMUNITY_PUBLISH_VERIFY_TIMEOUT,
  loadEvents = loadCommunityEvents,
}: VerifyCommunityEventOptions): Promise<TrustedEvent> => {
  const normalizedRelays = normalizeRelays(relays)
  const loadOptions: CommunityRelayLoadOptions = {
    authenticate: true,
    settle: "first-non-empty",
    timeout,
  }
  const failures: string[] = []

  for (const relay of normalizedRelays) {
    try {
      const idMatches = await loadEvents(
        [relay],
        getIdFilters([event.id]).map(filter => ({...filter, limit: 1})),
        loadOptions,
      )
      const exactMatch = idMatches.find(match => match.id === event.id)
      if (!exactMatch) {
        failures.push(`${relay}: ${label} was accepted but was not found on the verified relay.`)
        continue
      }

      const currentFilter = makeReplacementCurrentFilter(event)
      if (!currentFilter) return exactMatch

      const replacementMatches = await loadEvents([relay], [currentFilter], loadOptions)
      const current = selectCurrentReplacementEvent(event, [exactMatch, ...replacementMatches])

      if (current?.id === event.id) return exactMatch

      throw new Error(
        current
          ? `${label} was found on ${relay}, but ${relay} still serves a different replacement event.`
          : `${label} was found on ${relay}, but ${relay} did not serve it as the current replacement event.`,
      )
    } catch (error) {
      failures.push(
        `${relay}: readback failed — ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  throw new Error(
    failures.join("\n") || `${label} was accepted but no verification relay was available.`,
  )
}

export const publishAndVerifyCommunityEvent = async ({
  event,
  relays,
  requiredRelay,
  label,
  setStatus = () => undefined,
  timeout = COMMUNITY_PUBLISH_TIMEOUT,
  verifyTimeout = COMMUNITY_PUBLISH_VERIFY_TIMEOUT,
  publishEvent = publish,
  loadEvents = loadCommunityEvents,
}: PublishCommunityEventOptions): Promise<TrustedEvent> => {
  setStatus(`Publishing ${label}...`)
  const {acceptedRelays} = await publishRequiredCommunityEvent({
    event,
    relays,
    requiredRelay,
    label,
    timeout,
    publishEvent,
  })

  setStatus(`Verifying ${label} on relay...`)

  return verifyCommunityEventReadback({
    event,
    relays: acceptedRelays,
    label,
    timeout: verifyTimeout,
    loadEvents,
  })
}

export const publishAndVerifyProfileEvent = async ({
  event,
  relays,
  setStatus = () => undefined,
  timeout = COMMUNITY_PUBLISH_TIMEOUT,
  verifyTimeout = COMMUNITY_PUBLISH_VERIFY_TIMEOUT,
  publishToRelay = publishOne,
  loadEvents = loadCommunityEvents,
}: ProfilePublishOptions): Promise<TrustedEvent> => {
  if (event.kind !== PROFILE) throw new Error("Profile publication requires a kind-0 event.")

  const normalizedRelays = normalizeRelays(relays)
  if (normalizedRelays.length === 0) throw new Error("No profile publish relays are configured.")

  const controller = new AbortController()
  const results: PublishResultsByRelay = {}
  const verificationFailures: string[] = []
  setStatus("Publishing profile...")

  const attempts = normalizedRelays.map(async relay => {
    let result: PublishResult
    try {
      result = await publishToRelay({event, relay, signal: controller.signal, timeout})
    } catch (error) {
      result = {
        relay,
        status: PublishStatus.Failure,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
    results[relay] = result
    if (result.status !== PublishStatus.Success) {
      throw new RelayPublishError(event.id, {[relay]: result}, [relay])
    }

    setStatus("Verifying profile on relay...")
    let matches: TrustedEvent[]
    try {
      matches = await loadEvents([relay], [{kinds: [PROFILE], authors: [event.pubkey], limit: 1}], {
        authenticate: true,
        publishEvents: false,
        settle: "first-non-empty",
        signal: controller.signal,
        timeout: verifyTimeout,
      })
    } catch (error) {
      const message = `${relay}: profile was accepted, but readback failed: ${error instanceof Error ? error.message : String(error)}`
      verificationFailures.push(message)
      throw new Error(message)
    }
    const current = selectCurrentReplacementEvent(event, matches)

    if (current?.id !== event.id) {
      const message = current
        ? `Profile was accepted by ${relay}, but it serves a different current profile.`
        : `Profile was accepted by ${relay}, but it did not serve the current profile.`
      verificationFailures.push(message)
      throw new Error(message)
    }

    return current
  })

  try {
    const verified = await Promise.any(attempts)
    recordRelayDelivery(event, results, "Profile publication")
    return verified
  } catch (error) {
    if (error instanceof AggregateError) {
      for (const relay of normalizedRelays) {
        if (!results[relay])
          results[relay] = {
            relay,
            status: PublishStatus.Failure,
            detail: "Publish transport failed before returning a relay result.",
          }
      }
      recordRelayDelivery(event, results, "Profile publication")
      if (!verificationFailures.length) {
        throw new RelayPublishError(event.id, results, normalizedRelays)
      }
      throw new Error(
        [
          "No relay accepted and served the current profile.",
          ...verificationFailures,
          formatRelayPublishFailure(results, {fallback: ""}),
        ]
          .filter(Boolean)
          .join("\n"),
      )
    }

    throw error
  } finally {
    controller.abort()
  }
}
