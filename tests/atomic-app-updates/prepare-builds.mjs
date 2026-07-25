import {execFile} from "node:child_process"
import {cp, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const outputRoot = path.join(projectRoot, "test-results/atomic-app-updates")
const buildOutput = path.join(projectRoot, "build")

const build = async buildId => {
  await execFileAsync("./build.sh", [], {
    cwd: projectRoot,
    env: {...process.env, VITE_BUILD_HASH: buildId, VITE_BUILD_ID: buildId},
    maxBuffer: 20 * 1024 * 1024,
  })

  const destination = path.join(outputRoot, `build-${buildId}`)
  await cp(buildOutput, destination, {recursive: true})
  return destination
}

const listFiles = async (root, relative = "") => {
  const directory = path.join(root, relative)
  const entries = await readdir(directory, {withFileTypes: true})
  const files = []

  for (const entry of entries) {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(root, child)))
    if (entry.isFile()) files.push(child.split(path.sep).join("/"))
  }

  return files
}

await rm(outputRoot, {recursive: true, force: true})
await mkdir(outputRoot, {recursive: true})

const buildA = await build("atomic-a")
const buildB = await build("atomic-b")
const remote = path.join(outputRoot, "remote")
await cp(buildA, remote, {recursive: true})

const filesA = new Set(await listFiles(path.join(buildA, "_app/immutable")))
const filesB = await listFiles(path.join(buildB, "_app/immutable"))
const failingAsset = filesB.find(file => !filesA.has(file))
if (!failingAsset) throw new Error("Atomic test builds did not produce a B-only immutable asset")

const versionA = JSON.parse(await readFile(path.join(buildA, "_app/version.json"), "utf8"))
const versionB = JSON.parse(await readFile(path.join(buildB, "_app/version.json"), "utf8"))
if (versionA.version !== "atomic-a" || versionB.version !== "atomic-b") {
  throw new Error("Atomic test build IDs do not match their version markers")
}

await writeFile(
  path.join(outputRoot, "state.json"),
  `${JSON.stringify({buildA, buildB, remote, failingAsset: `/_app/immutable/${failingAsset}`}, null, 2)}\n`,
)
