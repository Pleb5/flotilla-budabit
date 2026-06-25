import {getPlaintext, setPlaintext, signer} from "@welshman/app"
import {Router} from "@welshman/router"
import {decrypt} from "@welshman/signer"
import {
  getListTags,
  getRelayTagValues,
  getTagValue,
  isRelayUrl,
  normalizeRelayUrl,
} from "@welshman/util"
import type {List, TrustedEvent} from "@welshman/util"
import {DM_KIND, INDEXER_RELAYS} from "@app/core/state"
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
