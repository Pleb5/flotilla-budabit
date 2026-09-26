import "fake-indexeddb/auto"
import {afterEach, describe, expect, it, vi} from "vitest"
import * as git from "isomorphic-git"
import {analyzePRMergeability} from "../../src/git/merge-analysis.js"
import {mergePRAndPushUtil} from "../../src/worker/workers/pr-merge.js"
import {createGitlinkRepo} from "../utils/gitlink-repo.js"
import {CachedGitProvider} from "../../src/git/cached-provider.js"
import {loadConfig} from "../../src/git/config.js"

const sourceUrl = "https://github.com/contributor/repo.git"
const mirrorUrl = "https://github.com/mirror/repo.git"
const targetUrl = "https://github.com/upstream/repo.git"

async function fixture(targetConflict = false, checkout = true) {
  const repo = await createGitlinkRepo({checkout})
  const target = targetConflict ? repo.conflictingTarget : repo.target
  // Only network I/O is mocked: all Git objects, refs, checkout and merge are real.
  const fetch = vi.spyOn(repo.provider, "fetch").mockImplementation(async ({url, ref}) => ({
    fetchHead: url === targetUrl ? target : ref,
    defaultBranch: null,
    fetchHeadDescription: null,
  }))
  const opts = {
    cloneUrls: [sourceUrl, mirrorUrl],
    targetCloneUrls: [targetUrl],
    tipCommitOid: repo.tip,
    targetBranch: "dev",
    strictTargetFresh: true,
  }
  return {...repo, target, fetch, opts}
}

afterEach(() => vi.restoreAllMocks())

