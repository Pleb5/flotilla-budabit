import {DELETE, type Filter, type TrustedEvent} from "@welshman/util"
import type {CommunityDefinition} from "@app/core/community"
import {FORM_RESPONSE_KIND, TARGETED_PUBLICATION_KINDS} from "@app/core/community"
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
} from "@app/core/community-state"

type CommunityLiveFilterInput = {
  definition: CommunityDefinition
  targetingEvents: TrustedEvent[]
  admissionFormAddresses: string[]
  admissionResponseIds: string[]
  reportEvents: TrustedEvent[]
  moderatorRequests: ModeratorPromotionRequest[]
  moderatorRequestReactionEvents: TrustedEvent[]
}

const COMMUNITY_LIVE_TAG_CHUNK_SIZE = 100

export const normalizeCommunityLiveValues = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean))).sort()

const chunkValues = <T>(values: T[], size: number) => {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

const normalizeFilter = (filter: Filter): Filter =>
  Object.fromEntries(
    Object.entries({...filter, limit: 0}).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value].sort() : value,
    ]),
  ) as Filter

const getFilterKey = (filter: Filter) =>
  JSON.stringify(Object.fromEntries(Object.entries(filter).sort(([a], [b]) => a.localeCompare(b))))

const dedupeLiveFilters = (filters: Filter[]) => {
  const deduped = new Map<string, Filter>()

  for (const filter of filters.map(normalizeFilter)) {
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

export const buildCommunityLiveFilters = ({
  definition,
  targetingEvents,
  admissionFormAddresses,
  admissionResponseIds,
  reportEvents,
  moderatorRequests,
  moderatorRequestReactionEvents,
}: CommunityLiveFilterInput) => {
  const filters: Filter[] = [
    makeCommunityDefinitionFilter(definition.pubkey),
    {kinds: COMMUNITY_EXCLUSIVE_KINDS, "#h": [definition.pubkey]},
    makeCommunityTargetingFilter(definition.pubkey, TARGETED_PUBLICATION_KINDS),
    ...makeCommunityProfileListFilters(definition),
    ...makeCommunityAdmissionFormFilters(definition),
    ...makeCommunityModeratorRequestFilters(definition),
    ...makeCommunityModeratorRequestReactionFilters(definition, moderatorRequests),
    ...makeCommunityModeratorRequestDeleteFilters(definition, moderatorRequestReactionEvents),
    ...makeCommunityReportFilters(definition),
    ...makeCommunityReportDeleteFilters(reportEvents),
    ...makeTargetedPublicationOriginalFilters(targetingEvents),
  ]

  pushTagChunkFilters(filters, [FORM_RESPONSE_KIND], "#a", admissionFormAddresses)
  pushTagChunkFilters(filters, [DELETE, COMMUNITY_FORM_REVIEW_KIND], "#e", admissionResponseIds)

  return dedupeLiveFilters(filters)
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
    filters: filters.map(filter => getFilterKey(normalizeFilter(filter))).sort(),
  })
