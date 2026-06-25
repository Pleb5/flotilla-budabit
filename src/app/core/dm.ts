import {get, writable} from "svelte/store"
import {chunk} from "@welshman/lib"
import {makeLoader} from "@welshman/net"
import {
  getFollows,
  getMutes,
  getPlaintext,
  pubkey,
  repository,
  setPlaintext,
  signer,
} from "@welshman/app"
import {Router} from "@welshman/router"
import {decrypt} from "@welshman/signer"
import {
  getListTags,
  getRelayTagValues,
  getTagValue,
  isRelayUrl,
  MESSAGING_RELAYS,
  normalizeRelayUrl,
} from "@welshman/util"
import type {List, TrustedEvent} from "@welshman/util"
import {DM_KIND, INDEXER_RELAYS} from "@app/core/state"
import {getProfileListPubkeys, normalizePubkey, PROFILE_LIST_KIND} from "@app/core/community"
import type {
  ActiveUserCommunityRef,
  UserCommunityReportStates,
} from "@app/core/community-membership"
import {isCommunityPersonBanned} from "@app/core/community-reports"
export {DM_KIND}

export type DmRelayRecommendationSourceKind =
  | "active_community_relay"
  | "starred_community_relay"
  | "community_messaging"
  | "admin_messaging"
  | "moderator_messaging"
  | "member_messaging"
  | "own_messaging"
  | "follow_messaging"

export type DmRelayRecommendationSource = {
  source?: DmRelayRecommendationSourceKind
  pubkey?: string
  communityPubkey?: string
  relays: string[]
  starredAt?: number
  createdAt?: number
  isStarred?: boolean
  isModerator?: boolean
  isAdmin?: boolean
}

export type DmRelayRecommendationEvidence = {
  source: DmRelayRecommendationSourceKind
  pubkey?: string
  communityPubkey?: string
  score: number
  starredAt: number
  createdAt: number
  isStarred: boolean
  isModerator: boolean
  isAdmin: boolean
}

export type DmRelayRecommendationCommunity = {
  communityPubkey: string
  score: number
  sources: DmRelayRecommendationSourceKind[]
  isStarred: boolean
  isModerator: boolean
  isAdmin: boolean
}

export type DmRelayRecommendationCounts = {
  sources: number
  communities: number
  pubkeys: number
  activeCommunities: number
  starredCommunities: number
  follows: number
  messagingLists: number
}

export type DmRelayRecommendation = {
  url: string
  communityPubkeys: string[]
  pubkeys: string[]
  communities: DmRelayRecommendationCommunity[]
  evidence: DmRelayRecommendationEvidence[]
  counts: DmRelayRecommendationCounts
  count: number
  score: number
  latestStarredAt: number
  isConfigured: boolean
}

export type DmRelayRecommendationState = {
  status: "idle" | "loading" | "ready" | "error"
  authorCount: number
  eventCount: number
  recommendationCount: number
  error?: string
}

