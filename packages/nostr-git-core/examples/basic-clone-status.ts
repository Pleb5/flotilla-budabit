import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {getGitProvider} from "../dist/index.node.js"

async function main() {
  const git = getGitProvider()
  const dir = mkdtempSync(join(tmpdir(), "ngit-basic-"))
  console.log("Working dir:", dir)
  try {
    await git.init({dir})
    const version = await git.version()
    console.log("isomorphic-git version:", version)

    const matrix = await git.statusMatrix({dir})
    console.log("statusMatrix entries:", matrix.length)
  } finally {
    try {
      rmSync(dir, {recursive: true, force: true})
    } catch {}
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
