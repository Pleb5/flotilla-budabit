import {get, writable} from "svelte/store"
import {chunk} from "@welshman/lib"
import {makeLoader} from "@welshman/net"
import {Router} from "@welshman/router"
import {getFollows, getMutes, pubkey, repository, tracker} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"
import {
  getProfileListPubkeys,
  normalizePubkey,
  normalizeRelays,
  PROFILE_LIST_KIND,
  type CommunityDefinition,
} from "@app/core/community"
import type {
  ActiveUserCommunityRef,
  UserCommunityReportStates,
} from "@app/core/community-membership"
import {isCommunityPersonBanned} from "@app/core/community-reports"

export const CASHU_MINT_LIST_KIND = 10019

export type CashuMintRecommendationRole = "community" | "moderator" | "member"

export type CashuMintRecommendationEvidenceKind =
  | "community"
  | "moderator"
  | "member"
  | "follow"
  | "own_nutzap"

export type CashuMintRecommendationEvidenceSource = "10222" | "10019"

export type CashuMintRecommendationRoleDetail = {
  pubkey: string
  communityPubkey: string
  role: CashuMintRecommendationRole
  moderatorSectionCount: number
  memberGrantCount: number
  relayHints: string[]
}

export type CashuMintRecommendationEvidence = {
  kind: CashuMintRecommendationEvidenceKind
  source: CashuMintRecommendationEvidenceSource
  pubkey: string
  communityPubkey?: string
  relayHints?: string[]
  communityRelayHints?: string[]
  role?: CashuMintRecommendationRole
  moderatorSectionCount?: number
  memberGrantCount?: number
  score: number
}

export type CashuMintRecommendationCounts = {
  communities: number
  moderators: number
  members: number
  follows: number
  ownNutzap: number
}

export type CashuMintRecommendation = {
  mintUrl: string
  score: number
  counts: CashuMintRecommendationCounts
  evidence: CashuMintRecommendationEvidence[]
}

export type CashuMintRecommendationState = {
  status: "idle" | "loading" | "ready" | "error"
  authorCount: number
  eventCount: number
  recommendationCount: number
  error?: string
}

export type BuildCashuMintRecommendationsInput = {
  viewerPubkey?: string
  trustedMints?: string[]
  communityRefs?: ActiveUserCommunityRef[]
  profileListEvents?: TrustedEvent[]
  reportStates?: UserCommunityReportStates
  follows?: string[]
  mutes?: string[]
  mintListEvents?: TrustedEvent[]
}

export type LoadCashuMintRecommendationsInput = Omit<
  BuildCashuMintRecommendationsInput,
  "viewerPubkey" | "follows" | "mutes" | "mintListEvents"
>

const COMMUNITY_MINT_WEIGHT = 100
const PERSONAL_MINT_WEIGHT = 50
const OWN_NUTZAP_MINT_WEIGHT = 75
const DIRECT_FOLLOW_MINT_WEIGHT = 10
const MAX_SECTION_BONUS = 0.25
const MAX_RECOMMENDER_COMMUNITY_SCORE = PERSONAL_MINT_WEIGHT * 3
const AUTHOR_LIMIT = 500
const DIRECT_FOLLOW_AUTHOR_LIMIT = 250
const AUTHOR_BATCH_SIZE = 80

const mintListLoad = makeLoader({delay: 200, timeout: 6000, threshold: 0.5})

const defaultRecommendationState: CashuMintRecommendationState = {
  status: "idle",
  authorCount: 0,
  eventCount: 0,
  recommendationCount: 0,
}

export const cashuMintRecommendations = writable<CashuMintRecommendation[]>([])
export const cashuMintRecommendationState = writable<CashuMintRecommendationState>(
  defaultRecommendationState,
)

const unique = <T>(values: T[]) => Array.from(new Set(values))

export const normalizeCashuMintUrl = (value: string | undefined) => {
  const trimmed = (value || "").trim()
  if (!trimmed) return ""

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:" && url.protocol !== "http:") return ""

    url.hash = ""
    url.search = ""
    const pathname = url.pathname.replace(/\/+$/, "")

    return `${url.protocol}//${url.host}${pathname}`
  } catch {
    return ""
  }
}

export const normalizeCashuMintUrls = (mints: string[] = []) =>
  unique(mints.map(normalizeCashuMintUrl).filter(Boolean))

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

