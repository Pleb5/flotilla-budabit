import {
  GIT_REPO_ANNOUNCEMENT,
  buildRepoKey,
  parseRepoAnnouncementEvent,
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

export const getCanonicalRepoKeyFromEvent = (event?: RepoAnnouncementEvent | null): string => {
  if (!event?.pubkey) return ""

  try {
    const parsed = parseRepoAnnouncementEvent(event)
    return buildRepoKey(event.pubkey, parsed.name || parsed.repoId || "")
  } catch {
    const dTag = (event.tags || []).find((tag: string[]) => tag[0] === "d")?.[1] || ""
    return buildRepoKey(event.pubkey, dTag)
  }
}

export const getCanonicalRepoKeyFromBookmark = ({
  bookmark,
  getCachedEvent,
}: {
  bookmark: BookmarkAddress
  getCachedEvent?: (address: string) => RepoAnnouncementEvent | undefined
}): string => {
  const cachedEvent = getCachedEvent?.(bookmark.address)
  if (cachedEvent) {
    return getCanonicalRepoKeyFromEvent(cachedEvent)
  }

  const parts = String(bookmark.address || "").split(":")
  const author = parts[1] || bookmark.author || ""
  const repoName = parts.slice(2).join(":")

  return buildRepoKey(author, repoName)
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
  options?: {
    candidateRepoKeys?: Iterable<string>
    getCachedEvent?: (address: string) => RepoAnnouncementEvent | undefined
  },
): boolean => {
  const addressSet = new Set(Array.from(candidateAddresses).filter(Boolean))
  const repoKeySet = new Set(Array.from(options?.candidateRepoKeys || []).filter(Boolean))
  if (addressSet.size === 0 && repoKeySet.size === 0) return false

  return dedupeBookmarks(bookmarks).some(bookmark => {
    if (addressSet.has(bookmark.address)) return true
    if (repoKeySet.size === 0) return false

    return (
      getCanonicalRepoKeyFromBookmark({bookmark, getCachedEvent: options?.getCachedEvent}) &&
      repoKeySet.has(
        getCanonicalRepoKeyFromBookmark({bookmark, getCachedEvent: options?.getCachedEvent}),
      )
    )
  })
}

export const toggleRepoBookmarks = ({
  bookmarks,
  candidateAddresses,
  nextBookmark,
  candidateRepoKeys = [],
  getCachedEvent,
}: {
  bookmarks: BookmarkAddress[]
  candidateAddresses: Iterable<string>
  nextBookmark: BookmarkAddress
  candidateRepoKeys?: Iterable<string>
  getCachedEvent?: (address: string) => RepoAnnouncementEvent | undefined
}): {isRemoving: boolean; nextBookmarks: BookmarkAddress[]} => {
  const dedupedBookmarks = dedupeBookmarks(bookmarks)
  const addressSet = new Set(Array.from(candidateAddresses).filter(Boolean))
  const repoKeySet = new Set(Array.from(candidateRepoKeys).filter(Boolean))
  const matchesBookmark = (bookmark: BookmarkAddress) =>
    addressSet.has(bookmark.address) ||
    (repoKeySet.size > 0 &&
      repoKeySet.has(getCanonicalRepoKeyFromBookmark({bookmark, getCachedEvent})))

  const isRemoving = dedupedBookmarks.some(matchesBookmark)

  if (isRemoving) {
    return {
      isRemoving,
      nextBookmarks: dedupedBookmarks.filter(bookmark => !matchesBookmark(bookmark)),
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
