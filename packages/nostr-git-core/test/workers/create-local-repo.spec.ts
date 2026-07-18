import {describe, expect, it, vi} from "vitest"
import {
  createLocalRepo,
  type CreateLocalRepoOptions,
} from "../../src/worker/workers/repo-management.js"

const options: CreateLocalRepoOptions = {
  repoId: "owner/repo",
  name: "repo",
  authorName: "Test User",
  authorEmail: "test@example.com",
  initializeWithReadme: false,
  mustNotExist: true,
}

function existingPath(path: string): Error {
  return Object.assign(new Error(`EEXIST: ${path}`), {code: "EEXIST"})
}

function missingParent(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), {code: "ENOENT"})
}

function makeGit(fsPromises: Record<string, any>, init = vi.fn(async () => undefined)) {
  return {
    fs: {promises: fsPromises},
    init,
    commit: vi.fn(async () => "a".repeat(40)),
    add: vi.fn(async () => undefined),
  } as any
}

describe("createLocalRepo mustNotExist", () => {
  it("creates a fresh parent directory chain before claiming the repository path", async () => {
    const directories = new Set(["/"])
    const mkdir = vi.fn(async (path: string) => {
      const parent = path.slice(0, path.lastIndexOf("/")) || "/"
      if (!directories.has(parent)) throw missingParent(path)
      if (directories.has(path)) throw existingPath(path)
      directories.add(path)
    })
    const git = makeGit({mkdir, writeFile: vi.fn()})

    const result = await createLocalRepo(git, "/repos", new Set(), new Map(), options)

    expect(result.success).toBe(true)
    expect(mkdir.mock.calls.map(([path]) => path)).toEqual([
      "/repos",
      "/repos/owner",
      "/repos/owner/repo",
    ])
  })

  it.each(["an existing repository", "filesystem residue"])(
    "rejects %s without calling init",
    async () => {
      const mkdir = vi.fn(async (path: string) => {
        throw existingPath(path)
      })
      const init = vi.fn(async () => undefined)
      const git = makeGit({mkdir, writeFile: vi.fn()}, init)

      const result = await createLocalRepo(git, "/repos", new Set(), new Map(), options)

      expect(result).toMatchObject({
        success: false,
        error: expect.stringMatching(/already exists|residue/i),
      })
      expect(mkdir).toHaveBeenCalledWith("/repos/owner/repo")
      expect(init).not.toHaveBeenCalled()
    },
  )

  it("serializes the absence check and init so concurrent creators cannot both win", async () => {
    let exists = false
    let releaseInit!: () => void
    const initGate = new Promise<void>(resolve => {
      releaseInit = resolve
    })
    const mkdir = vi.fn(async (path: string) => {
      if (path !== "/repos/owner/repo") return
      if (exists) throw existingPath(path)
      exists = true
    })
    const init = vi.fn(async () => {
      await initGate
    })
    const git = makeGit({mkdir, writeFile: vi.fn()}, init)
    const clonedRepos = new Set<string>()
    const levels = new Map<string, string>()

    const first = createLocalRepo(git, "/repos", clonedRepos, levels, options)
    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1))
    const second = createLocalRepo(git, "/repos", clonedRepos, levels, options)

    await Promise.resolve()
    expect(mkdir).toHaveBeenCalledWith("/repos/owner/repo")
    releaseInit()

    await expect(first).resolves.toMatchObject({success: true})
    await expect(second).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/already exists|residue/i),
    })
    expect(init).toHaveBeenCalledTimes(1)
    expect(mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      mkdir.mock.invocationCallOrder[
        mkdir.mock.calls.findIndex(([path]) => path === "/repos/owner/repo")
      ],
    )
    expect(mkdir.mock.calls.filter(([path]) => path === "/repos/owner/repo")).toHaveLength(2)
  })

  it("preserves legacy overwrite behavior when mustNotExist is omitted", async () => {
    const mkdir = vi.fn(async () => undefined)
    const init = vi.fn(async () => undefined)
    const git = makeGit({mkdir, writeFile: vi.fn()}, init)

    const result = await createLocalRepo(git, "/repos", new Set(), new Map(), {
      ...options,
      mustNotExist: undefined,
    })

    expect(result.success).toBe(true)
    expect(mkdir).not.toHaveBeenCalled()
    expect(init).toHaveBeenCalledTimes(1)
  })
})
