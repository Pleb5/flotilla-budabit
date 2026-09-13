import {execFileSync} from "node:child_process"
import {existsSync, readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {afterEach, describe, expect, it, vi} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const loadProjects = async () => {
  vi.resetModules()
  const {default: config} = await import("../vitest.config")
  return config.test?.projects
}

afterEach(() => vi.unstubAllEnvs())

describe("CI extension isolation", () => {
  it("fetches the template from the fork containing the pinned commit", () => {
    const remote = execFileSync(
      "git",
      [
        "config",
        "--file",
        fileURLToPath(new URL("../.gitmodules", import.meta.url)),
        "--get",
        "submodule.packages/flotilla-extension-template.url",
      ],
      {encoding: "utf8"},
    ).trim()
    expect(remote).toBe("https://github.com/Pleb5/flotilla-extension-template.git")
  })

  it("never loads the Kanban project in CI, even when installed locally", async () => {
    vi.stubEnv("CI", "true")
    const projects = JSON.stringify(await loadProjects())
    expect(projects).not.toContain("budabit-kanban-extension")
    expect(projects).toContain("flotilla-extension-template")
    expect(projects).toContain("budabit-pipelines-extension")
  })

  it("retains optional local Kanban tests only when the submodule is present", async () => {
    vi.stubEnv("CI", "")
    const installed = existsSync(
      new URL("../packages/budabit-kanban-extension/vitest.config.ts", import.meta.url),
    )
    expect(JSON.stringify(await loadProjects()).includes("budabit-kanban-extension")).toBe(
      installed,
    )
  })

  it.each(["community-policy-conformance.yml", "e2e-tests.yml"])(
    "%s checks out the template without initializing Kanban",
    workflow => {
      const source = readProjectFile(`../.github/workflows/${workflow}`)
      expect(source).not.toMatch(/submodules:\s*(recursive|true)/)
      const checkouts = source.match(/submodules: false/g) || []
      const updates = source.match(/run: git submodule update[^\n]*/g) || []
      expect(checkouts.length).toBeGreaterThan(0)
      expect(updates).toHaveLength(checkouts.length)
      for (const update of updates) {
        expect(update).toBe(
          "run: git submodule update --init --recursive -- packages/flotilla-extension-template",
        )
      }
    },
  )
})
