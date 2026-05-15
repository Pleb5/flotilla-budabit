import {describe, expect, it, vi, beforeEach} from "vitest"

vi.mock("@welshman/net", () => ({load: vi.fn()}))
vi.mock("@nostr-git/ui", () => ({
  tokens: {clear: vi.fn(), push: vi.fn()},
  bookmarksStore: {set: vi.fn()},
  DEFAULT_GRASP_SERVER_URL: "wss://grasp.budabit.club",
  graspServersStore: {set: vi.fn()},
}))

const {load} = await import("@welshman/net")
const {GIT_REPO_ANNOUNCEMENT, GIT_REPO_BOOKMARK_DTAG, GIT_REPO_BOOKMARK_SET} =
  await import("@nostr-git/core/events")
const {NAMED_BOOKMARKS} = await import("@welshman/util")
const {
  loadRepositories,
  loadGraspServers,
  loadTokens,
  GIT_AUTH_DTAG,
  getGitRepoBookmarkAddressesFromEvents,
} = await import("./git-requests")

const viewerPubkey = "f".repeat(64)
const ownerA = "a".repeat(64)
const ownerB = "b".repeat(64)

const makeBookmarkEvent = (created_at: number, tags: string[][]) => ({
  kind: NAMED_BOOKMARKS,
  pubkey: viewerPubkey,
  created_at,
  tags,
  id: String(created_at),
  content: "",
  sig: "sig",
})

describe("requests", () => {
  beforeEach(() => {
    vi.mocked(load).mockClear()
  })

  describe("loadRepositories", () => {
    it("calls load with expected filters", async () => {
      await loadRepositories("pk123", ["wss://relay.example.com"])
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({
          relays: ["wss://relay.example.com"],
          filters: expect.arrayContaining([
            {kinds: [NAMED_BOOKMARKS], authors: ["pk123"], "#d": expect.any(Array)},
            {kinds: [GIT_REPO_BOOKMARK_SET], authors: ["pk123"]},
            {kinds: [GIT_REPO_ANNOUNCEMENT], authors: ["pk123"]},
          ]),
        }),
      )
    })

    it("uses empty relays when not provided", async () => {
      await loadRepositories("pk456")
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({
          relays: [],
        }),
      )
    })
  })

  describe("getGitRepoBookmarkAddressesFromEvents", () => {
    it("falls back to the newest legacy bookmark event with git repo addresses", () => {
      const mapped = getGitRepoBookmarkAddressesFromEvents([
        makeBookmarkEvent(10, [["d", "unrelated-bookmarks"]]),
        makeBookmarkEvent(5, [
          ["a", `${GIT_REPO_ANNOUNCEMENT}:${ownerA}:nostr-git`, "wss://relay.example.com"],
        ]),
      ])

      expect(mapped).toEqual([
        {
          address: `${GIT_REPO_ANNOUNCEMENT}:${ownerA}:nostr-git`,
          author: ownerA,
          identifier: "nostr-git",
          relayHint: "wss://relay.example.com/",
        },
      ])
    })

    it("prefers the explicit git bookmark set over legacy bookmark events", () => {
      const mapped = getGitRepoBookmarkAddressesFromEvents([
        makeBookmarkEvent(5, [["a", `${GIT_REPO_ANNOUNCEMENT}:${ownerA}:old-repo`]]),
        makeBookmarkEvent(10, [
          ["d", GIT_REPO_BOOKMARK_DTAG],
          ["a", `${GIT_REPO_ANNOUNCEMENT}:${ownerB}:new-repo`],
        ]),
      ])

      expect(mapped.map(bookmark => bookmark.address)).toEqual([
        `${GIT_REPO_ANNOUNCEMENT}:${ownerB}:new-repo`,
      ])
    })
  })

  describe("loadGraspServers", () => {
    it("calls load with GRASP filter", async () => {
      await loadGraspServers("pk789", ["wss://relay.com"])
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({
          relays: ["wss://relay.com"],
          filters: expect.any(Array),
        }),
      )
    })
  })

  describe("loadTokens", () => {
    it("calls load with APP_DATA and GIT_AUTH_DTAG filter", async () => {
      await loadTokens("pk999", ["wss://relay.com"])
      expect(load).toHaveBeenCalledWith({
        relays: ["wss://relay.com"],
        filters: [{kinds: expect.any(Array), authors: ["pk999"], "#d": [GIT_AUTH_DTAG]}],
      })
    })
  })
})
