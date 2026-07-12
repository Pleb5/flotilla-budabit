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

  const dmLoad = vi.fn().mockResolvedValue([])

  return {
    page: createStore({url: {pathname: "/home"}, params: {} as Record<string, string>}),
    pubkey: createStore<string | undefined>(undefined),
    userRelayList: createStore<any>(null),
    userFollowList: createStore<any>(null),
    userMessagingRelayList: createStore<any>(null),
    bootstrapPubkeys: createStore<string[]>([]),
    request: vi.fn().mockResolvedValue([]),
    load: vi.fn().mockResolvedValue([]),
    pull: vi.fn().mockResolvedValue([]),
    dmLoad,
    makeLoader: vi.fn(() => dmLoad),
    loadRelay: vi.fn(),
    loadProfile: vi.fn().mockResolvedValue(undefined),
    loadRelayList: vi.fn().mockResolvedValue(undefined),
    loadUserRelayList: vi.fn().mockResolvedValue(undefined),
    forceLoadUserMessagingRelayList: vi.fn().mockResolvedValue(undefined),
    loadUserBlossomServerList: vi.fn().mockResolvedValue(undefined),
    loadFollowList: vi.fn().mockResolvedValue(undefined),
    loadUserFollowList: vi.fn().mockResolvedValue(undefined),
    loadMuteList: vi.fn().mockResolvedValue(undefined),
    loadUserMuteList: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(undefined),
    loadAlerts: vi.fn().mockResolvedValue(undefined),
    loadAlertStatuses: vi.fn().mockResolvedValue(undefined),
    hasNegentropy: vi.fn(() => false),
    repositoryQuery: vi.fn(() => []),
    trackerGetRelays: vi.fn(() => new Set<string>()),
    loadGraspServers: vi.fn(),
    loadRepositories: vi.fn(),
    loadTokens: vi.fn(),
    loadExtensionSettings: vi.fn(),
    setupGraspServersSync: vi.fn(() => () => {}),
    setupTokensSync: vi.fn(() => () => {}),
    clearSyncedGitAuthTokens: vi.fn(),
    setupExtensionSettingsSync: vi.fn(() => () => {}),
    applyRemoteExtensionSettings: vi.fn(),
    loadNip85ProviderConfig: vi.fn(),
    loadRepoWatch: vi.fn(),
    loadTrustGraphConfig: vi.fn(),
    startGraspServerRecommendationsSync: vi.fn(() => () => {}),
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
  getListTags: (list: any) => [
    ...(list?.tags || []),
    ...(list?.publicTags || []),
    ...(list?.privateTags || []),
  ],
  getRelayTagValues: (tags: string[][]) =>
    tags.flatMap(tag =>
      ["r", "relay"].includes(tag[0]) && typeof tag[1] === "string" ? [tag[1]] : [],
    ),
  getTag: (tags: string[][], name: string) => tags.find(tag => tag[0] === name),
  getTagValue: (name: string, tags: string[][]) => tags.find(tag => tag[0] === name)?.[1],
  COMMENT: 1111,
  DELETE: 5,
  EVENT_DATE: 31922,
  EVENT_TIME: 31923,
  MESSAGE: 1111,
  REACTION: 7,
  REPORT: 1984,
  THREAD: 11,
  ZAP_GOAL: 9041,
  isSignedEvent: (event: any) => Boolean(event),
  unionFilters: (filters: any[]) => filters,
  isRelayUrl: (url: string) => url.startsWith("ws://") || url.startsWith("wss://"),
  normalizeRelayUrl: (url: string) => url.replace(/\/+$/, "") + "/",
}))

vi.mock("@welshman/net", () => ({
  request: mocks.request,
  load: mocks.load,
  pull: mocks.pull,
  makeLoader: mocks.makeLoader,
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
  loadRelayList: mocks.loadRelayList,
  loadUserRelayList: mocks.loadUserRelayList,
  forceLoadUserMessagingRelayList: mocks.forceLoadUserMessagingRelayList,
  loadUserBlossomServerList: mocks.loadUserBlossomServerList,
  loadFollowList: mocks.loadFollowList,
  loadUserFollowList: mocks.loadUserFollowList,
  loadMuteList: mocks.loadMuteList,
  loadUserMuteList: mocks.loadUserMuteList,
}))

