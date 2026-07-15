import {
  DELETE,
  EVENT_DATE,
  EVENT_TIME,
  isRelayUrl,
  normalizeRelayUrl,
  THREAD,
  ZAP_GOAL,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import type {CommunityDefinition} from "@app/core/community"
import {
  FORM_RESPONSE_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KINDS,
  parseTargetedPublication,
} from "@app/core/community"
import {
  COMMUNITY_EXCLUSIVE_KINDS,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilters,
} from "@app/core/community-feeds"
import {COMMUNITY_FORM_REVIEW_KIND} from "@app/core/community-forms"
import type {ModeratorPromotionRequest} from "@app/core/community-moderator-requests"
import {
  makeCommunityAdmissionFormFilters,
  makeCommunityDefinitionFilter,
  makeCommunityModeratorRequestDeleteFilters,
  makeCommunityModeratorRequestFilters,
  makeCommunityModeratorRequestReactionFilters,
  makeCommunityProfileListFilters,
  makeCommunityReportDeleteFilters,
  makeCommunityReportFilters,
  makeCommunityReportReviewFilters,
} from "@app/core/community-state"
import {writable, type Readable} from "svelte/store"

type CommunityLiveFilterInput = {
  definition: CommunityDefinition
  admissionFormAddresses: string[]
}

type CommunityFiniteFollowUpFilterInput = {
  definition: CommunityDefinition
  targetingEvents: TrustedEvent[]
  admissionResponseIds: string[]
  reportEvents: TrustedEvent[]
  moderatorRequests: ModeratorPromotionRequest[]
  moderatorRequestReactionEvents: TrustedEvent[]
}

const COMMUNITY_LIVE_TAG_CHUNK_SIZE = 100
export const COMMUNITY_HISTORICAL_TARGET_KINDS = [EVENT_DATE, EVENT_TIME, ZAP_GOAL] as const

export type CommunityLiveOwnership = ReadonlySet<string>

const normalizeCommunityLiveRelay = (relay: string) => {
  try {
    const normalized = normalizeRelayUrl(relay)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

export const getCommunityLiveOwnershipKey = (communityPubkey: string, relay: string) => {
  const normalizedRelay = normalizeCommunityLiveRelay(relay)
  return communityPubkey && normalizedRelay ? `${communityPubkey}\n${normalizedRelay}` : ""
}

const communityLiveOwnershipCounts = new Map<string, number>()
const communityLiveOwnershipState = writable<CommunityLiveOwnership>(new Set())

export const communityLiveOwnership: Readable<CommunityLiveOwnership> = {
  subscribe: communityLiveOwnershipState.subscribe,
}

export const isCommunityLiveOwned = (
  ownership: CommunityLiveOwnership,
  communityPubkey: string,
  relay: string,
) => ownership.has(getCommunityLiveOwnershipKey(communityPubkey, relay))

export const registerCommunityLiveOwnership = (communityPubkey: string, relay: string) => {
  const key = getCommunityLiveOwnershipKey(communityPubkey, relay)
  if (!key) return () => undefined
  communityLiveOwnershipCounts.set(key, (communityLiveOwnershipCounts.get(key) || 0) + 1)
  communityLiveOwnershipState.set(new Set(communityLiveOwnershipCounts.keys()))
  let released = false

  return () => {
    if (released) return
    released = true

    const count = communityLiveOwnershipCounts.get(key) || 0
    if (count <= 1) communityLiveOwnershipCounts.delete(key)
    else communityLiveOwnershipCounts.set(key, count - 1)
    communityLiveOwnershipState.set(new Set(communityLiveOwnershipCounts.keys()))
  }
}

export const normalizeCommunityLiveValues = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean))).sort()

export const buildCommunityHistoricalDiscoveryFilters = (communityPubkey: string): Filter[] => [
  {kinds: [THREAD], "#h": [communityPubkey]},
  makeCommunityTargetingFilter(communityPubkey, COMMUNITY_HISTORICAL_TARGET_KINDS),
]

export const getCommunityFiniteFollowUpRelays = (
  relays: string[],
  targetingEvents: TrustedEvent[],
) =>
  normalizeCommunityLiveValues([
    ...relays,
    ...targetingEvents.flatMap(event => {
      const relay = parseTargetedPublication(event)?.ref?.relay

      return relay ? [relay] : []
    }),
  ])

