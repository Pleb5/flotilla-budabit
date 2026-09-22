import {get, writable} from "svelte/store"
import {chunk} from "@welshman/lib"
import {makeLoader} from "@welshman/net"
import {
  getFollows,
  forceLoadMessagingRelayList,
  getMessagingRelayList,
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
  communityAddress?: string
  relays: string[]
  primaryRelay?: string
  starredAt?: number
  createdAt?: number
  isStarred?: boolean
  isModerator?: boolean
  isAdmin?: boolean
}

export type DmRelayRecommendationEvidence = {
  source: DmRelayRecommendationSourceKind
  isPrimary: boolean
  pubkey?: string
  communityPubkey?: string
  communityAddress?: string
  score: number
  starredAt: number
  createdAt: number
  isStarred: boolean
  isModerator: boolean
  isAdmin: boolean
}

export type DmRelayRecommendationCommunity = {
  communityPubkey: string
  communityAddress?: string
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
const dmInboxCheckLoad = makeLoader({delay: 0, timeout: 6000, threshold: 1})

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

const getReportState = (states: UserCommunityReportStates | undefined, communityAddress: string) =>
  states instanceof Map ? states.get(communityAddress) : states?.[communityAddress]

const getProfileListOwner = (address: string) => normalizePubkey(address.split(":")[1] || "")

const getDefinitionsFromRefs = (refs: ActiveUserCommunityRef[] = []) => {
  const byAddress = new Map<string, ActiveUserCommunityRef["definition"]>()

  for (const ref of refs) {
    const address = getReplaceableAddress(ref.definition.event)
    if (!address) continue
    const current = byAddress.get(address)
    if (isPreferredEvent(ref.definition.event, current?.event)) {
      byAddress.set(address, ref.definition)
    }
  }

  return Array.from(byAddress.values())
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
  [
    evidence.source,
    evidence.pubkey || "",
    evidence.communityAddress || evidence.communityPubkey || "",
  ].join(":")

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
  // Community definitions are authoritative for community relay choices. Personal
  // inbox lists (even an owner's) must not promote a legacy relay above them.
  const active = recommendation.evidence.filter(item => item.source === "active_community_relay")
  if (active.length) return active.some(item => item.isPrimary) ? 7 : 6
  const starred = recommendation.evidence.filter(item => item.source === "starred_community_relay")
  if (starred.length) return starred.some(item => item.isPrimary) ? 5 : 4

  if (
    recommendation.evidence.some(evidence => DM_RELAY_STRONG_COMMUNITY_SOURCES.has(evidence.source))
  ) {
    return 3
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
    if (evidence.communityPubkey) {
      communities.add(evidence.communityAddress || evidence.communityPubkey)
    }
    if (evidence.pubkey) pubkeys.add(evidence.pubkey)
    if (evidence.source === "active_community_relay" && evidence.communityPubkey) {
      activeCommunities.add(evidence.communityAddress || evidence.communityPubkey)
    }
    if (evidence.source === "starred_community_relay" && evidence.communityPubkey) {
      starredCommunities.add(evidence.communityAddress || evidence.communityPubkey)
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
        isPrimary:
          supportsLegacyCommunityRoleBonus(sourceKind) &&
          normalizeRelayUrls([source.primaryRelay || ""])[0] === url,
        pubkey: source.pubkey,
        communityPubkey: source.communityPubkey,
        communityAddress: source.communityAddress,
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
          community =>
            (community.communityAddress || community.communityPubkey) ===
            (source.communityAddress || source.communityPubkey),
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
            communityAddress: source.communityAddress,
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
      (a, b) =>
        b.score - a.score ||
        (a.communityAddress || a.communityPubkey).localeCompare(
          b.communityAddress || b.communityPubkey,
        ),
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

export const getDmRelayRecommendationSourceLabel = (source: DmRelayRecommendationSourceKind) => {
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

  if (definition.ownerPubkey === normalizedPubkey) {
    return "community_messaging"
  }

  if (
    isCommunityPersonBanned(
      getReportState(reportStates, definition.pointer.address),
      normalizedPubkey,
    )
  ) {
    return
  }

  let isModerator = false
  let isMember = false

  for (const section of definition.sections) {
    for (const ref of section.profileLists) {
      const event = profileListsByAddress.get(ref.address)
      const moderatorPubkey = getProfileListOwner(ref.address)

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
  getDefinitionsFromRefs(communityRefs).flatMap(definition => {
    if (definition.relays.length === 0) return []
    const refs = communityRefs.filter(ref => ref.community.address === definition.pointer.address)

    return [
      {
        source: "active_community_relay" as const,
        communityPubkey: definition.ownerPubkey,
        communityAddress: definition.pointer.address,
        relays: definition.relays,
        primaryRelay: definition.relays[0],
        isStarred: false,
        isModerator: refs.some(ref => ref.roles.includes("moderator")),
        isAdmin: refs.some(ref => ref.roles.includes("admin")),
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
        communityPubkey: definition.ownerPubkey,
        communityAddress: definition.pointer.address,
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
    communityAuthors.push(definition.ownerPubkey)

    for (const section of definition.sections) {
      for (const ref of section.profileLists) {
        moderatorAuthors.push(getProfileListOwner(ref.address))

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

let dmRelayRecommendationLoadId = 0

export const loadDmRelayRecommendations = async ({
  currentRelays = [],
  communityRefs = [],
  profileListEvents = [],
  reportStates,
  extraSources = [],
  starredCommunityPubkeys = [],
}: LoadDmRelayRecommendationsInput = {}) => {
  const viewer = pubkey.get() || ""
  const loadId = ++dmRelayRecommendationLoadId
  const isCurrent = () => loadId === dmRelayRecommendationLoadId && (pubkey.get() || "") === viewer
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
  const buildRecommendations = () =>
    buildDmRelayRecommendations({
      viewerPubkey: viewer,
      currentRelays,
      communityRefs,
      profileListEvents,
      reportStates,
      follows,
      mutes,
      messagingRelayListEvents: authors.length
        ? (repository.query([{kinds: [MESSAGING_RELAYS], authors}]) as TrustedEvent[])
        : [],
      extraSources,
    })

  // Show the current community choices immediately, while enriching their evidence.
  dmRelayRecommendations.set(buildRecommendations())

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
    const recommendations = buildRecommendations()
    if (!isCurrent()) return recommendations

    dmRelayRecommendations.set(recommendations)
    dmRelayRecommendationState.set({
      status: "ready",
      authorCount: authors.length,
      eventCount: messagingRelayListEvents.length,
      recommendationCount: recommendations.length,
    })

    return recommendations
  } catch (error) {
    if (!isCurrent()) return []
    const recommendations = buildRecommendations()
    dmRelayRecommendations.set(recommendations)
    dmRelayRecommendationState.set({
      status: "error",
      authorCount: authors.length,
      eventCount: 0,
      recommendationCount: recommendations.length,
      error: error instanceof Error ? error.message : "Failed to load DM relay recommendations.",
    })

    return recommendations
  }
}

export const getDmRelayRecommendationsSnapshot = () => get(dmRelayRecommendations)

export const hasDmInbox = (list?: List) => getDmRelayUrls(list).length > 0

export const checkDmInboxRelayList = async (author: string, hints: string[]) => {
  await forceLoadMessagingRelayList(author, hints)
  if (hasDmInbox(getMessagingRelayList(author))) return true

  // Discovery can finish before batched startup requests deliver the inbox list.
  // Confirm absence with an isolated request; a timeout/disconnect is not absence.
  let receivedEose = false
  const relays = normalizeRelayUrls([...hints, ...Router.get().FromPubkeys([author]).getUrls()])
  const events = await dmInboxCheckLoad({
    relays,
    filters: [{kinds: [MESSAGING_RELAYS], authors: [author], limit: 1}],
    onEose: () => {
      receivedEose = true
    },
  })
  const stored = getMessagingRelayList(author)
  const latest = getLatestMessagingRelayListEventsByPubkey([
    ...events,
    ...(stored ? [stored.event] : []),
  ])[0]
  if (latest && getDmRelayUrlsFromEvent(latest).length > 0) return true
  if (!receivedEose && !latest) throw new Error("Could not check DM inbox relays.")
  return false
}

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
