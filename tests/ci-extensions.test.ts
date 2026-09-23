import {execFileSync} from "node:child_process"
import {readFileSync} from "node:fs"
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
  it("uses the public template fork containing the pinned commit", () => {
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

  it.each(["", "true"])("keeps standalone Kanban outside Budabit tests (CI=%s)", async ci => {
    vi.stubEnv("CI", ci)
    const projects = JSON.stringify(await loadProjects())
    expect(projects).not.toContain("budabit-kanban-extension")
    expect(projects).toContain("flotilla-extension-template")
    expect(projects).toContain("budabit-pipelines-extension")
  })

  it("registers only the template as a submodule", () => {
    const paths = execFileSync(
      "git",
      [
        "config",
        "--file",
        fileURLToPath(new URL("../.gitmodules", import.meta.url)),
        "--get-regexp",
        "^submodule\\..*\\.path$",
      ],
      {encoding: "utf8"},
    )
      .trim()
      .split("\n")
    expect(paths).toEqual([
      "submodule.packages/flotilla-extension-template.path packages/flotilla-extension-template",
    ])
    expect(readProjectFile("../pnpm-lock.yaml")).not.toContain("packages/budabit-kanban-extension:")
  })

  it.each(["community-policy-conformance.yml", "e2e-tests.yml", "contributor-bootstrap.yml"])(
    "%s exercises recursive initialization without a Kanban bypass",
    workflow => {
      const source = readProjectFile(`../.github/workflows/${workflow}`)
      expect(source).toMatch(/submodules:\s*recursive/)
      expect(source).not.toMatch(/submodules:\s*false/)
      expect(source).not.toContain("excluding Kanban")
    },
  )
})