const chunkValues = <T>(values: T[], size: number) => {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

const normalizeFilter = (filter: Filter, live: boolean): Filter =>
  Object.fromEntries(
    Object.entries({...filter, ...(live ? {limit: 0} : {})}).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value].sort() : value,
    ]),
  ) as Filter

const getFilterKey = (filter: Filter) =>
  JSON.stringify(Object.fromEntries(Object.entries(filter).sort(([a], [b]) => a.localeCompare(b))))

const dedupeFilters = (filters: Filter[], live: boolean) => {
  const deduped = new Map<string, Filter>()

  for (const filter of filters.map(filter => normalizeFilter(filter, live))) {
    deduped.set(getFilterKey(filter), filter)
  }

  return Array.from(deduped.values())
}

const pushTagChunkFilters = (filters: Filter[], kinds: number[], tag: string, values: string[]) => {
  for (const chunk of chunkValues(
    normalizeCommunityLiveValues(values),
    COMMUNITY_LIVE_TAG_CHUNK_SIZE,
  )) {
    filters.push({kinds, [tag]: chunk} as Filter)
  }
}

const chunkFiltersByTag = (filters: Filter[], tag: string) =>
  filters.flatMap(filter => {
    const values = ((filter as Record<string, unknown>)[tag] || []) as string[]

    return values.length > COMMUNITY_LIVE_TAG_CHUNK_SIZE
      ? chunkValues(values, COMMUNITY_LIVE_TAG_CHUNK_SIZE).map(chunk => ({...filter, [tag]: chunk}))
      : [filter]
  })

export const buildCommunityLiveFilters = ({
  definition,
  admissionFormAddresses,
}: CommunityLiveFilterInput) => {
  const profileListFilters = makeCommunityProfileListFilters(definition)
  const profileListAuthors = normalizeCommunityLiveValues(
    profileListFilters.flatMap(filter => filter.authors || []),
  )
  const profileListIdentifiers = normalizeCommunityLiveValues(
    profileListFilters.flatMap(filter => filter["#d"] || []),
  )
  const filters: Filter[] = [
    makeCommunityDefinitionFilter(definition.pubkey),
    {kinds: COMMUNITY_EXCLUSIVE_KINDS, "#h": [definition.pubkey]},
    makeCommunityTargetingFilter(definition.pubkey, TARGETED_PUBLICATION_KINDS),
    ...(profileListAuthors.length && profileListIdentifiers.length
      ? [
          {
            kinds: [PROFILE_LIST_KIND],
            authors: profileListAuthors,
            "#d": profileListIdentifiers,
          } as Filter,
        ]
      : []),
    ...makeCommunityAdmissionFormFilters(definition),
    ...makeCommunityModeratorRequestFilters(definition),
    ...makeCommunityReportFilters(definition),
  ]

  pushTagChunkFilters(filters, [FORM_RESPONSE_KIND], "#a", admissionFormAddresses)

  return dedupeFilters(filters, true)
}

export const buildCommunityFiniteFollowUpFilters = ({
  definition,
  targetingEvents,
  admissionResponseIds,
  reportEvents,
  moderatorRequests,
  moderatorRequestReactionEvents,
}: CommunityFiniteFollowUpFilterInput) => {
  const filters: Filter[] = [
    ...makeTargetedPublicationOriginalFilters(targetingEvents),
    ...chunkFiltersByTag(
      makeCommunityModeratorRequestReactionFilters(definition, moderatorRequests),
      "#e",
    ),
    ...chunkFiltersByTag(
      makeCommunityModeratorRequestDeleteFilters(definition, moderatorRequestReactionEvents),
      "#e",
    ),
    ...chunkFiltersByTag(makeCommunityReportDeleteFilters(reportEvents), "#e"),
    ...chunkFiltersByTag(makeCommunityReportReviewFilters(definition, reportEvents), "#e"),
  ]

  pushTagChunkFilters(filters, [DELETE, COMMUNITY_FORM_REVIEW_KIND], "#e", admissionResponseIds)

  return dedupeFilters(filters, false)
}

export const getCommunityLiveSubscriptionKey = ({
  communityPubkey,
  relays,
  filters,
}: {
  communityPubkey: string
  relays: string[]
  filters: Filter[]
}) =>
  JSON.stringify({
    communityPubkey,
    relays: normalizeCommunityLiveValues(relays),
    filters: filters.map(filter => getFilterKey(normalizeFilter(filter, false))).sort(),
  })
