import {describe, it, expect, vi} from "vitest"
import "fake-indexeddb/auto"

import type {GitProvider} from "../../src/git/provider.js"
import type {RepoCacheManager} from "../../src/worker/workers/cache.js"
import {safePushToRemoteUtil} from "../../src/worker/workers/push.js"

import {createTestFs, mkdirp, writeText} from "../utils/lightningfs.js"
import {createRemoteRegistry} from "../utils/remote-registry.js"
import {createTestGitProvider} from "../utils/provider-harness.js"
import {initRepo, commitFile} from "../utils/git-harness.js"

const GRASP_REMOTE_URL =
  "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git"

class MemCacheManager implements Partial<RepoCacheManager> {
  private map = new Map<string, any>()

  async getRepoCache(key: string): Promise<any> {
    return this.map.get(key) ?? null
  }

  async setRepoCache(cache: any): Promise<void> {
    this.map.set(cache.repoId, cache)
  }
}

async function statIsDir(fs: any, path: string): Promise<boolean> {
  try {
    const st = await fs.promises.stat(path)
    return typeof st.isDirectory === "function" ? st.isDirectory() : st.type === "dir"
  } catch {
    return false
  }
}

async function isRepoClonedByGitDir(fs: any, dir: string): Promise<boolean> {
  return await statIsDir(fs, `${dir}/.git`)
}

async function hasUncommittedChangesReal(git: GitProvider, dir: string): Promise<boolean> {
  const matrix = await (git as any).statusMatrix({dir})
  if (!Array.isArray(matrix)) return false

  return matrix.some((row: any[]) => {
    const head = row?.[1]
    const workdir = row?.[2]
    const stage = row?.[3]
    return head !== workdir || workdir !== stage
  })
}

it("proceeds when provider==='grasp' even if needsUpdate would be true, and propagates blossomSummary", async () => {
  const fs = createTestFs("push-safe-grasp-provider")
  const remoteRegistry = createRemoteRegistry()
  const git = createTestGitProvider({fs: fs as any, remoteRegistry})
  const cacheManager = new MemCacheManager()

  const rootDir = "/repos"
  const repoId = "owner/repo"
  const dir = `${rootDir}/${repoId}`
  await mkdirp(fs as any, dir)
  await (git as any).init({dir, defaultBranch: "main"})

  const summary: any = {uploaded: 2, failures: []}
  const pushToRemote = vi.fn().mockResolvedValue({success: true, blossomSummary: summary})

  const res = await safePushToRemoteUtil(
    git as any,
    cacheManager as any,
    {
      repoId,
      remoteUrl: "https://example.com/owner/repo.git",
      branch: "main",
      provider: "grasp" as any,
      preflight: {requireUpToDate: true, blockIfUncommitted: false},
    },
    {
      rootDir,
      parseRepoId: id => id,
      isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
      isShallowClone: async () => false,
      resolveBranchName: async (_d, requested) => requested || "main",
      hasUncommittedChanges: async () => false,
      needsUpdate: async () => true, // would normally block, but provider==='grasp' bypasses
      pushToRemote,
    },
  )

  expect(res.success).toBe(true)
  expect(res.pushed).toBe(true)
  expect((res as any).blossomSummary).toEqual(summary)
  expect(pushToRemote).toHaveBeenCalledTimes(1)
})

it("blocks when provider!=='grasp' and needsUpdate returns true (remote ahead)", async () => {
  const fs = createTestFs("push-safe-remote-ahead")
  const remoteRegistry = createRemoteRegistry()
  const git = createTestGitProvider({fs: fs as any, remoteRegistry})
  const cacheManager = new MemCacheManager()

  const rootDir = "/repos"
  const repoId = "owner/repo"
  const dir = `${rootDir}/${repoId}`
  await mkdirp(fs as any, dir)
  await (git as any).init({dir, defaultBranch: "main"})

  const pushSpy = vi.fn()

  const res = await safePushToRemoteUtil(
    git as any,
    cacheManager as any,
    {
      repoId,
      remoteUrl: "https://example.com/owner/repo.git",
      branch: "main",
      provider: "github" as any,
      preflight: {requireUpToDate: true, blockIfUncommitted: false},
    },
    {
      rootDir,
      parseRepoId: id => id,
      isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
      isShallowClone: async () => false,
      resolveBranchName: async (_d, requested) => requested || "main",
      hasUncommittedChanges: async () => false,
      needsUpdate: async () => true,
      pushToRemote: pushSpy,
    },
  )

  expect(res.success).toBe(false)
  expect((res as any).reason).toBe("remote_ahead")
  expect(String((res as any).error || "")).toMatch(
    /blocked during preflight|refresh the selected remote/i,
  )
  expect(pushSpy).not.toHaveBeenCalled()
})