const getLatestMintListEventsByPubkey = (events: TrustedEvent[] = []) => {
  const latest = new Map<string, TrustedEvent>()

  for (const event of events) {
    if (event.kind !== CASHU_MINT_LIST_KIND) continue

    const author = normalizePubkey(event.pubkey || "")
    if (!author) continue

    const current = latest.get(author)
    if (isPreferredEvent(event, current)) latest.set(author, event)
  }

  return Array.from(latest.values())
}

const getReportState = (states: UserCommunityReportStates | undefined, communityPubkey: string) =>
  states instanceof Map ? states.get(communityPubkey) : states?.[communityPubkey]

const getTrackedEventRelays = (event: TrustedEvent | undefined) => {
  if (!event?.id) return []

  try {
    return normalizeRelays(Array.from(tracker.getRelays(event.id) || []))
  } catch {
    return []
  }
}

const getCommunityDefinitionRelayHints = (definition: CommunityDefinition) =>
  normalizeRelays([...definition.relays, ...getTrackedEventRelays(definition.event)])

const getProfileListPubkeyRelayHints = (event: TrustedEvent | undefined, pubkey: string) => {
  if (!event || event.kind !== PROFILE_LIST_KIND) return []

  return normalizeRelays(
    (event.tags || [])
      .filter(tag => tag[0] === "p" && normalizePubkey(tag[1] || "") === pubkey)
      .map(tag => tag[2] || ""),
  )
}

const getSectionBonus = (count: number) => Math.min(Math.max(count, 0) * 0.05, MAX_SECTION_BONUS)

const getRoleBonus = (detail: CashuMintRecommendationRoleDetail) => {
  if (detail.role === "moderator") return getSectionBonus(detail.moderatorSectionCount)
  if (detail.role === "member") return getSectionBonus(detail.memberGrantCount)
  return 0
}

const getViewerRoleMultiplier = (detail: CashuMintRecommendationRoleDetail) => {
  switch (detail.role) {
    case "community":
      return 1.5
    case "moderator":
      return 1.25 + getRoleBonus(detail)
    case "member":
      return 1 + getRoleBonus(detail)
  }
}

const getRecommenderRoleMultiplier = (detail: CashuMintRecommendationRoleDetail) => {
  switch (detail.role) {
    case "community":
      return 2
    case "moderator":
      return 1.5 + getRoleBonus(detail)
    case "member":
      return 1 + getRoleBonus(detail)
  }
}

const getRoleEvidenceKind = (
  role: CashuMintRecommendationRole,
): Exclude<CashuMintRecommendationEvidenceKind, "follow" | "own_nutzap"> => {
  switch (role) {
    case "community":
      return "community"
    case "moderator":
      return "moderator"
    case "member":
      return "member"
  }
}

const getCommunityRoleDetail = ({
  definition,
  profileListsByAddress,
  reportStates,
  pubkey,
}: {
  definition: CommunityDefinition
  profileListsByAddress: Map<string, TrustedEvent>
  reportStates?: UserCommunityReportStates
  pubkey: string
}): CashuMintRecommendationRoleDetail | undefined => {
  const normalizedPubkey = normalizePubkey(pubkey || "")
  if (!normalizedPubkey) return
  const communityRelayHints = getCommunityDefinitionRelayHints(definition)

  if (definition.pubkey === normalizedPubkey) {
    return {
      pubkey: normalizedPubkey,
      communityPubkey: definition.pubkey,
      role: "community",
      moderatorSectionCount: definition.sections.length,
      memberGrantCount: definition.sections.length,
      relayHints: communityRelayHints,
    }
  }

  if (isCommunityPersonBanned(getReportState(reportStates, definition.pubkey), normalizedPubkey)) {
    return
  }

  const moderatorSections = new Set<string>()
  const memberSections = new Set<string>()
  const roleRelayHints: string[] = []

  for (const section of definition.sections) {
    for (const ref of section.profileLists) {
      const event = profileListsByAddress.get(ref.address)
      const profileListRelayHints = normalizeRelays([
        ref.relay || "",
        ...getTrackedEventRelays(event),
      ])

      if (ref.pubkey === normalizedPubkey && event?.pubkey === normalizedPubkey) {
        moderatorSections.add(section.name)
        roleRelayHints.push(...profileListRelayHints)
      }

      if (getProfileListPubkeys(event).includes(normalizedPubkey)) {
        memberSections.add(section.name)
        roleRelayHints.push(
          ...profileListRelayHints,
          ...getProfileListPubkeyRelayHints(event, normalizedPubkey),
        )
      }
    }
  }

  if (moderatorSections.size > 0) {
    return {
      pubkey: normalizedPubkey,
      communityPubkey: definition.pubkey,
      role: "moderator",
      moderatorSectionCount: moderatorSections.size,
      memberGrantCount: memberSections.size,
      relayHints: normalizeRelays([...communityRelayHints, ...roleRelayHints]),
    }
  }

  if (memberSections.size > 0) {
    return {
      pubkey: normalizedPubkey,
      communityPubkey: definition.pubkey,
      role: "member",
      moderatorSectionCount: 0,
      memberGrantCount: memberSections.size,
      relayHints: normalizeRelays([...communityRelayHints, ...roleRelayHints]),
    }
  }
}

