import {describe, expect, it, vi} from "vitest"
import {readable} from "svelte/store"

const mockSetNotificationsConfig = vi.fn()
const mockSetNotificationCandidates = vi.fn()

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
  pubkey: readable(null),
  repository: {query: vi.fn(() => []), getEvent: vi.fn(), publish: vi.fn()},
}))

vi.mock("@welshman/store", () => ({
  deriveEventsAsc: (store: any) => store,
  deriveEventsById: () => readable([]),
}))

vi.mock("@welshman/net", () => ({
  load: vi.fn().mockResolvedValue(undefined),
  request: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@welshman/lib", () => ({
  now: () => Math.floor(Date.now() / 1000),
}))

vi.mock("@welshman/util", () => ({
  Address: {
    fromEvent: () => ({toString: () => "30617:pubkey:repo", toNaddr: () => "naddr1abc"}),
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
  parseRepoAnnouncementEvent: () => ({relays: []}),
  parseRoleLabelEvent: () => ({namespace: "", rootId: "", repoAddr: "", role: ""}),
}))

vi.mock("@nostr-git/core/git", () => ({
  RepoCore: {
    buildRepoSubscriptions: () => ({filters: []}),
  },
}))

vi.mock("@lib/budabit/routes", () => ({
  makeGitPath: (relay: string, naddr: string) => `/spaces/${relay}/git/${naddr}`,
}))

vi.mock("@lib/budabit/state", () => ({
  GIT_RELAYS: ["wss://git.relay.example.com"],
  loadRepoContext: vi.fn(),
  repoAnnouncements: readable([]),
  repoAnnouncementsByAddress: readable(new Map()),
  effectiveRepoAddressesByRepoAddress: readable(new Map()),
  loadRepoAnnouncementByAddress: vi.fn(),
  loadRepoMaintainerAnnouncements: vi.fn(),
}))

vi.mock("@lib/budabit/repo-watch", () => ({
  defaultRepoWatchOptions: {
    status: {open: true, draft: true, applied: true, closed: true},
    issues: {new: true, comments: true},
    patches: {new: true, comments: true, updates: true},
    assignments: true,
    reviews: true,
  },
  userRepoWatchValues: readable({repos: {}}),
}))

vi.mock("@nostr-git/ui", () => ({
  bookmarksStore: readable([]),
}))

describe("notifications", () => {
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
})
