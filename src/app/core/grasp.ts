import {get, writable} from "svelte/store"
import {chunk} from "@welshman/lib"
import {makeLoader} from "@welshman/net"
import {getFollows, getMutes, pubkey, repository} from "@welshman/app"
import {Router} from "@welshman/router"
import {
  GIT_USER_GRASP_LIST,
  normalizeUserGraspServerUrls,
  parseUserGraspListServerUrls,
} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {
  DEFAULT_COMMUNITY_INPUT,
  activeCommunityStars,
  activeUserCommunityRefs,
  communityMemberProfileListEvents,
  communityMemberReportStates,
  communityModeratorProfileListEvents,
  getCommunityBootstrapRelays,
  loadCommunityDefinitionFromRelays,
} from "@app/core/community-state"
import {INDEXER_RELAYS} from "@app/core/state"
import {
  getProfileListPubkeys,
  normalizePubkey,
  normalizeRelays,
  parseCommunityInput,
  PROFILE_LIST_KIND,
} from "@app/core/community"
import type {
  ActiveUserCommunityRef,
  UserCommunityReportStates,
} from "@app/core/community-membership"
import {isCommunityPersonBanned} from "@app/core/community-reports"

export type GraspServerRecommendationSourceKind =
  | "own_grasp"
  | "community_grasp"
  | "moderator_grasp"
  | "member_grasp"
  | "starred_community_grasp"
  | "follow_grasp"
  | "default_community_fallback"

export type GraspServerRecommendationSource = {
  source: GraspServerRecommendationSourceKind
  pubkey?: string
  communityPubkey?: string
  urls: string[]
  starredAt?: number
  createdAt?: number
  isStarred?: boolean
  isModerator?: boolean
  isAdmin?: boolean
}

export type GraspServerRecommendationEvidence = {
  source: GraspServerRecommendationSourceKind
  pubkey?: string
  communityPubkey?: string
  score: number
  starredAt: number
  createdAt: number
  isStarred: boolean
  isModerator: boolean
  isAdmin: boolean
}

export type GraspServerRecommendationCounts = {
  sources: number
  communities: number
  pubkeys: number
  follows: number
  fallbackSources: number
}

export type GraspServerRecommendation = {
  url: string
  communityPubkeys: string[]
  pubkeys: string[]
  evidence: GraspServerRecommendationEvidence[]
  counts: GraspServerRecommendationCounts
  count: number
  score: number
  latestStarredAt: number
  isConfigured: boolean
}

export type GraspServerRecommendationState = {
  status: "idle" | "loading" | "ready" | "error"
  authorCount: number
  eventCount: number
  recommendationCount: number
  error?: string
}

export type BuildGraspServerRecommendationsInput = {
  viewerPubkey?: string
  currentServers?: string[]
  communityRefs?: ActiveUserCommunityRef[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  follows?: string[]
  mutes?: string[]
  userGraspListEvents?: TrustedEvent[]
  starredCommunityPubkeys?: string[]
  defaultCommunityPubkey?: string
  extraSources?: GraspServerRecommendationSource[]
}

export type LoadGraspServerRecommendationsInput = Omit<
  BuildGraspServerRecommendationsInput,
  "viewerPubkey" | "follows" | "mutes" | "userGraspListEvents"
>

const GRASP_SOURCE_SCORES: Record<GraspServerRecommendationSourceKind, number> = {
  own_grasp: 90,
  community_grasp: 80,
  default_community_fallback: 36,
  starred_community_grasp: 40,
  moderator_grasp: 32,
  member_grasp: 18,
  follow_grasp: 8,
}

const GRASP_AUTHOR_LIMIT = 500
const GRASP_DIRECT_FOLLOW_AUTHOR_LIMIT = 250
const GRASP_AUTHOR_BATCH_SIZE = 80
const GRASP_RECOMMENDATION_LOAD_TIMEOUT = 6000
const DEFAULT_COMMUNITY_GRASP_LOOKUP_TIMEOUT = 3000

const graspRecommendationLoad = makeLoader({delay: 200, timeout: GRASP_RECOMMENDATION_LOAD_TIMEOUT, threshold: 0.5})

const defaultGraspServerRecommendationState: GraspServerRecommendationState = {
  status: "idle",
  authorCount: 0,
  eventCount: 0,
  recommendationCount: 0,
}

export const graspServerRecommendations = writable<GraspServerRecommendation[]>([])
export const graspServerRecommendationState = writable<GraspServerRecommendationState>(
  defaultGraspServerRecommendationState,
)
export const graspServerFallbackUrls = writable<string[]>([])

const makeEmptyCounts = (): GraspServerRecommendationCounts => ({
  sources: 0,
  communities: 0,
  pubkeys: 0,
  follows: 0,
  fallbackSources: 0,
})

const unique = <T>(values: T[]) => Array.from(new Set(values))

const addUnique = (values: string[], value: string | undefined) => {
  if (value && !values.includes(value)) values.push(value)
}

const getDTag = (event: TrustedEvent) => event.tags.find(tag => tag[0] === "d")?.[1] || ""

const getReplaceableAddress = (event: TrustedEvent) => {
  const d = getDTag(event)

  return d ? `${event.kind}:${event.pubkey}:${d}` : ""
}

const isPreferredEvent = (candidate: TrustedEvent, current: TrustedEvent | undefined) => {
  if (!current) return true
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at

  return candidate.id < current.id
}

const getLatestProfileListEventsByAddress = (events: TrustedEvent[] = []) => {
  const latest = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (event.kind !== PROFILE_LIST_KIND) continue

    const address = getReplaceableAddress(event)
    if (!address) continue

    const current = latest.get(address)
    if (isPreferredEvent(event, current)) latest.set(address, event)
  }

  return latest
}

