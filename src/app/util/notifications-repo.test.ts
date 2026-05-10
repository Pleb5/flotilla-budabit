import {beforeEach, describe, expect, it, vi} from "vitest"
import {get, readable, writable} from "svelte/store"

const mockLoad = vi.fn().mockResolvedValue(undefined)
const mockRequest = vi.fn().mockResolvedValue(undefined)
const mockLoadRepoContext = vi.fn()
const mockLoadRepoAnnouncementByAddress = vi.fn()
const mockLoadRepoMaintainerAnnouncements = vi.fn()
const mockPubkey = writable<string | null>(null)
const mockRepoAnnouncements = writable<any[]>([])
const mockRepoAnnouncementsByAddress = writable(new Map())
const mockEffectiveRepoAddresses = writable(new Map())
const mockUserRepoWatchValues = writable({repos: {}})

const mockAddress = vi.hoisted(
  () =>
    class MockAddress {
      constructor(
        private kind: number,
        private author: string,
        private identifier: string,
        private relays: string[] = [],
      ) {}

      toNaddr() {
        return this.relays.length > 0 ? "naddr1hinted" : "naddr1abc"
      }

      toString() {
        return `${this.kind}:${this.author}:${this.identifier}`
      }

      static fromEvent(event: any) {
        return {
          toString: () => event.__address || "30617:pubkey:repo",
          toNaddr: () => "naddr1abc",
        }
      }

      static fromNaddr() {
        return {toString: () => "30617:pubkey:repo"}
      }
    },
)

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
}))

vi.mock("@app/util/routes", () => ({
  makeSpacePath: (url: string, ...parts: string[]) =>
    `/spaces/${url}/${parts.filter(Boolean).join("/")}`,
  makeChatPath: (id: string) => `/chat/${id}`,
  makeGoalPath: (url: string, id?: string) => `/spaces/${url}/goals${id ? `/${id}` : ""}`,
  makeThreadPath: (url: string, id?: string) => `/spaces/${url}/threads${id ? `/${id}` : ""}`,
  makeCalendarPath: (url: string, id?: string) => `/spaces/${url}/calendar${id ? `/${id}` : ""}`,
  makeSpaceChatPath: (url: string) => `/spaces/${url}/chat`,
  makeRoomPath: (url: string, h: string) => `/spaces/${url}/${h}`,
  makeGitPath: (relay: string, naddr: string) => `/spaces/${relay}/git/${naddr}`,
}))

vi.mock("@app/core/state", () => ({
  PLATFORM_RELAYS: ["wss://relay.example.com"],
  getSpaceUrlsFromGroupList: () => ["wss://relay.example.com"],
  chatsById: writable(new Map()),
  hasNip29: () => false,
  userSettingsValues: writable({show_notifications_badge: false}),
  userGroupList: writable({}),
  getSpaceRoomsFromGroupList: () => [],
  encodeRelay: (url: string) => encodeURIComponent(url),
  roomsById: writable(new Map()),
  channelsById: writable(new Map()),
}))

vi.mock("@app/util/room-archive", () => ({isArchivedRoomReference: () => false}))

vi.mock("@welshman/app", () => ({
  pubkey: mockPubkey,
  tracker: {},
  relaysByUrl: writable(new Map()),
  repository: {query: vi.fn(() => []), getEvent: vi.fn(), publish: vi.fn()},
}))

vi.mock("@welshman/store", () => ({
  synced: ({defaultValue}: {defaultValue: unknown}) => writable(defaultValue),
  throttled: (_delay: number, store: unknown) => store,
  deriveEventsByIdByUrl: () => readable(new Map()),
  deriveEventsAsc: (store: any) => store,
  deriveEventsById: () => readable([]),
}))

vi.mock("@welshman/net", () => ({
  load: mockLoad,
  request: mockRequest,
}))

vi.mock("@welshman/lib", () => ({
  prop: (key: string) => (value: Record<string, unknown>) => value?.[key],
  find: (predicate: (value: unknown) => boolean, values: Iterable<unknown>) =>
    Array.from(values).find(predicate),
  call: (fn: () => unknown) => fn(),
  spec: (pattern: any) => (value: any) => {
    if (Array.isArray(pattern)) {
      return pattern.every((part, index) => value?.[index] === part)
    }
    return Object.entries(pattern).every(([key, expected]) => value?.[key] === expected)
  },
  first: (values: Iterable<unknown>) => Array.from(values)[0],
  identity: (value: unknown) => value,
  now: () => Math.floor(Date.now() / 1000),
  groupBy: (getKey: (value: unknown) => string | undefined, values: Iterable<unknown>) => {
    const grouped = new Map<string | undefined, unknown[]>()
    for (const value of values) {
      const key = getKey(value)
      grouped.set(key, [...(grouped.get(key) || []), value])
    }
    return grouped
  },
}))

vi.mock("@welshman/util", () => ({
  Address: mockAddress,
  ZAP_GOAL: 9041,
  EVENT_TIME: 31922,
  MESSAGE: 9,
  THREAD: 11,
  COMMENT: 1111,
  getTagValue: () => "",
  isRelayUrl: () => true,
  normalizeRelayUrl: (url: string) => url,
}))

vi.mock("@welshman/router", () => ({
  Router: {get: () => ({FromUser: () => ({getUrls: () => []})})},
}))