vi.mock("@welshman/router", () => ({
  Router: {
    get: () => ({
      FromUser: () => ({getUrls: () => []}),
      ForUser: () => ({getUrls: () => []}),
    }),
  },
}))

vi.mock("@app/core/state", () => ({
  INDEXER_RELAYS: [],
  loadSettings: mocks.loadSettings,
  bootstrapPubkeys: mocks.bootstrapPubkeys,
}))

vi.mock("@app/core/profile-resolver", () => ({
  loadBudabitProfile: mocks.loadProfile,
}))

vi.mock("@app/core/requests", () => ({
  loadAlerts: mocks.loadAlerts,
  loadAlertStatuses: mocks.loadAlertStatuses,
}))

vi.mock("@app/core/dm", () => ({
  DM_KIND: 4444,
  getMessagingRelayHints: () => ["wss://hint.relay.example.com/"],
}))

vi.mock("@app/core/git-state", () => ({
  GIT_RELAYS: [],
}))

vi.mock("@app/core/grasp", () => ({
  startGraspServerRecommendationsSync: mocks.startGraspServerRecommendationsSync,
}))

vi.mock("@app/core/git-requests", () => ({
  loadGraspServers: mocks.loadGraspServers,
  loadRepositories: mocks.loadRepositories,
  loadTokens: mocks.loadTokens,
  loadExtensionSettings: mocks.loadExtensionSettings,
  setupGraspServersSync: mocks.setupGraspServersSync,
  setupTokensSync: mocks.setupTokensSync,
  clearSyncedGitAuthTokens: mocks.clearSyncedGitAuthTokens,
  setupExtensionSettingsSync: mocks.setupExtensionSettingsSync,
}))

vi.mock("@app/extensions/settings", () => ({
  applyRemoteExtensionSettings: mocks.applyRemoteExtensionSettings,
}))

vi.mock("@app/core/nip85", () => ({
  loadNip85ProviderConfig: mocks.loadNip85ProviderConfig,
}))

vi.mock("@app/core/repo-watch", () => ({
  loadRepoWatch: mocks.loadRepoWatch,
}))

