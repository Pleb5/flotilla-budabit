import "fake-indexeddb/auto"
import {describe, expect, it} from "vitest"
import * as git from "isomorphic-git"
import {createGitlinkRepo} from "../utils/gitlink-repo.js"

describe("isomorphic-git gitlink checkout compatibility", () => {
  it.each([false, true])(
    "round trips between a gitlink and a directory (nonBlocking=%s)",
    async nonBlocking => {
      const {ctx, path, gitlinkOid, base, target} = await createGitlinkRepo()
      const opts = {...ctx, nonBlocking}
      await git.checkout({...opts, ref: "dev", dryRun: true})
      expect(await git.resolveRef({...ctx, ref: "HEAD"})).toBe(base)
      expect(await git.listFiles(ctx)).toContain(path)

      await git.checkout({...opts, ref: "dev"})
      expect(await ctx.fs.promises.readFile(`${ctx.dir}/${path}/README.md`, "utf8")).toBe(
        "vendored template\n",
      )
      expect(await git.listFiles(ctx)).toEqual(["app.txt", `${path}/README.md`])
      expect(await git.statusMatrix(ctx)).toEqual([
        ["app.txt", 1, 1, 1],
        [`${path}/README.md`, 1, 1, 1],
      ])
      expect(await git.resolveRef({...ctx, ref: "HEAD"})).toBe(target)

      await git.checkout({...opts, ref: "cached"})
      expect(await git.listFiles(ctx)).toEqual(["app.txt", path])
      const entries = await git.walk({
        ...ctx,
        trees: [git.STAGE()],
        map: async (filepath, [entry]) =>
          filepath === path ? {oid: await entry!.oid(), mode: await entry!.mode()} : undefined,
      })
      expect(entries).toEqual([{oid: gitlinkOid, mode: 0o160000}])
      await expect(ctx.fs.promises.readFile(`${ctx.dir}/${path}/README.md`)).rejects.toThrow()
      await git.checkout({...opts, ref: "dev"})
      expect(await git.listFiles(ctx)).toEqual(["app.txt", `${path}/README.md`])
    },
  )

  it("materializes a converted directory when the old gitlink directory is missing", async () => {
    const {ctx, path} = await createGitlinkRepo()
    await ctx.fs.promises.rmdir(`${ctx.dir}/${path}`)
    await git.checkout({...ctx, ref: "dev"})
    expect(await ctx.fs.promises.readFile(`${ctx.dir}/${path}/README.md`, "utf8")).toBe(
      "vendored template\n",
    )
    expect(await git.listFiles(ctx)).not.toContain(path)
  })

  it("preserves untracked submodule files and rejects an overlapping file before changing HEAD or the index", async () => {
    const {ctx, path, base} = await createGitlinkRepo()
    await ctx.fs.promises.writeFile(`${ctx.dir}/${path}/README.md`, "local work\n")
    const index = Buffer.from(await ctx.fs.promises.readFile(`${ctx.dir}/.git/index`))
    await expect(git.checkout({...ctx, ref: "dev"})).rejects.toMatchObject({
      code: "CheckoutConflictError",
      data: {filepaths: [`${path}/README.md`]},
    })
    expect(await ctx.fs.promises.readFile(`${ctx.dir}/${path}/README.md`, "utf8")).toBe(
      "local work\n",
    )
    expect(Buffer.from(await ctx.fs.promises.readFile(`${ctx.dir}/.git/index`))).toEqual(index)
    expect(await git.resolveRef({...ctx, ref: "HEAD"})).toBe(base)

    await ctx.fs.promises.unlink(`${ctx.dir}/${path}/README.md`)
    await ctx.fs.promises.writeFile(`${ctx.dir}/${path}/local.txt`, "keep me\n")
    await git.checkout({...ctx, ref: "dev"})
    await git.checkout({...ctx, ref: "cached"})
    expect(await ctx.fs.promises.readFile(`${ctx.dir}/${path}/local.txt`, "utf8")).toBe("keep me\n")
  })

  it("rejects dirty tracked files when converting a directory back to a gitlink", async () => {
    const {ctx, path, target} = await createGitlinkRepo()
    await git.checkout({...ctx, ref: "dev"})
    await ctx.fs.promises.writeFile(`${ctx.dir}/${path}/README.md`, "local changes\n")
    await expect(git.checkout({...ctx, ref: "cached"})).rejects.toMatchObject({
      code: "CheckoutConflictError",
    })
    expect(await git.resolveRef({...ctx, ref: "HEAD"})).toBe(target)
    expect(await ctx.fs.promises.readFile(`${ctx.dir}/${path}/README.md`, "utf8")).toBe(
      "local changes\n",
    )
  })
})
