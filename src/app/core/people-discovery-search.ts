import {derived} from "svelte/store"
import {
  followLists,
  getFollows,
  getMutes,
  muteLists,
  profileSearch as welshmanProfileSearch,
  profilesByPubkey,
  pubkey,
  repository,
} from "@welshman/app"
import {deriveEvents} from "@welshman/store"
import type {TrustedEvent} from "@welshman/util"
import {
  activeCommunityDefinition,
  activeCommunityProfileListEvents,
  activeCommunityReportState,
  communityAdminDefinitionEvents,
  communityMemberDefinitionEvents,
  communityMemberProfileListEvents,
  communityMemberReportStates,
  communityModeratorDefinitionEvents,
  communityModeratorProfileListEvents,
} from "@app/core/community-state"
import {
  normalizePubkey,
  parseCommunityDefinition,
  TARGETED_PUBLICATION_KIND,
  type CommunityDefinition,
} from "@app/core/community"
import {userRenouncedCommunityPubkeys} from "@app/core/community-renunciations"
import {buildCommunityTrustAssessments} from "@app/core/community-trust"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import {
  resolvePeopleDiscoveryContext,
  type PeopleDiscoveryContext,
  type RepoPeopleDiscoveryContext,
} from "@app/core/people-discovery-context"
import {getRepoAddress} from "@app/core/repo-community-context"
import {
  buildPeopleSearchCandidates,
  getCommunityPeoplePubkeys,
  getPeopleSearchTextScore,
  searchPeopleCandidates,
  type PeopleSearchBatch,
  type PeopleSearchResult,
} from "@app/util/people-search"

export type PeopleDiscoverySearchOptions = {
  context?: PeopleDiscoveryContext
  recentConversationPubkeys?: string[]
  knownPubkeys?: string[]
  additionalProfileMatches?: string[]
  excludePubkeys?: string[]
  cursor?: number
  scanLimit?: number
  resultLimit?: number
  allowEmptyQuery?: boolean
}

export type PeopleDiscoverySearch = {
  search: (query: string, options?: PeopleDiscoverySearchOptions) => PeopleSearchBatch
  searchResults: (query: string, options?: PeopleDiscoverySearchOptions) => PeopleSearchResult[]
  searchValues: (query: string, options?: PeopleDiscoverySearchOptions) => string[]
}

type PeopleDiscoveryEvidence = {
  definitionEvents: TrustedEvent[]
  definitions: CommunityDefinition[]
  profileListEvents: TrustedEvent[]
  reportStates: Map<string, EffectiveCommunityReportState>
  renouncedCommunityPubkeys: string[]
}

const dedupeEvents = (events: TrustedEvent[]) =>
  Array.from(new Map(events.filter(event => event.id).map(event => [event.id, event])).values())

const selectLatestDefinitions = (events: TrustedEvent[]) => {
  const definitions = new Map<string, CommunityDefinition>()

  for (const event of events) {
    const definition = parseCommunityDefinition(event)
    if (!definition) continue

    const current = definitions.get(definition.pubkey)
    if (
      !current ||
      definition.event.created_at > current.event.created_at ||
      (definition.event.created_at === current.event.created_at &&
        definition.event.id.localeCompare(current.event.id) < 0)
    ) {
      definitions.set(definition.pubkey, definition)
    }
  }

  return Array.from(definitions.values())
}

const getContextCommunityPeoplePubkeys = (
  communityPubkey: string,
  evidence: PeopleDiscoveryEvidence,
) => {
  if (!communityPubkey) {
    return getCommunityPeoplePubkeys({
      definitionEvents: evidence.definitionEvents,
      profileListEvents: evidence.profileListEvents,
      excludedCommunityPubkeys: evidence.renouncedCommunityPubkeys,
    })
  }

  const definition = evidence.definitions.find(item => item.pubkey === communityPubkey)
  if (!definition) return [communityPubkey]

  const profileListAddresses = new Set(
    definition.sections.flatMap(section =>
      section.profileLists.map(profileList => profileList.address),
    ),
  )
  const profileListEvents = evidence.profileListEvents.filter(event => {
    const identifier = event.tags.find(tag => tag[0] === "d")?.[1] || ""
    return Boolean(
      identifier && profileListAddresses.has(`${event.kind}:${event.pubkey}:${identifier}`),
    )
  })

  return getCommunityPeoplePubkeys({
    definitionEvents: [definition.event],
    profileListEvents,
    excludedCommunityPubkeys: evidence.renouncedCommunityPubkeys,
  })
}