describe("PR merge analysis across gitlink conversions", () => {
  it.each([
    ["missing", false],
    ["missing", true],
    ["unborn", false],
    ["unborn", true],
  ] as const)(
    "analyzes an object-only repository with %s HEAD (conflicts=%s)",
    async (head, conflict) => {
      const {ctx, provider, opts, tip, first, target} = await fixture(conflict, false)
      for (const branch of await git.listBranches(ctx)) {
        await git.deleteRef({...ctx, ref: `refs/heads/${branch}`})
      }
      if (head === "missing") await ctx.fs.promises.unlink(`${ctx.dir}/.git/HEAD`)
      const headBefore = await ctx.fs.promises
        .readFile(`${ctx.dir}/.git/HEAD`, "utf8")
        .catch(() => null)
      const cached = new CachedGitProvider(provider, loadConfig())
      const checkout = vi.spyOn(provider, "checkout")
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      // Retrying in the same browser cache must also be safe.
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await analyzePRMergeability(cached, ctx.dir, opts)
        expect(result.analysis).toBe(conflict ? "conflicts" : "clean")
        expect(result.canMerge).toBe(!conflict)
        expect(result.targetCommit).toBe(target)
        expect(result.patchCommits).toEqual([tip, first])
        expect(result.conflictFiles).toEqual(conflict ? ["app.txt"] : [])
        expect(
          await ctx.fs.promises.readFile(`${ctx.dir}/.git/HEAD`, "utf8").catch(() => null),
        ).toBe(headBefore)
        expect(await ctx.fs.promises.readdir(ctx.dir)).toEqual([".git"])
        expect(await git.listFiles(ctx)).toEqual([])
        expect(await git.listRefs({...ctx, filepath: "refs"})).toEqual([])
        expect(await git.listRemotes(ctx)).toEqual([])
      }
      expect(checkout).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    },
  )

  it("cleans up an object-only target when source fetching fails", async () => {
    const {ctx, provider, opts, fetch} = await fixture(false, false)
    await ctx.fs.promises.unlink(`${ctx.dir}/.git/HEAD`)
    const beforeRefs = await git.listRefs({...ctx, filepath: "refs"})
    const remoteFetch = fetch.getMockImplementation()!
    fetch.mockImplementation(async args => {
      if (args.url !== targetUrl) throw new Error("source offline")
      return remoteFetch(args)
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await analyzePRMergeability(provider, ctx.dir, opts)
    expect(result.analysis).toBe("error")
    expect(result.errorMessage).toContain("source offline")
    expect(await git.listRefs({...ctx, filepath: "refs"})).toEqual(beforeRefs)
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Failed to remove temporary target branch"),
      expect.anything(),
    )
  })

  it.each([false, true])(
    "analyzes and restores an old cached checkout (conflicts=%s)",
    async conflict => {
      const {ctx, provider, opts, base, target, tip, first, path} = await fixture(conflict)
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const beforeRefs = await git.listRefs({...ctx, filepath: "refs"})
      const result = await analyzePRMergeability(provider, ctx.dir, opts)

      expect(result.analysis).toBe(conflict ? "conflicts" : "clean")
      expect(result.hasConflicts).toBe(conflict)
      expect(result.canMerge).toBe(!conflict)
      expect(result.patchCommits).toEqual([tip, first])
      expect(result.targetCommit).toBe(target)
      expect(result.mergeBase).toBe(base)
      if (conflict) expect(result.conflictFiles).toEqual(["app.txt"])
      expect(await git.currentBranch(ctx)).toBe("cached")
      expect(await git.resolveRef({...ctx, ref: "HEAD"})).toBe(base)
      expect(await git.listFiles(ctx)).toEqual(["app.txt", path])
      expect(await git.listRefs({...ctx, filepath: "refs"})).toEqual(beforeRefs)
      expect(await git.listRemotes(ctx)).toEqual([])
      expect(await git.statusMatrix(ctx)).toEqual([["app.txt", 1, 1, 1]])
      expect(warn).not.toHaveBeenCalled()
    },
  )

  it("restores a detached HEAD after analysis", async () => {
    const {ctx, provider, opts, base} = await fixture()
    await git.checkout({...ctx, ref: base})
    const result = await analyzePRMergeability(provider, ctx.dir, opts)
    expect(result.analysis).toBe("clean")
    expect(await git.currentBranch(ctx)).toBeUndefined()
    expect(await git.resolveRef({...ctx, ref: "HEAD"})).toBe(base)
  })

  it.each(["InternalError", "CheckoutConflictError"])(
    "reports %s as local analysis failure and skips uncreated resources",
    async code => {
      const {ctx, provider, opts, fetch, base, target, tip, first} = await fixture()
      const failure = Object.assign(new Error("checkout failed"), {
        caller: "git.checkout",
        code,
        data:
          code === "InternalError"
            ? {message: "update entry Unhandled type commit-tree"}
            : {filepaths: ["packages/template/README.md"]},
      })
      const checkout = vi.spyOn(provider, "checkout").mockRejectedValueOnce(failure)
      const deleteBranch = vi.spyOn(provider, "deleteBranch")
      const deleteRef = vi.spyOn(provider, "deleteRef")
      const merge = vi.spyOn(provider, "merge")
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

      const result = await analyzePRMergeability(provider, ctx.dir, opts)
      expect(result.analysis).toBe("error")
      expect(result.hasConflicts).toBe(false)
      expect(result.errorMessage).toContain(`Merge analysis failed during git.checkout (${code}):`)
      expect(result.errorMessage).not.toContain(sourceUrl)
      expect(result.usedCloneUrl).toBe(sourceUrl)
      expect(result.sourceAttempts).toEqual([
        expect.objectContaining({url: sourceUrl, success: true}),
      ])
      expect(result.patchCommits).toEqual([tip, first])
      expect(result.targetCommit).toBe(target)
      expect(result.mergeBase).toBe(base)
      expect(fetch.mock.calls.map(([args]) => args.url)).toEqual([targetUrl, sourceUrl])
      expect(checkout).toHaveBeenCalledTimes(1)
      expect(merge).not.toHaveBeenCalled()
      expect(deleteBranch).toHaveBeenCalledTimes(1)
      expect(deleteBranch).toHaveBeenCalledWith(
        expect.objectContaining({ref: expect.stringMatching(/^pr-target-analysis-/)}),
      )
      expect(deleteRef).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(await git.currentBranch(ctx)).toBe("cached")
      expect(await git.listBranches(ctx)).toEqual(["cached", "dev", "pr"])
    },
  )

  it("still falls back to another URL when source fetching fails", async () => {
    const {ctx, provider, opts, fetch} = await fixture()
    const remoteFetch = fetch.getMockImplementation()!
    fetch.mockImplementation(async args => {
      if (args.url === sourceUrl) throw new Error("source offline")
      return remoteFetch(args)
    })
    const result = await analyzePRMergeability(provider, ctx.dir, opts)
    expect(result.analysis).toBe("clean")
    expect(result.usedCloneUrl).toBe(mirrorUrl)
    expect(result.sourceAttempts).toEqual([
      expect.objectContaining({url: sourceUrl, success: false}),
      expect.objectContaining({url: mirrorUrl, success: true}),
    ])
    expect(await git.listRemotes(ctx)).toEqual([])
  })

  it("cleans up the target branch if every source is unavailable", async () => {
    const {ctx, provider, opts, fetch} = await fixture()
    const remoteFetch = fetch.getMockImplementation()!
    fetch.mockImplementation(async args => {
      if (args.url !== targetUrl) throw new Error("source offline")
      return remoteFetch(args)
    })
    const result = await analyzePRMergeability(provider, ctx.dir, opts)
    expect(result.analysis).toBe("error")
    expect(result.sourceAttempts).toHaveLength(2)
    expect(result.sourceAttempts?.every(attempt => !attempt.success)).toBe(true)
    expect(await git.listBranches(ctx)).toEqual(["cached", "dev", "pr"])
    expect(await git.listRemotes(ctx)).toEqual([])
  })

  it("merges into the converted target and materializes a clean working tree", async () => {
    const {ctx, provider, opts, target, tip, path} = await fixture()
    const pushToRemote = vi.fn()
    const safePushToRemote = vi.fn()
    const result = await mergePRAndPushUtil(
      provider,
      {
        repoId: "repo",
        ...opts,
        expectedTargetCommitOid: target,
        fastForward: false,
        skipPush: true,
      },
      {
        rootDir: "",
        parseRepoId: id => id,
        resolveBranchName: async () => "dev",
        ensureFullClone: vi.fn(),
        getAuthCallback: () => undefined,
        pushToRemote,
        safePushToRemote,
        getTokensForRemote: async () => [],
      },
    )
    expect(result.success).toBe(true)
    const merged = await git.readCommit({...ctx, oid: result.mergeCommitOid!})
    expect(merged.commit.parent).toEqual([target, tip])
    expect(await git.currentBranch(ctx)).toBe("dev")
    expect(await ctx.fs.promises.readFile(`${ctx.dir}/app.txt`, "utf8")).toBe("feature\n")
    expect(await ctx.fs.promises.readFile(`${ctx.dir}/${path}/README.md`, "utf8")).toBe(
      "vendored template\n",
    )
    expect(await git.statusMatrix(ctx)).toEqual([
      ["app.txt", 1, 1, 1],
      [`${path}/README.md`, 1, 1, 1],
    ])
    expect(await git.listRefs({...ctx, filepath: "refs"})).toEqual([
      "heads/cached",
      "heads/dev",
      "heads/pr",
    ])
    expect(pushToRemote).not.toHaveBeenCalled()
    expect(safePushToRemote).not.toHaveBeenCalled()
  })
})
