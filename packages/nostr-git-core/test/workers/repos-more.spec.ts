import {describe, it, expect, vi, beforeEach} from "vitest"
import type {GitProvider} from "../../src/git/provider.js"
import {
  smartInitializeRepoUtil,
  initializeRepoUtil,
  ensureShallowCloneUtil,
  ensureFullCloneUtil,
  clearCloneTracking,
  cloneRemoteRepoUtil,
} from "../../src/worker/workers/repos.js"

const parseRepoId = (id: string) => id.replace(/\s+/g, "-").toLowerCase()

function makeGitMock(partial: Partial<GitProvider> = {}): GitProvider {
  return {
    // clone/init
    clone: vi.fn().mockResolvedValue(undefined),
    listBranches: vi.fn().mockResolvedValue(["main"]),
    resolveRef: vi.fn().mockResolvedValue("abcdef1234567890"),
    // fetch/checkout
    listRemotes: vi
      .fn()
      .mockResolvedValue([{remote: "origin", url: "https://example.com/repo.git"}]),
    fetch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    // write and others
    writeRef: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue([]),
    statusMatrix: vi.fn().mockResolvedValue([] as any),
    ...partial,
  } as unknown as GitProvider
}

function makeCacheMock(initial?: any) {
  let stored: any = initial ?? null
  return {
    getRepoCache: vi.fn(async (key: string) => (stored && stored.repoId === key ? stored : null)),
    setRepoCache: vi.fn(async (value: any) => {
      stored = value
      return undefined
    }),
    clearOldCache: vi.fn(async () => undefined),
    deleteRepoCache: vi.fn(async () => undefined),
  } as any
}

const rootDir = "/tmp/root"