const withLoadedRepoAssociations = (
  context: PeopleDiscoveryContext | undefined,
  loadedAssociationEvents: TrustedEvent[],
): PeopleDiscoveryContext | undefined => {
  if (
    context?.scope !== "repo" ||
    context.authority.source !== "announcement" ||
    context.associationEvents !== undefined
  ) {
    return context
  }

  const repoEvent = context.authority.event
  const repoAddress = context.repoAddress || getRepoAddress(repoEvent as TrustedEvent)
  const associationEvents = loadedAssociationEvents.filter(event =>
    event.tags.some(
      tag =>
        (tag[0] === "a" && tag[1] === repoAddress) ||
        (tag[0] === "e" && tag[1] === repoEvent.id),
    ),
  )

  return {...context, repoAddress, associationEvents} satisfies RepoPeopleDiscoveryContext
}

const loadedRepoAssociationEvents = deriveEvents({
  repository,
  filters: [{kinds: [TARGETED_PUBLICATION_KIND]}],
})

export const peopleDiscoverySearch = derived(
  [
    welshmanProfileSearch,
    profilesByPubkey,
    pubkey,
    followLists,
    muteLists,
    communityAdminDefinitionEvents,
    communityMemberDefinitionEvents,
    communityModeratorDefinitionEvents,
    communityMemberProfileListEvents,
    communityModeratorProfileListEvents,
    communityMemberReportStates,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    userRenouncedCommunityPubkeys,
    loadedRepoAssociationEvents,
  ] as const,
  ([
    $welshmanProfileSearch,
    $profilesByPubkey,
    $pubkey,
    _followLists,
    _muteLists,
    $communityAdminDefinitionEvents,
    $communityMemberDefinitionEvents,
    $communityModeratorDefinitionEvents,
    $communityMemberProfileListEvents,
    $communityModeratorProfileListEvents,
    $communityMemberReportStates,
    $activeCommunityDefinition,
    $activeCommunityProfileListEvents,
    $activeCommunityReportState,
    $userRenouncedCommunityPubkeys,
    $loadedRepoAssociationEvents,
  ]): PeopleDiscoverySearch => {
    const definitionEvents = dedupeEvents([
      ...$communityAdminDefinitionEvents,
      ...$communityMemberDefinitionEvents,
      ...$communityModeratorDefinitionEvents,
      ...($activeCommunityDefinition ? [$activeCommunityDefinition.event] : []),
    ])
    const profileListEvents = dedupeEvents([
      ...$communityMemberProfileListEvents,
      ...$communityModeratorProfileListEvents,
      ...$activeCommunityProfileListEvents,
    ])
    const reportStates = new Map($communityMemberReportStates)
    if ($activeCommunityDefinition) {
      reportStates.set($activeCommunityDefinition.pubkey, $activeCommunityReportState)
    }
    const evidence: PeopleDiscoveryEvidence = {
      definitionEvents,
      definitions: selectLatestDefinitions(definitionEvents),
      profileListEvents,
      reportStates,
      renouncedCommunityPubkeys: $userRenouncedCommunityPubkeys,
    }
    const viewerPubkey = normalizePubkey($pubkey || "")
    const directFollowPubkeys = viewerPubkey ? getFollows(viewerPubkey) : []
    const directMutePubkeys = viewerPubkey ? getMutes(viewerPubkey) : []

    const search = (
      query: string,
      options: PeopleDiscoverySearchOptions = {},
    ): PeopleSearchBatch => {
      const normalizedQuery = query.trim()
      const resolvedContext = resolvePeopleDiscoveryContext(
        withLoadedRepoAssociations(options.context, $loadedRepoAssociationEvents),
        evidence,
        viewerPubkey,
      )
      const rawCommunityPubkeys = getContextCommunityPeoplePubkeys(
        resolvedContext.communityPubkey,
        evidence,
      )
      const getSearchProfile = (candidatePubkey: string) =>
        $welshmanProfileSearch.getOption(candidatePubkey) || null
      const additionalProfileMatches = normalizedQuery
        ? (options.additionalProfileMatches || []).filter(
            candidatePubkey =>
              getPeopleSearchTextScore({
                pubkey: candidatePubkey,
                profile: getSearchProfile(candidatePubkey),
                query: normalizedQuery,
              }) > 0,
          )
        : options.additionalProfileMatches || []
      const profileMatches = normalizedQuery
        ? [
            ...($welshmanProfileSearch.searchValues(normalizedQuery) as string[]),
            ...additionalProfileMatches,
          ]
        : additionalProfileMatches
      const profileMatchSet = new Set(profileMatches.map(normalizePubkey).filter(Boolean))
      const matchesQuery = (candidatePubkey: string) =>
        !normalizedQuery ||
        profileMatchSet.has(normalizePubkey(candidatePubkey)) ||
        getPeopleSearchTextScore({
          pubkey: candidatePubkey,
          profile: getSearchProfile(candidatePubkey),
          query: normalizedQuery,
        }) > 0
      const getTextScore = (candidatePubkey: string) =>
        getPeopleSearchTextScore({
          pubkey: candidatePubkey,
          profile: getSearchProfile(candidatePubkey),
          query: normalizedQuery,
        })
      const matchingCommunityPubkeys = rawCommunityPubkeys.filter(matchesQuery)
      const communityAssessments = buildCommunityTrustAssessments({
        candidatePubkeys: matchingCommunityPubkeys,
        viewerPubkey: viewerPubkey || undefined,
        context: resolvedContext.trustContext,
        definitionEvents,
        profileListEvents,
        reportStates,
        renouncedCommunityPubkeys: $userRenouncedCommunityPubkeys,
      })
      const communityPubkeys = matchingCommunityPubkeys
        .filter(candidatePubkey => {
          const assessment = communityAssessments.get(candidatePubkey)
          return Boolean(assessment && !assessment.suppressed && assessment.score > 0)
        })
        .sort((a, b) => {
          const assessmentDifference =
            (communityAssessments.get(b)?.score || 0) - (communityAssessments.get(a)?.score || 0)
          return assessmentDifference || getTextScore(b) - getTextScore(a) || a.localeCompare(b)
        })
      const matchingDirectFollowPubkeys = directFollowPubkeys
        .filter(matchesQuery)
        .sort((a, b) => getTextScore(b) - getTextScore(a) || a.localeCompare(b))
      const knownPubkeys = [
        ...(options.knownPubkeys || []),
        ...(options.allowEmptyQuery ? Array.from($profilesByPubkey.keys()) : []),
      ]
      const candidates = buildPeopleSearchCandidates({
        query: normalizedQuery,
        recentConversationPubkeys: (options.recentConversationPubkeys || []).filter(matchesQuery),
        repoOwnerPubkeys: resolvedContext.repoOwnerPubkeys.filter(matchesQuery),
        repoMaintainerPubkeys: resolvedContext.repoMaintainerPubkeys.filter(matchesQuery),
        communityPubkeys,
        directFollowPubkeys: matchingDirectFollowPubkeys,
        directMutePubkeys,
        knownPubkeys,
        profileMatches,
      })

      return searchPeopleCandidates({
        query: normalizedQuery,
        candidates,
        excludePubkeys: options.excludePubkeys,
        communityAssessments,
        getProfile: getSearchProfile,
        cursor: options.cursor,
        scanLimit: options.scanLimit,
        resultLimit: options.resultLimit,
        allowEmptyQuery: options.allowEmptyQuery,
      })
    }

    return {
      search,
      searchResults: (query, options) => search(query, options).results,
      searchValues: (query, options) => search(query, options).results.map(result => result.pubkey),
    }
  },
)