export type BuildDmRelayRecommendationsInput = {
  viewerPubkey?: string
  currentRelays?: string[]
  communityRefs?: ActiveUserCommunityRef[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  follows?: string[]
  mutes?: string[]
  messagingRelayListEvents?: TrustedEvent[]
  extraSources?: DmRelayRecommendationSource[]
}

export type LoadDmRelayRecommendationsInput = Omit<
  BuildDmRelayRecommendationsInput,
  "viewerPubkey" | "follows" | "mutes" | "messagingRelayListEvents"
> & {
  starredCommunityPubkeys?: string[]
}

const DM_RELAY_SOURCE_SCORES: Record<DmRelayRecommendationSourceKind, number> = {
  own_messaging: 90,
  community_messaging: 80,
  admin_messaging: 70,
  active_community_relay: 55,
  starred_community_relay: 40,
  moderator_messaging: 32,
  member_messaging: 18,
  follow_messaging: 8,
}

const DM_RELAY_ADMIN_BONUS = 16
const DM_RELAY_MODERATOR_BONUS = 8
const DM_RELAY_AUTHOR_LIMIT = 500
const DM_RELAY_DIRECT_FOLLOW_AUTHOR_LIMIT = 250
const DM_RELAY_AUTHOR_BATCH_SIZE = 80

const dmRelayRecommendationLoad = makeLoader({delay: 200, timeout: 6000, threshold: 0.5})

const defaultDmRelayRecommendationState: DmRelayRecommendationState = {
  status: "idle",
  authorCount: 0,
  eventCount: 0,
  recommendationCount: 0,
}

export const dmRelayRecommendations = writable<DmRelayRecommendation[]>([])
export const dmRelayRecommendationState = writable<DmRelayRecommendationState>(
  defaultDmRelayRecommendationState,
)

const DM_RELAY_MESSAGING_SOURCES = new Set<DmRelayRecommendationSourceKind>([
  "own_messaging",
  "community_messaging",
  "admin_messaging",
  "moderator_messaging",
  "member_messaging",
  "follow_messaging",
])

const DM_RELAY_STRONG_COMMUNITY_SOURCES = new Set<DmRelayRecommendationSourceKind>([
  "own_messaging",
  "community_messaging",
  "admin_messaging",
  "active_community_relay",
  "moderator_messaging",
  "member_messaging",
])

const makeEmptyDmRelayRecommendationCounts = (): DmRelayRecommendationCounts => ({
  sources: 0,
  communities: 0,
  pubkeys: 0,
  activeCommunities: 0,
  starredCommunities: 0,
  follows: 0,
  messagingLists: 0,
})

const unique = <T>(values: T[]) => Array.from(new Set(values))

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

const getLatestMessagingRelayListEventsByPubkey = (events: TrustedEvent[] = []) => {
  const latest = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (event.kind !== MESSAGING_RELAYS) continue

    const author = normalizePubkey(event.pubkey || "")
    if (!author) continue

    const current = latest.get(author)
    if (isPreferredEvent(event, current)) latest.set(author, event)
  }

  return Array.from(latest.values())
}

const getReportState = (states: UserCommunityReportStates | undefined, communityPubkey: string) =>
  states instanceof Map ? states.get(communityPubkey) : states?.[communityPubkey]

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

