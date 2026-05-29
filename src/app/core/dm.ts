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

export type DmRelayRecommendationSource = {
  communityPubkey: string
  relays: string[]
  starredAt?: number
  isStarred?: boolean
  isModerator?: boolean
  isAdmin?: boolean
}

export type DmRelayRecommendationCommunity = {
  communityPubkey: string
  score: number
  isStarred: boolean
  isModerator: boolean
  isAdmin: boolean
}

export type DmRelayRecommendation = {
  url: string
  communityPubkeys: string[]
  communities: DmRelayRecommendationCommunity[]
  count: number
  score: number
  latestStarredAt: number
  isConfigured: boolean
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

export const getDmRelayRecommendationSourceScore = (source: DmRelayRecommendationSource) =>
  (source.isStarred === false ? 0 : 1) + (source.isModerator ? 2 : 0) + (source.isAdmin ? 4 : 0)

export const getDmRelayRecommendations = (
  sources: DmRelayRecommendationSource[],
  currentRelays: string[] = [],
): DmRelayRecommendation[] => {
  const currentRelaySet = new Set(normalizeRelayUrls(currentRelays))
  const recommendationsByUrl = new Map<string, DmRelayRecommendation>()

  for (const source of sources) {
    if (!source.communityPubkey) continue
    const sourceScore = getDmRelayRecommendationSourceScore(source)
    if (sourceScore <= 0) continue

    for (const url of normalizeRelayUrls(source.relays)) {
      const recommendation = recommendationsByUrl.get(url) || {
        url,
        communityPubkeys: [],
        communities: [],
        count: 0,
        score: 0,
        latestStarredAt: 0,
        isConfigured: currentRelaySet.has(url),
      }

      if (!recommendation.communityPubkeys.includes(source.communityPubkey)) {
        recommendation.communityPubkeys.push(source.communityPubkey)
        recommendation.communities.push({
          communityPubkey: source.communityPubkey,
          score: sourceScore,
          isStarred: source.isStarred !== false,
          isModerator: Boolean(source.isModerator),
          isAdmin: Boolean(source.isAdmin),
        })
        recommendation.count = recommendation.communityPubkeys.length
        recommendation.score += sourceScore
      }

      recommendation.latestStarredAt = Math.max(
        recommendation.latestStarredAt,
        source.starredAt || 0,
      )
      recommendationsByUrl.set(url, recommendation)
    }
  }

  const recommendations = Array.from(recommendationsByUrl.values())

  for (const recommendation of recommendations) {
    recommendation.communities.sort(
      (a, b) => b.score - a.score || a.communityPubkey.localeCompare(b.communityPubkey),
    )
  }

  return recommendations.sort(
    (a, b) =>
      b.score - a.score ||
      b.count - a.count ||
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
