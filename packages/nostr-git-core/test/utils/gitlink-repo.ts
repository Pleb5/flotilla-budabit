import * as git from "isomorphic-git"
import {createTestFs} from "./lightningfs.js"
import {IsomorphicGitProvider} from "../../src/git/isomorphic-git-provider.js"

/** A cached clone predating a target-side submodule-to-directory conversion. */
export async function createGitlinkRepo({checkout = true}: {checkout?: boolean} = {}) {
  const fs = createTestFs("gitlink-checkout")
  const dir = "/repo"
  const ctx = {fs, dir}
  const author = {name: "Test", email: "test@example.com", timestamp: 1, timezoneOffset: 0}
  const path = "packages/template"
  const gitlinkOid = "861024424feba424f81dffcf4a6f8e8fbb8f878f"
  await fs.promises.mkdir(dir)
  await git.init({...ctx, defaultBranch: "cached"})

  const blob = async (path: string, text: string) => ({
    path,
    mode: "100644",
    type: "blob" as const,
    oid: await git.writeBlob({...ctx, blob: new TextEncoder().encode(text)}),
  })
  const tree = async (path: string, entries: git.TreeEntry[]) => ({
    path,
    mode: "040000",
    type: "tree" as const,
    oid: await git.writeTree({...ctx, tree: entries}),
  })
  const oldPackages = await tree("packages", [
    {path: "template", mode: "160000", type: "commit", oid: gitlinkOid},
  ])
  const newPackages = await tree("packages", [
    await tree("template", [await blob("README.md", "vendored template\n")]),
  ])
  const commit = async (entries: git.TreeEntry[], parent: string[], message: string) =>
    git.writeCommit({
      ...ctx,
      commit: {
        tree: await git.writeTree({...ctx, tree: entries}),
        parent,
        author,
        committer: author,
        message,
      },
    })
  const base = await commit([oldPackages, await blob("app.txt", "base\n")], [], "base")
  const target = await commit(
    [newPackages, await blob("app.txt", "base\n")],
    [base],
    "vendor template",
  )
  const first = await commit(
    [oldPackages, await blob("app.txt", "first\n")],
    [base],
    "first change",
  )
  const tip = await commit([oldPackages, await blob("app.txt", "feature\n")], [first], "feature")
  const conflictingTarget = await commit(
    [newPackages, await blob("app.txt", "target change\n")],
    [target],
    "conflicting target",
  )
  for (const [ref, value] of Object.entries({cached: base, dev: target, pr: tip})) {
    await git.writeRef({...ctx, ref: `refs/heads/${ref}`, value})
  }
  if (checkout) await git.checkout({...ctx, ref: "cached"})
  const provider = new IsomorphicGitProvider({fs, http: undefined, corsProxy: null})
  return {ctx, provider, author, path, gitlinkOid, base, target, conflictingTarget, first, tip}
}
