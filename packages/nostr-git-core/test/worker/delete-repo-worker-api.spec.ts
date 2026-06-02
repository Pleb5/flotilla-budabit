import {beforeEach, describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"

let exposed: any
let fsPromisesMock: any

vi.mock("comlink", () => ({
  expose: (obj: any) => {
    exposed = obj
  },
}))

vi.mock("../../src/git/factory-browser.js", () => ({
  createGitProvider: () => ({
    statusMatrix: vi.fn(async () => []),
    log: vi.fn(async () => []),
    listBranches: vi.fn(async () => ["main"]),
  }),
}))

vi.mock("../../src/worker/workers/fs-utils.js", () => ({
  getProviderFs: () => ({promises: fsPromisesMock}),
  isRepoClonedFs: async () => true,
}))

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => {},
}))

await import("../../src/worker/worker.js")

describe("worker.deleteRepo API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ignores ENOENT when child entry disappears during recursive removal", async () => {
    const repoDir = "/repos/owner/repo"
    const missingChild = `${repoDir}/AGENTS.md`

    const rmdir = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("ENOTEMPTY"), {code: "ENOTEMPTY"}))
      .mockResolvedValueOnce(undefined)
    const readdir = vi.fn(async () => ["AGENTS.md"])
    const stat = vi.fn(async () => {
      throw Object.assign(new Error(`ENOENT: ${missingChild}`), {code: "ENOENT"})
    })
    const unlink = vi.fn(async () => undefined)

    fsPromisesMock = {rmdir, readdir, stat, unlink}

    const res = await exposed.deleteRepo({repoId: "owner/repo"})

    expect(res.success).toBe(true)
    expect(readdir).toHaveBeenCalledWith(repoDir)
    expect(stat).toHaveBeenCalledWith(missingChild)
    expect(unlink).not.toHaveBeenCalled()
    expect(rmdir).toHaveBeenNthCalledWith(1, repoDir, {recursive: true})
    expect(rmdir).toHaveBeenNthCalledWith(2, repoDir)
  })

  it("treats already-missing repo directory as successful deletion", async () => {
    const repoDir = "/repos/owner/repo"

    const rmdir = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("ENOTEMPTY"), {code: "ENOTEMPTY"}))
    const readdir = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error(`ENOENT: ${repoDir}`), {code: "ENOENT"}))
    const stat = vi.fn(async () => ({isDirectory: () => false}))
    const unlink = vi.fn(async () => undefined)

    fsPromisesMock = {rmdir, readdir, stat, unlink}

    const res = await exposed.deleteRepo({repoId: "owner/repo"})

    expect(res.success).toBe(true)
    expect(readdir).toHaveBeenCalledWith(repoDir)
    expect(stat).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
  })
})
