// @vitest-environment jsdom

import {readable} from "svelte/store"
import {describe, expect, it, vi} from "vitest"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/core/state", () => ({
  chatsById: readable(new Map()),
  hasNip29: () => false,
  PLATFORM_RELAYS: [],
  userSettingsValues: readable({show_notifications_badge: false}),
  userGroupList: readable({}),
  getSpaceUrlsFromGroupList: () => [],
  getSpaceRoomsFromGroupList: () => [],
  encodeRelay: vi.fn((url: string) => encodeURIComponent(url)),
  roomsById: readable(new Map()),
}))

vi.mock("@app/util/routes", () => ({
  makeSpacePath: (url: string) => `/spaces/${encodeURIComponent(url)}`,
  makeChatPath: (id: string) => `/chat/${id}`,
  makeGoalPath: (url: string, id?: string) =>
    `/spaces/${encodeURIComponent(url)}/goals${id ? `/${id}` : ""}`,
  makeThreadPath: (url: string, id?: string) =>
    `/spaces/${encodeURIComponent(url)}/threads${id ? `/${id}` : ""}`,
  makeCalendarPath: (url: string, id?: string) =>
    `/spaces/${encodeURIComponent(url)}/calendar${id ? `/${id}` : ""}`,
  makeSpaceChatPath: (url: string) => `/spaces/${encodeURIComponent(url)}/chat`,
  makeRoomPath: (url: string, h: string) => `/spaces/${encodeURIComponent(url)}/${h}`,
  makeGitPath: (url: string, naddr?: string) =>
    `/spaces/${encodeURIComponent(url)}/git${naddr ? `/${naddr}` : ""}`,
}))

vi.mock("@lib/budabit/state", () => ({
  channelsById: readable(new Map()),
  GIT_RELAYS: [],
  repoAnnouncements: readable([]),
  repoAnnouncementsByAddress: readable(new Map()),
  maintainerSetRepoAddressesByRepoAddress: readable(new Map()),
  loadRepoContext: vi.fn(),
  loadRepoAnnouncementByAddress: vi.fn(),
  loadRepoMaintainerAnnouncements: vi.fn(),
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
  userRepoWatchValues: readable({repos: {}}),
}))

vi.mock("@welshman/net", () => ({
  load: vi.fn().mockResolvedValue(undefined),
  request: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@welshman/router", () => ({
  Router: {get: () => ({FromUser: () => ({getUrls: () => []})})},
}))

vi.mock("@nostr-git/core/events", async importOriginal => {
  const actual = await importOriginal<typeof import("@nostr-git/core/events")>()
  return {
    ...actual,
    parseRepoAnnouncementEvent: vi.fn(() => ({relays: []})),
    parseRoleLabelEvent: vi.fn(() => ({namespace: "", rootId: "", repoAddr: "", role: ""})),
  }
})

vi.mock("@nostr-git/core/git", () => ({
  RepoCore: {buildRepoSubscriptions: () => ({filters: []})},
}))

vi.mock("@nostr-git/core/utils", async importOriginal => {
  const actual = await importOriginal<typeof import("@nostr-git/core/utils")>()
  return {
    ...actual,
    buildRepoNaddrFromEvent: vi.fn(() => "naddr1valid"),
  }
})

vi.mock("@welshman/util", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/util")>()
  return {
    ...actual,
    Address: {
      ...actual.Address,
      fromNaddr: vi.fn((naddr: string) => ({
        toString: () => (naddr === "naddr1valid" ? "30617:pubkey123:repo" : "30617:other:repo"),
      })),
    },
  }
})

