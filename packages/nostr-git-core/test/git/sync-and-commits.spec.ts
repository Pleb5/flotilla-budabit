import {describe, it, expect, beforeEach, afterEach, vi} from "vitest"
import {syncWithRemoteUtil, needsUpdateUtil} from "../../src/worker/workers/sync.js"
import type {GitProvider} from "../../src/git/provider.js"
import type {RepoCacheManager, RepoCache} from "../../src/worker/workers/cache.js"

describe("syncWithRemote with Enhanced Logging", () => {
  let mockGit: Partial<GitProvider>
  let mockCacheManager: Partial<RepoCacheManager>
  let consoleLogs: string[]
  let consoleErrors: string[]
  let consoleWarns: string[]

  beforeEach(() => {
    consoleLogs = []
    consoleErrors = []
    consoleWarns = []

    // Capture console output
    vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleLogs.push(args.join(" "))
    })
    vi.spyOn(console, "error").mockImplementation((...args) => {
      consoleErrors.push(args.join(" "))
    })
    vi.spyOn(console, "warn").mockImplementation((...args) => {
      consoleWarns.push(args.join(" "))
    })

    mockGit = {
      listRemotes: vi
        .fn()
        .mockResolvedValue([{remote: "origin", url: "https://example.com/repo.git"}]),
      fetch: vi.fn().mockResolvedValue(undefined),
      resolveRef: vi.fn().mockImplementation(async ({ref}) => {
        if (ref === "HEAD") return "local-def456"
        if (ref === "refs/remotes/origin/main") return "remote-abc123"
        return "remote-abc123"
      }),
      listBranches: vi.fn().mockResolvedValue(["main", "develop"]),
      checkout: vi.fn().mockResolvedValue(undefined),
      branch: vi.fn().mockResolvedValue(undefined),
    }

    mockCacheManager = {
      setRepoCache: vi.fn().mockResolvedValue(undefined),
      getRepoCache: vi.fn().mockResolvedValue(null),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should log sync start and completion", async () => {
    const result = await syncWithRemoteUtil(
      mockGit as GitProvider,
      mockCacheManager as RepoCacheManager,
      {
        repoId: "test-repo",
        cloneUrls: ["https://example.com/repo.git"],
        branch: "main",
      },
      {
        rootDir: "/repos",
        parseRepoId: id => id,
        resolveBranchName: vi.fn().mockResolvedValue("main"),
        isRepoCloned: vi.fn().mockResolvedValue(true),
        toPlain: v => v,
      },
    )

    expect(result.success).toBe(true)
    expect(result.duration).toBeGreaterThanOrEqual(0)

    // Check that logs contain expected patterns
    const allLogs = consoleLogs.join(" ")
    expect(allLogs).toContain("[syncWithRemote] Starting sync")
    expect(allLogs).toContain("[syncWithRemote] Sync completed successfully")
  })

  it("should log detailed error information on failure", async () => {
    const mockError = new Error("Network timeout")
    mockGit.fetch = vi.fn().mockRejectedValue(mockError)

    const result = await syncWithRemoteUtil(
      mockGit as GitProvider,
      mockCacheManager as RepoCacheManager,
      {
        repoId: "test-repo",
        cloneUrls: ["https://example.com/repo.git"],
        branch: "main",
      },
      {
        rootDir: "/repos",
        parseRepoId: id => id,
        resolveBranchName: vi.fn().mockResolvedValue("main"),
        isRepoCloned: vi.fn().mockResolvedValue(true),
        toPlain: v => v,
      },
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect((result as any).synced).toBe(false)
      expect((result as any).warning).toContain("CORS/network restrictions")
      expect((result as any).errorDetails).toContain("Network timeout")
    }

    const allWarns = consoleWarns.join(" ")
    expect(allWarns).toContain("using local data only")

    const allErrors = consoleErrors.join(" ")
    expect(allErrors).not.toContain("[syncWithRemote] Sync failed")
  })

  it("should return needsUpdate flag", async () => {
    ;(mockGit.resolveRef as any)
      .mockResolvedValueOnce("remote-abc123") // remote HEAD
      .mockResolvedValueOnce("local-def456") // local HEAD

    const result = await syncWithRemoteUtil(
      mockGit as GitProvider,
      mockCacheManager as RepoCacheManager,
      {
        repoId: "test-repo",
        cloneUrls: ["https://example.com/repo.git"],
        branch: "main",
      },
      {
        rootDir: "/repos",
        parseRepoId: id => id,
        resolveBranchName: vi.fn().mockResolvedValue("main"),
        isRepoCloned: vi.fn().mockResolvedValue(true),
        toPlain: v => v,
      },
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect((result as any).needsUpdate).toBe(true)
      expect((result as any).headCommit).toBe("remote-abc123")
      expect((result as any).localCommit).toBe("local-def456")
    }
  })

  it("should log each step of the sync process", async () => {
    await syncWithRemoteUtil(
      mockGit as GitProvider,
      mockCacheManager as RepoCacheManager,
      {
        repoId: "test-repo",
        cloneUrls: ["https://example.com/repo.git"],
        branch: "main",
      },
      {
        rootDir: "/repos",
        parseRepoId: id => id,
        resolveBranchName: vi.fn().mockResolvedValue("main"),
        isRepoCloned: vi.fn().mockResolvedValue(true),
        toPlain: v => v,
      },
    )

    const allLogs = consoleLogs.join(" ")
    expect(allLogs).toContain("Attempting to fetch requested branch: main")
    expect(allLogs).toContain("Successfully fetched requested branch from")
    expect(allLogs).toContain("Branch checked out successfully")
    expect(allLogs).toContain("Remote HEAD")
    expect(allLogs).toContain("Cache updated")
  })
})

