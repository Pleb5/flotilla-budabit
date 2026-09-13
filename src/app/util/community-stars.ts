import {DELETE, REACTION, makeEvent, type Filter, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  type CommunityPointer,
  deleteMatchesCommunity,
  makeCommunityAuthorityTags,
  makeCommunityDeleteTags,
  makeCommunityPointer,
  normalizePubkey,
  parseCommunityAuthority,
} from "@app/core/community"

export const COMMUNITY_STAR_CONTENT = "+"
export const COMMUNITY_STAR_LIMIT = 200
export const COMMUNITY_STAR_DELETE_LOOKBACK_SECONDS = 60 * 60 * 24 * 30

export type CommunityStarRef = {
  community: CommunityPointer
  reaction: TrustedEvent
}

export const makeExactCommunityInputValue = (community: CommunityPointer) => {
  const pointer = makeCommunityPointer({
    ownerPubkey: community.ownerPubkey,
    communityId: community.communityId,
    relayHints: community.relayHints,
  })

  return pointer?.address === community.address ? pointer.naddr : ""
}

export const makeCommunityStarReaction = (community: CommunityPointer) => {
  return makeEvent(REACTION, {
    content: COMMUNITY_STAR_CONTENT,
    tags: makeCommunityAuthorityTags(community, community.relayHints[0], [
      ["k", String(COMMUNITY_DEFINITION_KIND)],
    ]),
  })
}

export const makeCommunityStarDelete = (community: CommunityPointer, reactionId: string) => ({
  kind: DELETE,
  content: "Deleted community star",
  tags: makeCommunityDeleteTags(community, [
    ["e", reactionId],
    ["k", String(REACTION)],
  ]),
})

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

  const community = parseCommunityAuthority(event)
  if (!community) return undefined

  const kTag = (event.tags || []).find(tag => tag[0] === "k")?.[1]
  if (kTag !== String(COMMUNITY_DEFINITION_KIND)) return undefined

  return {
    community,
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
  const activeByCommunity = new Map<string, CommunityStarRef>()

  for (const event of reactions) {
    if (normalizedAuthor && event.pubkey !== normalizedAuthor) continue
    const star = parseCommunityStarReaction(event)
    if (!star) continue

    if (
      deleteEvents.some(deletion => {
        if (deletion.kind !== DELETE || deletion.pubkey !== event.pubkey) return false
        if (!deleteMatchesCommunity(deletion, star.community)) return false

        const eventTags = deletion.tags.filter(tag => tag[0] === "e")
        const kindTags = deletion.tags.filter(tag => tag[0] === "k")
        return (
          eventTags.length === 1 &&
          eventTags[0].length === 2 &&
          eventTags[0][1] === event.id &&
          kindTags.length === 1 &&
          kindTags[0].length === 2 &&
          kindTags[0][1] === String(REACTION)
        )
      })
    ) {
      continue
    }

    const current = activeByCommunity.get(star.community.address)
    if (!current || event.created_at > current.reaction.created_at) {
      activeByCommunity.set(star.community.address, star)
    }
  }

  return Array.from(activeByCommunity.values()).sort(
    (a, b) => b.reaction.created_at - a.reaction.created_at,
  )
}
