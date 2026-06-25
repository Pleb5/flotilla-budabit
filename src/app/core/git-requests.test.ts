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

const graspMocks = vi.hoisted(() => {
  const subscribers = new Set<(urls: string[]) => void>()

  return {
    reset() {
      subscribers.clear()
    },
    emitFallbackUrls(urls: string[]) {
      for (const fn of subscribers) fn(urls)
    },
    graspServerFallbackUrls: {
      subscribe(fn: (urls: string[]) => void) {
        subscribers.add(fn)
        fn([])
        return () => subscribers.delete(fn)
      },
    },
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

vi.mock("@app/core/grasp", () => ({
  graspServerFallbackUrls: graspMocks.graspServerFallbackUrls,
}))

vi.mock("@nostr-git/ui", () => ({
  tokens: {clear: vi.fn(), push: vi.fn()},
  graspServersStore: {set: vi.fn()},
}))

const {load} = await import("@welshman/net")
const {tokens, graspServersStore} = await import("@nostr-git/ui")
const {APP_DATA} = await import("@welshman/util")
const {DEFAULT_GRASP_SET_ID, GIT_REPO_ANNOUNCEMENT, GIT_USER_GRASP_LIST, GRASP_SET_KIND} =
  await import("@nostr-git/core/events")
const {
  loadRepositories,
  loadGraspServers,
  loadTokens,
  persistGitAuthTokens,
  setupGraspServersSync,
  setupTokensSync,
  GIT_AUTH_DTAG,
} = await import("./git-requests")

describe("requests", () => {
  beforeEach(() => {
    vi.mocked(load).mockClear()
    vi.mocked(tokens.clear).mockClear()
    vi.mocked(tokens.push).mockClear()
    vi.mocked(graspServersStore.set).mockClear()
    appMocks.publishThunk.mockReset()
    appMocks.ensurePlaintext.mockReset()
    appMocks.pubkey.set("pk999")
    appMocks.signer.set({
      nip44: {
        encrypt: vi.fn(async (_pubkey: string, payload: string) => `encrypted:${payload}`),
      },
    })
    storeMocks.reset()
    graspMocks.reset()
  })

  describe("loadRepositories", () => {
    it("calls load with expected filters", async () => {
      await loadRepositories("pk123", ["wss://relay.example.com"])
      expect(load).toHaveBeenCalledWith(
        expect.objectContaining({
          relays: ["wss://relay.example.com"],
          filters: [{kinds: [GIT_REPO_ANNOUNCEMENT], authors: ["pk123"]}],
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
        {
          relays: ["wss://relay.com"],
          filters: [
            {kinds: [GIT_USER_GRASP_LIST], authors: ["pk789"]},
            {kinds: [GRASP_SET_KIND], authors: ["pk789"], "#d": [DEFAULT_GRASP_SET_ID]},
          ],
        },
      )
    })
  })

  describe("setupGraspServersSync", () => {
    it("syncs kind 10317 GRASP server URLs", async () => {
      setupGraspServersSync("pk789", ["wss://relay.com"])

      await storeMocks.emitTokenEvents([
        {
          id: "1".repeat(64),
          kind: GIT_USER_GRASP_LIST,
          pubkey: "pk789",
          created_at: 10,
          tags: [["g", "wss://current.example/"]],
          content: "",
        },
      ])

      expect(graspServersStore.set).toHaveBeenLastCalledWith(["wss://current.example"])
    })

    it("falls back to legacy GRASP server URLs when kind 10317 is absent", async () => {
      setupGraspServersSync("pk789", ["wss://relay.com"])

      await storeMocks.emitTokenEvents([
        {
          id: "1".repeat(64),
          kind: GRASP_SET_KIND,
          pubkey: "pk789",
          created_at: 10,
          tags: [["d", DEFAULT_GRASP_SET_ID]],
          content: JSON.stringify({urls: ["wss://legacy.example/"]}),
        },
      ])

      expect(graspServersStore.set).toHaveBeenLastCalledWith(["wss://legacy.example"])
    })

    it("keeps an empty kind 10317 list authoritative", async () => {
      setupGraspServersSync("pk789", ["wss://relay.com"])

      await storeMocks.emitTokenEvents([
        {
          id: "1".repeat(64),
          kind: GRASP_SET_KIND,
          pubkey: "pk789",
          created_at: 10,
          tags: [["d", DEFAULT_GRASP_SET_ID]],
          content: JSON.stringify({urls: ["wss://legacy.example/"]}),
        },
        {
          id: "2".repeat(64),
          kind: GIT_USER_GRASP_LIST,
          pubkey: "pk789",
          created_at: 11,
          tags: [],
          content: "",
        },
      ])

      expect(graspServersStore.set).toHaveBeenLastCalledWith([])
    })

    it("uses recommendation fallback URLs only when no user or legacy list exists", async () => {
      setupGraspServersSync("pk789", ["wss://relay.com"])

      graspMocks.emitFallbackUrls(["wss://fallback.example"])
      expect(graspServersStore.set).toHaveBeenLastCalledWith(["wss://fallback.example"])

      await storeMocks.emitTokenEvents([
        {
          id: "2".repeat(64),
          kind: GIT_USER_GRASP_LIST,
          pubkey: "pk789",
          created_at: 11,
          tags: [],
          content: "",
        },
      ])
      graspMocks.emitFallbackUrls(["wss://ignored.example"])

      expect(graspServersStore.set).toHaveBeenLastCalledWith([])
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