vi.mock("@nostr-git/core/events", () => ({
  GIT_COMMENT: 1311,
  GIT_ISSUE: 1312,
  GIT_LABEL: 1313,
  GIT_PULL_REQUEST: 1314,
  GIT_PULL_REQUEST_UPDATE: 1315,
  GIT_STATUS_APPLIED: 1316,
  GIT_STATUS_CLOSED: 1317,
  GIT_STATUS_DRAFT: 1318,
  GIT_STATUS_OPEN: 1319,
  parseRepoAnnouncementEvent: (event: any) => event.__parsed || {relays: []},
  parseRoleLabelEvent: () => ({namespace: "", rootId: "", repoAddr: "", role: ""}),
}))

vi.mock("@nostr-git/core/git", () => ({
  RepoCore: {
    buildRepoSubscriptions: ({addressA}: {addressA: string}) => ({filters: [{"#a": [addressA]}]}),
  },
}))

vi.mock("@nostr-git/core/utils", () => ({
  buildRepoNaddrFromEvent: () => "naddr1abc",
}))

vi.mock("@app/core/git-state", () => ({
  GIT_RELAYS: ["wss://git.relay.example.com"],
  loadRepoContext: mockLoadRepoContext,
  repoAnnouncements: mockRepoAnnouncements,
  repoAnnouncementsByAddress: mockRepoAnnouncementsByAddress,
  maintainerSetRepoAddressesByRepoAddress: mockEffectiveRepoAddresses,
  loadRepoAnnouncementByAddress: mockLoadRepoAnnouncementByAddress,
  loadRepoMaintainerAnnouncements: mockLoadRepoMaintainerAnnouncements,
  getMaintainerSetRepoAddresses: (map: Map<string, Set<string>>, repoAddress: string) =>
    map.get(repoAddress) || new Set([repoAddress]),
}))

vi.mock("@app/core/repo-watch", () => ({
  defaultRepoWatchOptions: {
    status: {open: true, draft: true, applied: true, closed: true},
    issues: {new: true, comments: true},
    prs: {new: true, comments: true, updates: true},
    assignments: true,
    reviews: true,
  },
  userRepoWatchValues: mockUserRepoWatchValues,
}))

describe("repo notifications", () => {
  beforeEach(() => {
    vi.resetModules()
    mockLoad.mockClear()
    mockRequest.mockClear()
    mockLoadRepoContext.mockClear()
    mockLoadRepoAnnouncementByAddress.mockClear()
    mockLoadRepoMaintainerAnnouncements.mockClear()
    mockPubkey.set(null)
    mockRepoAnnouncements.set([])
    mockRepoAnnouncementsByAddress.set(new Map())
    mockEffectiveRepoAddresses.set(new Map())
    mockUserRepoWatchValues.set({repos: {}})
  })

  it("setupBudabitNotifications returns a cleanup function", async () => {
    const {setupBudabitNotifications} = await import("./notifications")
    const cleanup = setupBudabitNotifications()

    expect(typeof cleanup).toBe("function")
    expect(() => cleanup()).not.toThrow()
  })

  it("configures repo notification paths", async () => {
    const {notificationsConfig, setupBudabitNotifications} = await import("./notifications")
    const cleanup = setupBudabitNotifications()

    const config = get(notificationsConfig)
    expect(config).toMatchObject({
      getSpaceUrls: expect.any(Function),
      augmentPaths: expect.any(Function),
    })
    expect(config.getSpaceUrls?.({} as any)).toEqual(["wss://relay.example.com"])

    cleanup()
  })

  it("augments repo issue and PR paths to the git root", async () => {
    const {notificationsConfig, setupBudabitNotifications} = await import("./notifications")
    const cleanup = setupBudabitNotifications()
    const augmentPaths = get(notificationsConfig).augmentPaths
    const paths = new Set(["/spaces/relay/git/naddr1abc/issues", "/spaces/relay/git/naddr1abc/prs"])

    const augmented = augmentPaths?.(paths)

    expect(augmented).toBe(paths)
    expect(paths.has("/spaces/relay/git")).toBe(true)
    cleanup()
  })

  it("uses watched repo relays only for repo-bound subscriptions", async () => {
    const repoAddr = "30617:pubkey:repo"
    const repoEvent = {
      id: "repo-event",
      pubkey: "pubkey",
      __address: repoAddr,
      __parsed: {relays: ["wss://repo.relay.example.com"]},
    }

    mockPubkey.set("viewer")
    mockRepoAnnouncements.set([repoEvent])
    mockRepoAnnouncementsByAddress.set(new Map([[repoAddr, repoEvent]]))
    mockEffectiveRepoAddresses.set(new Map([[repoAddr, new Set([repoAddr])]]))
    mockUserRepoWatchValues.set({
      repos: {
        [repoAddr]: {
          issues: {new: true, comments: true},
          prs: {new: true, comments: true, updates: true},
          status: {open: true, draft: true, applied: true, closed: true},
          assignments: true,
          reviews: true,
        },
      },
    })

    const {setupBudabitNotifications} = await import("./notifications")
    const cleanup = setupBudabitNotifications()

    expect(mockLoadRepoContext).toHaveBeenCalledWith({
      addressA: repoAddr,
      relays: ["wss://repo.relay.example.com"],
    })
    expect(mockRequest).toHaveBeenCalled()
    expect(
      mockRequest.mock.calls.every(
        ([args]) =>
          Array.isArray(args.relays) &&
          args.relays.includes("wss://repo.relay.example.com") &&
          !args.relays.includes("wss://git.relay.example.com"),
      ),
    ).toBe(true)

    cleanup()
  })
})