const getLatestUserGraspListEventsByPubkey = (events: TrustedEvent[] = []) => {
  const latest = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (event.kind !== GIT_USER_GRASP_LIST) continue

    const author = normalizePubkey(event.pubkey || "")
    if (!author) continue

    const current = latest.get(author)
    if (isPreferredEvent(event, current)) latest.set(author, event)
  }

  return Array.from(latest.values())
}

const getDefinitionsFromRefs = (refs: ActiveUserCommunityRef[] = []) => {
  const byPubkey = new Map<string, ActiveUserCommunityRef["definition"]>()

  for (const ref of refs) {
    const current = byPubkey.get(ref.communityPubkey)
    if (!current || ref.definition.event.created_at > current.event.created_at) {
      byPubkey.set(ref.communityPubkey, ref.definition)
    }
  }

  return Array.from(byPubkey.values())
}

const getReportState = (states: UserCommunityReportStates | undefined, communityPubkey: string) =>
  states instanceof Map ? states.get(communityPubkey) : states?.[communityPubkey]

const getCommunityGraspSourceKind = ({
  definition,
  profileListsByAddress,
  reportStates,
  pubkey,
}: {
  definition: ActiveUserCommunityRef["definition"]
  profileListsByAddress: Map<string, TrustedEvent>
  reportStates?: UserCommunityReportStates
  pubkey: string
}): GraspServerRecommendationSourceKind | undefined => {
  const normalizedPubkey = normalizePubkey(pubkey || "")
  if (!normalizedPubkey) return

  if (definition.pubkey === normalizedPubkey) return "community_grasp"
  if (isCommunityPersonBanned(getReportState(reportStates, definition.pubkey), normalizedPubkey)) return

  let isModerator = false
  let isMember = false

  for (const section of definition.sections) {
    for (const ref of section.profileLists) {
      const event = profileListsByAddress.get(ref.address)
      const moderatorPubkey = normalizePubkey(ref.pubkey || "")

      if (moderatorPubkey === normalizedPubkey && event?.pubkey === normalizedPubkey) {
        isModerator = true
      }

      if (getProfileListPubkeys(event).includes(normalizedPubkey)) {
        isMember = true
      }
    }
  }

  if (isModerator) return "moderator_grasp"
  if (isMember) return "member_grasp"
}

const getEvidenceKey = (evidence: GraspServerRecommendationEvidence) =>
  [evidence.source, evidence.pubkey || "", evidence.communityPubkey || ""].join(":")

const hasEvidence = (
  recommendation: GraspServerRecommendation,
  evidence: GraspServerRecommendationEvidence,
) => recommendation.evidence.some(existing => getEvidenceKey(existing) === getEvidenceKey(evidence))

const getRecommendationPriority = (recommendation: GraspServerRecommendation) => {
  if (recommendation.evidence.some(evidence => evidence.source === "own_grasp")) return 4
  if (
    recommendation.evidence.some(evidence =>
      ["community_grasp", "moderator_grasp", "member_grasp"].includes(evidence.source),
    )
  ) {
    return 3
  }
  if (recommendation.evidence.some(evidence => evidence.source === "starred_community_grasp")) {
    return 2
  }
  if (recommendation.evidence.some(evidence => evidence.source === "follow_grasp")) return 1
  return 0
}