describe("worker/push: safePushToRemoteUtil", () => {
  it("returns error when repository is not cloned", async () => {
    const fs = createTestFs("push-safe-not-cloned")
    const remoteRegistry = createRemoteRegistry()
    const git = createTestGitProvider({fs: fs as any, remoteRegistry})
    const cacheManager = new MemCacheManager()

    const res = await safePushToRemoteUtil(
      git as any,
      cacheManager as any,
      {
        repoId: "owner/repo",
        remoteUrl: "https://example.com/owner/repo.git",
        branch: "main",
      },
      {
        rootDir: "/repos",
        parseRepoId: id => id,
        isRepoCloned: async dir => isRepoClonedByGitDir(fs as any, dir),
        isShallowClone: async () => false,
        resolveBranchName: async (_dir, requested) => requested || "main",
        hasUncommittedChanges: async dir => hasUncommittedChangesReal(git as any, dir),
        needsUpdate: async () => false,
        pushToRemote: async () => ({success: true}),
      },
    )

    expect(res.success).toBe(false)
    expect(res.error?.toLowerCase()).toContain("not cloned")
  })

  it("blocks when uncommitted changes exist and blockIfUncommitted enabled", async () => {
    const fs = createTestFs("push-safe-dirty")
    const remoteRegistry = createRemoteRegistry()
    const git = createTestGitProvider({fs: fs as any, remoteRegistry})
    const cacheManager = new MemCacheManager()

    const rootDir = "/repos"
    const repoId = "owner/repo"
    const dir = `${rootDir}/${repoId}`

    await mkdirp(fs as any, dir)
    await initRepo({fs: fs as any, dir, author: {name: "Test", email: "t@example.com"}}, "main")
    await commitFile(
      {fs: fs as any, dir, author: {name: "Test", email: "t@example.com"}},
      "/README.md",
      "v1\n",
      "init",
    )

    // Modify without committing/staging
    await writeText(fs as any, `${dir}/README.md`, "v2-uncommitted\n")

    const res = await safePushToRemoteUtil(
      git as any,
      cacheManager as any,
      {
        repoId,
        remoteUrl: "https://example.com/owner/repo.git",
        branch: "main",
        preflight: {blockIfUncommitted: true, requireUpToDate: false},
      },
      {
        rootDir,
        parseRepoId: id => id,
        isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
        isShallowClone: async () => false,
        resolveBranchName: async (_d, requested) => requested || "main",
        hasUncommittedChanges: async d => hasUncommittedChangesReal(git as any, d),
        needsUpdate: async () => false,
        pushToRemote: async () => ({success: true}),
      },
    )

    expect(res.success).toBe(false)
    expect(res.reason).toBe("uncommitted_changes")
    expect(res.error?.toLowerCase()).toContain("uncommitted")
  })

  it("blocks when shallow clone and blockIfShallow enabled", async () => {
    const fs = createTestFs("push-safe-shallow")
    const remoteRegistry = createRemoteRegistry()
    const git = createTestGitProvider({fs: fs as any, remoteRegistry})
    const cacheManager = new MemCacheManager()

    const rootDir = "/repos"
    const repoId = "owner/repo"
    const dir = `${rootDir}/${repoId}`

    await mkdirp(fs as any, dir)
    await (git as any).init({dir, defaultBranch: "main"})

    const res = await safePushToRemoteUtil(
      git as any,
      cacheManager as any,
      {
        repoId,
        remoteUrl: "https://example.com/owner/repo.git",
        branch: "main",
        preflight: {blockIfShallow: true, blockIfUncommitted: false, requireUpToDate: false},
      },
      {
        rootDir,
        parseRepoId: id => id,
        isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
        isShallowClone: async () => true,
        resolveBranchName: async (_d, requested) => requested || "main",
        hasUncommittedChanges: async () => false,
        needsUpdate: async () => false,
        pushToRemote: async () => ({success: true}),
      },
    )

    expect(res.success).toBe(false)
    expect(res.reason).toBe("shallow_clone")
    expect(res.error?.toLowerCase()).toContain("shallow")
  })

  it('requireUpToDate triggers needsUpdate check except for provider==="grasp"', async () => {
    const fs = createTestFs("push-safe-upToDate")
    const remoteRegistry = createRemoteRegistry()
    const git = createTestGitProvider({fs: fs as any, remoteRegistry})
    const cacheManager = new MemCacheManager()

    const rootDir = "/repos"
    const repoId = "owner/repo"
    const dir = `${rootDir}/${repoId}`

    await mkdirp(fs as any, dir)
    await (git as any).init({dir, defaultBranch: "main"})

    const needsUpdate = vi.fn().mockResolvedValue(true)

    const resBlocked = await safePushToRemoteUtil(
      git as any,
      cacheManager as any,
      {
        repoId,
        remoteUrl: "https://example.com/owner/repo.git",
        branch: "main",
        provider: "github" as any,
        preflight: {requireUpToDate: true, blockIfUncommitted: false},
      },
      {
        rootDir,
        parseRepoId: id => id,
        isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
        isShallowClone: async () => false,
        resolveBranchName: async (_d, requested) => requested || "main",
        hasUncommittedChanges: async () => false,
        needsUpdate,
        pushToRemote: async () => ({success: true}),
      },
    )

    expect(resBlocked.success).toBe(false)
    expect(resBlocked.reason).toBe("remote_ahead")
    expect(needsUpdate).toHaveBeenCalledTimes(1)
    expect(needsUpdate.mock.calls[0]?.slice(0, 4)).toEqual([
      repoId,
      ["https://example.com/owner/repo.git"],
      null,
      "main",
    ])

    needsUpdate.mockClear()

    const resGrasp = await safePushToRemoteUtil(
      git as any,
      cacheManager as any,
      {
        repoId,
        remoteUrl: GRASP_REMOTE_URL,
        branch: "main",
        provider: "grasp" as any,
        preflight: {requireUpToDate: true, blockIfUncommitted: false},
      },
      {
        rootDir,
        parseRepoId: id => id,
        isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
        isShallowClone: async () => false,
        resolveBranchName: async (_d, requested) => requested || "main",
        hasUncommittedChanges: async () => false,
        needsUpdate,
        pushToRemote: async () => ({success: true}),
      },
    )

    expect(resGrasp.success).toBe(true)
    expect((resGrasp as any).pushed).toBe(true)
    expect(needsUpdate).toHaveBeenCalledTimes(0)
  })

  it("requires confirmation when allowForce=true and confirmDestructive=false", async () => {
    const fs = createTestFs("push-safe-force-confirm")
    const remoteRegistry = createRemoteRegistry()
    const git = createTestGitProvider({fs: fs as any, remoteRegistry})
    const cacheManager = new MemCacheManager()

    const rootDir = "/repos"
    const repoId = "owner/repo"
    const dir = `${rootDir}/${repoId}`
    await mkdirp(fs as any, dir)
    await (git as any).init({dir, defaultBranch: "main"})

    const res = await safePushToRemoteUtil(
      git as any,
      cacheManager as any,
      {
        repoId,
        remoteUrl: "https://example.com/owner/repo.git",
        branch: "main",
        allowForce: true,
        confirmDestructive: false,
        preflight: {requireUpToDate: false, blockIfUncommitted: false},
      },
      {
        rootDir,
        parseRepoId: id => id,
        isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
        isShallowClone: async () => false,
        resolveBranchName: async (_d, requested) => requested || "main",
        hasUncommittedChanges: async () => false,
        needsUpdate: async () => false,
        pushToRemote: async () => ({success: true}),
      },
    )

    expect(res.success).toBe(false)
    expect(res.requiresConfirmation).toBe(true)
    expect(res.reason).toBe("force_push_requires_confirmation")
  })

  it("success path propagates blossomSummary when provided by pushToRemote", async () => {
    const fs = createTestFs("push-safe-success-blossom")
    const remoteRegistry = createRemoteRegistry()
    const git = createTestGitProvider({fs: fs as any, remoteRegistry})
    const cacheManager = new MemCacheManager()

    const rootDir = "/repos"
    const repoId = "owner/repo"
    const dir = `${rootDir}/${repoId}`
    await mkdirp(fs as any, dir)
    await (git as any).init({dir, defaultBranch: "main"})

    const summary: any = {uploaded: 1, failures: []}

    const pushToRemote = vi.fn().mockResolvedValue({success: true, blossomSummary: summary})

    const res = await safePushToRemoteUtil(
      git as any,
      cacheManager as any,
      {
        repoId,
        remoteUrl: "https://example.com/owner/repo.git",
        branch: "main",
        preflight: {requireUpToDate: false, blockIfUncommitted: false},
      },
      {
        rootDir,
        parseRepoId: id => id,
        isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
        isShallowClone: async () => false,
        resolveBranchName: async (_d, requested) => requested || "main",
        hasUncommittedChanges: async () => false,
        needsUpdate: async () => false,
        pushToRemote,
      },
    )

    expect(res.success).toBe(true)
    expect((res as any).blossomSummary).toEqual(summary)
    expect(pushToRemote).toHaveBeenCalledTimes(1)
  })

  it("returns error when pushToRemote returns invalid response without success field", async () => {
    const fs = createTestFs("push-safe-invalid-response")
    const remoteRegistry = createRemoteRegistry()
    const git = createTestGitProvider({fs: fs as any, remoteRegistry})
    const cacheManager = new MemCacheManager()

    const rootDir = "/repos"
    const repoId = "owner/repo"
    const dir = `${rootDir}/${repoId}`
    await mkdirp(fs as any, dir)
    await (git as any).init({dir, defaultBranch: "main"})

    const res = await safePushToRemoteUtil(
      git as any,
      cacheManager as any,
      {
        repoId,
        remoteUrl: "https://example.com/owner/repo.git",
        branch: "main",
        preflight: {requireUpToDate: false, blockIfUncommitted: false},
      },
      {
        rootDir,
        parseRepoId: id => id,
        isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
        isShallowClone: async () => false,
        resolveBranchName: async (_d, requested) => requested || "main",
        hasUncommittedChanges: async () => false,
        needsUpdate: async () => false,
        pushToRemote: async () => ({}) as any,
      },
    )

    expect(res.success).toBe(false)
    expect(String(res.error || "")).toMatch(/invalid response/i)
  })

  it("allows force push when confirmation provided (allowForce=true, confirmDestructive=true)", async () => {
    const fs = createTestFs("push-safe-force-allowed")
    const remoteRegistry = createRemoteRegistry()
    const git = createTestGitProvider({fs: fs as any, remoteRegistry})
    const cacheManager = new MemCacheManager()

    const rootDir = "/repos"
    const repoId = "owner/repo"
    const dir = `${rootDir}/${repoId}`
    await mkdirp(fs as any, dir)
    await (git as any).init({dir, defaultBranch: "main"})

    const pushSpy = vi.fn().mockResolvedValue({success: true})

    const res = await safePushToRemoteUtil(
      git as any,
      cacheManager as any,
      {
        repoId,
        remoteUrl: "https://example.com/owner/repo.git",
        branch: "main",
        allowForce: true,
        confirmDestructive: true,
        preflight: {requireUpToDate: false, blockIfUncommitted: false},
      },
      {
        rootDir,
        parseRepoId: id => id,
        isRepoCloned: async d => isRepoClonedByGitDir(fs as any, d),
        isShallowClone: async () => false,
        resolveBranchName: async (_d, requested) => requested || "main",
        hasUncommittedChanges: async () => false,
        needsUpdate: async () => false,
        pushToRemote: pushSpy,
      },
    )

    expect(res.success).toBe(true)
    expect(res.pushed).toBe(true)
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })
})
