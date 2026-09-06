import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("PR review consistency", () => {
  const prView = readProjectFile("../components/PRView.svelte")
  const worker = readProjectFile("../../../packages/nostr-git-core/src/worker/worker.ts")
  const newPrForm = readProjectFile(
    "../../../packages/nostr-git-ui/src/lib/components/git/NewPRForm.svelte",
  )

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

  it("renders an OID-pinned submitted diff without waiting for current-target ancestry", () => {
    expect(prView).toContain('beginPrReviewOperations(["diff", "commits"] as const)')
    expect(prView).toContain(
      "loadSubmittedPrDiff(submittedBaseOid, submittedHeadOid, currentGen, operations.diff)",
    )
    expect(prView).toContain("getPRSubmittedCommits({")
    expect(prView).toContain("cloneUrls: prSourceReadCloneUrls")
    expect(prView).toContain('"Submitted base (unverified)"')
    expect(worker).toContain("targetUrls: []")
    expect(worker).toContain("targetCommitOid: params.baseCommitOid")
    expect(worker).toContain("includeDiff: false")
  })

  it("routes normal target review reads through the declared list while pinning authority checks", () => {
    expect(prView.match(/cloneUrls: prTargetCloneUrls/g)).toHaveLength(4)
    expect(prView).toContain(
      "const targetCloneUrls = primaryTargetCloneUrl ? [primaryTargetCloneUrl] : []",
    )
    expect(prView).toContain("targetCloneUrls: [primaryTargetCloneUrl]")
  })

  it("keeps fork-source routing separate from the target repository cursor", () => {
    expect(prView).not.toContain("prFetchCloneUrls")
    expect(prView).toContain("return `pr-source:${sourceEventId}`")
    expect(prView).toContain('role === "source"')
    expect(prView).toContain('if (role === "target" && result?.usedUrl)')
    expect(prView).toContain("sourceReadScope: prSourceReadScope")
    expect(prView).toContain("...(route.readScope ? {readScope: route.readScope} : {})")
    expect(newPrForm).toContain("`pr-source:new:${JSON.stringify(sourceUrls)}`")
    expect(newPrForm).toContain("sourceReadScope,")
  })

  it("cancels obsolete PR review work while retaining generation guards", () => {
    expect(prView).toContain("const beginPrReviewOperations = <T extends string>")
    expect(prView).toContain("workerManager.cancelGitNaturalRead(operationId)")
    expect(prView).toContain("cancelGitNaturalRead(operationId)")
    expect(prView).toContain("finishPrReviewOperation(operationId)")
    expect(prView).toContain("if (prChangesGeneration !== currentGen) return")
    expect(prView).toContain("cancelActivePrReviewOperation()")
    expect(prView).toContain("onDestroy(() => {")
    expect(prView).toContain("untrack(() => void loadPrChanges())")
    expect(prView).not.toContain("untrack(() => void loadPrChanges())\n    return () =>")
  })
})