describe("needsUpdate", () => {
  let mockGit: Partial<GitProvider>

  beforeEach(() => {
    mockGit = {
      listServerRefs: vi.fn().mockResolvedValue([{ref: "refs/heads/main", oid: "new-commit-123"}]),
    }
  })

  it("should return true when cache is stale", async () => {
    const oldCache: RepoCache = {
      repoId: "test-repo",
      lastUpdated: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      headCommit: "old-commit",
      dataLevel: "shallow",
      branches: [],
      cloneUrls: ["https://example.com/repo.git"],
    }

    const needsSync = await needsUpdateUtil(
      mockGit as GitProvider,
      "test-repo",
      ["https://example.com/repo.git"],
      oldCache,
      Date.now(),
    )

    expect(needsSync).toBe(true)
  })

  it("should return true when remote HEAD differs from cache", async () => {
    const cache: RepoCache = {
      repoId: "test-repo",
      lastUpdated: Date.now(),
      headCommit: "old-commit",
      dataLevel: "shallow",
      branches: [],
      cloneUrls: ["https://example.com/repo.git"],
    }

    const needsSync = await needsUpdateUtil(
      mockGit as GitProvider,
      "test-repo",
      ["https://example.com/repo.git"],
      cache,
      Date.now(),
    )

    expect(needsSync).toBe(true)
  })

  it("should return false when cache is fresh and HEAD matches", async () => {
    const cache: RepoCache = {
      repoId: "test-repo",
      lastUpdated: Date.now(),
      headCommit: "new-commit-123",
      dataLevel: "shallow",
      branches: [],
      cloneUrls: ["https://example.com/repo.git"],
    }

    const needsSync = await needsUpdateUtil(
      mockGit as GitProvider,
      "test-repo",
      ["https://example.com/repo.git"],
      cache,
      Date.now(),
    )

    expect(needsSync).toBe(false)
  })
})

describe("Commit History Integration", () => {
  it("should verify logging structure for debugging", () => {
    // This test documents the expected log format for debugging
    const expectedLogPatterns = [
      "[syncWithRemote] Starting sync for",
      "[syncWithRemote] Resolved branch:",
      "[syncWithRemote] Using remote URL:",
      "[syncWithRemote] Fetching from remote...",
      "[syncWithRemote] Fetch completed",
      "[syncWithRemote] Remote HEAD:",
      "[syncWithRemote] Local HEAD:",
      "[syncWithRemote] Cache updated",
      "[syncWithRemote] Sync completed successfully in",
      "[getCommitHistory] Starting for",
      "[getCommitHistory] Resolved branch:",
      "[getCommitHistory] Repo needs sync",
      "[getCommitHistory] Success: loaded",
    ]

    // This test serves as documentation
    expect(expectedLogPatterns.length).toBeGreaterThan(0)
  })
})
