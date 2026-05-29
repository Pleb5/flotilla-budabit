import {describe, expect, it, vi, beforeEach} from "vitest"

const appMocks = vi.hoisted(() => {
  const createStore = <T>(initial: T) => {
    let value = initial

    return {
      set(next: T) {
        value = next
      },
      subscribe(fn: (value: T) => void) {
        fn(value)
        return () => {}
      },
    }
  }

  return {
    signer: createStore<any>({
      nip44: {
        encrypt: vi.fn(async (_pubkey: string, payload: string) => `encrypted:${payload}`),
      },
    }),
    pubkey: createStore<string | undefined>("pk999"),
    publishThunk: vi.fn(),
    ensurePlaintext: vi.fn(),
    repository: {},
  }
})

const storeMocks = vi.hoisted(() => {
  const subscribers = new Set<(events: any[]) => void | Promise<void>>()

  return {
    reset() {
      subscribers.clear()
    },
    async emitTokenEvents(events: any[]) {
      await Promise.all(Array.from(subscribers).map(fn => fn(events)))
    },
    deriveEventsById: vi.fn(() => ({})),
    deriveEventsAsc: vi.fn(() => ({
      subscribe(fn: (events: any[]) => void | Promise<void>) {
        subscribers.add(fn)
        void fn([])
        return () => subscribers.delete(fn)
      },
    })),
  }
})

vi.mock("@welshman/net", () => ({
  load: vi.fn(),
  PublishStatus: {
    Sending: "sending",
    Pending: "pending",
    Success: "success",
    Failure: "failure",
    Timeout: "timeout",
    Aborted: "aborted",
  },
}))

vi.mock("@welshman/app", () => appMocks)

vi.mock("@welshman/store", () => ({
  deriveEventsAsc: storeMocks.deriveEventsAsc,
  deriveEventsById: storeMocks.deriveEventsById,
}))

vi.mock("@app/core/community-relays", () => ({
  getUserDataPublishRelays: (relays: string[]) => [...relays, "wss://community.example.com/"],
}))

vi.mock("@nostr-git/ui", () => ({
  tokens: {clear: vi.fn(), push: vi.fn()},
  bookmarksStore: {set: vi.fn()},
  DEFAULT_GRASP_SERVER_URL: "wss://grasp.budabit.club",
  graspServersStore: {set: vi.fn()},
}))

const {load} = await import("@welshman/net")
const {tokens} = await import("@nostr-git/ui")
const {APP_DATA} = await import("@welshman/util")
const {GIT_REPO_ANNOUNCEMENT, GIT_REPO_BOOKMARK_DTAG, GIT_REPO_BOOKMARK_SET} =
  await import("@nostr-git/core/events")
const {NAMED_BOOKMARKS} = await import("@welshman/util")
const {
  loadRepositories,
  loadGraspServers,
  loadTokens,
  persistGitAuthTokens,
  setupTokensSync,
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
    vi.mocked(tokens.clear).mockClear()
    vi.mocked(tokens.push).mockClear()
    appMocks.publishThunk.mockReset()
    appMocks.ensurePlaintext.mockReset()
    appMocks.pubkey.set("pk999")
    appMocks.signer.set({
      nip44: {
        encrypt: vi.fn(async (_pubkey: string, payload: string) => `encrypted:${payload}`),
      },
    })
    storeMocks.reset()
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

  describe("persistGitAuthTokens", () => {
    it("updates the token store after a relay accepts the encrypted token event", async () => {
      appMocks.publishThunk.mockReturnValue({
        complete: Promise.resolve(),
        results: {
          "wss://relay.com/": {
            relay: "wss://relay.com/",
            status: "success",
            detail: "",
          },
        },
      })

      const result = await persistGitAuthTokens(
        [{host: " github.com ", token: " ghp_test "}],
        ["wss://relay.com"],
      )

      expect(result).toEqual({relayPersisted: true, acceptedRelays: ["wss://relay.com/"]})
      expect(appMocks.publishThunk).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            kind: APP_DATA,
            content: expect.stringContaining("github.com"),
            tags: [["d", GIT_AUTH_DTAG]],
          }),
          relays: expect.arrayContaining(["wss://relay.com/", "wss://community.example.com/"]),
        }),
      )
      expect(tokens.clear).toHaveBeenCalledTimes(1)
      expect(tokens.push).toHaveBeenCalledWith({host: "github.com", token: "ghp_test"})
    })

    it("does not update the token store when no relay accepts the token event", async () => {
      appMocks.publishThunk.mockReturnValue({
        complete: Promise.resolve(),
        results: {
          "wss://relay.com/": {
            relay: "wss://relay.com/",
            status: "failure",
            detail: "blocked",
          },
        },
      })

      await expect(
        persistGitAuthTokens([{host: "github.com", token: "ghp_test"}], ["wss://relay.com"]),
      ).rejects.toThrow("No relay accepted Git token backup")

      expect(tokens.clear).not.toHaveBeenCalled()
      expect(tokens.push).not.toHaveBeenCalled()
    })
  })

  describe("setupTokensSync", () => {
    it("restores tokens from encrypted relay APP_DATA events", async () => {
      appMocks.ensurePlaintext.mockResolvedValue(
        JSON.stringify([{host: "github.com", token: "ghp_loaded_token_value"}]),
      )

      setupTokensSync("pk999", ["wss://relay.com"])
      vi.mocked(tokens.clear).mockClear()

      await storeMocks.emitTokenEvents([
        {
          kind: APP_DATA,
          pubkey: "pk999",
          created_at: 10,
          content: "encrypted",
          tags: [["d", GIT_AUTH_DTAG]],
        },
      ])

      expect(appMocks.ensurePlaintext).toHaveBeenCalledWith(
        expect.objectContaining({content: "encrypted"}),
      )
      expect(tokens.clear).toHaveBeenCalledTimes(1)
      expect(tokens.push).toHaveBeenCalledWith({
        host: "github.com",
        token: "ghp_loaded_token_value",
      })
    })
  })
})