const countEvidence = (recommendation: GraspServerRecommendation) => {
  const communities = new Set<string>()
  const pubkeys = new Set<string>()
  const follows = new Set<string>()
  let fallbackSources = 0

  for (const evidence of recommendation.evidence) {
    if (evidence.communityPubkey) communities.add(evidence.communityPubkey)
    if (evidence.pubkey) pubkeys.add(evidence.pubkey)
    if (evidence.source === "follow_grasp" && evidence.pubkey) follows.add(evidence.pubkey)
    if (evidence.source === "default_community_fallback") fallbackSources += 1
  }

  recommendation.counts = {
    sources: recommendation.evidence.length,
    communities: communities.size,
    pubkeys: pubkeys.size,
    follows: follows.size,
    fallbackSources,
  }
  recommendation.count = recommendation.counts.sources
}

export const getGraspServerRecommendations = (
  sources: GraspServerRecommendationSource[],
  currentServers: string[] = [],
): GraspServerRecommendation[] => {
  const currentServerSet = new Set(normalizeUserGraspServerUrls(currentServers))
  const byUrl = new Map<string, GraspServerRecommendation>()

  for (const source of sources) {
    const sourceScore = GRASP_SOURCE_SCORES[source.source] || 0
    if (sourceScore <= 0) continue

    for (const url of normalizeUserGraspServerUrls(source.urls)) {
      const recommendation = byUrl.get(url) || {
        url,
        communityPubkeys: [],
        pubkeys: [],
        evidence: [],
        counts: makeEmptyCounts(),
        count: 0,
        score: 0,
        latestStarredAt: 0,
        isConfigured: currentServerSet.has(url),
      }
      const evidence: GraspServerRecommendationEvidence = {
        source: source.source,
        pubkey: source.pubkey,
        communityPubkey: source.communityPubkey,
        score: sourceScore,
        starredAt: source.starredAt || 0,
        createdAt: source.createdAt || 0,
        isStarred: source.source === "starred_community_grasp" || source.isStarred === true,
        isModerator: Boolean(source.isModerator || source.source === "moderator_grasp"),
        isAdmin: Boolean(source.isAdmin || source.source === "community_grasp"),
      }

      if (hasEvidence(recommendation, evidence)) {
        byUrl.set(url, recommendation)
        continue
      }

      addUnique(recommendation.communityPubkeys, source.communityPubkey)
      addUnique(recommendation.pubkeys, source.pubkey)
      recommendation.evidence.push(evidence)
      recommendation.score += sourceScore
      recommendation.latestStarredAt = Math.max(recommendation.latestStarredAt, evidence.starredAt)
      byUrl.set(url, recommendation)
    }
  }

  const recommendations = Array.from(byUrl.values())

  for (const recommendation of recommendations) {
    recommendation.evidence.sort(
      (a, b) =>
        b.score - a.score ||
        b.starredAt - a.starredAt ||
        b.createdAt - a.createdAt ||
        getEvidenceKey(a).localeCompare(getEvidenceKey(b)),
    )
    countEvidence(recommendation)
  }

  return recommendations.sort(
    (a, b) =>
      getRecommendationPriority(b) - getRecommendationPriority(a) ||
      b.score - a.score ||
      b.count - a.count ||
      b.counts.communities - a.counts.communities ||
      b.counts.pubkeys - a.counts.pubkeys ||
      b.latestStarredAt - a.latestStarredAt ||
      a.url.localeCompare(b.url),
  )
}

const isFallbackOnlyRecommendation = (recommendation: GraspServerRecommendation) =>
  recommendation.evidence.length > 0 &&
  recommendation.evidence.every(evidence => evidence.source === "default_community_fallback")

export const selectEffectiveGraspServerRecommendations = (
  recommendations: GraspServerRecommendation[],
) => {
  const nonFallback = recommendations.filter(recommendation => !isFallbackOnlyRecommendation(recommendation))

  return nonFallback.length > 0 ? nonFallback : recommendations
}

