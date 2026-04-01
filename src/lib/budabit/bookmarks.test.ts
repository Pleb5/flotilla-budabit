import {describe, expect, it} from "vitest"

import {
  GIT_REPO_ANNOUNCEMENT,
  type BookmarkAddress,
  type RepoAnnouncementEvent,
} from "@nostr-git/core/events"

import {
  buildBookmarkRepoFilters,
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
    identifier: address.split(":")[2] || "",
  }) satisfies BookmarkAddress

const makeRepoEvent = (pubkey: string, identifier: string): RepoAnnouncementEvent =>
  ({
    kind: GIT_REPO_ANNOUNCEMENT,
    pubkey,
    id: `${pubkey}-${identifier}`,
    created_at: 1,
    content: "",
    sig: "sig",
    tags: [
      ["d", identifier],
      ["name", identifier],
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
      {kinds: [30617], authors: ["author-a"], "#d": ["repo-one", "repo-three"]},
      {kinds: [30617], authors: ["author-b"], "#d": ["repo-two"]},
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

  it("toggleRepoBookmarks removes all alias addresses for the same repo", () => {
    const candidateAddresses = getRepoBookmarkAddressSet({
      primaryAddress: "30617:owner:repo",
      relatedAddresses: ["30617:maintainer:repo"],
    })

    const {isRemoving, nextBookmarks} = toggleRepoBookmarks({
      bookmarks: [
        makeBookmark("30617:owner:repo"),
        makeBookmark("30617:maintainer:repo"),
        makeBookmark("30617:elsewhere:repo"),
      ],
      candidateAddresses,
      nextBookmark: makeBookmark("30617:owner:repo"),
    })

    expect(isRemoving).toBe(true)
    expect(nextBookmarks.map(bookmark => bookmark.address)).toEqual(["30617:elsewhere:repo"])
  })

  it("isAnyBookmarked treats any equivalent repo address as bookmarked", () => {
    expect(
      isAnyBookmarked(
        [makeBookmark("30617:owner:repo")],
        getRepoBookmarkAddressSet({
          primaryAddress: "30617:maintainer:repo",
          relatedAddresses: ["30617:owner:repo"],
        }),
      ),
    ).toBe(true)
  })
})
