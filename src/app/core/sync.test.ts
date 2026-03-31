import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  const createStore = <T>(initial: T) => {
    let value = initial
    const subscribers = new Set<(value: T) => void>()

    return {
      set(next: T) {
        value = next
        subscribers.forEach(fn => fn(value))
      },
      get() {
        return value
      },
      subscribe(fn: (value: T) => void) {
        subscribers.add(fn)
        fn(value)

        return () => {
          subscribers.delete(fn)
        }
      },
    }
  }

  return {
    page: createStore({params: {} as Record<string, string>}),
    pubkey: createStore<string | undefined>(undefined),
    userRelayList: createStore<any>(null),
    userFollowList: createStore<any>(null),
    userMessagingRelayList: createStore<any>(null),
    userSpaceUrls: createStore<Set<string>>(new Set()),
    userGroupList: createStore<any>(null),
    bootstrapPubkeys: createStore<string[]>([]),
    request: vi.fn().mockResolvedValue([]),
    load: vi.fn().mockResolvedValue([]),
    pull: vi.fn().mockResolvedValue([]),
    loadRelay: vi.fn(),
    loadProfile: vi.fn().mockResolvedValue(undefined),
    loadUserRelayList: vi.fn().mockResolvedValue(undefined),
    loadUserBlossomServerList: vi.fn().mockResolvedValue(undefined),
    loadUserFollowList: vi.fn().mockResolvedValue(undefined),
    loadUserMuteList: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(undefined),
    loadGroupList: vi.fn().mockResolvedValue(undefined),
    loadAlerts: vi.fn().mockResolvedValue(undefined),
    loadAlertStatuses: vi.fn().mockResolvedValue(undefined),
    hasNegentropy: vi.fn((url: string) => url.includes("smart")),
    repositoryQuery: vi.fn(() => []),
    trackerGetRelays: vi.fn(() => new Set<string>()),
  }
})

vi.mock("$app/stores", () => ({
  page: mocks.page,
}))

vi.mock("@welshman/lib", () => ({
  partition: <T>(predicate: (value: T) => boolean, items: T[]) => [
    items.filter(predicate),
    items.filter(item => !predicate(item)),
  ],
  call: (fn: () => void) => fn(),
  sortBy: <T>(selector: (value: T) => number, items: T[]) =>
    [...items].sort((a, b) => selector(a) - selector(b)),
  assoc: (key: string, value: unknown) => (obj: Record<string, unknown>) => ({
    ...obj,
    [key]: value,
  }),
  chunk: <T>(size: number, items: T[]) => {
    const result: T[][] = []
    for (let index = 0; index < items.length; index += size) {
      result.push(items.slice(index, index + size))
    }
    return result
  },
  sleep: vi.fn().mockResolvedValue(undefined),
  identity: <T>(value: T) => value,
  WEEK: 60 * 60 * 24 * 7,
  ago: (windowSeconds: number, multiplier = 1) =>
    Math.floor(Date.now() / 1000) - windowSeconds * multiplier,
}))

vi.mock("@welshman/util", () => ({
  getListTags: (event: any) => event?.tags || [],
  getRelayTagValues: (tags: string[][]) =>
    tags.flatMap(tag => (tag[0] === "r" && typeof tag[1] === "string" ? [tag[1]] : [])),
  RELAY_ADD_MEMBER: 1001,
  RELAY_REMOVE_MEMBER: 1002,
  RELAY_MEMBERS: 1003,
  ROOM_ADMINS: 1004,
  ROOM_MEMBERS: 1005,
  ROOM_CREATE_PERMISSION: 1006,
  ROOM_ADD_MEMBER: 1007,
  ROOM_REMOVE_MEMBER: 1008,
  isSignedEvent: (event: any) => Boolean(event),
  unionFilters: (filters: any[]) => filters,
}))

vi.mock("@welshman/net", () => ({
  request: mocks.request,
  load: mocks.load,
  pull: mocks.pull,
}))

vi.mock("@welshman/app", () => ({
  pubkey: mocks.pubkey,
  loadRelay: mocks.loadRelay,
  loadProfile: mocks.loadProfile,
  tracker: {
    getRelays: mocks.trackerGetRelays,
  },
  repository: {
    query: mocks.repositoryQuery,
  },
  hasNegentropy: mocks.hasNegentropy,
  userRelayList: mocks.userRelayList,
  userFollowList: mocks.userFollowList,
  userMessagingRelayList: mocks.userMessagingRelayList,
  loadUserRelayList: mocks.loadUserRelayList,
  loadUserBlossomServerList: mocks.loadUserBlossomServerList,
  loadUserFollowList: mocks.loadUserFollowList,
  loadUserMuteList: mocks.loadUserMuteList,
}))

vi.mock("@app/core/state", () => ({
  REACTION_KINDS: [7],
  MESSAGE_KINDS: [9],
  CONTENT_KINDS: [1],
  INDEXER_RELAYS: ["wss://indexer.one", "wss://indexer.two"],
  isPlatformRelay: (url: string) => url.includes("platform"),
  loadSettings: mocks.loadSettings,
  loadGroupList: mocks.loadGroupList,
  userSpaceUrls: mocks.userSpaceUrls,
  userGroupList: mocks.userGroupList,
  bootstrapPubkeys: mocks.bootstrapPubkeys,
  decodeRelay: (relay: string) => `decoded:${relay}`,
  getSpaceUrlsFromGroupList: (groupList: any) => groupList?.spaceUrls || [],
  getSpaceRoomsFromGroupList: (url: string, groupList: any) => groupList?.roomsByUrl?.[url] || [],
  makeCommentFilter: () => ({kinds: [1111]}),
}))

