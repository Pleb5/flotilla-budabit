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

  it("does not report synthetic commits for up-to-date PR analysis", async () => {
    const git = {
      addRemote: vi.fn().mockResolvedValue(undefined),
      deleteRemote: vi.fn().mockResolvedValue(undefined),
      setConfig: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockResolvedValue(undefined),
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
  })
})
