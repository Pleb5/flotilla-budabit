import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"
import {IMPORT_REPO_ENABLED} from "./feature-flags"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("retired history importer", () => {
  it.each(["development", "production"])("cannot be enabled in %s", mode => {
    const config = readProjectFile("../../../vite.config.ts")
    const expression = config.match(/__IMPORT_REPO__:\s*([^\n]+),/)?.[1]
    expect(expression).toBe("JSON.stringify(false)")
    for (const flag of [undefined, "0", "1"]) {
      const value = new Function("process", `return ${expression}`)({
        env: {NODE_ENV: mode, FEATURE_IMPORT_REPO: flag},
      })
      expect(value).toBe("false")
    }
    expect(IMPORT_REPO_ENABLED).toBe(false)
  })

  it("has no app handler, dialog wiring or wizard shortcut", () => {
    const page = readProjectFile("../../routes/git/+page.svelte")
    const wizard = readProjectFile(
      "../../../packages/nostr-git-ui/src/lib/components/git/NewRepoWizard.svelte",
    )
    for (const name of ["InitialImportDialog", "onImportRepo", "onImportSource", "Import Repo"]) {
      expect(page).not.toContain(name)
    }
    expect(wizard).not.toContain("onImportSource")
    expect(wizard).not.toContain("Create from GitHub")
  })
})
