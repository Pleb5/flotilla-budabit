import {describe, expect, it, vi} from "vitest"
import {analyzePRMergeability, getPRReviewData} from "../../src/git/merge-analysis.js"
import type {GitProvider} from "../../src/git/provider.js"

describe("merge analysis", () => {
  const tipOid = "1".repeat(40)
  const targetOid = "2".repeat(40)

  it("uses the target commit as review diff base when histories are unrelated", async () => {
    const git = {
      findMergeBase: vi.fn().mockResolvedValue([]),
      log: vi.fn().mockResolvedValue([
        {
          oid: tipOid,
          commit: {
            message: "orphan change",
            author: {name: "Contributor", email: "contributor@example.com"},
            parent: [],
          },
        },
      ]),
    } as unknown as GitProvider

    const result = await getPRReviewData(git, "/repo", {
      tipCommitOid: tipOid,
      targetCommitOid: targetOid,
    })

    expect(result.success).toBe(true)
    expect(result.baseOid).toBe(targetOid)
    expect(result.headOid).toBe(tipOid)
    expect(result.mergeBase).toBeUndefined()
    expect(result.unrelatedHistory).toBe(true)
    expect(result.warning).toContain("No common history")
    expect(result.commitOids).toEqual([tipOid])
  })

  it("can defer unrelated-history review fallback for a deeper fetch attempt", async () => {
    const git = {
      findMergeBase: vi.fn().mockResolvedValue([]),
      log: vi.fn(),
    } as unknown as GitProvider

    const result = await getPRReviewData(git, "/repo", {
      tipCommitOid: tipOid,
      targetCommitOid: targetOid,
      allowUnrelatedHistoryFallback: false,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("Unable to resolve a PR diff base.")
    expect(result.headOid).toBe(tipOid)
    expect(result.targetCommit).toBe(targetOid)
    expect((git as any).log).not.toHaveBeenCalled()
  })

  it("uses the computed merge base and reports a mismatched claimed base", async () => {
    const claimedOid = "3".repeat(40)
    const git = {
      findMergeBase: vi.fn().mockResolvedValue([targetOid]),
      log: vi.fn(async ({ref}: {ref: string}) =>
        ref === tipOid
          ? [
              {oid: tipOid, commit: {message: "change", parent: [targetOid]}},
              {oid: targetOid, commit: {message: "base", parent: []}},
            ]
          : [{oid: targetOid, commit: {message: "base", parent: []}}],
      ),
    } as unknown as GitProvider

    const result = await getPRReviewData(git, "/repo", {
      tipCommitOid: tipOid,
      targetCommitOid: targetOid,
      mergeBase: claimedOid,
    })

    expect(result.baseOid).toBe(targetOid)
    expect(result.claimedMergeBaseMismatch).toBe(true)
    expect(result.aheadCount).toBe(1)
    expect(result.behindCount).toBe(0)
  })

  it("counts every reachable source commit when log order encounters the base early", async () => {
    const sideOid = "4".repeat(40)
    const git = {
      findMergeBase: vi.fn().mockResolvedValue([targetOid]),
      log: vi.fn(async ({ref}: {ref: string}) =>
        ref === tipOid
          ? [
              {oid: tipOid, commit: {message: "merge", parent: [targetOid, sideOid]}},
              {oid: targetOid, commit: {message: "base", parent: []}},
              {oid: sideOid, commit: {message: "side", parent: [targetOid]}},
            ]
          : [{oid: targetOid, commit: {message: "base", parent: []}}],
      ),
    } as unknown as GitProvider

    const result = await getPRReviewData(git, "/repo", {
      tipCommitOid: tipOid,
      targetCommitOid: targetOid,
    })

    expect(result.aheadCount).toBe(2)
    expect(result.commitOids).toEqual([tipOid, sideOid])
  })

  it("excludes commits reachable from the target side of a merge DAG", async () => {
    const baseOid = "3".repeat(40)
    const sourceOnlyOid = "4".repeat(40)
    const git = {
      findMergeBase: vi.fn().mockResolvedValue([baseOid]),
      log: vi.fn(async ({ref}: {ref: string}) =>
        ref === tipOid
          ? [
              {oid: tipOid, commit: {message: "merge", parent: [targetOid, sourceOnlyOid]}},
              {oid: targetOid, commit: {message: "target", parent: [baseOid]}},
              {oid: sourceOnlyOid, commit: {message: "source", parent: [baseOid]}},
              {oid: baseOid, commit: {message: "base", parent: []}},
            ]
          : [
              {oid: targetOid, commit: {message: "target", parent: [baseOid]}},
              {oid: baseOid, commit: {message: "base", parent: []}},
            ],
      ),
    } as unknown as GitProvider

    const result = await getPRReviewData(git, "/repo", {
      tipCommitOid: tipOid,
      targetCommitOid: targetOid,
    })

    expect(result.commitOids).toEqual([tipOid, sourceOnlyOid])
    expect(result.aheadCount).toBe(2)
    expect(result.behindCount).toBe(0)
  })

  it("does not report synthetic commits for up-to-date PR analysis", async () => {
    const git = {
      addRemote: vi.fn().mockResolvedValue(undefined),
      deleteRemote: vi.fn().mockResolvedValue(undefined),
      setConfig: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(async ({ref}: {ref?: string}) => ({fetchHead: ref || null})),
      readCommit: vi.fn().mockImplementation(async ({oid}) => {
        if (oid === tipOid) {
          return {oid, commit: {message: "already merged", parent: []}}
        }
        throw new Error(`Missing commit ${oid}`)
      }),
      resolveRef: vi.fn().mockImplementation(async ({ref}) => {
        if (ref === "refs/heads/main") return targetOid
        throw new Error(`Missing ref ${ref}`)
      }),
      isDescendent: vi.fn().mockResolvedValue(true),
      log: vi.fn().mockResolvedValue([]),
      listBranches: vi.fn().mockResolvedValue(["main"]),
    } as unknown as GitProvider

    const result = await analyzePRMergeability(git, "/repo", {
      cloneUrls: ["https://github.com/contributor/repo.git"],
      tipCommitOid: tipOid,
      targetBranch: "main",
    })

    expect(result.analysis).toBe("up-to-date")
    expect(result.upToDate).toBe(true)
    expect(result.patchCommits).toEqual([])
    expect(result.prCommits).toEqual([])
    expect(result.sourceAttempts).toEqual([
      expect.objectContaining({
        url: "https://github.com/contributor/repo.git",
        success: true,
      }),
    ])
  })

  it("refuses analysis before remote or ref mutation when the working tree is dirty", async () => {
    const git = {
      statusMatrix: vi.fn().mockResolvedValue([["README.md", 1, 2, 1]]),
      addRemote: vi.fn(),
      branch: vi.fn(),
      writeRef: vi.fn(),
    } as unknown as GitProvider

    const result = await analyzePRMergeability(git, "/repo", {
      cloneUrls: ["https://github.com/contributor/repo.git"],
      targetCloneUrls: ["https://github.com/upstream/repo.git"],
      tipCommitOid: tipOid,
      targetBranch: "main",
      strictTargetFresh: true,
    })

    expect(result.analysis).toBe("error")
    expect(result.errorMessage).toBe("Merge analysis requires a clean working tree.")
    expect((git as any).addRemote).not.toHaveBeenCalled()
    expect((git as any).branch).not.toHaveBeenCalled()
    expect((git as any).writeRef).not.toHaveBeenCalled()
  })

  it("does not accept a stale global FETCH_HEAD for a scoped target fetch", async () => {
    const git = {
      statusMatrix: vi.fn().mockResolvedValue([]),
      addRemote: vi.fn().mockResolvedValue(undefined),
      deleteRemote: vi.fn().mockResolvedValue(undefined),
      setConfig: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockResolvedValue(undefined),
      resolveRef: vi.fn(async ({ref}: {ref: string}) => {
        if (ref === "FETCH_HEAD") return targetOid
        throw new Error(`Missing ref ${ref}`)
      }),
      branch: vi.fn(),
    } as unknown as GitProvider

    const result = await analyzePRMergeability(git, "/repo", {
      cloneUrls: ["https://github.com/contributor/repo.git"],
      targetCloneUrls: ["https://github.com/upstream/repo.git"],
      tipCommitOid: tipOid,
      targetBranch: "main",
      strictTargetFresh: true,
    })

    expect(result.analysis).toBe("error")
    expect(result.errorMessage).toContain("no target commit could be resolved")
    expect((git as any).resolveRef).not.toHaveBeenCalledWith(
      expect.objectContaining({ref: "FETCH_HEAD"}),
    )
    expect((git as any).branch).not.toHaveBeenCalled()
  })
})
