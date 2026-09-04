import {afterEach, describe, expect, it, vi} from "vitest"
import "fake-indexeddb/auto"

import {getGitProvider, setGitProvider} from "../../src/api/git-provider.js"
import {
  getRepoFileContentFromEvent,
  listRepoFilesFromEvent,
} from "../../src/git/files.js"

const remoteUrl = "https://authorized.example/owner/repo.git"
const remoteOid = "a".repeat(40)
const staleOid = "b".repeat(40)
const repoEvent = {
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  created_at: 1,
  kind: 30617,
  tags: [
    ["d", "repo"],
    ["clone", remoteUrl],
  ],
  content: "",
  sig: "3".repeat(128),
} as any

describe("strict clone-backed file reads", () => {
  const previousProvider = getGitProvider()

  afterEach(() => {
    setGitProvider(previousProvider)
  })

  it("reads a directory from the exact fetched branch OID", async () => {
    const readTree = vi.fn(async () => ({tree: []}))
    setGitProvider(
      makeGit({
        fetch: vi.fn(async () => ({fetchHead: remoteOid})),
        readTree,
      }),
    )

    await listRepoFilesFromEvent({
      repoEvent,
      repoKey: "owner/repo",
      branch: "main",
      cloneUrls: [remoteUrl],
      strictCloneUrls: true,
    })

    expect(readTree).toHaveBeenCalledWith(
      expect.objectContaining({oid: remoteOid}),
    )
  })

  it("reads file content from the exact fetched branch OID", async () => {
    const readBlob = vi.fn(async () => ({oid: "c".repeat(40), blob: new Uint8Array([111, 107])}))
    setGitProvider(
      makeGit({
        fetch: vi.fn(async () => ({fetchHead: remoteOid})),
        readBlob,
      }),
    )

    const content = await getRepoFileContentFromEvent({
      repoEvent,
      repoKey: "owner/repo",
      branch: "main",
      path: "README.md",
      cloneUrls: [remoteUrl],
      strictCloneUrls: true,
    })

    expect(content).toBe("ok")
    expect(readBlob).toHaveBeenCalledWith(
      expect.objectContaining({oid: remoteOid, filepath: "README.md"}),
    )
  })

  it("does not read a stale local tree after the scoped fetch fails", async () => {
    const readTree = vi.fn(async () => ({tree: []}))
    setGitProvider(
      makeGit({
        fetch: vi.fn(async () => {
          throw new Error("scoped fetch failed")
        }),
        readTree,
      }),
    )

    await expect(
      listRepoFilesFromEvent({
        repoEvent,
        repoKey: "owner/repo",
        branch: "main",
        cloneUrls: [remoteUrl],
        strictCloneUrls: true,
      }),
    ).rejects.toThrow(/scoped fetch failed/)
    expect(readTree).not.toHaveBeenCalled()
  })

  it("requires exact-OID evidence for a commit-addressed read already present locally", async () => {
    const fetch = vi.fn(async ({ref}: {ref: string}) => ({fetchHead: ref}))
    const readTree = vi.fn(async () => ({tree: []}))
    setGitProvider(makeGit({fetch, readTree}))

    await listRepoFilesFromEvent({
      repoEvent,
      repoKey: "owner/repo",
      commit: remoteOid,
      cloneUrls: [remoteUrl],
      strictCloneUrls: true,
    })

    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({url: remoteUrl, ref: remoteOid}))
    expect(readTree).toHaveBeenCalledWith(expect.objectContaining({oid: remoteOid}))
  })

  it("rejects a commit-addressed read when the scoped fetch returns another OID", async () => {
    const readTree = vi.fn(async () => ({tree: []}))
    setGitProvider(
      makeGit({
        fetch: vi.fn(async () => ({fetchHead: staleOid})),
        readTree,
      }),
    )

    await expect(
      listRepoFilesFromEvent({
        repoEvent,
        repoKey: "owner/repo",
        commit: remoteOid,
        cloneUrls: [remoteUrl],
        strictCloneUrls: true,
      }),
    ).rejects.toThrow()
    expect((getGitProvider() as any).fetch).toHaveBeenCalledWith(
      expect.objectContaining({url: remoteUrl, ref: remoteOid}),
    )
    expect(readTree).not.toHaveBeenCalled()
  })
})

function makeGit(overrides: Record<string, unknown>) {
  return {
    resolveRef: vi.fn(async ({ref}: {ref: string}) => {
      if (ref === "HEAD" || ref === "main" || ref === "refs/heads/main") return staleOid
      throw new Error("missing ref")
    }),
    fetch: vi.fn(),
    readCommit: vi.fn(async () => ({oid: staleOid})),
    readTree: vi.fn(async () => ({tree: []})),
    readBlob: vi.fn(async () => ({oid: "c".repeat(40), blob: new Uint8Array()})),
    ...overrides,
  } as any
}
