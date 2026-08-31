import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("pull request creation contract", () => {
  const form = readProjectFile(
    "../../../packages/nostr-git-ui/src/lib/components/git/NewPRForm.svelte",
  )
  const worker = readProjectFile("../../../packages/nostr-git-core/src/worker/worker.ts")
  const page = readProjectFile("../../routes/git/[id=naddr]/prs/+page.svelte")
  const prView = readProjectFile("../components/PRView.svelte")

  it("emits distinct source and target branch tags", () => {
    expect(form).toContain("branchName: result.data.sourceBranch")
    expect(form).toContain("targetBranch: result.data.targetBranch")
  })

  it("falls back to the repository default when target-branch is absent", () => {
    expect(prView).toContain('pr?.targetBranch ?? repoClass?.mainBranch ?? "main"')
    expect(prView).not.toContain("pr?.targetBranch ?? repoClass?.selectedBranch")
  })

  it("publishes only clone URLs verified by the preview", () => {
    expect(form).toContain("const urls = prPreview?.verifiedCloneUrls ?? []")
    expect(worker).toContain("verifiedCloneUrls: [source.usedUrl.trim()]")
    expect(worker).toContain("result.success && verifiedSourceUrl ? [verifiedSourceUrl] : []")
  })

  it("uses one validated input per fork clone URL", () => {
    expect(form).toContain("{#each forkCloneUrls as cloneUrl, index (index)}")
    expect(form).toContain("validateForkCloneUrls(values)")
    expect(form).toContain("Add clone URL")
    expect(form).not.toContain("Clone URL(s), one per line")
  })

  it("invalidates stale fork requests immediately while debouncing replacement work", () => {
    expect(form).toContain("forkInputRevision += 1")
    expect(form).toContain("requestRevision !== forkInputRevision")
    expect(form).toContain("setTimeout(() =>")
    expect(form).toContain("}, 400)")
    expect(form).toContain('sourceBranch = ""')
    expect(form).toContain("prPreview = null")
  })

  it("uses durable sequenced publication and exact-stage retry", () => {
    expect(page).toContain("startLinkedPublication({")
    expect(page).toContain("rootId: primaryEvent.id")
    expect(page).toContain("retry: () => retryPublication(operation.operationId)")
    expect(page).not.toContain("awaitLinkedPublication")
    expect(form).toContain("await finishPublication(publicationOperation.retry())")
    expect(form).toContain("Retry publication")
  })
})
