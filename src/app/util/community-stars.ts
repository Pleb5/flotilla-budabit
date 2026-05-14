import {DELETE, REACTION, makeEvent, type Filter, type TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, normalizePubkey, normalizeRelays} from "@app/core/community"
import {
  makeCommunityDefinitionAddress,
  parseCommunityDefinitionAddress,
} from "@app/core/community-forms"

export const COMMUNITY_STAR_CONTENT = "+"
export const COMMUNITY_STAR_LIMIT = 200
export const COMMUNITY_STAR_DELETE_LOOKBACK_SECONDS = 60 * 60 * 24 * 30

export type CommunityStarRef = {
  communityPubkey: string
  relayHints: string[]
  reaction: TrustedEvent
}

export const makeCommunityInputValue = ({
  pubkey,
  relayHints = [],
}: {
  pubkey: string
  relayHints?: string[]
}) => {
  const normalizedPubkey = normalizePubkey(pubkey)
  const relays = normalizeRelays(relayHints)
  if (!normalizedPubkey) return ""
  if (relays.length === 0) return normalizedPubkey

  const params = new URLSearchParams()
  for (const relay of relays) params.append("relay", relay)

  return `ncommunity://${normalizedPubkey}?${params.toString()}`
}

export const makeCommunityStarReaction = ({
  communityPubkey,
  relayHints = [],
}: {
  communityPubkey: string
  relayHints?: string[]
}) => {
  const pubkey = normalizePubkey(communityPubkey)
  if (!pubkey) throw new Error("Invalid community pubkey")

  const address = makeCommunityDefinitionAddress(pubkey)
  const relayHint = normalizeRelays(relayHints)[0]
  const aTag = relayHint ? ["a", address, relayHint] : ["a", address]

  return makeEvent(REACTION, {
    content: COMMUNITY_STAR_CONTENT,
    tags: [aTag, ["p", pubkey], ["k", String(COMMUNITY_DEFINITION_KIND)]],
  })
}

export const makeCommunityStarReactionFilter = (author: string): Filter | undefined => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {
    kinds: [REACTION],
    authors: [pubkey],
    "#k": [String(COMMUNITY_DEFINITION_KIND)],
    limit: COMMUNITY_STAR_LIMIT,
  }
}

export const makeCommunityStarDeleteFilter = (
  author: string,
  reactions: TrustedEvent[],
): Filter | undefined => {
  const pubkey = normalizePubkey(author)
  const ids = Array.from(new Set(reactions.map(event => event.id).filter(Boolean)))
  if (!pubkey || ids.length === 0) return undefined

  return {
    kinds: [DELETE],
    authors: [pubkey],
    "#e": ids,
    limit: ids.length,
  }
}

export const makeRecentCommunityStarDeleteFilter = (author: string): Filter | undefined => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {
    kinds: [DELETE],
    authors: [pubkey],
    "#k": [String(REACTION)],
    since: Math.floor(Date.now() / 1000) - COMMUNITY_STAR_DELETE_LOOKBACK_SECONDS,
    limit: COMMUNITY_STAR_LIMIT,
  }
}

export const parseCommunityStarReaction = (event: TrustedEvent): CommunityStarRef | undefined => {
  if (event.kind !== REACTION || event.content !== COMMUNITY_STAR_CONTENT) return undefined

  const aTag = (event.tags || []).find(tag => tag[0] === "a")
  const address = parseCommunityDefinitionAddress(aTag?.[1] || "")
  if (!address) return undefined

  const kTag = (event.tags || []).find(tag => tag[0] === "k")?.[1]
  if (kTag && kTag !== String(COMMUNITY_DEFINITION_KIND)) return undefined

  return {
    communityPubkey: address.pubkey,
    relayHints: normalizeRelays([
      aTag?.[2] || "",
      ...(event.tags || []).filter(tag => tag[0] === "r").map(tag => tag[1] || ""),
    ]),
    reaction: event,
  }
}

export const getDeletedReactionIds = (deleteEvents: TrustedEvent[], author?: string) => {
  const normalizedAuthor = author ? normalizePubkey(author) : ""
  const deletedIds = new Set<string>()

  for (const event of deleteEvents) {
    if (event.kind !== DELETE) continue
    if (normalizedAuthor && event.pubkey !== normalizedAuthor) continue

    for (const tag of event.tags || []) {
      if (tag[0] === "e" && tag[1]) deletedIds.add(tag[1])
    }
  }

  return deletedIds
}

export const selectActiveCommunityStars = ({
  reactions,
  deleteEvents = [],
  author,
}: {
  reactions: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
  author?: string
}): CommunityStarRef[] => {
  const normalizedAuthor = author ? normalizePubkey(author) : ""
  const deletedIds = getDeletedReactionIds(deleteEvents, normalizedAuthor)
  const activeByCommunity = new Map<string, CommunityStarRef>()

  for (const event of reactions) {
    if (normalizedAuthor && event.pubkey !== normalizedAuthor) continue
    if (deletedIds.has(event.id)) continue

    const star = parseCommunityStarReaction(event)
    if (!star) continue

    const current = activeByCommunity.get(star.communityPubkey)
    if (!current || event.created_at > current.reaction.created_at) {
      activeByCommunity.set(star.communityPubkey, star)
    }
  }

  return Array.from(activeByCommunity.values()).sort(
    (a, b) => b.reaction.created_at - a.reaction.created_at,
  )
}