describe("repos utils (additional coverage)", () => {
  let git: GitProvider
  let cacheManager: any
  let repoDataLevels: Map<string, "refs" | "shallow" | "full">
  let clonedRepos: Set<string>

  beforeEach(() => {
    git = makeGitMock()
    cacheManager = makeCacheMock()
    repoDataLevels = new Map()
    clonedRepos = new Set()
  })

  it("initializeRepoUtil: returns structured corsError=false on non-network failure", async () => {
    const git = makeGitMock({
      clone: vi.fn(async () => {
        throw new Error("auth failed")
      }) as any,
      listBranches: vi.fn(async () => ["main"]) as any,
    })
    const cacheManager = makeCacheMock()
    const res = await (initializeRepoUtil as any)(
      git,
      cacheManager,
      {repoId: "o/r", cloneUrls: ["https://example.com/o/r.git"]},
      {rootDir, parseRepoId, repoDataLevels, clonedRepos},
      () => {},
    )
    expect(res.success).toBe(false)
    expect((res as any).corsError).toBeUndefined()
    expect(String((res as any).error || "")).toMatch(/auth failed|All clone URLs failed/i)
  })

  it("initializeRepoUtil: returns corsError=true with message on CORS/network failure", async () => {
    const git = makeGitMock({
      clone: vi.fn(async () => {
        throw new Error("CORS: Access-Control")
      }) as any,
      listBranches: vi.fn(async () => ["main"]) as any,
    })
    const cacheManager = makeCacheMock()
    const res = await (initializeRepoUtil as any)(
      git,
      cacheManager,
      {repoId: "o/r", cloneUrls: ["https://example.com/o/r.git"]},
      {rootDir, parseRepoId, repoDataLevels, clonedRepos},
      () => {},
    )
    expect(res.success).toBe(false)
    expect((res as any).corsError).toBe(true)
    expect(String((res as any).error || "")).toMatch(/CORS|network/i)
  })

  it("initializeRepoUtil: uses advertised branch when remote HEAD is missing", async () => {
    const clone = vi.fn().mockResolvedValue(undefined)
    const git = makeGitMock({
      clone: clone as any,
      listServerRefs: vi.fn(async () => [{ref: "refs/heads/maint", oid: "abcd"}]) as any,
      listBranches: vi.fn(async (args: any) => (args?.remote ? ["maint"] : ["maint"])) as any,
      resolveRef: vi.fn(async () => "abcd") as any,
    })

    const res = await initializeRepoUtil(
      git,
      makeCacheMock(),
      {repoId: "o/r", cloneUrls: ["https://example.com/owner/repo.git"]},
      {rootDir, parseRepoId, repoDataLevels, clonedRepos},
      () => {},
    )

    expect(res.success).toBe(true)
    expect(clone).toHaveBeenCalled()
    expect((clone as any).mock.calls[0][0].ref).toBe("maint")
  })

  it("ensureShallowCloneUtil: idempotent when already shallow", async () => {
    const git = makeGitMock({
      listRemotes: vi.fn(async () => [
        {remote: "origin", url: "https://example.com/x/y.git"},
      ]) as any,
    })
    const res = await ensureShallowCloneUtil(
      git,
      {repoId: "o/r"},
      {
        rootDir,
        parseRepoId,
        repoDataLevels: new Map([[parseRepoId("o/r"), "shallow"]]),
        clonedRepos: new Set([parseRepoId("o/r")]),
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )
    expect(res.success).toBe(true)
    expect((res as any).fromCache).toBe(true)
    expect((git as any).fetch).not.toHaveBeenCalled()
  })

  it("ensureFullCloneUtil: falls back to existing local branch when deepen fetch fails", async () => {
    const git = makeGitMock({
      listRemotes: vi.fn(async () => [
        {remote: "origin", url: "https://example.com/x/y.git"},
      ]) as any,
      fetch: vi.fn(async () => {
        throw new Error("Could not find maint.")
      }) as any,
      resolveRef: vi.fn(async ({ref}: any) => {
        if (ref === "maint" || ref === "refs/heads/maint") return "abc123"
        throw new Error(`missing ${ref}`)
      }) as any,
    })

    const res = await ensureFullCloneUtil(
      git,
      {repoId: "o/r", branch: "maint", depth: 75},
      {
        rootDir,
        parseRepoId,
        repoDataLevels: new Map([[parseRepoId("o/r"), "refs"]]),
        clonedRepos: new Set([parseRepoId("o/r")]),
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )

    expect(res.success).toBe(true)
    expect((res as any).localOnly).toBe(true)
    expect((res as any).warning).toMatch(/Could not find maint/)
  })

  it("ensureShallowCloneUtil: error when no origin remote configured", async () => {
    const git = makeGitMock({listRemotes: vi.fn(async () => []) as any})
    const res = await ensureShallowCloneUtil(
      git,
      {repoId: "o/r"},
      {
        rootDir,
        parseRepoId,
        repoDataLevels: new Map(),
        clonedRepos: new Set([parseRepoId("o/r")]),
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )
    expect(res.success).toBe(false)
    expect(String((res as any).error || "")).toMatch(/Origin remote not found/i)
  })

  it("ensureFullCloneUtil: happy path deepens to full with auth", async () => {
    const git = makeGitMock({
      listRemotes: vi.fn(async () => [
        {remote: "origin", url: "https://example.com/x/y.git"},
      ]) as any,
      fetch: vi.fn(async () => undefined) as any,
    })
    const res = await ensureFullCloneUtil(
      git,
      {repoId: "o/r", branch: "develop", depth: 75},
      {
        rootDir,
        parseRepoId,
        repoDataLevels: new Map([[parseRepoId("o/r"), "shallow"]]),
        clonedRepos: new Set([parseRepoId("o/r")]),
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir: string, requested?: string) => requested || "main",
      },
      () => {},
    )
    expect(res.success).toBe(true)
    expect((res as any).level).toBe("full")
    // depth is capped at 100, but 75 should pass through
    expect((git as any).fetch).toHaveBeenCalled()
  })

  it("ensureFullCloneUtil: not initialized returns error", async () => {
    const git = makeGitMock({})
    const res = await ensureFullCloneUtil(
      git,
      {repoId: "o/r", branch: "main"},
      {
        rootDir,
        parseRepoId,
        repoDataLevels: new Map(),
        clonedRepos: new Set(),
        isRepoCloned: async () => false,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )
    expect(res.success).toBe(false)
    expect(String((res as any).error || "")).toMatch(/not initialized/i)
  })

  it("ensureFullCloneUtil: idempotent when already full", async () => {
    const git = makeGitMock({})
    const res = await ensureFullCloneUtil(
      git,
      {repoId: "o/r", branch: "main"},
      {
        rootDir,
        parseRepoId,
        repoDataLevels: new Map([[parseRepoId("o/r"), "full"]]),
        clonedRepos: new Set([parseRepoId("o/r")]),
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )
    expect(res.success).toBe(true)
    expect((res as any).cached).toBe(true)
    expect((git as any).fetch).not.toHaveBeenCalled()
  })

  it("smartInitializeRepoUtil: caches tags with commit oids when available", async () => {
    const git = makeGitMock({
      listBranches: vi.fn(async (args?: any) => {
        if (args && args.remote === "origin") return []
        return ["main"]
      }) as any,
      resolveRef: vi.fn(async ({ref}: any) => {
        if (ref === "refs/heads/main") return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        if (ref === "refs/tags/v1.0.0") return "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        if (ref === "refs/tags/v2.0.0") return "cccccccccccccccccccccccccccccccccccccccc"
        if (ref === "HEAD") return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        throw new Error("no ref")
      }) as any,
      // Provide listTags API
      listTags: vi.fn(async () => ["v1.0.0", "v2.0.0"]) as any,
      fetch: vi.fn(async () => undefined) as any,
    })

    const cacheManager = makeCacheMock()

    const res = await (smartInitializeRepoUtil as any)(
      git,
      cacheManager,
      {repoId: "owner/repo", cloneUrls: ["https://example.com/owner/repo.git"]},
      {
        rootDir,
        parseRepoId,
        repoDataLevels: new Map([[parseRepoId("owner/repo"), "refs"]]),
        clonedRepos: new Set([parseRepoId("owner/repo")]),
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )

    expect(res.success).toBe(true)
    const setArg = (cacheManager.setRepoCache as any).mock.calls[0][0]
    const tags = (setArg.tags || []) as Array<{name: string; commit: string}>
    expect(Array.isArray(tags)).toBe(true)
    const t1 = tags.find(t => t.name === "v1.0.0")
    const t2 = tags.find(t => t.name === "v2.0.0")
    expect(t1?.commit).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    expect(t2?.commit).toBe("cccccccccccccccccccccccccccccccccccccccc")
  })

  it("smartInitializeRepoUtil: caches per-branch commits for local and remote branches", async () => {
    const git = makeGitMock({
      // Local and remote branches
      listBranches: vi.fn(async (args?: any) => {
        if (args && args.remote === "origin") return ["origin/feature"]
        return ["main"]
      }) as any,
      // Resolve refs per-branch
      resolveRef: vi.fn(async ({ref}: any) => {
        if (ref === "refs/heads/main") return "1111111111111111111111111111111111111111"
        if (ref === "refs/remotes/origin/feature") return "2222222222222222222222222222222222222222"
        if (ref === "HEAD") return "1111111111111111111111111111111111111111"
        throw new Error("no ref")
      }) as any,
      // Fetch succeeds (no-op)
      fetch: vi.fn(async () => undefined) as any,
    })

    const cacheManager = makeCacheMock()

    const res = await (smartInitializeRepoUtil as any)(
      git,
      cacheManager,
      {repoId: "owner/repo", cloneUrls: ["https://example.com/owner/repo.git"]},
      {
        rootDir,
        parseRepoId,
        repoDataLevels: new Map([[parseRepoId("owner/repo"), "refs"]]),
        clonedRepos: new Set([parseRepoId("owner/repo")]),
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )

    expect(res.success).toBe(true)
    const setArg = (cacheManager.setRepoCache as any).mock.calls[0][0]
    const branches = setArg.branches as Array<{name: string; commit: string}>
    // Should include both main and feature with correct commits
    const main = branches.find(b => b.name === "main")
    const feature = branches.find(b => b.name === "feature")
    expect(main?.commit).toBe("1111111111111111111111111111111111111111")
    expect(feature?.commit).toBe("2222222222222222222222222222222222222222")
  })

  it("ensureFullCloneUtil: not initialized returns error", async () => {
    const repoId = "X/FullNotInit"
    const res = await ensureFullCloneUtil(
      git,
      {repoId, branch: "main", depth: 10},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => false,
        resolveBranchName: async (_dir, requested) => requested || "main",
      } as any,
      () => {},
    )
    expect(res.success).toBe(false)
    expect((res as any).error).toMatch(/Repository not initialized/i)
  })

  it("cloneRemoteRepoUtil: empty remote refs throws with helpful error", async () => {
    const gitNoRefs = makeGitMock({
      listServerRefs: vi.fn(async () => []) as any,
    } as any)
    const cacheMgr: any = {init: vi.fn(async () => {}), setRepoCache: vi.fn(async () => {})}
    await expect(
      cloneRemoteRepoUtil(gitNoRefs as any, cacheMgr, {
        url: "https://example.com/owner/repo.git",
        dir: "/tmp/root/clone-empty",
      }),
    ).rejects.toThrow(/Clone failed: .*not found|no refs/i)
    expect(cacheMgr.setRepoCache).not.toHaveBeenCalled()
  })

  it("cloneRemoteRepoUtil: wraps clone errors and does not write cache", async () => {
    const gitFailClone = makeGitMock({
      listServerRefs: vi.fn(async () => [{ref: "refs/heads/main", oid: "abcd"}]) as any,
      clone: vi.fn(async () => {
        throw new Error("network timeout")
      }) as any,
    } as any)
    const cacheMgr: any = {init: vi.fn(async () => {}), setRepoCache: vi.fn(async () => {})}
    await expect(
      cloneRemoteRepoUtil(gitFailClone as any, cacheMgr, {
        url: "https://example.com/owner/repo.git",
        dir: "/tmp/root/clone-fail",
      }),
    ).rejects.toThrow(/Clone failed: network timeout/)
    expect(cacheMgr.setRepoCache).not.toHaveBeenCalled()
  })

  it("cloneRemoteRepoUtil: happy path clones and writes cache", async () => {
    // Provide a git mock with listServerRefs to satisfy discovery
    const gitHappy = makeGitMock({
      // listServerRefs used by cloneRemoteRepoUtil to validate remote
      listServerRefs: vi.fn(async () => [{ref: "refs/heads/main", oid: "abcd"}]) as any,
    } as any)
    const cacheMgr: any = {init: vi.fn(async () => {}), setRepoCache: vi.fn(async () => {})}
    await cloneRemoteRepoUtil(gitHappy as any, cacheMgr, {
      url: "https://example.com/owner/repo.git",
      dir: "/tmp/root/clone-ok",
      depth: 1,
    })
    expect(cacheMgr.init).toHaveBeenCalled()
    expect(cacheMgr.setRepoCache).toHaveBeenCalled()
  })

  it("cloneRemoteRepoUtil: invalid URL fails early with helpful error", async () => {
    const cacheMgr: any = {init: vi.fn(async () => {}), setRepoCache: vi.fn(async () => {})}
    await expect(
      cloneRemoteRepoUtil(git as any, cacheMgr, {
        url: "not a url",
        dir: "/tmp/root/invalid",
        depth: 1,
      }),
    ).rejects.toThrow(/Invalid repository URL/i)
  })

  it("ensureFullCloneUtil: missing origin remote error", async () => {
    const repoId = "X/FullNoOrigin"
    const key = parseRepoId(repoId)
    clonedRepos.add(key)
    ;(git.listRemotes as any) = vi.fn(async () => [])
    const res = await ensureFullCloneUtil(
      git,
      {repoId, branch: "main", depth: 20},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      } as any,
      () => {},
    )
    expect(res.success).toBe(false)
    expect((res as any).error).toMatch(/Origin remote not found/i)
  })

  it("smartInitializeRepoUtil: forceUpdate bypasses cache and re-initializes", async () => {
    const repoId = "Org/ForceUpdate"
    const key = parseRepoId(repoId)
    // Seed cache that would normally short-circuit
    const cached = {
      repoId: key,
      lastUpdated: Date.now(),
      headCommit: "deadbeef",
      dataLevel: "refs" as const,
      branches: [{name: "main", commit: "deadbeef"}],
      cloneUrls: ["https://example.com/repo.git"],
    }
    cacheManager = makeCacheMock(cached)

    const res = await smartInitializeRepoUtil(
      git,
      cacheManager,
      {repoId, cloneUrls: ["https://example.com/repo.git"], forceUpdate: true},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => false,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )

    expect(res.success).toBe(true)
    if (!res.success) throw new Error("unexpected failure")
    expect((res as any).fromCache).toBe(false)
    expect((res as any).dataLevel).toBe("refs")
  })

  it("ensureFullCloneUtil: cached full path returns cached=true", async () => {
    const repoId = "X/FullCached"
    const key = parseRepoId(repoId)
    repoDataLevels.set(key, "full")
    clonedRepos.add(key)
    const res = await ensureFullCloneUtil(
      git,
      {repoId, branch: "main", depth: 50},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      } as any,
      () => {},
    )
    expect(res.success).toBe(true)
    expect((res as any).cached).toBe(true)
  })

  it("ensureFullCloneUtil: success path updates dataLevel to full", async () => {
    const repoId = "X/FullSuccess"
    const key = parseRepoId(repoId)
    const res = await ensureFullCloneUtil(
      git,
      {repoId, branch: "main", depth: 50},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      } as any,
      () => {},
    )
    expect(res.success).toBe(true)
    if (!res.success) throw new Error("unexpected failure")
    expect((res as any).level).toBe("full")
    expect(repoDataLevels.get(key)).toBe("full")
  })

  it("ensureShallowCloneUtil: success path sets shallow level", async () => {
    const repoId = "X/ShallowSuccess"
    const key = parseRepoId(repoId)
    clonedRepos.add(key)
    const res = await ensureShallowCloneUtil(
      git,
      {repoId, branch: "main"},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      } as any,
      () => {},
    )
    expect(res.success).toBe(true)
    if (!res.success) throw new Error("unexpected failure")
    expect((res as any).dataLevel).toBe("shallow")
    expect(repoDataLevels.get(key)).toBe("shallow")
  })

  it("ensureShallowCloneUtil: missing origin remote throws", async () => {
    const repoId = "X/ShallowNoOrigin"
    const key = parseRepoId(repoId)
    clonedRepos.add(key)
    // listRemotes returns empty
    ;(git.listRemotes as any) = vi.fn(async () => [])
    const res = await ensureShallowCloneUtil(
      git,
      {repoId, branch: "main"},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      } as any,
      () => {},
    )
    expect(res.success).toBe(false)
    expect((res as any).error).toMatch(/Origin remote not found/i)
  })

  it("ensureShallowCloneUtil: returns from cache when level already shallow", async () => {
    const repoId = "Org/CachedShallow"
    const key = parseRepoId(repoId)
    repoDataLevels.set(key, "shallow")
    const res = await ensureShallowCloneUtil(
      git,
      {repoId, branch: "main"},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )
    expect(res.success).toBe(true)
    expect((res as any).fromCache).toBe(true)
  })

  it("clearCloneTracking clears tracking sets", () => {
    const repoDataLevelsLocal = new Map<string, "refs" | "shallow" | "full">([["a", "refs"]])
    const clonedReposLocal = new Set<string>(["a"])
    clearCloneTracking(clonedReposLocal, repoDataLevelsLocal as any)
    expect(clonedReposLocal.size).toBe(0)
    expect(repoDataLevelsLocal.size).toBe(0)
  })

  it("smartInitializeRepoUtil: propagate failure when initialize fallback fails", async () => {
    const repoId = "Org/FallbackInitFail"
    const isRepoCloned = async () => true
    const resolveBranchName = async () => "main"

    // Non-CORS fetch error to force fallback into initializeRepoUtil
    ;(git.fetch as any) = vi.fn(async () => {
      throw new Error("server 500")
    })
    // Make clone fail inside initializeRepoUtil
    ;(git.clone as any) = vi.fn(async () => {
      throw new Error("clone failed")
    })

    const res = await smartInitializeRepoUtil(
      git,
      cacheManager,
      {repoId, cloneUrls: ["https://example.com/repo.git"]},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned,
        resolveBranchName,
      },
      () => {},
    )

    expect(res.success).toBe(false)
    if (res.success) throw new Error("unexpected success")
    expect((res as any).error).toMatch(/clone failed|All clone URLs failed|server 500/i)
  })

  it("smartInitializeRepoUtil: falls back to HEAD when remoteRef resolve fails", async () => {
    const repoId = "Org/FallbackHead"
    const isRepoCloned = async () => true
    const resolveBranchName = async () => "main"

    // First resolveRef call for remoteRef throws; next for HEAD succeeds
    const originalResolve = git.resolveRef as any
    ;(git.resolveRef as any) = vi.fn(async (args: any) => {
      if (args?.ref && String(args.ref).startsWith("refs/remotes/")) {
        throw new Error("no remote ref")
      }
      return "deadbeef"
    })

    const res = await smartInitializeRepoUtil(
      git,
      cacheManager,
      {repoId, cloneUrls: ["https://example.com/repo.git"]},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned,
        resolveBranchName,
      },
      () => {},
    )

    expect(res.success).toBe(true)
    if (!res.success) throw new Error("unexpected failure")
    expect((res as any).synced).toBe(true)

    // restore
    ;(git.resolveRef as any) = originalResolve
  })

  it("smartInitializeRepoUtil: already-cloned non-CORS fetch error falls through to initialize flow", async () => {
    const repoId = "Org/NonCorsFail"
    const key = parseRepoId(repoId)
    const isRepoCloned = async () => true
    const resolveBranchName = async () => "main"

    // Make fetch throw a non-CORS error to trigger throw and re-init path
    ;(git.fetch as any) = vi.fn(async () => {
      throw new Error("Some other failure")
    })
    // Make clone succeed during the initializeRepoUtil fallback
    ;(git.clone as any) = vi.fn(async () => undefined)

    const res = await smartInitializeRepoUtil(
      git,
      cacheManager,
      {repoId, cloneUrls: ["https://example.com/repo.git"]},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned,
        resolveBranchName,
      },
      () => {},
    )

    expect(res.success).toBe(true)
    if (!res.success) throw new Error("unexpected failure")
    // either synced true from re-init, or refs level set via initialize path
    expect((res as any).synced === true || (res as any).dataLevel === "refs").toBe(true)
  })

  it("smartInitializeRepoUtil: already-cloned path with CORS fetch error and empty repo branch resolution", async () => {
    const repoId = "Owner/EmptyRepo"
    const key = parseRepoId(repoId)

    // Simulate already cloned
    const isRepoCloned = async () => true
    // Simulate fetch throwing a CORS-like error, should be handled and not thrown
    ;(git.fetch as any) = vi.fn(async () => {
      const err: any = new Error("CORS: Access-Control blocked")
      throw err
    })
    // Simulate resolveBranchName failing (empty repo)
    const resolveBranchName = async () => {
      throw new Error("no branches")
    }

    const res = await smartInitializeRepoUtil(
      git,
      cacheManager,
      {repoId, cloneUrls: ["https://example.com/repo.git"]},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned,
        resolveBranchName,
      },
      () => {},
    )

    expect(res.success).toBe(true)
    if (!res.success) throw new Error("unexpected failure")
    expect(res.fromCache).toBe(false)
    // should return limited success with warning for empty repos
    expect((res as any).warning).toMatch(/no branches/i)
    expect((res as any).dataLevel).toBe("refs")
  })

  it("smartInitializeRepoUtil: already-cloned path syncs branch when resolvable", async () => {
    const repoId = "Org/Normal"
    const key = parseRepoId(repoId)
    const isRepoCloned = async () => true
    const resolveBranchName = async () => "main"

    const res = await smartInitializeRepoUtil(
      git,
      cacheManager,
      {repoId, cloneUrls: ["https://example.com/repo.git"]},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned,
        resolveBranchName,
      },
      () => {},
    )

    expect(res.success).toBe(true)
    if (!res.success) throw new Error("unexpected failure")
    expect((res as any).synced).toBe(true)
    expect(git.writeRef as any).toHaveBeenCalled()
  })

  it("smartInitializeRepoUtil: uses requested branch during refresh sync", async () => {
    const repoId = "Org/Release"
    const requestedBranch = "release"
    const git = makeGitMock({
      fetch: vi.fn(async () => undefined) as any,
      listBranches: vi.fn(async (args?: any) =>
        args?.remote ? [requestedBranch] : [requestedBranch],
      ) as any,
      resolveRef: vi.fn(async ({ref}: any) => {
        if (ref === `refs/remotes/origin/${requestedBranch}`) return "release-oid"
        if (ref === `refs/heads/${requestedBranch}` || ref === "HEAD") return "release-oid"
        throw new Error(`missing ${ref}`)
      }) as any,
    })
    const resolveBranchName = vi.fn(async (_dir: string, requested?: string) => requested || "main")

    const res = await smartInitializeRepoUtil(
      git,
      cacheManager,
      {repoId, cloneUrls: ["https://example.com/repo.git"], branch: requestedBranch},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => true,
        resolveBranchName,
      },
      () => {},
    )

    expect(res.success).toBe(true)
    expect(resolveBranchName).toHaveBeenCalledWith(
      `${rootDir}/${parseRepoId(repoId)}`,
      requestedBranch,
    )
    expect(git.fetch as any).toHaveBeenCalledWith(
      expect.objectContaining({ref: requestedBranch, singleBranch: true}),
    )
  })

  it("initializeRepoUtil: prioritizes requested branch during force refresh clone", async () => {
    const requestedBranch = "release"
    const clone = vi.fn(async ({ref}: any) => {
      if (ref !== requestedBranch) throw new Error(`unexpected ref ${ref}`)
    })
    const git = makeGitMock({
      clone: clone as any,
      listServerRefs: vi.fn(async () => [{ref: "refs/heads/main", oid: "main-oid"}]) as any,
      listBranches: vi.fn(async (args?: any) =>
        args?.remote ? [requestedBranch] : [requestedBranch],
      ) as any,
      resolveRef: vi.fn(async ({ref}: any) => {
        if (ref === `refs/remotes/origin/${requestedBranch}`) return "release-oid"
        if (ref === `refs/heads/${requestedBranch}` || ref === "HEAD") return "release-oid"
        throw new Error(`missing ${ref}`)
      }) as any,
    })

    const res = await initializeRepoUtil(
      git,
      makeCacheMock(),
      {repoId: "o/r", cloneUrls: ["https://example.com/o/r.git"], branch: requestedBranch},
      {rootDir, parseRepoId, repoDataLevels, clonedRepos},
      () => {},
    )

    expect(res.success).toBe(true)
    expect(clone).toHaveBeenCalledWith(expect.objectContaining({ref: requestedBranch}))
  })

  it("ensureShallowCloneUtil: not initialized error path", async () => {
    const repoId = "X/Y"
    const res = await ensureShallowCloneUtil(
      git,
      {repoId, branch: "main"},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => false,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )
    expect(res.success).toBe(false)
    expect((res as any).error).toMatch(/Repository not initialized/i)
  })

  it("ensureFullCloneUtil: not initialized error path", async () => {
    const repoId = "X/Z"
    const res = await ensureFullCloneUtil(
      git,
      {repoId, branch: "main", depth: 50},
      {
        rootDir,
        parseRepoId,
        repoDataLevels,
        clonedRepos,
        isRepoCloned: async () => false,
        resolveBranchName: async (_dir, requested) => requested || "main",
      },
      () => {},
    )
    expect(res.success).toBe(false)
    expect((res as any).error).toMatch(/Repository not initialized/i)
  })
})
