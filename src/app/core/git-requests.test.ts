import {describe, expect, it, vi, beforeEach} from "vitest"

vi.mock("@welshman/net", () => ({load: vi.fn()}))
vi.mock("@nostr-git/ui", () => ({
  tokens: {clear: vi.fn(), push: vi.fn()},
  bookmarksStore: {set: vi.fn()},
  DEFAULT_GRASP_SERVER_URL: "wss://grasp.budabit.club",
  graspServersStore: {set: vi.fn()},
}))

const {load} = await import("@welshman/net")
const {GIT_REPO_ANNOUNCEMENT, GIT_REPO_BOOKMARK_SET} = await import("@nostr-git/core/events")
const {NAMED_BOOKMARKS} = await import("@welshman/util")
const {loadRepositories, loadGraspServers, loadTokens, GIT_AUTH_DTAG} =
  await import("./git-requests")

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