describe("notifications", () => {
  describe("getRepoNotificationPaths", () => {
    it("returns empty when relay or repoAddress is missing", async () => {
      const {getRepoNotificationPaths} = await import("./notifications")

      expect(getRepoNotificationPaths(new Set(), {relay: "", repoAddress: "30617:a:r"})).toEqual([])
      expect(getRepoNotificationPaths(new Set(), {relay: "wss://r.com", repoAddress: ""})).toEqual(
        [],
      )
    })

    it("returns matching paths for issues section", async () => {
      const {getRepoNotificationPaths} = await import("./notifications")
      const {encodeRelay} = await import("@app/core/state")
      vi.mocked(encodeRelay).mockReturnValue("relay-encoded")

      const paths = new Set([
        "/spaces/relay-encoded/git/naddr1valid/issues",
        "/spaces/relay-encoded/git/naddr1valid/prs",
        "/spaces/relay-encoded/git/naddr1other/repos",
      ])

      const result = getRepoNotificationPaths(paths, {
        relay: "wss://relay.example.com",
        repoAddress: "30617:pubkey123:repo",
        kind: "issues",
      })

      expect(result).toEqual(["/spaces/relay-encoded/git/naddr1valid/issues"])
    })

    it("returns matching paths for PRs section", async () => {
      const {getRepoNotificationPaths} = await import("./notifications")
      const {encodeRelay} = await import("@app/core/state")
      vi.mocked(encodeRelay).mockReturnValue("r")

      const paths = new Set(["/spaces/r/git/naddr1valid/prs"])
      const result = getRepoNotificationPaths(paths, {
        relay: "wss://r.com",
        repoAddress: "30617:pubkey123:repo",
        kind: "prs",
      })

      expect(result).toContain("/spaces/r/git/naddr1valid/prs")
    })

    it("matches any effective repo address alias", async () => {
      const {getRepoNotificationPaths} = await import("./notifications")
      const {encodeRelay} = await import("@app/core/state")
      vi.mocked(encodeRelay).mockReturnValue("r")

      const paths = new Set(["/spaces/r/git/naddr1valid/issues"])
      const result = getRepoNotificationPaths(paths, {
        relay: "wss://r.com",
        repoAddresses: ["30617:other:repo", "30617:pubkey123:repo"],
        kind: "issues",
      })

      expect(result).toEqual(["/spaces/r/git/naddr1valid/issues"])
    })

    it("filters by kind when specified", async () => {
      const {getRepoNotificationPaths} = await import("./notifications")
      const {encodeRelay} = await import("@app/core/state")
      vi.mocked(encodeRelay).mockReturnValue("r")

      const paths = new Set(["/spaces/r/git/naddr1valid/issues", "/spaces/r/git/naddr1valid/prs"])
      const result = getRepoNotificationPaths(paths, {
        relay: "wss://r.com",
        repoAddress: "30617:pubkey123:repo",
        kind: "issues",
      })

      expect(result).toEqual(["/spaces/r/git/naddr1valid/issues"])
    })
  })

  describe("hasRepoNotification", () => {
    it("returns true when getRepoNotificationPaths has matches", async () => {
      const {hasRepoNotification} = await import("./notifications")
      const {encodeRelay} = await import("@app/core/state")
      vi.mocked(encodeRelay).mockReturnValue("r")

      const paths = new Set(["/spaces/r/git/naddr1valid/issues"])
      const result = hasRepoNotification(paths, {
        relay: "wss://r.com",
        repoAddress: "30617:pubkey123:repo",
      })

      expect(result).toBe(true)
    })

    it("returns false when no matches", async () => {
      const {hasRepoNotification} = await import("./notifications")

      const result = hasRepoNotification(new Set(), {
        relay: "wss://r.com",
        repoAddress: "30617:a:r",
      })

      expect(result).toBe(false)
    })

    it("returns true when any alias matches", async () => {
      const {hasRepoNotification} = await import("./notifications")
      const {encodeRelay} = await import("@app/core/state")
      vi.mocked(encodeRelay).mockReturnValue("r")

      const result = hasRepoNotification(new Set(["/spaces/r/git/naddr1valid/prs"]), {
        relay: "wss://r.com",
        repoAddresses: ["30617:other:repo", "30617:pubkey123:repo"],
      })

      expect(result).toBe(true)
    })
  })
})
