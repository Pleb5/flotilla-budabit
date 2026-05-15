import {
  DELETE,
  REACTION,
  makeEvent,
  normalizeRelayUrl,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {
  GIT_REPO_ANNOUNCEMENT,
  type BookmarkAddress,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"

export const REPO_STAR_CONTENT = "+"
export const REPO_STAR_LIMIT = 500
export const REPO_STAR_DELETE_LOOKBACK_SECONDS = 60 * 60 * 24 * 30

export type RepoStarRef = {
  address: string
  author: string
  identifier: string
  relayHint: string
  relayHints: string[]
  reaction: TrustedEvent
}

const normalizePubkey = (value: string) => (/^[0-9a-f]{64}$/i.test(value) ? value : "")

const normalizeRelay = (url?: string) => {
  if (!url) return ""

  try {
    return normalizeRelayUrl(url)
  } catch {
    return ""
  }
}

const normalizeRelays = (relays: string[]) =>
  Array.from(new Set(relays.map(normalizeRelay).filter(Boolean)))

const getRepoAddressParts = (address: string) => {
  const [kind, author, ...identifierParts] = String(address || "").split(":")
  const identifier = identifierParts.join(":")

  if (kind !== String(GIT_REPO_ANNOUNCEMENT) || !normalizePubkey(author) || !identifier) {
    return null
  }

  return {author, identifier}
}

export const getRepoStarAddressFromEvent = (event: RepoAnnouncementEvent): string => {
  const dTag = (event.tags || []).find(tag => tag[0] === "d")?.[1] || ""
  return event.pubkey && dTag ? `${GIT_REPO_ANNOUNCEMENT}:${event.pubkey}:${dTag}` : ""
}

export const makeRepoStarReaction = ({
  event,
  address = getRepoStarAddressFromEvent(event),
  relayHints = [],
}: {
  event: RepoAnnouncementEvent
  address?: string
  relayHints?: string[]
}) => {
  const parts = getRepoAddressParts(address)
  if (!parts) throw new Error("Invalid repository address")

  const relays = normalizeRelays(relayHints)
  const relayHint = relays[0] || ""
  const aTag = relayHint ? ["a", address, relayHint] : ["a", address]
  const eTag = relayHint ? ["e", event.id, relayHint] : ["e", event.id]

  return makeEvent(REACTION, {
    content: REPO_STAR_CONTENT,
    tags: [
      aTag,
      eTag,
      ["p", event.pubkey],
      ["k", String(GIT_REPO_ANNOUNCEMENT)],
      ...relays.map(relay => ["r", relay]),
    ],
  })
}

export const makeRepoStarReactionFilter = (author: string): Filter | undefined => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {
    kinds: [REACTION],
    authors: [pubkey],
    "#k": [String(GIT_REPO_ANNOUNCEMENT)],
    limit: REPO_STAR_LIMIT,
  }
}

export const makeRepoStarDeleteFilter = (
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

export const makeRecentRepoStarDeleteFilter = (author: string): Filter | undefined => {
  const pubkey = normalizePubkey(author)
  if (!pubkey) return undefined

  return {
    kinds: [DELETE],
    authors: [pubkey],
    "#k": [String(REACTION)],
    since: Math.floor(Date.now() / 1000) - REPO_STAR_DELETE_LOOKBACK_SECONDS,
    limit: REPO_STAR_LIMIT,
  }
}

export const parseRepoStarReaction = (event: TrustedEvent): RepoStarRef | undefined => {
  if (event.kind !== REACTION || event.content !== REPO_STAR_CONTENT) return undefined

  const aTag = (event.tags || []).find(tag => tag[0] === "a")
  const address = aTag?.[1] || ""
  const parts = getRepoAddressParts(address)
  if (!parts) return undefined

  const kTag = (event.tags || []).find(tag => tag[0] === "k")?.[1]
  if (kTag && kTag !== String(GIT_REPO_ANNOUNCEMENT)) return undefined

  const relayHints = normalizeRelays([
    aTag?.[2] || "",
    ...(event.tags || []).filter(tag => tag[0] === "r").map(tag => tag[1] || ""),
  ])

  return {
    address,
    author: parts.author,
    identifier: parts.identifier,
    relayHint: relayHints[0] || "",
    relayHints,
    reaction: event,
  }
}

export const getDeletedRepoStarReactionIds = (deleteEvents: TrustedEvent[], author?: string) => {
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

export const selectActiveRepoStars = ({
  reactions,
  deleteEvents = [],
  author,
}: {
  reactions: TrustedEvent[]
  deleteEvents?: TrustedEvent[]
  author?: string
}): RepoStarRef[] => {
  const normalizedAuthor = author ? normalizePubkey(author) : ""
  const deletedIds = getDeletedRepoStarReactionIds(deleteEvents, normalizedAuthor)
  const activeByAddress = new Map<string, RepoStarRef>()

  for (const event of reactions) {
    if (normalizedAuthor && event.pubkey !== normalizedAuthor) continue
    if (deletedIds.has(event.id)) continue

    const star = parseRepoStarReaction(event)
    if (!star) continue

    const current = activeByAddress.get(star.address)
    if (!current || event.created_at > current.reaction.created_at) {
      activeByAddress.set(star.address, star)
    }
  }

  return Array.from(activeByAddress.values()).sort(
    (a, b) => b.reaction.created_at - a.reaction.created_at,
  )
}

export const repoStarToBookmarkAddress = (star: RepoStarRef): BookmarkAddress => ({
  address: star.address,
  author: star.author,
  identifier: star.identifier,
  relayHint: star.relayHint,
})
