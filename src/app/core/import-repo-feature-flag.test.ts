import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("import repository feature flag", () => {
  it("enables the narrowed initial-import lane with an explicit disable switch", () => {
    const viteConfig = readProjectFile("../../../vite.config.ts")
    const envExample = readProjectFile("../../../.env.example")

    expect(viteConfig).toContain(
      '__IMPORT_REPO__: JSON.stringify(process.env.FEATURE_IMPORT_REPO !== "0")',
    )
    expect(envExample).toContain("FEATURE_IMPORT_REPO=1")
  })

  it("uses the new lane without rollback, synthetic profiles or shared-worker termination", () => {
    const page = readProjectFile("../../routes/git/+page.svelte")
    const handler = page.slice(page.indexOf("const onImportRepo ="), page.indexOf("</script>"))
    expect(handler).toContain("InitialImportDialog")
    expect(handler).toContain("createInitialImportGit(workerApi)")
    expect(handler).toContain("publishLocally: false")
    expect(handler).toContain("assertActor(event.pubkey)")
    expect(handler).not.toContain("terminateGitWorker")
    expect(handler).not.toContain("onRollback")
    expect(handler).not.toContain("deleteExactRepoEvent")
    expect(page).toContain("onImportSource: IMPORT_REPO_ENABLED")
  })

  it("hides entry points and blocks the import handler when disabled", () => {
    const flags = readProjectFile("./feature-flags.ts")
    const gitPage = readProjectFile("../../routes/git/+page.svelte")

    expect(flags).toContain("export const IMPORT_REPO_ENABLED = __IMPORT_REPO__")
    expect(gitPage).toContain("if (!IMPORT_REPO_ENABLED) return")
    expect(gitPage.match(/{#if IMPORT_REPO_ENABLED}/g)).toHaveLength(2)
  })
})