vi.mock("@app/core/requests", () => ({
  loadAlerts: mocks.loadAlerts,
  loadAlertStatuses: mocks.loadAlertStatuses,
}))

vi.mock("@lib/budabit/dm", () => ({
  DM_KIND: 4,
}))

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.page.set({params: {}})
  mocks.pubkey.set(undefined)
  mocks.userRelayList.set(null)
  mocks.userFollowList.set(null)
  mocks.userMessagingRelayList.set(null)
  mocks.userSpaceUrls.set(new Set())
  mocks.userGroupList.set(null)
  mocks.bootstrapPubkeys.set([])
})

describe("syncApplicationData", () => {
  it("loads indexer relays and the relay from the current page context", async () => {
    mocks.page.set({params: {relay: "ws%3A%2F%2Fspace.example.com"}})

    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()

    expect(mocks.loadRelay).toHaveBeenCalledWith("wss://indexer.one")
    expect(mocks.loadRelay).toHaveBeenCalledWith("wss://indexer.two")
    expect(mocks.loadRelay).toHaveBeenCalledWith("decoded:ws%3A%2F%2Fspace.example.com")

    mocks.page.set({params: {relay: "next-relay"}})
    expect(mocks.loadRelay).toHaveBeenCalledWith("decoded:next-relay")

    cleanup()
  })

  it("uses pull for smart DM relays, load fallback for dumb relays, and aborts removed subscriptions", async () => {
    mocks.pubkey.set("a".repeat(64))
    mocks.userMessagingRelayList.set({
      tags: [
        ["r", "wss://smart-relay.example.com"],
        ["r", "wss://dumb-relay.example.com"],
      ],
    })

    const requestSignals: Array<{relay: string; signal: AbortSignal}> = []
    const loadSignals: Array<{relay: string; signal: AbortSignal}> = []
    const pullSignals: Array<{relay: string; signal: AbortSignal}> = []

    mocks.request.mockImplementation(async ({relays, signal}: any) => {
      requestSignals.push({relay: relays[0], signal})
      return []
    })
    mocks.load.mockImplementation(async ({relays, signal}: any) => {
      loadSignals.push({relay: relays[0], signal})
      return []
    })
    mocks.pull.mockImplementation(async ({relays, signal}: any) => {
      pullSignals.push({relay: relays[0], signal})
      return []
    })

    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()
    await flush()

    expect(mocks.loadUserRelayList).toHaveBeenCalledWith("a".repeat(64))
    expect(pullSignals.map(entry => entry.relay)).toContain("wss://smart-relay.example.com")
    expect(loadSignals.map(entry => entry.relay)).toContain("wss://dumb-relay.example.com")
    expect(requestSignals.map(entry => entry.relay)).toEqual(
      expect.arrayContaining(["wss://smart-relay.example.com", "wss://dumb-relay.example.com"]),
    )

    const dumbRelayRequest = requestSignals.find(
      entry => entry.relay === "wss://dumb-relay.example.com",
    )
    expect(dumbRelayRequest?.signal.aborted).toBe(false)

    mocks.userMessagingRelayList.set({tags: [["r", "wss://smart-relay.example.com"]]})
    await flush()

    expect(dumbRelayRequest?.signal.aborted).toBe(true)

    cleanup()

    const smartRelayRequest = requestSignals.find(
      entry => entry.relay === "wss://smart-relay.example.com",
    )
    expect(smartRelayRequest?.signal.aborted).toBe(true)
  })

  it("refreshes alert, profile, and settings resources when a user relay list appears", async () => {
    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()

    mocks.userRelayList.set({event: {pubkey: "b".repeat(64)}})
    await flush()

    expect(mocks.loadAlerts).toHaveBeenCalledWith("b".repeat(64))
    expect(mocks.loadAlertStatuses).toHaveBeenCalledWith("b".repeat(64))
    expect(mocks.loadUserBlossomServerList).toHaveBeenCalledWith("b".repeat(64))
    expect(mocks.loadUserFollowList).toHaveBeenCalledWith("b".repeat(64))
    expect(mocks.loadGroupList).toHaveBeenCalledWith("b".repeat(64))
    expect(mocks.loadUserMuteList).toHaveBeenCalledWith("b".repeat(64))
    expect(mocks.loadProfile).toHaveBeenCalledWith("b".repeat(64))
    expect(mocks.loadSettings).toHaveBeenCalledWith("b".repeat(64))

    cleanup()
  })

  it("starts and stops group membership subscriptions as room membership changes", async () => {
    mocks.pubkey.set("c".repeat(64))

    const requestSignals: Array<{relay: string; signal: AbortSignal}> = []
    mocks.request.mockImplementation(async ({relays, signal}: any) => {
      requestSignals.push({relay: relays[0], signal})
      return []
    })

    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()

    mocks.userGroupList.set({
      spaceUrls: ["wss://space.one"],
      roomsByUrl: {"wss://space.one": ["room-1"]},
    })
    await flush()

    const spaceRequests = requestSignals.filter(entry => entry.relay === "wss://space.one")
    expect(spaceRequests).toHaveLength(2)
    expect(spaceRequests.every(entry => entry.signal.aborted === false)).toBe(true)

    mocks.userGroupList.set({spaceUrls: [], roomsByUrl: {}})
    await flush()

    expect(spaceRequests.every(entry => entry.signal.aborted)).toBe(true)

    cleanup()
  })
})