export const normalizeRelayUrls = (relays: string[]) => {
  const result: string[] = []
  const seen = new Set<string>()

  for (const url of relays || []) {
    let normalized = ""
    try {
      normalized = normalizeRelayUrl(url)
    } catch {
      normalized = ""
    }

    if (!normalized || !isRelayUrl(normalized) || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export const getDmRelayUrls = (list?: List) =>
  normalizeRelayUrls(getRelayTagValues(getListTags(list)))

export const getDmPublishRelays = (selfRelays: string[], recipientRelays: string[]) =>
  normalizeRelayUrls([...recipientRelays, ...selfRelays])

const getDmRelayRecommendationSourceKind = (
  source: DmRelayRecommendationSource,
): DmRelayRecommendationSourceKind => {
  if (source.source) return source.source

  return source.isStarred === false ? "active_community_relay" : "starred_community_relay"
}

const supportsLegacyCommunityRoleBonus = (source: DmRelayRecommendationSourceKind) =>
  source === "active_community_relay" || source === "starred_community_relay"

export const getDmRelayRecommendationSourceScore = (source: DmRelayRecommendationSource) => {
  const sourceKind = getDmRelayRecommendationSourceKind(source)
  const baseScore = DM_RELAY_SOURCE_SCORES[sourceKind] || 0
  const roleBonus = supportsLegacyCommunityRoleBonus(sourceKind)
    ? (source.isAdmin ? DM_RELAY_ADMIN_BONUS : 0) +
      (source.isModerator ? DM_RELAY_MODERATOR_BONUS : 0)
    : 0

  return baseScore + roleBonus
}

const getDmRelayEvidenceKey = (evidence: DmRelayRecommendationEvidence) =>
  [evidence.source, evidence.pubkey || "", evidence.communityPubkey || ""].join(":")

const hasDmRelayEvidence = (
  recommendation: DmRelayRecommendation,
  evidence: DmRelayRecommendationEvidence,
) =>
  recommendation.evidence.some(
    existing => getDmRelayEvidenceKey(existing) === getDmRelayEvidenceKey(evidence),
  )

const addUnique = (values: string[], value: string | undefined) => {
  if (value && !values.includes(value)) values.push(value)
}

const addUniqueSource = (
  sources: DmRelayRecommendationSourceKind[],
  source: DmRelayRecommendationSourceKind,
) => {
  if (!sources.includes(source)) sources.push(source)
}

const getDmRelayRecommendationPriority = (recommendation: DmRelayRecommendation) => {
  if (
    recommendation.evidence.some(evidence =>
      DM_RELAY_STRONG_COMMUNITY_SOURCES.has(evidence.source),
    )
  ) {
    return 3
  }

  if (recommendation.evidence.some(evidence => evidence.source === "starred_community_relay")) {
    return 2
  }

  if (recommendation.evidence.some(evidence => evidence.source === "follow_messaging")) {
    return 1
  }

  return 0
}

const countDmRelayRecommendationEvidence = (recommendation: DmRelayRecommendation) => {
  const communities = new Set<string>()
  const pubkeys = new Set<string>()
  const activeCommunities = new Set<string>()
  const starredCommunities = new Set<string>()
  const follows = new Set<string>()
  const messagingLists = new Set<string>()

  for (const evidence of recommendation.evidence) {
    if (evidence.communityPubkey) communities.add(evidence.communityPubkey)
    if (evidence.pubkey) pubkeys.add(evidence.pubkey)
    if (evidence.source === "active_community_relay" && evidence.communityPubkey) {
      activeCommunities.add(evidence.communityPubkey)
    }
    if (evidence.source === "starred_community_relay" && evidence.communityPubkey) {
      starredCommunities.add(evidence.communityPubkey)
    }
    if (evidence.source === "follow_messaging" && evidence.pubkey) follows.add(evidence.pubkey)
    if (DM_RELAY_MESSAGING_SOURCES.has(evidence.source)) {
      messagingLists.add(getDmRelayEvidenceKey(evidence))
    }
  }

  recommendation.counts = {
    sources: recommendation.evidence.length,
    communities: communities.size,
    pubkeys: pubkeys.size,
    activeCommunities: activeCommunities.size,
    starredCommunities: starredCommunities.size,
    follows: follows.size,
    messagingLists: messagingLists.size,
  }
  recommendation.count = recommendation.counts.sources
}

export const getDmRelayRecommendations = (
  sources: DmRelayRecommendationSource[],
  currentRelays: string[] = [],
): DmRelayRecommendation[] => {
  const currentRelaySet = new Set(normalizeRelayUrls(currentRelays))
  const recommendationsByUrl = new Map<string, DmRelayRecommendation>()

  for (const source of sources) {
    const sourceKind = getDmRelayRecommendationSourceKind(source)
    const sourceScore = getDmRelayRecommendationSourceScore(source)
    if (sourceScore <= 0) continue

    for (const url of normalizeRelayUrls(source.relays)) {
      const recommendation = recommendationsByUrl.get(url) || {
        url,
        communityPubkeys: [],
        pubkeys: [],
        communities: [],
        evidence: [],
        counts: makeEmptyDmRelayRecommendationCounts(),
        count: 0,
        score: 0,
        latestStarredAt: 0,
        isConfigured: currentRelaySet.has(url),
      }
      const evidence: DmRelayRecommendationEvidence = {
        source: sourceKind,
        pubkey: source.pubkey,
        communityPubkey: source.communityPubkey,
        score: sourceScore,
        starredAt: source.starredAt || 0,
        createdAt: source.createdAt || 0,
        isStarred: sourceKind === "starred_community_relay" || source.isStarred === true,
        isModerator: Boolean(source.isModerator || sourceKind === "moderator_messaging"),
        isAdmin: Boolean(
          source.isAdmin ||
            sourceKind === "community_messaging" ||
            sourceKind === "admin_messaging",
        ),
      }

      if (hasDmRelayEvidence(recommendation, evidence)) {
        recommendationsByUrl.set(url, recommendation)
        continue
      }

      addUnique(recommendation.communityPubkeys, source.communityPubkey)
      addUnique(recommendation.pubkeys, source.pubkey)
      recommendation.evidence.push(evidence)
      recommendation.score += sourceScore
      recommendation.latestStarredAt = Math.max(recommendation.latestStarredAt, evidence.starredAt)

      if (source.communityPubkey) {
        const community = recommendation.communities.find(
          community => community.communityPubkey === source.communityPubkey,
        )

        if (community) {
          community.score += sourceScore
          addUniqueSource(community.sources, sourceKind)
          community.isStarred ||= evidence.isStarred
          community.isModerator ||= evidence.isModerator
          community.isAdmin ||= evidence.isAdmin
        } else {
          recommendation.communities.push({
            communityPubkey: source.communityPubkey,
            score: sourceScore,
            sources: [sourceKind],
            isStarred: evidence.isStarred,
            isModerator: evidence.isModerator,
            isAdmin: evidence.isAdmin,
          })
        }
      }

      recommendationsByUrl.set(url, recommendation)
    }
  }

  const recommendations = Array.from(recommendationsByUrl.values())

  for (const recommendation of recommendations) {
    recommendation.evidence.sort(
      (a, b) =>
        b.score - a.score ||
        b.starredAt - a.starredAt ||
        b.createdAt - a.createdAt ||
        getDmRelayEvidenceKey(a).localeCompare(getDmRelayEvidenceKey(b)),
    )
    recommendation.communities.sort(
      (a, b) => b.score - a.score || a.communityPubkey.localeCompare(b.communityPubkey),
    )
    countDmRelayRecommendationEvidence(recommendation)
  }

  return recommendations.sort(
    (a, b) =>
      getDmRelayRecommendationPriority(b) - getDmRelayRecommendationPriority(a) ||
      b.score - a.score ||
      b.count - a.count ||
      b.counts.communities - a.counts.communities ||
      b.counts.pubkeys - a.counts.pubkeys ||
      b.latestStarredAt - a.latestStarredAt ||
      a.url.localeCompare(b.url),
  )
}

export const getDmRelayRecommendationSourceLabel = (
  source: DmRelayRecommendationSourceKind,
) => {
  switch (source) {
    case "active_community_relay":
      return "active community relay"
    case "starred_community_relay":
      return "starred community relay"
    case "community_messaging":
      return "community messaging list"
    case "admin_messaging":
      return "admin messaging list"
    case "moderator_messaging":
      return "moderator messaging list"
    case "member_messaging":
      return "member messaging list"
    case "own_messaging":
      return "your messaging list"
    case "follow_messaging":
      return "follow messaging list"
  }
}

const getDmRelayUrlsFromEvent = (event: TrustedEvent) =>
  normalizeRelayUrls(getRelayTagValues(event.tags || []))

const getCommunityMessagingSourceKind = ({
  definition,
  profileListsByAddress,
  reportStates,
  pubkey,
}: {
  definition: ActiveUserCommunityRef["definition"]
  profileListsByAddress: Map<string, TrustedEvent>
  reportStates?: UserCommunityReportStates
  pubkey: string
}): DmRelayRecommendationSourceKind | undefined => {
  const normalizedPubkey = normalizePubkey(pubkey || "")
  if (!normalizedPubkey) return

  if (definition.pubkey === normalizedPubkey) {
    return "community_messaging"
  }

  if (isCommunityPersonBanned(getReportState(reportStates, definition.pubkey), normalizedPubkey)) {
    return
  }

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

  if (isModerator) return "moderator_messaging"
  if (isMember) return "member_messaging"
}

const getActiveCommunityRelaySources = (communityRefs: ActiveUserCommunityRef[] = []) =>
  communityRefs.flatMap(ref => {
    if (ref.definition.relays.length === 0) return []

    return [
      {
        source: "active_community_relay" as const,
        communityPubkey: ref.communityPubkey,
        relays: ref.definition.relays,
        isStarred: false,
        isModerator: ref.roles.includes("moderator"),
        isAdmin: ref.roles.includes("admin"),
      },
    ]
  })

export const buildDmRelayRecommendations = ({
  viewerPubkey = "",
  currentRelays = [],
  communityRefs = [],
  profileListEvents = [],
  reportStates,
  follows = [],
  mutes = [],
  messagingRelayListEvents = [],
  extraSources = [],
}: BuildDmRelayRecommendationsInput) => {
  const viewer = normalizePubkey(viewerPubkey || "")
  const followed = new Set(follows.map(normalizePubkey).filter(Boolean))
  const muted = new Set(mutes.map(normalizePubkey).filter(Boolean))
  const profileListsByAddress = getLatestProfileListEventsByAddress(profileListEvents)
  const definitions = getDefinitionsFromRefs(communityRefs)
  const sources: DmRelayRecommendationSource[] = [
    ...getActiveCommunityRelaySources(communityRefs),
    ...extraSources,
  ]

  for (const event of getLatestMessagingRelayListEventsByPubkey(messagingRelayListEvents)) {
    const recommender = normalizePubkey(event.pubkey || "")
    if (!recommender) continue

    const relays = getDmRelayUrlsFromEvent(event)
    if (relays.length === 0) continue

    if (viewer && recommender === viewer) {
      sources.push({
        source: "own_messaging",
        pubkey: recommender,
        relays,
        createdAt: event.created_at,
      })
      continue
    }

    const communitySources: DmRelayRecommendationSource[] = []

    for (const definition of definitions) {
      const sourceKind = getCommunityMessagingSourceKind({
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
        relays,
        createdAt: event.created_at,
        isModerator: sourceKind === "moderator_messaging",
        isAdmin: sourceKind === "community_messaging" || sourceKind === "admin_messaging",
      })
    }

    if (communitySources.length > 0) {
      sources.push(...communitySources)
      continue
    }

    if (followed.has(recommender) && !muted.has(recommender)) {
      sources.push({
        source: "follow_messaging",
        pubkey: recommender,
        relays,
        createdAt: event.created_at,
      })
    }
  }

  return getDmRelayRecommendations(sources, currentRelays)
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

export const getDmRelayRecommendationAuthors = ({
  viewerPubkey,
  follows = [],
  communityRefs = [],
  profileListEvents = [],
  starredCommunityPubkeys = [],
}: {
  viewerPubkey?: string
  follows?: string[]
  communityRefs?: ActiveUserCommunityRef[]
  profileListEvents?: TrustedEvent[]
  starredCommunityPubkeys?: string[]
}) => {
  const viewer = normalizePubkey(viewerPubkey || "")
  const {communityAuthors, moderatorAuthors, memberAuthors} = getCommunityProfileListAuthors(
    communityRefs,
    profileListEvents,
  )
  const directFollows = follows
    .map(normalizePubkey)
    .filter(author => author && author !== viewer)
    .slice(0, DM_RELAY_DIRECT_FOLLOW_AUTHOR_LIMIT)

  return unique(
    [
      viewer,
      ...communityAuthors,
      ...moderatorAuthors,
      ...starredCommunityPubkeys,
      ...directFollows,
      ...memberAuthors,
    ]
      .map(normalizePubkey)
      .filter(Boolean),
  ).slice(0, DM_RELAY_AUTHOR_LIMIT)
}

const getDmRelayRecommendationRelays = (
  authors: string[],
  communityRefs: ActiveUserCommunityRef[],
) => {
  let authorRelays: string[] = []
  let userRelays: string[] = []
  let indexRelays: string[] = []

  try {
    authorRelays = Router.get().FromPubkeys(authors).getUrls() || []
  } catch {
    // pass
  }

  try {
    userRelays = Router.get().FromUser().getUrls() || []
  } catch {
    // pass
  }

  try {
    indexRelays = Router.get().Index().getUrls() || []
  } catch {
    // pass
  }

  return normalizeRelayUrls([
    ...communityRefs.flatMap(ref => ref.relayHints),
    ...authorRelays,
    ...userRelays,
    ...indexRelays,
    ...INDEXER_RELAYS,
  ])
}

const loadMessagingRelayListEvents = async (authors: string[], relays: string[]) => {
  const loaded: TrustedEvent[] = []

  for (const batch of chunk(DM_RELAY_AUTHOR_BATCH_SIZE, authors)) {
    const events = await dmRelayRecommendationLoad({
      filters: [{kinds: [MESSAGING_RELAYS], authors: batch}],
      relays,
    })

    loaded.push(...(events as TrustedEvent[]))
  }

  return loaded
}

export const loadDmRelayRecommendations = async ({
  currentRelays = [],
  communityRefs = [],
  profileListEvents = [],
  reportStates,
  extraSources = [],
  starredCommunityPubkeys = [],
}: LoadDmRelayRecommendationsInput = {}) => {
  const viewer = pubkey.get() || ""
  const follows = viewer ? getFollows(viewer) : []
  const mutes = viewer ? getMutes(viewer) : []
  const authors = getDmRelayRecommendationAuthors({
    viewerPubkey: viewer,
    follows,
    communityRefs,
    profileListEvents,
    starredCommunityPubkeys,
  })
  const relays = getDmRelayRecommendationRelays(authors, communityRefs)

  dmRelayRecommendationState.set({
    ...defaultDmRelayRecommendationState,
    status: "loading",
    authorCount: authors.length,
  })

  try {
    if (authors.length > 0 && relays.length > 0) {
      await loadMessagingRelayListEvents(authors, relays)
    }

    const messagingRelayListEvents =
      authors.length > 0
        ? (repository.query([{kinds: [MESSAGING_RELAYS], authors}]) as TrustedEvent[])
        : []
    const recommendations = buildDmRelayRecommendations({
      viewerPubkey: viewer,
      currentRelays,
      communityRefs,
      profileListEvents,
      reportStates,
      follows,
      mutes,
      messagingRelayListEvents,
      extraSources,
    })

    dmRelayRecommendations.set(recommendations)
    dmRelayRecommendationState.set({
      status: "ready",
      authorCount: authors.length,
      eventCount: messagingRelayListEvents.length,
      recommendationCount: recommendations.length,
    })

    return recommendations
  } catch (error) {
    dmRelayRecommendations.set([])
    dmRelayRecommendationState.set({
      status: "error",
      authorCount: authors.length,
      eventCount: 0,
      recommendationCount: 0,
      error: error instanceof Error ? error.message : "Failed to load DM relay recommendations.",
    })

    return []
  }
}

export const getDmRelayRecommendationsSnapshot = () => get(dmRelayRecommendations)

export const hasDmInbox = (list?: List) => getDmRelayUrls(list).length > 0

export const getMessagingRelayHints = () => {
  const hints: string[] = [...INDEXER_RELAYS]

  try {
    const router = Router.get()
    hints.push(...router.FromUser().getUrls())
    hints.push(...router.ForUser().getUrls())
  } catch {
    // ignore
  }

  return normalizeRelayUrls(hints)
}

export const getDmCounterparty = (event: TrustedEvent, selfPubkey: string) => {
  if (event.pubkey === selfPubkey) {
    return getTagValue("p", event.tags)
  }

  return event.pubkey
}

const decryptDmContent = async (
  $signer: ReturnType<typeof signer.get>,
  counterparty: string,
  content: string,
) => {
  if (!$signer) return
  const signerAny = $signer as any

  if (typeof signerAny?.nip44?.decrypt === "function") {
    return signerAny.nip44.decrypt(counterparty, content)
  }

  if (typeof signerAny?.decrypt === "function") {
    return signerAny.decrypt(counterparty, content)
  }

  return decrypt($signer, counterparty, content)
}

const plaintextPromisesByKey = new Map<string, Promise<string | undefined>>()
const MAX_CONCURRENT_DM_DECRYPTIONS = 6
const pendingDmDecryptions: Array<() => void> = []
let activeDmDecryptions = 0

const runDmDecryption = async <T>(fn: () => Promise<T>) => {
  if (activeDmDecryptions >= MAX_CONCURRENT_DM_DECRYPTIONS) {
    await new Promise<void>(resolve => pendingDmDecryptions.push(resolve))
  }

  activeDmDecryptions += 1

  try {
    return await fn()
  } finally {
    activeDmDecryptions -= 1
    pendingDmDecryptions.shift()?.()
  }
}

export const ensureDmPlaintext = async (event: TrustedEvent, selfPubkey: string) => {
  const existing = getPlaintext(event)

  if (!event.content || existing !== undefined) {
    return existing
  }

  const promiseKey = `${selfPubkey}:${event.id}`
  const existingPromise = plaintextPromisesByKey.get(promiseKey)
  if (existingPromise) return existingPromise

  const promise = (async () => {
    const $signer = signer.get()
    if (!$signer) return

    const counterparty = getDmCounterparty(event, selfPubkey)
    if (!counterparty) return

    let result: string | undefined

    try {
      result = await runDmDecryption(() => decryptDmContent($signer, counterparty, event.content))
    } catch (error: any) {
      if (!String(error).match(/invalid base64/)) {
        throw error
      }
    }

    if (result !== undefined) {
      setPlaintext(event, result)
    }

    return getPlaintext(event)
  })()

  plaintextPromisesByKey.set(promiseKey, promise)

  try {
    return await promise
  } finally {
    plaintextPromisesByKey.delete(promiseKey)
  }
}
