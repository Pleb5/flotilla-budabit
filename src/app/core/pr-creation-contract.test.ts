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

  it("debounces fork input and resets stale source state", () => {
    expect(form).toContain("setTimeout(() =>")
    expect(form).toContain("}, 400)")
    expect(form).toContain('sourceBranch = ""')
    expect(form).toContain("prPreview = null")
  })

  it("waits for linked PR and status publication before success", () => {
    const linked = page.indexOf("await awaitLinkedPublication([publishedPR, publishedStatus])")
    const success = page.indexOf('pushToast({message: "Pull request created"})')

    expect(linked).toBeGreaterThan(-1)
    expect(success).toBeGreaterThan(linked)
  })
})