vi.mock("@app/core/trust-graph-config", () => ({
  loadTrustGraphConfig: mocks.loadTrustGraphConfig,
}))

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe("syncApplicationData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.page.set({url: {pathname: "/home"}, params: {}})
    mocks.pubkey.set(undefined)
    mocks.userRelayList.set(null)
    mocks.userFollowList.set(null)
    mocks.userMessagingRelayList.set(null)
    mocks.bootstrapPubkeys.set([])
    mocks.repositoryQuery.mockReturnValue([])
    mocks.trackerGetRelays.mockReturnValue(new Set<string>())
  })

  it("bootstraps older DMs without adding bootstrap filters to live subscriptions", async () => {
    const userPubkey = "a".repeat(64)

    mocks.pubkey.set(userPubkey)
    mocks.userMessagingRelayList.set({tags: [["r", "wss://dm.relay.example.com"]]})

    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()
    await flush()

    const dmCalls = mocks.dmLoad.mock.calls.map(call => call[0])
    const recentCall = dmCalls.find(call =>
      call.filters.every((filter: any) => filter.limit === 100),
    )
    const bootstrapCall = dmCalls.find(call =>
      call.filters.every((filter: any) => filter.limit === 200),
    )
    const fullHistoryCall = dmCalls.find(call =>
      call.filters.every((filter: any) => filter.limit === undefined && filter.since === undefined),
    )

    expect(recentCall).toBeTruthy()
    expect(recentCall!.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kinds: [4444], "#p": [userPubkey], limit: 100}),
        expect.objectContaining({kinds: [4444], authors: [userPubkey], limit: 100}),
      ]),
    )
    expect(recentCall!.filters.every((filter: any) => typeof filter.since === "number")).toBe(true)

    expect(bootstrapCall).toBeTruthy()
    expect(bootstrapCall!.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kinds: [4444], "#p": [userPubkey], limit: 200}),
        expect.objectContaining({kinds: [4444], authors: [userPubkey], limit: 200}),
      ]),
    )
    expect(bootstrapCall!.filters.every((filter: any) => filter.since === undefined)).toBe(true)
    expect(bootstrapCall!.filters.every((filter: any) => filter.until === undefined)).toBe(true)
    expect(fullHistoryCall).toBeFalsy()

    const liveCall = mocks.request.mock.calls.at(-1)?.[0]

    expect(liveCall?.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kinds: [4444], "#p": [userPubkey], limit: 0}),
        expect.objectContaining({kinds: [4444], authors: [userPubkey], limit: 0}),
      ]),
    )
    expect(liveCall?.filters.every((filter: any) => typeof filter.since === "number")).toBe(true)
    expect(liveCall?.filters.some((filter: any) => filter.limit === 200)).toBe(false)

    mocks.dmLoad.mockClear()

    mocks.page.set({url: {pathname: "/chat"}, params: {}})
    await flush()

    expect(mocks.forceLoadUserMessagingRelayList).toHaveBeenCalledTimes(2)
    expect(mocks.dmLoad).not.toHaveBeenCalled()

    cleanup()
  })

  it("fully backfills DMs when the first messaging relay is configured after startup", async () => {
    const userPubkey = "a".repeat(64)

    mocks.pubkey.set(userPubkey)

    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()
    await flush()

    mocks.dmLoad.mockClear()
    mocks.request.mockClear()

    mocks.userMessagingRelayList.set({
      publicTags: [["relay", "wss://first-dm.relay.example.com"]],
    })
    await flush()

    const dmCalls = mocks.dmLoad.mock.calls.map(call => call[0])
    const fullHistoryCall = dmCalls.find(call =>
      call.filters.every((filter: any) => filter.limit === undefined && filter.since === undefined),
    )
    const bootstrapCall = dmCalls.find(call =>
      call.filters.every((filter: any) => filter.limit === 200),
    )

    expect(fullHistoryCall).toBeTruthy()
    expect(fullHistoryCall!.relays).toEqual(["wss://first-dm.relay.example.com/"])
    expect(fullHistoryCall!.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kinds: [4444], "#p": [userPubkey]}),
        expect.objectContaining({kinds: [4444], authors: [userPubkey]}),
      ]),
    )
    expect(bootstrapCall).toBeTruthy()

    const liveCall = mocks.request.mock.calls.at(-1)?.[0]

    expect(liveCall?.relays).toEqual(["wss://first-dm.relay.example.com/"])
    expect(liveCall?.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kinds: [4444], "#p": [userPubkey], limit: 0}),
        expect.objectContaining({kinds: [4444], authors: [userPubkey], limit: 0}),
      ]),
    )

    cleanup()
  })

  it("keeps legacy NIP-85 provider sync inert by default", async () => {
    mocks.userRelayList.set({event: {pubkey: "b".repeat(64)}})

    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()
    await flush()

    expect(mocks.loadSettings).toHaveBeenCalledWith("b".repeat(64))
    expect(mocks.loadRepoWatch).toHaveBeenCalledWith("b".repeat(64))
    expect(mocks.loadUserBlossomServerList).toHaveBeenCalledWith()
    expect(mocks.loadUserFollowList).toHaveBeenCalledWith()
    expect(mocks.loadUserMuteList).toHaveBeenCalledWith()
    expect(mocks.loadNip85ProviderConfig).not.toHaveBeenCalled()
    expect(mocks.loadTrustGraphConfig).not.toHaveBeenCalled()

    cleanup()
  })

  it("uses pubkey-specific loaders for bootstrap pubkeys", async () => {
    const bootstrapPubkey = "c".repeat(64)
    mocks.bootstrapPubkeys.set([bootstrapPubkey])

    const {syncApplicationData} = await import("./sync")
    const cleanup = syncApplicationData()
    await flush()
    await flush()

    expect(mocks.loadRelayList).toHaveBeenCalledWith(bootstrapPubkey)
    expect(mocks.loadFollowList).toHaveBeenCalledWith(bootstrapPubkey)
    expect(mocks.loadMuteList).toHaveBeenCalledWith(bootstrapPubkey)
    expect(mocks.loadUserRelayList).not.toHaveBeenCalledWith(bootstrapPubkey)
    expect(mocks.loadUserFollowList).not.toHaveBeenCalledWith(bootstrapPubkey)
    expect(mocks.loadUserMuteList).not.toHaveBeenCalledWith(bootstrapPubkey)

    cleanup()
  })
})
