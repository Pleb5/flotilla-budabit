import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("PR review consistency", () => {
  const prView = readProjectFile("../components/PRView.svelte")
  const worker = readProjectFile("../../../packages/nostr-git-core/src/worker/worker.ts")

  it("displays computed graph evidence without converting missing evidence to zero", () => {
    expect(prView).toContain('prReviewAheadCount ?? "unknown"')
    expect(prView).toContain('prReviewBehindCount ?? "unknown"')
    expect(prView).toContain("Claimed merge base does not match the local graph")
    expect(prView).toContain("Target drift: {prReviewTargetDrift === null")
  })

  it("reloads stale review data and blocks merge confirmation on target drift", () => {
    expect(prView).toContain("if (prReviewTargetDrift !== true || prChangesLoading) return")
    expect(prView).toContain("targetCommitOid: analysisTarget")
    expect(prView).toContain(
      "...(options.targetCommitOid ? {targetCommitOid: options.targetCommitOid} : {})",
    )
    expect(prView).not.toContain("if (options.preserveAnalysisUntilSuccess) clearPrMergeAnalysis()")
    expect(prView).toContain("The target moved after review data loaded")
  })

  it("does not require the untrusted claimed base object before computing review data", () => {
    expect(worker).not.toContain(
      'return failure("Could not fetch PR diff base objects.", "review")',
    )
    expect(worker).toContain("allowUnrelatedHistoryFallback: false")
  })

  it("loads target-side review evidence only from the declared primary", () => {
    expect(
      prView.match(/cloneUrls: primaryTargetCloneUrl \? \[primaryTargetCloneUrl\] : \[\]/g),
    ).toHaveLength(3)
  })
})