const getDefinitionsFromRefs = (refs: ActiveUserCommunityRef[] = []) => {
  const byPubkey = new Map<string, CommunityDefinition>()

  for (const ref of refs) {
    const current = byPubkey.get(ref.communityPubkey)
    if (!current || ref.definition.event.created_at > current.event.created_at) {
      byPubkey.set(ref.communityPubkey, ref.definition)
    }
  }

  return Array.from(byPubkey.values())
}

const tagSupportsSat = (tag: string[]) => {
  const units = tag
    .slice(2)
    .map(unit => unit.toLowerCase())
    .filter(Boolean)

  return units.length === 0 || units.includes("sat")
}

const parseMintListEventMints = (event: TrustedEvent) =>
  unique(
    event.tags
      .filter(tag => tag[0] === "mint" && tagSupportsSat(tag))
      .map(tag => normalizeCashuMintUrl(tag[1]))
      .filter(Boolean),
  )

const makeEmptyCounts = (): CashuMintRecommendationCounts => ({
  communities: 0,
  moderators: 0,
  members: 0,
  follows: 0,
  ownNutzap: 0,
})

const getRecommendationEntry = (
  recommendations: Map<string, CashuMintRecommendation>,
  mintUrl: string,
) => {
  const existing = recommendations.get(mintUrl)
  if (existing) return existing

  const created: CashuMintRecommendation = {
    mintUrl,
    score: 0,
    counts: makeEmptyCounts(),
    evidence: [],
  }
  recommendations.set(mintUrl, created)

  return created
}

const addEvidence = (
  recommendations: Map<string, CashuMintRecommendation>,
  mintUrl: string,
  evidence: CashuMintRecommendationEvidence,
) => {
  const entry = getRecommendationEntry(recommendations, mintUrl)

  entry.evidence.push(evidence)
  entry.score += evidence.score
}

const countEvidence = (entry: CashuMintRecommendation) => {
  const communities = new Set<string>()
  const moderators = new Set<string>()
  const members = new Set<string>()
  const follows = new Set<string>()
  let ownNutzap = 0

  for (const evidence of entry.evidence) {
    if (evidence.kind === "community" && evidence.communityPubkey) {
      communities.add(evidence.communityPubkey)
    }
    if (evidence.kind === "moderator") {
      moderators.add(`${evidence.pubkey}:${evidence.communityPubkey || ""}`)
    }
    if (evidence.kind === "member")
      members.add(`${evidence.pubkey}:${evidence.communityPubkey || ""}`)
    if (evidence.kind === "follow") follows.add(evidence.pubkey)
    if (evidence.kind === "own_nutzap") ownNutzap = 1
  }

  entry.counts = {
    communities: communities.size,
    moderators: moderators.size,
    members: members.size,
    follows: follows.size,
    ownNutzap,
  }
}

