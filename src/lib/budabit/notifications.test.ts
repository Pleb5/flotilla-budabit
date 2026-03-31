import {beforeEach, describe, expect, it, vi} from "vitest"
import {readable, writable} from "svelte/store"

const mockSetNotificationsConfig = vi.fn()
const mockSetNotificationCandidates = vi.fn()
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

vi.mock("@app/util/notifications", () => ({
  setNotificationCandidates: (store: any) => mockSetNotificationCandidates(store),
  setNotificationsConfig: (config: any) => mockSetNotificationsConfig(config),
}))

vi.mock("@app/util/routes", () => ({
  makeSpacePath: (url: string, ...parts: string[]) => `/spaces/${url}/${parts.join("/")}`,
}))

vi.mock("@app/core/state", () => ({
  PLATFORM_RELAYS: ["wss://relay.example.com"],
  getSpaceUrlsFromGroupList: () => ["wss://relay.example.com"],
}))

vi.mock("@welshman/app", () => ({
  pubkey: mockPubkey,
  repository: {query: vi.fn(() => []), getEvent: vi.fn(), publish: vi.fn()},
}))

vi.mock("@welshman/store", () => ({
  deriveEventsAsc: (store: any) => store,
  deriveEventsById: () => readable([]),
}))

vi.mock("@welshman/net", () => ({
  load: mockLoad,
  request: mockRequest,
}))

vi.mock("@welshman/lib", () => ({
  now: () => Math.floor(Date.now() / 1000),
}))

vi.mock("@welshman/util", () => ({
  Address: {
    fromEvent: (event: any) => ({
      toString: () => event.__address || "30617:pubkey:repo",
      toNaddr: () => "naddr1abc",
    }),
    fromNaddr: () => ({toString: () => "30617:pubkey:repo"}),
  },
  getTagValue: () => "",
  isRelayUrl: () => true,
  normalizeRelayUrl: (u: string) => u,
}))

vi.mock("@nostr-git/core/events", () => ({
  GIT_COMMENT: 1311,
  GIT_ISSUE: 1311,
  GIT_LABEL: 1311,
  GIT_PATCH: 1311,
  GIT_PULL_REQUEST: 1311,
  GIT_PULL_REQUEST_UPDATE: 1311,
  GIT_STATUS_APPLIED: 1311,
  GIT_STATUS_CLOSED: 1311,
  GIT_STATUS_DRAFT: 1311,
  GIT_STATUS_OPEN: 1311,
  parseRepoAnnouncementEvent: (event: any) => event.__parsed || {relays: []},
  parseRoleLabelEvent: () => ({namespace: "", rootId: "", repoAddr: "", role: ""}),
}))

vi.mock("@nostr-git/core/git", () => ({
  RepoCore: {
    buildRepoSubscriptions: ({addressA}: {addressA: string}) => ({filters: [{"#a": [addressA]}]}),
  },
}))

vi.mock("@lib/budabit/routes", () => ({
  makeGitPath: (relay: string, naddr: string) => `/spaces/${relay}/git/${naddr}`,
}))

vi.mock("@lib/budabit/state", () => ({
  GIT_RELAYS: ["wss://git.relay.example.com"],
  loadRepoContext: mockLoadRepoContext,
  repoAnnouncements: mockRepoAnnouncements,
  repoAnnouncementsByAddress: mockRepoAnnouncementsByAddress,
  effectiveRepoAddressesByRepoAddress: mockEffectiveRepoAddresses,
  loadRepoAnnouncementByAddress: mockLoadRepoAnnouncementByAddress,
  loadRepoMaintainerAnnouncements: mockLoadRepoMaintainerAnnouncements,
  getEffectiveRepoAddresses: (map: Map<string, Set<string>>, repoAddress: string) =>
    map.get(repoAddress) || new Set([repoAddress]),
}))

vi.mock("@lib/budabit/repo-watch", () => ({
  defaultRepoWatchOptions: {
    status: {open: true, draft: true, applied: true, closed: true},
    issues: {new: true, comments: true},
    patches: {new: true, comments: true, updates: true},
    assignments: true,
    reviews: true,
  },
  userRepoWatchValues: mockUserRepoWatchValues,
}))

vi.mock("@nostr-git/ui", () => ({
  bookmarksStore: readable([]),
}))

describe("notifications", () => {
  beforeEach(() => {
    mockSetNotificationsConfig.mockClear()
    mockSetNotificationCandidates.mockClear()
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
    cleanup()
  })

  it("cleanup function can be called without throwing", async () => {
    const {setupBudabitNotifications} = await import("./notifications")
    const cleanup = setupBudabitNotifications()

    expect(() => cleanup()).not.toThrow()
  })

  it("setupBudabitNotifications calls setNotificationsConfig", async () => {
    mockSetNotificationsConfig.mockClear()

    const {setupBudabitNotifications} = await import("./notifications")
    setupBudabitNotifications()

    expect(mockSetNotificationsConfig).toHaveBeenCalled()
    expect(mockSetNotificationsConfig.mock.calls[0][0]).toMatchObject({
      getSpaceUrls: expect.any(Function),
      augmentPaths: expect.any(Function),
    })
  })

  it("setupBudabitNotifications calls setNotificationCandidates", async () => {
    mockSetNotificationCandidates.mockClear()

    const {setupBudabitNotifications} = await import("./notifications")
    setupBudabitNotifications()

    expect(mockSetNotificationCandidates).toHaveBeenCalled()
  })

  it("augments repo issue and patch paths to the git root", async () => {
    mockSetNotificationsConfig.mockClear()

    const {setupBudabitNotifications} = await import("./notifications")
    setupBudabitNotifications()

    const augmentPaths = mockSetNotificationsConfig.mock.calls.at(-1)?.[0]?.augmentPaths
    const paths = new Set([
      "/spaces/relay/git/naddr1abc/issues",
      "/spaces/relay/git/naddr1abc/patches",
    ])

    const augmented = augmentPaths(paths)

    expect(augmented).toBe(paths)
    expect(paths.has("/spaces/relay/git")).toBe(true)
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
          patches: {new: true, comments: true, updates: true},
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
