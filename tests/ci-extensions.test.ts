import {execFileSync} from "node:child_process"
import {existsSync, readFileSync, realpathSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))
const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("self-contained extension workspaces", () => {
  it("checks out all package sources without Git submodules", () => {
    expect(existsSync(new URL("../.gitmodules", import.meta.url))).toBe(false)
    const index = execFileSync("git", ["ls-files", "--stage"], {cwd: root, encoding: "utf8"})
    expect(index).not.toMatch(/^160000 /m)
    for (const name of [
      "budabit-releases-extension",
      "budabit-pipelines-extension",
      "flotilla-extension-template",
      "nostr-git-core",
      "nostr-git-ui",
      "welshman",
    ]) {
      expect(existsSync(new URL(`../packages/${name}/package.json`, import.meta.url))).toBe(true)
      expect(existsSync(new URL(`../packages/${name}/.git`, import.meta.url))).toBe(false)
    }
  })

  it("discovers extension children through the root workspace, excluding scaffold fixtures", () => {
    const packages = JSON.parse(
      execFileSync("pnpm", ["list", "--recursive", "--depth=-1", "--json"], {
        cwd: root,
        encoding: "utf8",
      }),
    ) as {name: string; path: string}[]
    const names = packages.map(pkg => pkg.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "budabit-releases-extension",
        "@budabit-releases-extension/iframe",
        "budabit-pipelines-extension",
        "@flotilla/ext-iframe",
        "@flotilla/ext-manifest",
        "budabit-extension-template",
        "@budabit/ext-iframe",
        "budabit-sdk",
        "create-budabit-widget",
      ]),
    )
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain("budabit-kanban-extension")
    expect(packages.some(pkg => pkg.path.includes("create-budabit-widget/template/"))).toBe(false)
  })

  it("links Releases and Pipelines to the in-tree SDK", () => {
    const sdk = realpathSync(
      new URL("../packages/flotilla-extension-template/packages/sdk", import.meta.url),
    )
    for (const name of ["budabit-releases-extension", "budabit-pipelines-extension"]) {
      const consumer = new URL(`../packages/${name}/packages/iframe-app/`, import.meta.url)
      expect(realpathSync(new URL("node_modules/budabit-sdk", consumer))).toBe(sdk)
      const workspace = new URL(`../packages/${name}/`, import.meta.url)
      expect(existsSync(new URL("pnpm-workspace.yaml", workspace))).toBe(false)
      expect(existsSync(new URL("pnpm-lock.yaml", workspace))).toBe(false)
    }
  })

  it("registers widget and SDK tests rather than obsolete shared-package paths", async () => {
    const {default: config} = await import("../vitest.config")
    const projects = JSON.stringify(config.test?.projects)
    expect(projects).toContain("budabit-releases-extension")
    expect(projects).toContain("budabit-pipelines-extension")
    expect(projects).toContain("flotilla-extension-template")
    expect(projects).toContain("budabit-sdk")
    expect(projects).not.toContain("budabit-kanban-extension")
  })

  it.each([
    "community-policy-conformance.yml",
    "e2e-tests.yml",
    "contributor-bootstrap.yml",
    "docker-publish.yml",
  ])("%s uses an ordinary checkout", workflow => {
    const source = readProjectFile(`../.github/workflows/${workflow}`)
    expect(source).not.toMatch(/submodules:\s*(recursive|true)/)
    expect(source).not.toContain("git submodule update")
  })
})