export const buildCashuMintRecommendations = ({
  viewerPubkey = "",
  trustedMints = [],
  communityRefs = [],
  profileListEvents = [],
  reportStates,
  follows = [],
  mutes = [],
  mintListEvents = [],
}: BuildCashuMintRecommendationsInput) => {
  const viewer = normalizePubkey(viewerPubkey || "")
  const trusted = new Set(normalizeCashuMintUrls(trustedMints))
  const profileListsByAddress = getLatestProfileListEventsByAddress(profileListEvents)
  const definitions = getDefinitionsFromRefs(communityRefs)
  const followed = new Set(follows.map(normalizePubkey).filter(Boolean))
  const muted = new Set(mutes.map(normalizePubkey).filter(Boolean))
  const recommendations = new Map<string, CashuMintRecommendation>()

  for (const definition of definitions) {
    const viewerRole = getCommunityRoleDetail({
      definition,
      profileListsByAddress,
      reportStates,
      pubkey: viewer,
    })

    if (!viewerRole) continue

    for (const mint of definition.mints) {
      if (mint.type && mint.type.toLowerCase() !== "cashu") continue

      const mintUrl = normalizeCashuMintUrl(mint.url)
      if (!mintUrl || trusted.has(mintUrl)) continue

      const score = COMMUNITY_MINT_WEIGHT * getViewerRoleMultiplier(viewerRole)

      addEvidence(recommendations, mintUrl, {
        kind: "community",
        source: "10222",
        pubkey: definition.pubkey,
        communityPubkey: definition.pubkey,
        relayHints: getCommunityDefinitionRelayHints(definition),
        communityRelayHints: getCommunityDefinitionRelayHints(definition),
        role: "community",
        moderatorSectionCount: definition.sections.length,
        memberGrantCount: definition.sections.length,
        score,
      })
    }
  }

  for (const event of getLatestMintListEventsByPubkey(mintListEvents)) {
    const recommender = normalizePubkey(event.pubkey || "")
    if (!recommender) continue
    const recommenderRelayHints = getTrackedEventRelays(event)

    for (const mintUrl of parseMintListEventMints(event)) {
      if (trusted.has(mintUrl)) continue

      if (viewer && recommender === viewer) {
        addEvidence(recommendations, mintUrl, {
          kind: "own_nutzap",
          source: "10019",
          pubkey: recommender,
          relayHints: recommenderRelayHints,
          score: OWN_NUTZAP_MINT_WEIGHT,
        })
        continue
      }

      const roleEvidence: CashuMintRecommendationEvidence[] = []

      for (const definition of definitions) {
        const viewerRole = getCommunityRoleDetail({
          definition,
          profileListsByAddress,
          reportStates,
          pubkey: viewer,
        })
        const recommenderRole = getCommunityRoleDetail({
          definition,
          profileListsByAddress,
          reportStates,
          pubkey: recommender,
        })

        if (!viewerRole || !recommenderRole) continue

        roleEvidence.push({
          kind: getRoleEvidenceKind(recommenderRole.role),
          source: "10019",
          pubkey: recommender,
          communityPubkey: definition.pubkey,
          relayHints: normalizeRelays([...recommenderRelayHints, ...recommenderRole.relayHints]),
          communityRelayHints: getCommunityDefinitionRelayHints(definition),
          role: recommenderRole.role,
          moderatorSectionCount: recommenderRole.moderatorSectionCount,
          memberGrantCount: recommenderRole.memberGrantCount,
          score:
            PERSONAL_MINT_WEIGHT *
            getViewerRoleMultiplier(viewerRole) *
            getRecommenderRoleMultiplier(recommenderRole),
        })
      }

      if (roleEvidence.length > 0) {
        const sortedRoleEvidence = roleEvidence.sort((a, b) => b.score - a.score)
        let totalCommunityScore = 0

        for (const [index, evidence] of sortedRoleEvidence.entries()) {
          const score = evidence.score * (index === 0 ? 1 : 0.5)
          const remaining = MAX_RECOMMENDER_COMMUNITY_SCORE - totalCommunityScore
          if (remaining <= 0) break

          const cappedScore = Math.min(score, remaining)
          totalCommunityScore += cappedScore
          addEvidence(recommendations, mintUrl, {...evidence, score: cappedScore})
        }
      }

      if (followed.has(recommender) && !muted.has(recommender)) {
        addEvidence(recommendations, mintUrl, {
          kind: "follow",
          source: "10019",
          pubkey: recommender,
          relayHints: recommenderRelayHints,
          score: DIRECT_FOLLOW_MINT_WEIGHT,
        })
      }
    }
  }

  for (const entry of recommendations.values()) countEvidence(entry)

  return Array.from(recommendations.values()).sort((a, b) => {
    const aCommunityMint = a.evidence.some(evidence => evidence.source === "10222")
    const bCommunityMint = b.evidence.some(evidence => evidence.source === "10222")

    if (aCommunityMint !== bCommunityMint) return aCommunityMint ? -1 : 1
    if (a.score !== b.score) return b.score - a.score
    if (a.counts.communities !== b.counts.communities) {
      return b.counts.communities - a.counts.communities
    }
    const aPeople = a.counts.moderators + a.counts.members + a.counts.follows
    const bPeople = b.counts.moderators + b.counts.members + b.counts.follows
    if (aPeople !== bPeople) return bPeople - aPeople

    return a.mintUrl.localeCompare(b.mintUrl)
  })
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

export const getCashuMintRecommendationAuthors = ({
  viewerPubkey,
  follows = [],
  communityRefs = [],
  profileListEvents = [],
}: {
  viewerPubkey?: string
  follows?: string[]
  communityRefs?: ActiveUserCommunityRef[]
  profileListEvents?: TrustedEvent[]
}) => {
  const viewer = normalizePubkey(viewerPubkey || "")
  const {communityAuthors, moderatorAuthors, memberAuthors} = getCommunityProfileListAuthors(
    communityRefs,
    profileListEvents,
  )
  const directFollows = follows
    .map(normalizePubkey)
    .filter(author => author && author !== viewer)
    .slice(0, DIRECT_FOLLOW_AUTHOR_LIMIT)

  return unique(
    [viewer, ...communityAuthors, ...moderatorAuthors, ...directFollows, ...memberAuthors]
      .map(normalizePubkey)
      .filter(Boolean),
  ).slice(0, AUTHOR_LIMIT)
}

const getRecommendationRelays = (authors: string[], communityRefs: ActiveUserCommunityRef[]) => {
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

  return normalizeRelays([
    ...communityRefs.flatMap(ref => ref.relayHints),
    ...authorRelays,
    ...userRelays,
    ...indexRelays,
  ])
}

const loadMintListEvents = async (authors: string[], relays: string[]) => {
  const loaded: TrustedEvent[] = []

  for (const batch of chunk(AUTHOR_BATCH_SIZE, authors)) {
    const events = await mintListLoad({
      filters: [{kinds: [CASHU_MINT_LIST_KIND], authors: batch}],
      relays,
    })

    loaded.push(...(events as TrustedEvent[]))
  }

  return loaded
}

export const loadCashuMintRecommendations = async ({
  trustedMints = [],
  communityRefs = [],
  profileListEvents = [],
  reportStates,
}: LoadCashuMintRecommendationsInput = {}) => {
  const viewer = pubkey.get() || ""
  const follows = viewer ? getFollows(viewer) : []
  const mutes = viewer ? getMutes(viewer) : []
  const authors = getCashuMintRecommendationAuthors({
    viewerPubkey: viewer,
    follows,
    communityRefs,
    profileListEvents,
  })
  const relays = getRecommendationRelays(authors, communityRefs)

  cashuMintRecommendationState.set({
    ...defaultRecommendationState,
    status: "loading",
    authorCount: authors.length,
  })

  try {
    if (authors.length > 0 && relays.length > 0) {
      await loadMintListEvents(authors, relays)
    }

    const mintListEvents =
      authors.length > 0
        ? (repository.query([{kinds: [CASHU_MINT_LIST_KIND], authors}]) as TrustedEvent[])
        : []
    const recommendations = buildCashuMintRecommendations({
      viewerPubkey: viewer,
      trustedMints,
      communityRefs,
      profileListEvents,
      reportStates,
      follows,
      mutes,
      mintListEvents,
    })

    cashuMintRecommendations.set(recommendations)
    cashuMintRecommendationState.set({
      status: "ready",
      authorCount: authors.length,
      eventCount: mintListEvents.length,
      recommendationCount: recommendations.length,
    })

    return recommendations
  } catch (error) {
    cashuMintRecommendations.set([])
    cashuMintRecommendationState.set({
      status: "error",
      authorCount: authors.length,
      eventCount: 0,
      recommendationCount: 0,
      error: error instanceof Error ? error.message : "Failed to load Cashu mint recommendations.",
    })

    return []
  }
}

export const getCashuMintRecommendationsSnapshot = () => get(cashuMintRecommendations)
