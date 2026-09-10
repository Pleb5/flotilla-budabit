import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {parseRepoStarReaction, repoStarToBookmarkAddress} from "./repo-stars"

import {
  GIT_REPO_ANNOUNCEMENT,
  type BookmarkAddress,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"

import {
  buildBookmarkRepoFilters,
  getCanonicalRepoKeyFromBookmark,
  getCanonicalRepoKeyFromEvent,
  getRepoBookmarkAddressSet,
  isAnyBookmarked,
  matchBookmarkedRepoEvents,
  toggleRepoBookmarks,
} from "./bookmarks"

const makeBookmark = (address: string, relayHint = "wss://relay.example") =>
  ({
    address,
    relayHint,
    author: address.split(":")[1] || "",
    identifier: address.split(":").slice(2).join(":"),
  }) satisfies BookmarkAddress

const makeRepoEvent = (
  pubkey: string,
  identifier: string,
  name = identifier,
): RepoAnnouncementEvent =>
  ({
    kind: GIT_REPO_ANNOUNCEMENT,
    pubkey,
    id: `${pubkey}-${identifier}`,
    created_at: 1,
    content: "",
    sig: "sig",
    tags: [
      ["d", identifier],
      ["name", name],
    ],
  }) as RepoAnnouncementEvent

describe("bookmarks helpers", () => {
  it("buildBookmarkRepoFilters groups identifiers by author without cross-product filters", () => {
    const filters = buildBookmarkRepoFilters([
      makeBookmark("30617:author-a:repo-one"),
      makeBookmark("30617:author-b:repo-two"),
      makeBookmark("30617:author-a:repo-three"),
    ])

    expect(filters).toEqual([
      {
        kinds: [30617],
        authors: ["author-a"],
        "#d": ["repo-one", "repo-three"],
        limit: 2,
      },
      {kinds: [30617], authors: ["author-b"], "#d": ["repo-two"], limit: 1},
    ])
  })

  it("matchBookmarkedRepoEvents keeps exact bookmarked addresses in bookmark order", () => {
    const bookmarks = [
      makeBookmark("30617:author-b:repo-two", "wss://relay.b"),
      makeBookmark("30617:author-a:repo-one", "wss://relay.a"),
    ]

    const matched = matchBookmarkedRepoEvents({
      bookmarks,
      events: [
        makeRepoEvent("author-a", "repo-two"),
        makeRepoEvent("author-a", "repo-one"),
        makeRepoEvent("author-b", "repo-two"),
      ],
      getFallbackRelayHint: event => `fallback:${event.pubkey}`,
    })

    expect(matched.map(item => item.address)).toEqual([
      "30617:author-b:repo-two",
      "30617:author-a:repo-one",
    ])
    expect(matched.map(item => item.event.pubkey)).toEqual(["author-b", "author-a"])
    expect(matched.map(item => item.relayHint)).toEqual(["wss://relay.b", "wss://relay.a"])
  })

  it("toggleRepoBookmarks honors explicitly supplied historical rename aliases", () => {
    const candidateAddresses = getRepoBookmarkAddressSet({
      primaryAddress: "30617:owner:repo",
      relatedAddresses: ["30617:owner:old-identifier"],
    })

    const {isRemoving, nextBookmarks} = toggleRepoBookmarks({
      bookmarks: [
        makeBookmark("30617:owner:repo"),
        makeBookmark("30617:owner:old-identifier"),
        makeBookmark("30617:elsewhere:repo"),
      ],
      candidateAddresses,
      nextBookmark: makeBookmark("30617:owner:repo"),
    })

    expect(isRemoving).toBe(true)
    expect(nextBookmarks.map(bookmark => bookmark.address)).toEqual(["30617:elsewhere:repo"])
  })

  it("isAnyBookmarked honors explicitly supplied historical rename addresses", () => {
    expect(
      isAnyBookmarked(
        [makeBookmark("30617:owner:repo")],
        getRepoBookmarkAddressSet({
          primaryAddress: "30617:owner:new-identifier",
          relatedAddresses: ["30617:owner:repo"],
        }),
      ),
    ).toBe(true)
  })

  it("uses exact coordinates without colliding same-name repos from different owners", () => {
    const ownerA = "a".repeat(64)
    const ownerB = "b".repeat(64)
    const repoName = "shared-name"

    expect(
      isAnyBookmarked([makeBookmark(`30617:${ownerA}:${repoName}`)], [], {
        candidateRepoKeys: [getCanonicalRepoKeyFromEvent(makeRepoEvent(ownerA, repoName))],
      }),
    ).toBe(true)

    expect(
      isAnyBookmarked([makeBookmark(`30617:${ownerA}:${repoName}`)], [], {
        candidateRepoKeys: [getCanonicalRepoKeyFromEvent(makeRepoEvent(ownerB, repoName))],
      }),
    ).toBe(false)
  })

  it("toggleRepoBookmarks removes canonical matches but keeps same-name repos from other owners", () => {
    const ownerA = "a".repeat(64)
    const ownerB = "b".repeat(64)
    const repoName = "shared-name"
    const bookmarks = [
      makeBookmark(`30617:${ownerA}:${repoName}`),
      makeBookmark(`30617:${ownerB}:${repoName}`),
    ]
    const cachedEvents = new Map([
      [`30617:${ownerA}:${repoName}`, makeRepoEvent(ownerA, repoName, repoName)],
      [`30617:${ownerB}:${repoName}`, makeRepoEvent(ownerB, repoName, repoName)],
    ])

    const {isRemoving, nextBookmarks} = toggleRepoBookmarks({
      bookmarks,
      candidateAddresses: [],
      candidateRepoKeys: [getCanonicalRepoKeyFromEvent(makeRepoEvent(ownerA, repoName))],
      nextBookmark: makeBookmark(`30617:${ownerA}:${repoName}`),
      getCachedEvent: address => cachedEvents.get(address),
    })

    expect(isRemoving).toBe(true)
    expect(nextBookmarks.map(bookmark => bookmark.address)).toEqual([`30617:${ownerB}:${repoName}`])
  })

  it.each(["Shared display", "名前 with spaces!"])(
    "does not match or remove another coordinate with display name %s",
    name => {
      const owner = "a".repeat(64)
      const first = makeRepoEvent(owner, "first", name)
      const second = makeRepoEvent(owner, "second", name)
      const firstKey = getCanonicalRepoKeyFromEvent(first)
      const secondKey = getCanonicalRepoKeyFromEvent(second)
      const cached = new Map([
        [firstKey, first],
        [secondKey, second],
      ])
      const getCachedEvent = (address: string) => cached.get(address)
      const bookmarks = [makeBookmark(firstKey)]
      expect(firstKey).not.toBe(secondKey)
      expect(
        isAnyBookmarked(bookmarks, [secondKey], {
          candidateRepoKeys: [secondKey],
          getCachedEvent,
        }),
      ).toBe(false)
      const added = toggleRepoBookmarks({
        bookmarks,
        candidateAddresses: [secondKey],
        candidateRepoKeys: [secondKey],
        nextBookmark: makeBookmark(secondKey),
        getCachedEvent,
      })
      expect(added.isRemoving).toBe(false)
      const removed = toggleRepoBookmarks({
        bookmarks: added.nextBookmarks,
        candidateAddresses: [secondKey],
        candidateRepoKeys: [secondKey],
        nextBookmark: makeBookmark(secondKey),
        getCachedEvent,
      })
      expect(removed.nextBookmarks).toEqual(bookmarks)
    },
  )

  it("keeps opaque identifiers exact with and without cached announcements", () => {
    const owner = "a".repeat(64)
    const identifiers = ["repo", "repo ", " repo", "Repo", "Legacy/Case:ID"]
    const keys = identifiers.map(identifier => {
      const event = makeRepoEvent(owner, identifier, "Same display name")
      const key = getCanonicalRepoKeyFromEvent(event)
      const bookmark = makeBookmark(`30617:${owner}:${identifier}`)
      expect(key).toBe(bookmark.address)
      expect(getCanonicalRepoKeyFromBookmark({bookmark})).toBe(key)
      expect(getCanonicalRepoKeyFromBookmark({bookmark, getCachedEvent: () => event})).toBe(key)
      return key
    })
    expect(new Set(keys).size).toBe(identifiers.length)
  })

  it.each(["personal", "community"])(
    "keeps %s star selection and removal on its exact coordinate",
    scope => {
      const owner = "a".repeat(64)
      const first = makeRepoEvent(owner, "first", "Shared display")
      const second = makeRepoEvent(owner, "second", "Shared display")
      const firstAddress = getCanonicalRepoKeyFromEvent(first)
      const secondAddress = getCanonicalRepoKeyFromEvent(second)
      const events = new Map([
        [firstAddress, first],
        [secondAddress, second],
      ])
      const stars = [firstAddress, secondAddress].map(
        (address, i) =>
          parseRepoStarReaction({
            kind: 7,
            pubkey: "b".repeat(64),
            content: "+",
            created_at: 1,
            id: `${scope}-reaction-${i}`,
            sig: "fixture-only",
            tags: [
              ["a", address],
              ["k", "30617"],
              ...(scope === "community" ? [["h", "community"]] : []),
            ],
          } as TrustedEvent)!,
      )
      const matches = (star: (typeof stars)[number]) =>
        isAnyBookmarked([repoStarToBookmarkAddress(star)], [secondAddress], {
          candidateRepoKeys: [getCanonicalRepoKeyFromEvent(second)],
          getCachedEvent: address => events.get(address),
        })
      expect(stars.slice(0, 1).some(matches)).toBe(false)
      // These are the matching reaction IDs the collection UI passes to deletion.
      expect(stars.filter(matches).map(star => star.reaction.id)).toEqual([`${scope}-reaction-1`])
    },
  )
})
