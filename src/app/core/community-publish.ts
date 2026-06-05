import {
  publish,
  PublishStatus,
  type PublishOptions,
  type PublishResultsByRelay,
} from "@welshman/net"
import {now} from "@welshman/lib"
import {
  deduplicateEvents,
  getAddress,
  getIdFilters,
  isReplaceable,
  type Filter,
  type SignedEvent,
  type TrustedEvent,
} from "@welshman/util"
import {normalizeRelay, normalizeRelays} from "@app/core/community"
import {loadCommunityEvents, type CommunityRelayLoadOptions} from "@app/core/community-state"

export const COMMUNITY_PUBLISH_TIMEOUT = 12_000
export const COMMUNITY_PUBLISH_VERIFY_TIMEOUT = 5_000

export type CommunityPublishStatusUpdate = (message: string) => void

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

const getPublishError = (results: PublishResultsByRelay, requiredRelay?: string) => {
  const normalizedRequiredRelay = normalizeRelay(requiredRelay)
  const result = normalizedRequiredRelay
    ? Object.entries(results).find(
        ([relay]) => normalizeRelay(relay) === normalizedRequiredRelay,
      )?.[1]
    : Object.values(results).find(result => result.status !== PublishStatus.Success) ||
      Object.values(results)[0]

  return result?.detail || "No relay accepted the event."
}

export const publishRequiredCommunityEvent = async ({
  event,
  relays,
  requiredRelay,
  timeout = COMMUNITY_PUBLISH_TIMEOUT,
  publishEvent = publish,
}: Omit<PublishCommunityEventOptions, "label" | "setStatus" | "verifyTimeout" | "loadEvents">) => {
  const normalizedRelays = normalizeRelays(relays)
  const normalizedRequiredRelay = normalizeRelay(requiredRelay)
  const results = await publishEvent({event, relays: normalizedRelays, timeout})
  const acceptedRelays = getSuccessfulPublishRelays(results)
  const requiredResult = normalizedRequiredRelay
    ? Object.entries(results).find(
        ([relay]) => normalizeRelay(relay) === normalizedRequiredRelay,
      )?.[1]
    : undefined
  const accepted = normalizedRequiredRelay
    ? requiredResult?.status === PublishStatus.Success
    : acceptedRelays.length > 0

  if (!accepted) throw new Error(getPublishError(results, requiredRelay))

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

  for (const relay of normalizedRelays) {
    const idMatches = await loadEvents(
      [relay],
      getIdFilters([event.id]).map(filter => ({...filter, limit: 1})),
      loadOptions,
    ).catch(() => [] as TrustedEvent[])
    const exactMatch = idMatches.find(match => match.id === event.id)
    if (!exactMatch) continue

    const currentFilter = makeReplacementCurrentFilter(event)
    if (!currentFilter) return exactMatch

    const replacementMatches = await loadEvents([relay], [currentFilter], loadOptions).catch(
      () => [] as TrustedEvent[],
    )
    const current = selectCurrentReplacementEvent(event, replacementMatches)

    if (current?.id === event.id) return exactMatch

    throw new Error(
      current
        ? `${label} was found on ${relay}, but ${relay} still serves a different replacement event.`
        : `${label} was found on ${relay}, but ${relay} did not serve it as the current replacement event.`,
    )
  }

  throw new Error(`${label} was accepted but was not found on the verified relay.`)
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
