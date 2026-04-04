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
    loadUserRelayList: vi.fn().mockResolvedValue(undefined),
    forceLoadUserMessagingRelayList: vi.fn().mockResolvedValue(undefined),
    loadUserBlossomServerList: vi.fn().mockResolvedValue(undefined),
    loadUserFollowList: vi.fn().mockResolvedValue(undefined),
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
    setupBookmarksSync: vi.fn(() => () => {}),
    setupGraspServersSync: vi.fn(() => () => {}),
    setupTokensSync: vi.fn(() => () => {}),
    setupExtensionSettingsSync: vi.fn(() => () => {}),
    applyRemoteExtensionSettings: vi.fn(),
    startExtensionSettingsAutoSync: vi.fn(() => () => {}),
    loadNip85ProviderConfig: vi.fn(),
    loadRepoWatch: vi.fn(),
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
  loadUserRelayList: mocks.loadUserRelayList,
  forceLoadUserMessagingRelayList: mocks.forceLoadUserMessagingRelayList,
  loadUserBlossomServerList: mocks.loadUserBlossomServerList,
  loadUserFollowList: mocks.loadUserFollowList,
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
  REACTION_KINDS: [7],
  MESSAGE_KINDS: [9],
  CONTENT_KINDS: [1],
  INDEXER_RELAYS: [],
  PLATFORM_RELAYS: [],
  isPlatformRelay: () => false,
  loadSettings: mocks.loadSettings,
  bootstrapPubkeys: mocks.bootstrapPubkeys,
  makeCommentFilter: () => ({kinds: [1111]}),
}))

vi.mock("@app/core/requests", () => ({
  loadAlerts: mocks.loadAlerts,
  loadAlertStatuses: mocks.loadAlertStatuses,
}))

vi.mock("@lib/budabit/dm", () => ({
  DM_KIND: 4444,
  getMessagingRelayHints: () => ["wss://hint.relay.example.com/"],
}))

vi.mock("./state", () => ({
  GIT_RELAYS: [],
}))

vi.mock("./requests", () => ({
  loadGraspServers: mocks.loadGraspServers,
  loadRepositories: mocks.loadRepositories,
  loadTokens: mocks.loadTokens,
  loadExtensionSettings: mocks.loadExtensionSettings,
  setupBookmarksSync: mocks.setupBookmarksSync,
  setupGraspServersSync: mocks.setupGraspServersSync,
  setupTokensSync: mocks.setupTokensSync,
  setupExtensionSettingsSync: mocks.setupExtensionSettingsSync,
}))

vi.mock("@app/extensions/settings", () => ({
  applyRemoteExtensionSettings: mocks.applyRemoteExtensionSettings,
  startExtensionSettingsAutoSync: mocks.startExtensionSettingsAutoSync,
}))

vi.mock("./nip85", () => ({
  loadNip85ProviderConfig: mocks.loadNip85ProviderConfig,
}))

vi.mock("./repo-watch", () => ({
  loadRepoWatch: mocks.loadRepoWatch,
}))

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe("budabit sync", () => {
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

  it("reloads DMs without history limits after entering /chat", async () => {
    mocks.pubkey.set("a".repeat(64))
    mocks.userMessagingRelayList.set({tags: [["r", "wss://dm.relay.example.com"]]})

    const {syncBudabitApplicationData} = await import("./sync")
    const cleanup = syncBudabitApplicationData()
    await flush()

    const recentCall = mocks.dmLoad.mock.calls.at(-1)?.[0]

    expect(recentCall?.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({limit: 100}),
        expect.objectContaining({limit: 100}),
      ]),
    )
    expect(recentCall?.filters.every((filter: any) => typeof filter.since === "number")).toBe(true)

    mocks.dmLoad.mockClear()

    mocks.page.set({url: {pathname: "/chat"}, params: {}})
    await flush()

    const fullHistoryCall = mocks.dmLoad.mock.calls.at(-1)?.[0]

    expect(mocks.forceLoadUserMessagingRelayList).toHaveBeenCalledTimes(2)
    expect(fullHistoryCall?.filters.every((filter: any) => filter.limit === undefined)).toBe(true)
    expect(fullHistoryCall?.filters.every((filter: any) => filter.since === undefined)).toBe(true)

    cleanup()
  })
})
