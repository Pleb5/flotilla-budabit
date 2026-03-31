// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/core/state", async importOriginal => {
  const actual = await importOriginal<typeof import("@app/core/state")>()
  return {
    ...actual,
    encodeRelay: vi.fn((url: string) => encodeURIComponent(url)),
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
        "/spaces/relay-encoded/git/naddr1valid/patches",
        "/spaces/relay-encoded/git/naddr1other/repos",
      ])

      const result = getRepoNotificationPaths(paths, {
        relay: "wss://relay.example.com",
        repoAddress: "30617:pubkey123:repo",
        kind: "issues",
      })

      expect(result).toEqual(["/spaces/relay-encoded/git/naddr1valid/issues"])
    })

    it("returns matching paths for patches section", async () => {
      const {getRepoNotificationPaths} = await import("./notifications")
      const {encodeRelay} = await import("@app/core/state")
      vi.mocked(encodeRelay).mockReturnValue("r")

      const paths = new Set(["/spaces/r/git/naddr1valid/patches"])
      const result = getRepoNotificationPaths(paths, {
        relay: "wss://r.com",
        repoAddress: "30617:pubkey123:repo",
        kind: "patches",
      })

      expect(result).toContain("/spaces/r/git/naddr1valid/patches")
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

      const paths = new Set([
        "/spaces/r/git/naddr1valid/issues",
        "/spaces/r/git/naddr1valid/patches",
      ])
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

      const result = hasRepoNotification(new Set(["/spaces/r/git/naddr1valid/patches"]), {
        relay: "wss://r.com",
        repoAddresses: ["30617:other:repo", "30617:pubkey123:repo"],
      })

      expect(result).toBe(true)
    })
  })
})
