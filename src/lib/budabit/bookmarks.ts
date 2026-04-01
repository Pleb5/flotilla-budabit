import {
  GIT_REPO_ANNOUNCEMENT,
  type BookmarkAddress,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"
import {Address, type Filter} from "@welshman/util"

export type LoadedBookmarkedRepo = {
  address: string
  event: RepoAnnouncementEvent
  relayHint: string
}

const dedupeBookmarks = (bookmarks: BookmarkAddress[]): BookmarkAddress[] => {
  const seen = new Set<string>()
  const deduped: BookmarkAddress[] = []

  for (const bookmark of bookmarks) {
    if (!bookmark?.address || seen.has(bookmark.address)) continue
    seen.add(bookmark.address)
    deduped.push(bookmark)
  }

  return deduped
}

const getBookmarkAddressParts = (address: string) => {
  const parts = String(address || "").split(":")
  if (parts.length < 3) return null

  const [kind, author, ...identifierParts] = parts
  const identifier = identifierParts.join(":")
  if (!kind || !author || !identifier) return null

  return {kind, author, identifier}
}

export const getRepoAddressFromEvent = (event: RepoAnnouncementEvent): string => {
  try {
    return Address.fromEvent(event).toString()
  } catch {
    const dTag = (event.tags || []).find((tag: string[]) => tag[0] === "d")?.[1] || ""
    return dTag && event.pubkey && event.kind ? `${event.kind}:${event.pubkey}:${dTag}` : ""
  }
}

export const buildBookmarkRepoFilters = (bookmarks: BookmarkAddress[]): Filter[] => {
  const identifiersByAuthor = new Map<string, Set<string>>()

  for (const bookmark of dedupeBookmarks(bookmarks)) {
    const parts = getBookmarkAddressParts(bookmark.address)
    if (!parts || parts.kind !== String(GIT_REPO_ANNOUNCEMENT)) continue

    const identifiers = identifiersByAuthor.get(parts.author) || new Set<string>()
    identifiers.add(parts.identifier)
    identifiersByAuthor.set(parts.author, identifiers)
  }

  return Array.from(identifiersByAuthor.entries()).map(([author, identifiers]) => ({
    kinds: [GIT_REPO_ANNOUNCEMENT],
    authors: [author],
    "#d": Array.from(identifiers),
  }))
}

export const buildBookmarkRepoLoadKey = (bookmarks: BookmarkAddress[]): string =>
  dedupeBookmarks(bookmarks)
    .map(bookmark => `${bookmark.address}|${bookmark.relayHint || ""}`)
    .sort()
    .join(",")

export const getRepoBookmarkAddressSet = ({
  primaryAddress,
  relatedAddresses = [],
}: {
  primaryAddress?: string
  relatedAddresses?: string[]
}): Set<string> => {
  const addresses = new Set<string>()

  for (const address of [primaryAddress, ...relatedAddresses]) {
    if (address) addresses.add(address)
  }

  return addresses
}

export const isAnyBookmarked = (
  bookmarks: BookmarkAddress[],
  candidateAddresses: Iterable<string>,
): boolean => {
  const addressSet = new Set(Array.from(candidateAddresses).filter(Boolean))
  if (addressSet.size === 0) return false

  return dedupeBookmarks(bookmarks).some(bookmark => addressSet.has(bookmark.address))
}

export const toggleRepoBookmarks = ({
  bookmarks,
  candidateAddresses,
  nextBookmark,
}: {
  bookmarks: BookmarkAddress[]
  candidateAddresses: Iterable<string>
  nextBookmark: BookmarkAddress
}): {isRemoving: boolean; nextBookmarks: BookmarkAddress[]} => {
  const dedupedBookmarks = dedupeBookmarks(bookmarks)
  const addressSet = new Set(Array.from(candidateAddresses).filter(Boolean))
  const isRemoving = dedupedBookmarks.some(bookmark => addressSet.has(bookmark.address))

  if (isRemoving) {
    return {
      isRemoving,
      nextBookmarks: dedupedBookmarks.filter(bookmark => !addressSet.has(bookmark.address)),
    }
  }

  return {
    isRemoving,
    nextBookmarks: dedupeBookmarks([
      ...dedupedBookmarks.filter(bookmark => bookmark.address !== nextBookmark.address),
      nextBookmark,
    ]),
  }
}

export const matchBookmarkedRepoEvents = ({
  bookmarks,
  events,
  getCachedEvent,
  isDeleted,
  getFallbackRelayHint,
}: {
  bookmarks: BookmarkAddress[]
  events: RepoAnnouncementEvent[]
  getCachedEvent?: (address: string) => RepoAnnouncementEvent | undefined
  isDeleted?: (event: RepoAnnouncementEvent) => boolean
  getFallbackRelayHint?: (event: RepoAnnouncementEvent) => string
}): LoadedBookmarkedRepo[] => {
  const eventsByAddress = new Map<string, RepoAnnouncementEvent>()

  for (const event of events) {
    const address = getRepoAddressFromEvent(event)
    if (!address || eventsByAddress.has(address)) continue
    eventsByAddress.set(address, event)
  }

  const matched: LoadedBookmarkedRepo[] = []

  for (const bookmark of dedupeBookmarks(bookmarks)) {
    const event = getCachedEvent?.(bookmark.address) || eventsByAddress.get(bookmark.address)
    if (!event) continue
    if (isDeleted?.(event)) continue

    matched.push({
      address: bookmark.address,
      event,
      relayHint: bookmark.relayHint || getFallbackRelayHint?.(event) || "",
    })
  }

  return matched
}
