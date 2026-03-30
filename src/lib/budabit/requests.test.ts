import {describe, expect, it, vi, beforeEach} from "vitest"

vi.mock("@welshman/net", () => ({load: vi.fn()}))
vi.mock("@nostr-git/ui", () => ({
  tokens: {clear: vi.fn(), push: vi.fn()},
  bookmarksStore: {set: vi.fn()},
  graspServersStore: {set: vi.fn()},
}))

const {load} = await import("@welshman/net")
const {
  loadRepositories,
  loadGraspServers,
  loadTokens,
  GIT_AUTH_DTAG,
} = await import("./requests")

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
            expect.objectContaining({kinds: expect.any(Array), authors: ["pk123"]}),
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
