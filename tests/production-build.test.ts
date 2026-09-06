import {spawnSync} from "node:child_process"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {afterEach, describe, expect, it} from "vitest"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const productionBuildScript = path.join(projectRoot, "build-in-production.sh")
const temporaryDirectories: string[] = []

const runProductionBuild = async (failAt = "") => {
  const root = await mkdtemp(path.join(os.tmpdir(), "budabit-production-build-"))
  temporaryDirectories.push(root)
  const bin = path.join(root, "bin")
  await mkdir(bin)

  await Promise.all([
    writeFile(
      path.join(bin, "git"),
      `#!/usr/bin/env bash
case "$*" in
  "rev-parse --is-shallow-repository") echo false ;;
  "rev-parse --short HEAD") echo test-build ;;
esac
`,
      {mode: 0o755},
    ),
    writeFile(
      path.join(bin, "pnpm"),
      `#!/usr/bin/env bash
echo "pnpm $* sharp=$SHARP_IGNORE_GLOBAL_LIBVIPS"
if [[ "$*" == "$FAIL_AT" ]]; then
  exit 23
fi
`,
      {mode: 0o755},
    ),
    writeFile(path.join(root, "build.sh"), '#!/usr/bin/env bash\necho "app build"\n', {
      mode: 0o755,
    }),
  ])

  return spawnSync("bash", [productionBuildScript], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      SHARP_IGNORE_GLOBAL_LIBVIPS: "",
      FAIL_AT: failAt,
      RENDER_GIT_COMMIT: "test-build",
    },
    encoding: "utf8",
    timeout: 10_000,
  })
}

describe("production build dependency setup", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map(directory => rm(directory, {recursive: true})),
    )
  })

  it("ignores system libvips during installation and rebuild before building the app", async () => {
    const result = await runProductionBuild()

    expect(result.status).toBe(0)
    expect(result.stdout.trim().split("\n")).toEqual([
      "pnpm i sharp=1",
      "pnpm rebuild sharp=1",
      "app build",
    ])
  })

  it.each(["i", "rebuild"])("stops the build when pnpm %s fails", async stage => {
    const result = await runProductionBuild(stage)

    expect(result.status).toBe(23)
    expect(result.stdout).not.toContain("app build")
    if (stage === "i") {
      expect(result.stdout).not.toContain("pnpm rebuild")
    }
  })
})