export const getGraspServerRecommendationSourceLabel = (
  source: GraspServerRecommendationSourceKind,
) => {
  switch (source) {
    case "own_grasp":
      return "your GRASP list"
    case "community_grasp":
      return "community GRASP list"
    case "moderator_grasp":
      return "moderator GRASP list"
    case "member_grasp":
      return "member GRASP list"
    case "starred_community_grasp":
      return "starred community GRASP list"
    case "follow_grasp":
      return "follow GRASP list"
    case "default_community_fallback":
      return "default community fallback"
  }
}

const getCommunityProfileListAuthors = (
  communityRefs: ActiveUserCommunityRef[],
  profileListEvents: TrustedEvent[],
) => {
  const profileListsByAddress = getLatestProfileListEventsByAddress(profileListEvents)
  const communityAuthors: string[] = []
  const moderatorAuthors: string[] = []
  const memberAuthors: string[] = []

  for (const definition of getDefinitionsFromRefs(communityRefs)) {
    communityAuthors.push(definition.pubkey)

    for (const section of definition.sections) {
      for (const ref of section.profileLists) {
        moderatorAuthors.push(ref.pubkey)

        const event = profileListsByAddress.get(ref.address)
        memberAuthors.push(...getProfileListPubkeys(event))
      }
    }
  }

  return {communityAuthors, moderatorAuthors, memberAuthors}
}

export const getGraspServerRecommendationAuthors = ({
  viewerPubkey,
  follows = [],
  communityRefs = [],
  profileListEvents = [],
  starredCommunityPubkeys = [],
  defaultCommunityPubkey,
}: {
  viewerPubkey?: string
  follows?: string[]
  communityRefs?: ActiveUserCommunityRef[]
  profileListEvents?: TrustedEvent[]
  starredCommunityPubkeys?: string[]
  defaultCommunityPubkey?: string
}) => {
  const viewer = normalizePubkey(viewerPubkey || "")
  const defaultCommunity = normalizePubkey(defaultCommunityPubkey || "")
  const {communityAuthors, moderatorAuthors, memberAuthors} = getCommunityProfileListAuthors(
    communityRefs,
    profileListEvents,
  )
  const directFollows = follows
    .map(normalizePubkey)
    .filter(author => author && author !== viewer)
    .slice(0, GRASP_DIRECT_FOLLOW_AUTHOR_LIMIT)

  return unique(
    [
      viewer,
      ...communityAuthors,
      defaultCommunity,
      ...moderatorAuthors,
      ...starredCommunityPubkeys,
      ...directFollows,
      ...memberAuthors,
    ]
      .map(normalizePubkey)
      .filter(Boolean),
  ).slice(0, GRASP_AUTHOR_LIMIT)
}

export const buildGraspServerRecommendations = ({
  viewerPubkey = "",
  currentServers = [],
  communityRefs = [],
  profileListEvents = [],
  reportStates,
  follows = [],
  mutes = [],
  userGraspListEvents = [],
  starredCommunityPubkeys = [],
  defaultCommunityPubkey,
  extraSources = [],
}: BuildGraspServerRecommendationsInput) => {
  const viewer = normalizePubkey(viewerPubkey || "")
  const followed = new Set(follows.map(normalizePubkey).filter(Boolean))
  const muted = new Set(mutes.map(normalizePubkey).filter(Boolean))
  const starred = new Set(starredCommunityPubkeys.map(normalizePubkey).filter(Boolean))
  const defaultCommunity = normalizePubkey(defaultCommunityPubkey || "")
  const profileListsByAddress = getLatestProfileListEventsByAddress(profileListEvents)
  const definitions = getDefinitionsFromRefs(communityRefs)
  const sources: GraspServerRecommendationSource[] = [...extraSources]

  for (const event of getLatestUserGraspListEventsByPubkey(userGraspListEvents)) {
    const recommender = normalizePubkey(event.pubkey || "")
    if (!recommender) continue

    const urls = parseUserGraspListServerUrls(event as any)
    if (urls.length === 0) continue

    if (viewer && recommender === viewer) {
      sources.push({source: "own_grasp", pubkey: recommender, urls, createdAt: event.created_at})
      continue
    }

    const communitySources: GraspServerRecommendationSource[] = []

    for (const definition of definitions) {
      const sourceKind = getCommunityGraspSourceKind({
        definition,
        profileListsByAddress,
        reportStates,
        pubkey: recommender,
      })

      if (!sourceKind) continue

      communitySources.push({
        source: sourceKind,
        pubkey: recommender,
        communityPubkey: definition.pubkey,
        urls,
        createdAt: event.created_at,
        isModerator: sourceKind === "moderator_grasp",
        isAdmin: sourceKind === "community_grasp",
      })
    }

    if (communitySources.length > 0) {
      sources.push(...communitySources)
      continue
    }

    if (starred.has(recommender)) {
      sources.push({
        source: "starred_community_grasp",
        pubkey: recommender,
        communityPubkey: recommender,
        urls,
        createdAt: event.created_at,
        isStarred: true,
      })
      continue
    }

    if (defaultCommunity && recommender === defaultCommunity) {
      sources.push({
        source: "default_community_fallback",
        pubkey: recommender,
        communityPubkey: recommender,
        urls,
        createdAt: event.created_at,
      })
      continue
    }

    if (followed.has(recommender) && !muted.has(recommender)) {
      sources.push({source: "follow_grasp", pubkey: recommender, urls, createdAt: event.created_at})
    }
  }

  return getGraspServerRecommendations(sources, currentServers)
}

