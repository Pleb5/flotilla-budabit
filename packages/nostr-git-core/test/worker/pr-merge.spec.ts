import {describe, it, expect, vi, beforeEach} from "vitest"
import {
  inferProviderFromUrl,
  mergePRAndPushUtil,
  analyzePRMergeUtil,
  type MergePRAndPushOptions,
  type AnalyzePRMergeOptions,
} from "../../src/worker/workers/pr-merge.js"
import type {GitProvider} from "../../src/git/provider.js"

describe("pr-merge", () => {
  const graspRepoUrl =
    "https://pyramid.fiatjaf.com/npub1elta7cneng3w8p9y4dw633qzdjr4kyvaparuyuttyrx6e8xp7xnq32cume/societybuilder.git"

  describe("inferProviderFromUrl", () => {
    it("returns grasp for strict GRASP clone URLs", () => {
      expect(inferProviderFromUrl(graspRepoUrl)).toBe("grasp")
    })

    it("returns github for github.com", () => {
      expect(inferProviderFromUrl("https://github.com/user/repo.git")).toBe("github")
    })

    it("returns github for enterprise GitHub", () => {
      expect(inferProviderFromUrl("https://git.company.github.com/user/repo")).toBe("github")
    })

    it("returns gitlab for gitlab.com", () => {
      expect(inferProviderFromUrl("https://gitlab.com/user/repo.git")).toBe("gitlab")
    })

    it("returns gitlab for enterprise GitLab", () => {
      expect(inferProviderFromUrl("https://gitlab.company.com/user/repo")).toBe("gitlab")
    })

    it("returns undefined for unknown hosts", () => {
      expect(inferProviderFromUrl("https://bitbucket.org/user/repo")).toBeUndefined()
      expect(inferProviderFromUrl("https://relay.ngit.dev/owner/repo.git")).toBeUndefined()
      expect(inferProviderFromUrl("https://sourcehut.org/user/repo")).toBeUndefined()
    })

    it("returns undefined for invalid URLs", () => {
      expect(inferProviderFromUrl("not-a-url")).toBeUndefined()
      expect(inferProviderFromUrl("")).toBeUndefined()
    })

    it("handles ssh URLs via hostname parsing", () => {
      // SSH URLs (git@host:path) are not parseable by URL(); inferProviderFromUrl uses
      // new URL() so they return undefined. Document this as expected behavior.
      const sshGitHub = "ssh://git@github.com/user/repo.git"
      const sshGitLab = "ssh://git@gitlab.com/user/repo.git"
      expect(inferProviderFromUrl(sshGitHub)).toBe("github")
      expect(inferProviderFromUrl(sshGitLab)).toBe("gitlab")
    })
  })

  describe("mergePRAndPushUtil", () => {
    let fetchedTipOid = false

    const mockGit: GitProvider = {
      addRemote: vi.fn().mockResolvedValue(undefined),
      deleteRemote: vi.fn().mockResolvedValue(undefined),
      setConfig: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockImplementation(async ({ref, singleBranch}) => {
        if (ref === "tip-oid-456" && singleBranch === true) {
          fetchedTipOid = true
        }
      }),
      readCommit: vi.fn().mockImplementation(async ({oid}) => {
        if (oid === "tip-oid-456" && fetchedTipOid) {
          return {oid, commit: {message: "tip"}}
        }

        throw new Error(`Missing commit ${oid}`)
      }),
      writeRef: vi.fn().mockResolvedValue(undefined),
      checkout: vi.fn().mockResolvedValue(undefined),
      resolveRef: vi.fn().mockImplementation(({ref}) => {
        if (ref === "main" || ref === "refs/heads/main") return Promise.resolve("target-oid-123")
        if (ref?.startsWith("refs/pr-tip-merge-")) return Promise.resolve("tip-oid-456")
        return Promise.resolve("some-oid")
      }),
      merge: vi.fn().mockResolvedValue({oid: "merge-commit-oid-789"}),
      listRemotes: vi.fn().mockResolvedValue([]),
      deleteRef: vi.fn().mockResolvedValue(undefined),
    } as any

    const baseDeps = {
      rootDir: "/tmp/repos",
      parseRepoId: (id: string) => id.replace(/[^a-zA-Z0-9-_]/g, "-"),
      resolveBranchName: vi.fn().mockResolvedValue("main"),
      ensureFullClone: vi.fn().mockResolvedValue(undefined),
      getAuthCallback: vi.fn().mockReturnValue(undefined),
      pushToRemote: vi.fn().mockResolvedValue({success: true}),
      safePushToRemote: vi.fn().mockResolvedValue({success: true}),
      getTokensForRemote: vi.fn().mockResolvedValue([{token: "fake-token"}]),
    }

    beforeEach(() => {
      vi.clearAllMocks()
      fetchedTipOid = false
    })

    it("returns error when no valid clone URLs after filtering", async () => {
      const result = await mergePRAndPushUtil(
        mockGit,
        {
          repoId: "test-repo",
          cloneUrls: ["nostr://relay.example.com", "", "  "],
          tipCommitOid: "abc123",
        } as MergePRAndPushOptions,
        baseDeps as any,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain("No valid clone URLs")
    })

    it("returns mergeCommitOid and skips push when skipPush is true", async () => {
      const result = await mergePRAndPushUtil(
        mockGit,
        {
          repoId: "test-repo",
          cloneUrls: ["https://github.com/user/repo.git"],
          tipCommitOid: "tip-oid-456",
          targetBranch: "main",
          skipPush: true,
        } as MergePRAndPushOptions,
        baseDeps as any,
      )

      expect(result.success).toBe(true)
      expect(result.mergeCommitOid).toBe("merge-commit-oid-789")
      expect(result.warning).toContain("Push deferred")
      expect(result.pushedRemotes).toEqual([])
      expect(baseDeps.pushToRemote).not.toHaveBeenCalled()
      expect(baseDeps.safePushToRemote).not.toHaveBeenCalled()
    })

    it("returns error when fetch fails from all URLs", async () => {
      const gitWithFailingFetch = {
        ...mockGit,
        fetch: vi.fn().mockRejectedValue(new Error("Fetch failed")),
      } as any

      const result = await mergePRAndPushUtil(
        gitWithFailingFetch,
        {
          repoId: "test-repo",
          cloneUrls: ["https://github.com/user/repo.git"],
          tipCommitOid: "tip-oid",
        } as MergePRAndPushOptions,
        baseDeps as any,
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it("calls resolveBranchName with dir and targetBranch", async () => {
      await mergePRAndPushUtil(
        mockGit,
        {
          repoId: "test-repo",
          cloneUrls: ["https://github.com/user/repo.git"],
          tipCommitOid: "tip-oid",
          targetBranch: "develop",
          skipPush: true,
        } as MergePRAndPushOptions,
        baseDeps as any,
      )

      expect(baseDeps.resolveBranchName).toHaveBeenCalledWith(
        expect.stringContaining("test-repo"),
        "develop",
      )
    })

    it("uses target clone URLs when preparing the target branch", async () => {
      await mergePRAndPushUtil(
        mockGit,
        {
          repoId: "test-repo",
          cloneUrls: ["https://github.com/user/fork.git"],
          targetCloneUrls: ["https://github.com/upstream/repo.git"],
          tipCommitOid: "tip-oid",
          targetBranch: "develop",
          skipPush: true,
        } as MergePRAndPushOptions,
        baseDeps as any,
      )

      expect(baseDeps.ensureFullClone).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: "test-repo",
          cloneUrls: ["https://github.com/upstream/repo.git"],
        }),
      )
    })

    it("fetches the PR tip by commit oid before falling back to branch refs", async () => {
      await mergePRAndPushUtil(
        mockGit,
        {
          repoId: "test-repo",
          cloneUrls: ["https://github.com/user/fork.git"],
          tipCommitOid: "tip-oid-456",
          targetBranch: "main",
          skipPush: true,
        } as MergePRAndPushOptions,
        baseDeps as any,
      )

      expect(mockGit.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: "tip-oid-456",
          singleBranch: true,
        }),
      )
      expect(mockGit.setConfig).not.toHaveBeenCalledWith(
        expect.objectContaining({path: expect.stringContaining("remote.pr-source")}),
      )
    })

    it("falls back to all refs when tip-oid fetch does not make the commit available", async () => {
      const gitWithFallback = {
        ...mockGit,
        fetch: vi
          .fn()
          .mockImplementationOnce(async () => {
            // tip-oid fetch fails to materialize the commit
          })
          .mockImplementationOnce(async () => {
            fetchedTipOid = true
          }),
      } as any

      await mergePRAndPushUtil(
        gitWithFallback,
        {
          repoId: "test-repo",
          cloneUrls: ["https://github.com/user/fork.git"],
          tipCommitOid: "tip-oid-456",
          targetBranch: "main",
          skipPush: true,
        } as MergePRAndPushOptions,
        baseDeps as any,
      )

      expect(gitWithFallback.fetch).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          ref: "tip-oid-456",
          singleBranch: true,
        }),
      )
      expect(gitWithFallback.fetch).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          singleBranch: false,
        }),
      )
    })
  })

  describe("analyzePRMergeUtil", () => {
    let fetchedAnalysisTip = false

    const mockGit: GitProvider = {
      addRemote: vi.fn().mockResolvedValue(undefined),
      deleteRemote: vi.fn().mockResolvedValue(undefined),
      setConfig: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockImplementation(async ({ref, singleBranch}) => {
        if (ref === "tip-oid" && singleBranch === true) {
          fetchedAnalysisTip = true
        }
      }),
      readCommit: vi.fn().mockImplementation(async ({oid}) => {
        if (oid === "tip-oid" && fetchedAnalysisTip) {
          return {oid, commit: {message: "tip"}}
        }

        throw new Error(`Missing commit ${oid}`)
      }),
      writeRef: vi.fn().mockResolvedValue(undefined),
      checkout: vi.fn().mockResolvedValue(undefined),
      branch: vi.fn().mockResolvedValue(undefined),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      deleteRef: vi.fn().mockResolvedValue(undefined),
      log: vi.fn().mockResolvedValue([]),
      resolveRef: vi.fn().mockImplementation(({ref}) => {
        if (ref === "refs/heads/main") return Promise.resolve("target-oid")
        return Promise.resolve("some-oid")
      }),
      merge: vi.fn().mockResolvedValue({oid: "merge-oid"}),
      findMergeBase: vi.fn().mockResolvedValue("base-oid"),
      isDescendent: vi.fn().mockResolvedValue(false),
      listBranches: vi.fn().mockResolvedValue(["main"]),
    } as any

    const baseDeps = {
      rootDir: "/tmp/repos",
      parseRepoId: (id: string) => id.replace(/[^a-zA-Z0-9-_]/g, "-"),
      resolveBranchName: vi.fn().mockResolvedValue("main"),
    }

    beforeEach(() => {
      vi.clearAllMocks()
      fetchedAnalysisTip = false
    })

    it("delegates to analyzePRMergeability and returns result shape", async () => {
      const opts: AnalyzePRMergeOptions = {
        repoId: "30617:npub123/repo",
        prCloneUrls: ["https://github.com/user/fork.git"],
        tipCommitOid: "tip-oid",
        targetBranch: "main",
      }

      const result = await analyzePRMergeUtil(mockGit, opts, baseDeps as any)

      expect(result).toBeDefined()
      expect(typeof result.canMerge).toBe("boolean")
      expect(typeof result.hasConflicts).toBe("boolean")
      expect(Array.isArray(result.conflictFiles)).toBe(true)
      expect(typeof result.analysis).toBe("string")
      expect(Array.isArray(result.patchCommits)).toBe(true)
    })

    it("returns error result when prCloneUrls filter to empty", async () => {
      const result = await analyzePRMergeUtil(
        mockGit,
        {
          repoId: "repo",
          prCloneUrls: ["nostr://relay.example.com", ""],
          tipCommitOid: "tip",
        } as AnalyzePRMergeOptions,
        baseDeps as any,
      )
      expect(result.analysis).toBe("error")
      expect(result.errorMessage).toContain("No valid clone URLs")
    })

    it("fetches the PR source by tip commit oid during analysis", async () => {
      await analyzePRMergeUtil(
        mockGit,
        {
          repoId: "repo",
          prCloneUrls: ["https://github.com/user/fork.git"],
          targetCloneUrls: ["https://github.com/upstream/repo.git"],
          tipCommitOid: "tip-oid",
          targetBranch: "main",
        } as AnalyzePRMergeOptions,
        baseDeps as any,
      )

      expect(mockGit.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: "tip-oid",
          singleBranch: true,
        }),
      )
    })

    it("returns conflicts when fallback merge reports conflict filepaths", async () => {
      const gitWithFallbackConflict = {
        ...mockGit,
        merge: vi
          .fn()
          .mockRejectedValueOnce(new Error("Automatic merge failed"))
          .mockRejectedValueOnce(
            Object.assign(new Error("Automatic merge failed with conflicts"), {
              name: "MergeConflictError",
              data: {filepaths: ["src/conflicted.ts"]},
            }),
          ),
        statusMatrix: vi.fn().mockResolvedValue([]),
      } as any

      const result = await analyzePRMergeUtil(
        gitWithFallbackConflict,
        {
          repoId: "repo",
          prCloneUrls: ["https://github.com/user/fork.git"],
          targetCloneUrls: ["https://github.com/upstream/repo.git"],
          tipCommitOid: "tip-oid",
          targetBranch: "main",
        } as AnalyzePRMergeOptions,
        baseDeps as any,
      )

      expect(result.analysis).toBe("conflicts")
      expect(result.hasConflicts).toBe(true)
      expect(result.conflictFiles).toEqual(["src/conflicted.ts"])
      expect(gitWithFallbackConflict.merge).toHaveBeenCalledTimes(2)
    })

    it("returns conflicts when initial merge reports conflict filepaths", async () => {
      const gitWithInitialConflict = {
        ...mockGit,
        merge: vi.fn().mockRejectedValueOnce(
          Object.assign(new Error("Automatic merge failed with conflicts"), {
            name: "MergeConflictError",
            data: {filepaths: ["src/direct-conflict.ts"]},
          }),
        ),
        statusMatrix: vi.fn().mockResolvedValue([]),
      } as any

      const result = await analyzePRMergeUtil(
        gitWithInitialConflict,
        {
          repoId: "repo",
          prCloneUrls: ["https://github.com/user/fork.git"],
          targetCloneUrls: ["https://github.com/upstream/repo.git"],
          tipCommitOid: "tip-oid",
          targetBranch: "main",
        } as AnalyzePRMergeOptions,
        baseDeps as any,
      )

      expect(result.analysis).toBe("conflicts")
      expect(result.hasConflicts).toBe(true)
      expect(result.conflictFiles).toEqual(["src/direct-conflict.ts"])
      expect(gitWithInitialConflict.merge).toHaveBeenCalledTimes(1)
      expect(gitWithInitialConflict.statusMatrix).not.toHaveBeenCalled()
    })
  })
})
