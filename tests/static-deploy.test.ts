import {execFile} from "node:child_process"
import {mkdtemp, mkdir, readFile, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {afterEach, describe, expect, it} from "vitest"

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const deployScript = path.join(projectRoot, "scripts/deploy-static-lftp.sh")
const temporaryDirectories: string[] = []

const makeTemporaryDirectory = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "budabit-atomic-deploy-"))
  temporaryDirectories.push(directory)
  return directory
}

const write = async (root: string, relativePath: string, content: string) => {
  const target = path.join(root, relativePath)
  await mkdir(path.dirname(target), {recursive: true})
  await writeFile(target, content)
}

describe("ordered static deployment", () => {
  afterEach(async () => {
    const {rm} = await import("node:fs/promises")
    await Promise.all(
      temporaryDirectories.splice(0).map(directory => rm(directory, {recursive: true})),
    )
  })

  it("publishes immutable, supporting files, worker, shell, then marker", async () => {
    const root = await makeTemporaryDirectory()
    const build = path.join(root, "build")
    const remote = path.join(root, "remote")
    const trace = path.join(root, "deploy.trace")

    await write(build, "_app/immutable/b.js", "build-b")
    await write(build, "_app/version.json", '{"version":"b"}\n')
    await write(build, "service-worker.js", "worker-b")
    await write(build, "index.html", "shell-b")
    await write(build, "manifest.webmanifest", "manifest-b")
    await write(remote, "_app/immutable/a.js", "build-a")
    await write(remote, "_app/version.json", '{"version":"a"}\n')
    await write(remote, "service-worker.js", "worker-a")
    await write(remote, "index.html", "shell-a")
    await write(remote, "obsolete.txt", "remove-me")

    await execFileAsync(deployScript, ["--local-remote", remote], {
      cwd: projectRoot,
      env: {
        ...process.env,
        BUDABIT_BUILD_DIR: build,
        BUDABIT_DEPLOY_CONFIG: "/dev/null",
        BUDABIT_DEPLOY_TRACE_FILE: trace,
      },
    })

    await expect(readFile(path.join(remote, "_app/immutable/a.js"), "utf8")).resolves.toBe(
      "build-a",
    )
    await expect(readFile(path.join(remote, "_app/immutable/b.js"), "utf8")).resolves.toBe(
      "build-b",
    )
    await expect(readFile(path.join(remote, "service-worker.js"), "utf8")).resolves.toBe("worker-b")
    await expect(readFile(path.join(remote, "index.html"), "utf8")).resolves.toBe("shell-b")
    await expect(readFile(path.join(remote, "_app/version.json"), "utf8")).resolves.toContain('"b"')
    await expect(readFile(path.join(remote, "obsolete.txt"), "utf8")).rejects.toThrow()

    const traceLines = (await readFile(trace, "utf8")).trim().split("\n")
    expect(traceLines).toEqual([
      "pass0 immutable start",
      "pass0 immutable done",
      "pass1 invalidate marker start",
      'pass1 after version={"version":"","status":"deploying"}',
      "pass1 invalidate marker done",
      "pass2 supporting mutable start",
      'pass2 before version={"version":"","status":"deploying"}',
      'pass2 after version={"version":"","status":"deploying"}',
      "pass2 supporting mutable done",
      "pass3 service worker start",
      "pass3 service worker done",
      "pass4 app shell start",
      "pass4 app shell done",
      "pass5 version start",
      'pass5 after version={"version":"b"}',
      "pass5 version done",
    ])
  })

  it("emits the same ordering for the real lftp path", async () => {
    const root = await makeTemporaryDirectory()
    const build = path.join(root, "build")

    await write(build, "_app/immutable/b.js", "build-b")
    await write(build, "_app/version.json", '{"version":"b"}\n')
    await write(build, "service-worker.js", "worker-b")
    await write(build, "index.html", "shell-b")

    const {stdout} = await execFileAsync(deployScript, ["--dry-run"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        BUDABIT_BUILD_DIR: build,
        BUDABIT_DEPLOY_CONFIG: "/dev/null",
        BUDABIT_SFTP_HOST: "sftp://example.test",
        BUDABIT_SFTP_USER: "tester",
      },
    })

    const immutable = stdout.indexOf("mirror -R")
    const mutable = stdout.indexOf("mirror -R", immutable + 1)
    const worker = stdout.indexOf('"service-worker.js"', mutable)
    const shell = stdout.indexOf('"index.html"', worker)
    const marker = stdout.indexOf('"_app/version.json"', shell)

    expect(immutable).toBeGreaterThan(-1)
    expect(mutable).toBeGreaterThan(immutable)
    expect(worker).toBeGreaterThan(mutable)
    expect(shell).toBeGreaterThan(worker)
    expect(marker).toBeGreaterThan(shell)
    expect(stdout).toContain("-x '^service-worker\\.js$'")
    expect(stdout).toContain("-x '^index\\.html$'")
    expect(stdout).not.toContain(".budabit-rename-probe")
    expect(stdout.indexOf("# Pass 0:")).toBeLessThan(immutable)
    expect(stdout.indexOf("# Pass 1:")).toBeGreaterThan(immutable)
    expect(stdout.indexOf("# Pass 1:")).toBeLessThan(mutable)
    expect(stdout.match(/\.budabit-upload/g)).toHaveLength(12)
    expect(stdout.match(/^put ".+" -o ".+"$/gm)).toHaveLength(4)
    expect(stdout).not.toMatch(/^put -o /m)
    expect(stdout.match(/^mv /gm)).toHaveLength(4)
    expect(stdout).not.toContain("--delete-excluded")
  })
})
