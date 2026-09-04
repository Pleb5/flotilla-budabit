import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("import repository feature flag", () => {
  it("is disabled unless explicitly enabled", () => {
    const viteConfig = readProjectFile("../../../vite.config.ts")
    const envExample = readProjectFile("../../../.env.example")

    expect(viteConfig).toContain(
      '__IMPORT_REPO__: JSON.stringify(process.env.FEATURE_IMPORT_REPO === "1")',
    )
    expect(envExample).toContain("FEATURE_IMPORT_REPO=0")
  })

  it("hides entry points and blocks the import handler when disabled", () => {
    const flags = readProjectFile("./feature-flags.ts")
    const gitPage = readProjectFile("../../routes/git/+page.svelte")

    expect(flags).toContain("export const IMPORT_REPO_ENABLED = __IMPORT_REPO__")
    expect(gitPage).toContain("if (!IMPORT_REPO_ENABLED) return")
    expect(gitPage.match(/{#if IMPORT_REPO_ENABLED}/g)).toHaveLength(2)
  })
})