const getGraspServerRecommendationRelays = (
  authors: string[],
  communityRefs: ActiveUserCommunityRef[],
  extraRelays: string[] = [],
) => {
  let authorRelays: string[] = []
  let userRelays: string[] = []
  let indexRelays: string[] = []

  try {
    authorRelays = Router.get().FromPubkeys(authors).getUrls() || []
  } catch {}

  try {
    userRelays = Router.get().FromUser().getUrls() || []
  } catch {}

  try {
    indexRelays = Router.get().Index().getUrls() || []
  } catch {}

  return normalizeRelays([
    ...communityRefs.flatMap(ref => ref.relayHints),
    ...authorRelays,
    ...userRelays,
    ...indexRelays,
    ...extraRelays,
    ...INDEXER_RELAYS,
  ])
}

const loadUserGraspListEvents = async (authors: string[], relays: string[]) => {
  const loaded: TrustedEvent[] = []

  for (const batch of chunk(GRASP_AUTHOR_BATCH_SIZE, authors)) {
    const events = await graspRecommendationLoad({
      filters: [{kinds: [GIT_USER_GRASP_LIST], authors: batch}],
      relays,
    })

    loaded.push(...(events as TrustedEvent[]))
  }

  return loaded
}

export const resolveDefaultCommunityGraspServerFallback = async ({
  communityInput = DEFAULT_COMMUNITY_INPUT,
  indexerRelays = INDEXER_RELAYS,
  loadDefinition = loadCommunityDefinitionFromRelays,
  loadEvents = loadUserGraspListEvents,
  queryEvents = (author: string) =>
    repository.query([{kinds: [GIT_USER_GRASP_LIST], authors: [author]}]) as TrustedEvent[],
}: {
  communityInput?: string
  indexerRelays?: string[]
  loadDefinition?: typeof loadCommunityDefinitionFromRelays
  loadEvents?: (authors: string[], relays: string[]) => Promise<TrustedEvent[]>
  queryEvents?: (author: string) => TrustedEvent[]
} = {}) => {
  const parsed = parseCommunityInput(communityInput)
  if (!parsed) return {pubkey: "", urls: [] as string[], relays: [] as string[]}

  const lookupRelays = normalizeRelays([...parsed.relays, ...indexerRelays])
  const definition = lookupRelays.length
    ? await loadDefinition(parsed.pubkey, lookupRelays, {
        timeout: DEFAULT_COMMUNITY_GRASP_LOOKUP_TIMEOUT,
      }).catch(() => undefined)
    : undefined
  const relays = getCommunityBootstrapRelays([
    ...parsed.relays,
    ...(definition?.relays || []),
    ...indexerRelays,
  ])

  if (relays.length > 0) {
    await loadEvents([parsed.pubkey], relays).catch(() => [])
  }

  const recommendations = buildGraspServerRecommendations({
    userGraspListEvents: queryEvents(parsed.pubkey),
    defaultCommunityPubkey: parsed.pubkey,
  })

  return {
    pubkey: parsed.pubkey,
    relays,
    urls: selectEffectiveGraspServerRecommendations(recommendations).map(recommendation => recommendation.url),
  }
}

