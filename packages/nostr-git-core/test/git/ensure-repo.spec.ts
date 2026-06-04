import {describe, it, expect, vi, beforeEach, afterEach} from "vitest"
import "fake-indexeddb/auto"

import {setGitProvider, getGitProvider} from "../../src/api/git-provider.js"
import {
  isRepoCloned,
  ensureRepo,
  ensureRepoFromEvent,
  detectDefaultBranch,
  getDefaultBranch,
  rootDir,
} from "../../src/git/git.js"

import {VirtualGitRemote} from "../git/virtual-remote.js"
import {createRemoteRegistry} from "../utils/remote-registry.js"
import {createTestGitProvider} from "../utils/provider-harness.js"
import {createTestFs, mkdirp} from "../utils/lightningfs.js"
import {initRepo, commitFile} from "../utils/git-harness.js"

describe.sequential(
  "git/git.ts: ensureRepo + ensureRepoFromEvent + default branch detection",
  () => {
    let prevProvider: any

    beforeEach(() => {
      prevProvider = getGitProvider()
    })

    afterEach(() => {
      setGitProvider(prevProvider)
    })

    it("isRepoCloned detects existing repos by resolving HEAD", async () => {
      const fs = createTestFs("ensure-isRepoCloned")
      const registry = createRemoteRegistry()
      const git = createTestGitProvider({fs: fs as any, remoteRegistry: registry})
      setGitProvider(git as any)

      const dir = `${rootDir}/cloned/check`
      await mkdirp(fs as any, dir)

      const h = {fs: fs as any, dir, author: {name: "Test", email: "t@example.com"}}
      await initRepo(h, "main")
      await commitFile(h, "/README.md", "hello\n", "init")

      await expect(isRepoCloned(dir)).resolves.toBe(true)
      await expect(isRepoCloned(`${rootDir}/does/not/exist`)).resolves.toBe(false)
    })

    it("ensureRepo clones when not present and calls fetch when already cloned", async () => {
      const remoteFs = createTestFs("ensure-remote-basic")
      const remote = new VirtualGitRemote({
        fs: remoteFs as any,
        dir: "/remote",
        defaultBranch: "main",
        author: {name: "Remote", email: "remote@example.com"},
      })
      await remote.seed({"README.md": "hello\n"}, "init")

      const registry = createRemoteRegistry()
      const url = "https://example.com/owner/repo.git"
      registry.register(url, remote)

      const fs = createTestFs("ensure-local-basic")
      const git = createTestGitProvider({fs: fs as any, remoteRegistry: registry})
      setGitProvider(git as any)

      const cloneSpy = vi.spyOn(git as any, "clone")
      const fetchSpy = vi.spyOn(git as any, "fetch")

      await ensureRepo({host: "example.com", owner: "owner", repo: "repo", branch: "main"}, 1)

      const localDir = `${rootDir}/owner/repo`
      expect(cloneSpy).toHaveBeenCalledTimes(1)
      await expect(isRepoCloned(localDir)).resolves.toBe(true)

      await ensureRepo({host: "example.com", owner: "owner", repo: "repo", branch: "main"}, 1)
      expect(fetchSpy).toHaveBeenCalled()
    })

    it("ensureRepoFromEvent prefers https clone URLs and converts ssh git@ URLs to https", async () => {
      const remoteFs = createTestFs("ensure-remote-ssh")
      const remote = new VirtualGitRemote({
        fs: remoteFs as any,
        dir: "/remote",
        defaultBranch: "main",
        author: {name: "Remote", email: "remote@example.com"},
      })
      await remote.seed({"README.md": "hello\n"}, "init")

      const registry = createRemoteRegistry()
      const httpsUrl = "https://example.com/owner/repo.git"
      registry.register(httpsUrl, remote)

      const fs = createTestFs("ensure-local-ssh")
      const git = createTestGitProvider({fs: fs as any, remoteRegistry: registry})
      setGitProvider(git as any)

      const cloneSpy = vi.spyOn(git as any, "clone")

      const repoEvent: any = {
        repoId: "ignored-by-test",
        clone: ["git@example.com:owner/repo.git"],
      }

      await ensureRepoFromEvent(
        {
          repoEvent,
          repoKey: "owner/repo",
        },
        1,
      )

      expect(cloneSpy).toHaveBeenCalled()
      const lastArgs = cloneSpy.mock.calls[cloneSpy.mock.calls.length - 1]?.[0] as any
      expect(String(lastArgs?.url || "")).toBe(httpsUrl)

      const localDir = `${rootDir}/owner/repo`
      await expect(isRepoCloned(localDir)).resolves.toBe(true)
    })

    it("ensureRepoFromEvent falls back to later clone URLs and discovers their default branch", async () => {
      const remoteFs = createTestFs("ensure-remote-fallback")
      const remote = new VirtualGitRemote({
        fs: remoteFs as any,
        dir: "/remote",
        defaultBranch: "master",
        author: {name: "Remote", email: "remote@example.com"},
      })
      await remote.seed({"README.md": "hello fallback\n"}, "init")

      const registry = createRemoteRegistry()
      const badUrl = "https://bad.example.com/owner/repo.git"
      const goodUrl = "https://example.com/owner/repo.git"
      registry.register(goodUrl, remote)

      const fs = createTestFs("ensure-local-fallback")
      const git = createTestGitProvider({fs: fs as any, remoteRegistry: registry})
      setGitProvider(git as any)

      const cloneSpy = vi.spyOn(git as any, "clone")

      const repoEvent: any = {
        repoId: "fallback-repo",
        clone: [badUrl, goodUrl],
      }

      await ensureRepoFromEvent(
        {
          repoEvent,
          repoKey: "owner/repo",
        },
        1,
      )

      const cloneUrls = cloneSpy.mock.calls.map(call => call[0]?.url)
      expect(cloneUrls).toEqual([badUrl, goodUrl])
      const successfulCloneArgs = cloneSpy.mock.calls[1]?.[0] as any
      expect(successfulCloneArgs.ref).toBe("master")

      const localDir = `${rootDir}/owner/repo`
      await expect(isRepoCloned(localDir)).resolves.toBe(true)
    })

    it("detectDefaultBranch and getDefaultBranch return HEAD symbolic default branch and cache it", async () => {
      const fs = createTestFs("ensure-default-branch")
      const registry = createRemoteRegistry()
      const git = createTestGitProvider({fs: fs as any, remoteRegistry: registry})
      setGitProvider(git as any)

      const repoKey = "default-branch-repo"
      const dir = `${rootDir}/${repoKey}`
      await mkdirp(fs as any, dir)

      const h = {fs: fs as any, dir, author: {name: "Test", email: "t@example.com"}}
      await initRepo(h, "develop")
      await commitFile(h, "/README.md", "hello\n", "init")

      const repoEvent: any = {repoId: "ignored"}

      const detected = await detectDefaultBranch(repoEvent, repoKey)
      expect(detected).toBe("develop")

      const cached1 = await getDefaultBranch(repoEvent, repoKey)
      const cached2 = await getDefaultBranch(repoEvent, repoKey)
      expect(cached1).toBe("develop")
      expect(cached2).toBe("develop")
    })

    it("ensureRepoFromEvent creates local branches from remote tracking refs when clone leaves none (ngit relay scenario)", async () => {
      // This test simulates the ngit relay scenario where shallow clone fetches objects
      // but doesn't create local branch refs. The fix creates local branches from remote tracking refs.
      const remoteFs = createTestFs("ensure-remote-ngit")
      const remote = new VirtualGitRemote({
        fs: remoteFs as any,
        dir: "/remote",
        defaultBranch: "master",
        author: {name: "Remote", email: "remote@example.com"},
      })
      const {initialCommit} = await remote.seed(
        {"README.md": "hello from ngit\n"},
        "initial commit",
      )

      const registry = createRemoteRegistry()
      const httpsUrl = "https://relay.ngit.dev/example/ngit-repo.git"
      registry.register(httpsUrl, remote)

      const localFs = createTestFs("ensure-local-ngit")

      // Create a mock git provider that simulates ngit relay behavior:
      // - clone succeeds but local branch refs are removed (simulating ngit behavior)
      // - remote tracking refs remain under refs/remotes/origin/*
      const baseGit = createTestGitProvider({fs: localFs as any, remoteRegistry: registry})

      let cloneCallCount = 0

      // Create the mock by explicitly binding methods from baseGit
      const mockGit: any = {
        clone: async (args: any) => {
          cloneCallCount++
          // Perform the normal clone
          await baseGit.clone(args)
          // Simulate ngit relay behavior: delete local branch refs but keep remote tracking refs
          const dir = args.dir
          try {
            // Get the OID before deleting the local branch
            const masterOid = await baseGit.resolveRef({dir, ref: 'refs/heads/master'})
            // Create remote tracking ref using git API (simulate what a real ngit clone might leave)
            await baseGit.writeRef({dir, ref: 'refs/remotes/origin/master', value: masterOid, force: true})
            // Delete the local branch ref to simulate ngit relay behavior
            await baseGit.deleteRef({dir, ref: 'refs/heads/master'})
          } catch (err) {
            console.error('Error in mock clone:', err)
          }
        },
        // Forward all other methods to baseGit
        listBranches: (args: any) => baseGit.listBranches(args),
        resolveRef: (args: any) => baseGit.resolveRef(args),
        writeRef: (args: any) => baseGit.writeRef(args),
        fetch: (args: any) => baseGit.fetch(args),
        listRemotes: (args: any) => baseGit.listRemotes(args),
        log: (args: any) => baseGit.log(args),
        deleteRef: (args: any) => baseGit.deleteRef(args),
        listRefs: (args: any) => baseGit.listRefs(args),
        checkout: (args: any) => baseGit.checkout(args),
        readCommit: (args: any) => baseGit.readCommit(args),
      }

      setGitProvider(mockGit as any)

      const repoEvent: any = {
        repoId: "test-ngit-repo",
        clone: [httpsUrl],
      }

      await ensureRepoFromEvent(
        {
          repoEvent,
          repoKey: "ngit/repo",
        },
        1,
      )

      expect(cloneCallCount).toBe(1)

      const localDir = `${rootDir}/ngit/repo`
      await expect(isRepoCloned(localDir)).resolves.toBe(true)

      // Verify that local branches now exist (the fix should have created them)
      const branches = await mockGit.listBranches({dir: localDir})
      expect(branches.length).toBeGreaterThan(0)

      // Verify we can resolve the master branch to a commit
      const masterOid = await mockGit.resolveRef({dir: localDir, ref: "master"})
      expect(masterOid).toBe(initialCommit)
    })
  },
)
