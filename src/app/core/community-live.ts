import {
  BADGE_AWARD,
  BADGE_DEFINITION,
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
import type {CommunityDefinition, CommunityPointer} from "@app/core/community"
import {
  FORM_RESPONSE_KIND,
  PROFILE_LIST_KIND,
  TARGETED_PUBLICATION_KINDS,
  makeTargetedPublicationLifecycleFilters,
  parseTargetedPublication,
} from "@app/core/community"
import {
  COMMUNITY_EXCLUSIVE_KINDS,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilterPlan,
} from "@app/core/community-feeds"
import {COMMUNITY_FORM_REVIEW_KIND} from "@app/core/community-forms"
import type {ModeratorPromotionRequest} from "@app/core/community-moderator-requests"
import {
  makeCommunityAdmissionFormFilters,
  makeExactCommunityDefinitionFilter,
  makeCommunityModeratorRequestDeleteFilters,
  makeCommunityModeratorRequestFilters,
  makeCommunityModeratorRequestReactionFilters,
  makeCommunityProfileListFilters,
  makeCommunityReportDeleteFilters,
  makeCommunityReportReviewFilters,
} from "@app/core/community-state"
import {writable, type Readable} from "svelte/store"

type CommunityLiveFilterInput = {
  authorityDefinition: CommunityDefinition
  admissionFormAddresses: string[]
}

type CommunityFiniteFollowUpFilterInput = {
  authorityDefinition: CommunityDefinition
  targetingEvents: TrustedEvent[]
  targetingCandidateEvents?: TrustedEvent[]
  admissionResponseIds: string[]
  reportEvents: TrustedEvent[]
  moderatorRequests: ModeratorPromotionRequest[]
  moderatorRequestReactionEvents: TrustedEvent[]
}

type CommunityFiniteFollowUpRelayPlanInput = CommunityFiniteFollowUpFilterInput & {
  relays: string[]
}

export type CommunityFiniteFollowUpRelayPlan = {
  relay: string
  filters: Filter[]
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

export const getCommunityLiveOwnershipKey = (communityAddress: string, relay: string) => {
  const normalizedRelay = normalizeCommunityLiveRelay(relay)
  return communityAddress && normalizedRelay ? `${communityAddress}\n${normalizedRelay}` : ""
}

const communityLiveOwnershipCounts = new Map<string, number>()
const communityLiveOwnershipState = writable<CommunityLiveOwnership>(new Set())

export const communityLiveOwnership: Readable<CommunityLiveOwnership> = {
  subscribe: communityLiveOwnershipState.subscribe,
}

export const isCommunityLiveOwned = (
  ownership: CommunityLiveOwnership,
  communityAddress: string,
  relay: string,
) => ownership.has(getCommunityLiveOwnershipKey(communityAddress, relay))

export const registerCommunityLiveOwnership = (communityAddress: string, relay: string) => {
  const key = getCommunityLiveOwnershipKey(communityAddress, relay)
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

export const buildCommunityHistoricalDiscoveryFilters = (community: CommunityPointer): Filter[] => [
  {kinds: [THREAD], "#h": [community.communityId]},
  makeCommunityTargetingFilter(community.communityId, COMMUNITY_HISTORICAL_TARGET_KINDS),
]

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
  authorityDefinition,
  admissionFormAddresses,
}: CommunityLiveFilterInput) => {
  const community = authorityDefinition.pointer
  const profileListFilters = makeCommunityProfileListFilters(authorityDefinition)
  const profileListIdentifiers = normalizeCommunityLiveValues(
    profileListFilters.flatMap(filter => filter["#d"] || []),
  )
  const filters: Filter[] = [
    makeExactCommunityDefinitionFilter(community),
    {
      kinds: [...COMMUNITY_EXCLUSIVE_KINDS, BADGE_AWARD, BADGE_DEFINITION],
      "#h": [community.communityId],
    },
    makeCommunityTargetingFilter(community.communityId, TARGETED_PUBLICATION_KINDS),
    ...(profileListIdentifiers.length
      ? [
          {
            kinds: [PROFILE_LIST_KIND],
            "#d": profileListIdentifiers,
          } as Filter,
        ]
      : []),
    ...profileListFilters.filter(filter => filter.kinds?.includes(DELETE)),
    ...makeCommunityAdmissionFormFilters(authorityDefinition),
    ...makeCommunityModeratorRequestFilters(authorityDefinition),
  ]

  pushTagChunkFilters(filters, [FORM_RESPONSE_KIND], "#a", admissionFormAddresses)

  return dedupeFilters(filters, true)
}

export const buildCommunityFiniteFollowUpFilters = ({
  authorityDefinition,
  targetingEvents,
  targetingCandidateEvents,
  admissionResponseIds,
  reportEvents,
  moderatorRequests,
  moderatorRequestReactionEvents,
}: CommunityFiniteFollowUpFilterInput) => {
  const filters: Filter[] = [
    ...makeTargetedPublicationLifecycleFilters(targetingCandidateEvents || targetingEvents),
    ...makeTargetedPublicationOriginalFilterPlan(targetingEvents).relayFilters,
    ...chunkFiltersByTag(
      makeCommunityModeratorRequestReactionFilters(authorityDefinition, moderatorRequests),
      "#e",
    ),
    ...chunkFiltersByTag(
      makeCommunityModeratorRequestDeleteFilters(
        authorityDefinition,
        moderatorRequestReactionEvents,
      ),
      "#e",
    ),
    ...chunkFiltersByTag(makeCommunityReportDeleteFilters(reportEvents), "#e"),
    ...chunkFiltersByTag(
      makeCommunityReportReviewFilters(authorityDefinition.pointer, reportEvents),
      "#e",
    ),
  ]

  pushTagChunkFilters(filters, [DELETE, COMMUNITY_FORM_REVIEW_KIND], "#e", admissionResponseIds)

  return dedupeFilters(filters, false)
}

const buildCommunityWorkflowFollowUpFilters = ({
  authorityDefinition,
  admissionResponseIds,
  reportEvents,
  moderatorRequests,
  moderatorRequestReactionEvents,
  targetingCandidateEvents,
  targetingEvents,
}: CommunityFiniteFollowUpFilterInput) => {
  const filters: Filter[] = [
    ...makeTargetedPublicationLifecycleFilters(targetingCandidateEvents || targetingEvents),
    ...chunkFiltersByTag(
      makeCommunityModeratorRequestReactionFilters(authorityDefinition, moderatorRequests),
      "#e",
    ),
    ...chunkFiltersByTag(
      makeCommunityModeratorRequestDeleteFilters(
        authorityDefinition,
        moderatorRequestReactionEvents,
      ),
      "#e",
    ),
    ...chunkFiltersByTag(makeCommunityReportDeleteFilters(reportEvents), "#e"),
    ...chunkFiltersByTag(
      makeCommunityReportReviewFilters(authorityDefinition.pointer, reportEvents),
      "#e",
    ),
  ]

  pushTagChunkFilters(filters, [DELETE, COMMUNITY_FORM_REVIEW_KIND], "#e", admissionResponseIds)

  return dedupeFilters(filters, false)
}

export const buildCommunityFiniteFollowUpRelayPlans = ({
  relays,
  targetingEvents,
  ...input
}: CommunityFiniteFollowUpRelayPlanInput): CommunityFiniteFollowUpRelayPlan[] => {
  const communityRelays = normalizeCommunityLiveValues(
    relays.map(normalizeCommunityLiveRelay).filter(Boolean),
  )
  const communityRelaySet = new Set(communityRelays)
  const allOriginalFilters = makeTargetedPublicationOriginalFilterPlan(targetingEvents).relayFilters
  const communityFilters = dedupeFilters(
    [...allOriginalFilters, ...buildCommunityWorkflowFollowUpFilters({...input, targetingEvents})],
    false,
  )
  const filtersByRelay = new Map<string, Filter[]>()

  for (const relay of communityRelays) filtersByRelay.set(relay, communityFilters)

  for (const event of targetingEvents) {
    const relay = normalizeCommunityLiveRelay(parseTargetedPublication(event)?.source?.relay || "")
    if (!relay || communityRelaySet.has(relay)) continue

    filtersByRelay.set(
      relay,
      dedupeFilters(
        [
          ...(filtersByRelay.get(relay) || []),
          ...makeTargetedPublicationOriginalFilterPlan([event]).relayFilters,
        ],
        false,
      ),
    )
  }

  return Array.from(filtersByRelay, ([relay, filters]) => ({relay, filters}))
    .filter(plan => plan.filters.length > 0)
    .sort((a, b) => a.relay.localeCompare(b.relay))
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