export const loadGraspServerRecommendations = async ({
  currentServers = [],
  communityRefs = [],
  profileListEvents = [],
  reportStates,
  extraSources = [],
  starredCommunityPubkeys = [],
  defaultCommunityPubkey,
}: LoadGraspServerRecommendationsInput = {}) => {
  const viewer = pubkey.get() || ""
  const follows = viewer ? getFollows(viewer) : []
  const mutes = viewer ? getMutes(viewer) : []
  const defaultCommunity = normalizePubkey(
    defaultCommunityPubkey || parseCommunityInput(DEFAULT_COMMUNITY_INPUT)?.pubkey || "",
  )
  const authors = getGraspServerRecommendationAuthors({
    viewerPubkey: viewer,
    follows,
    communityRefs,
    profileListEvents,
    starredCommunityPubkeys,
    defaultCommunityPubkey: defaultCommunity,
  })
  const relays = getGraspServerRecommendationRelays(
    authors,
    communityRefs,
    getCommunityBootstrapRelays(),
  )

  graspServerRecommendationState.set({
    ...defaultGraspServerRecommendationState,
    status: "loading",
    authorCount: authors.length,
  })

  try {
    if (authors.length > 0 && relays.length > 0) {
      await loadUserGraspListEvents(authors, relays)
    }

    const userGraspListEvents =
      authors.length > 0
        ? (repository.query([{kinds: [GIT_USER_GRASP_LIST], authors}]) as TrustedEvent[])
        : []
    const recommendations = buildGraspServerRecommendations({
      viewerPubkey: viewer,
      currentServers,
      communityRefs,
      profileListEvents,
      reportStates,
      follows,
      mutes,
      userGraspListEvents,
      starredCommunityPubkeys,
      defaultCommunityPubkey: defaultCommunity,
      extraSources,
    })
    let effectiveRecommendations = selectEffectiveGraspServerRecommendations(recommendations)

    if (effectiveRecommendations.length === 0 && defaultCommunity) {
      const fallback = await resolveDefaultCommunityGraspServerFallback()
      effectiveRecommendations = getGraspServerRecommendations(
        fallback.urls.length > 0
          ? [
              {
                source: "default_community_fallback",
                pubkey: fallback.pubkey,
                communityPubkey: fallback.pubkey,
                urls: fallback.urls,
              },
            ]
          : [],
        currentServers,
      )
    }

    const fallbackUrls = effectiveRecommendations.map(recommendation => recommendation.url)

    graspServerRecommendations.set(effectiveRecommendations)
    graspServerFallbackUrls.set(fallbackUrls)
    graspServerRecommendationState.set({
      status: "ready",
      authorCount: authors.length,
      eventCount: userGraspListEvents.length,
      recommendationCount: effectiveRecommendations.length,
    })

    return effectiveRecommendations
  } catch (error) {
    graspServerRecommendations.set([])
    graspServerFallbackUrls.set([])
    graspServerRecommendationState.set({
      status: "error",
      authorCount: authors.length,
      eventCount: 0,
      recommendationCount: 0,
      error: error instanceof Error ? error.message : "Failed to load GRASP recommendations.",
    })

    return []
  }
}

export const startGraspServerRecommendationsSync = () => {
  let loadKey = ""
  const run = () => {
    const viewer = pubkey.get() || ""
    if (!viewer) {
      graspServerRecommendations.set([])
      graspServerFallbackUrls.set([])
      graspServerRecommendationState.set(defaultGraspServerRecommendationState)
      return
    }

    const communityRefs = get(activeUserCommunityRefs)
    const profileListEvents = [
      ...get(communityMemberProfileListEvents),
      ...get(communityModeratorProfileListEvents),
    ]
    const stars = get(activeCommunityStars)
    const key = JSON.stringify({
      viewer,
      communities: communityRefs.map(ref => `${ref.communityPubkey}:${ref.definition.event.id}`),
      profileLists: profileListEvents.map(event => `${event.id}:${event.created_at}`),
      stars: stars.map(star => `${star.communityPubkey}:${star.reaction.created_at}`),
    })

    if (key === loadKey) return
    loadKey = key

    loadGraspServerRecommendations({
      communityRefs,
      profileListEvents,
      reportStates: get(communityMemberReportStates),
      starredCommunityPubkeys: stars.map(star => star.communityPubkey),
    }).catch(() => undefined)
  }
  const unsubscribers = [
    pubkey.subscribe(run),
    activeUserCommunityRefs.subscribe(run),
    communityMemberProfileListEvents.subscribe(run),
    communityModeratorProfileListEvents.subscribe(run),
    communityMemberReportStates.subscribe(run),
    activeCommunityStars.subscribe(run),
  ]

  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}
