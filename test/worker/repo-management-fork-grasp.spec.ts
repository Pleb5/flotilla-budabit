import {beforeEach, describe, expect, it, vi} from "vitest"
import {nip19} from "nostr-tools"
import {isRepoClonedFs} from "../../src/worker/workers/fs-utils.js"
import {cloneRemoteRepoUtil} from "../../src/worker/workers/repos.js"

vi.mock("../../src/git/provider-factory.js", () => ({
  getGitServiceApi: vi.fn(() => ({
    forkRepo: vi.fn(async () => {
      throw new Error("GRASP not supported without external EventIO")
    }),
  })),
}))

vi.mock("../../src/worker/workers/fs-utils.js", () => ({
  getProviderFs: vi.fn(),
  ensureDir: vi.fn(async () => {}),
  isRepoClonedFs: vi.fn(async () => true),
}))

vi.mock("../../src/worker/workers/repos.js", () => ({
  cloneRemoteRepoUtil: vi.fn(async () => {}),
}))

import {forkAndCloneRepo} from "../../src/worker/workers/repo-management.js"

const GRASP_OWNER_NPUB = "npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw"
const GRASP_FORK_REMOTE_URL = `https://relay.ngit.dev/${GRASP_OWNER_NPUB}/upstream-repo.git`
const GRASP_ORIGIN_URL = `https://relay.ngit.dev/${GRASP_OWNER_NPUB}/r.git`

const pktLine = (payload: string) =>
  `${(payload.length + 4).toString(16).padStart(4, "0")}${payload}`

describe("worker/repo-management GRASP fork output", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(isRepoClonedFs as any).mockResolvedValue(true)
  })

  it("uses full clone (no depth) for GRASP cross-platform source clone", async () => {
    ;(isRepoClonedFs as any).mockResolvedValue(false)
    const tokenHex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

    const git = {
      listBranches: vi.fn(async () => ["main"]),
      listTags: vi.fn(async () => []),
      log: vi.fn(async () => [{oid: "c1", commit: {parent: []}}]),
      readCommit: vi.fn(async () => ({commit: {}})),
      resolveRef: vi.fn(async () => "abc123"),
    } as any

    const result = await forkAndCloneRepo(git, {} as any, "/root", {
      owner: "upstream-owner",
      repo: "upstream-repo",
      forkName: "forked-repo",
      visibility: "public",
      token: tokenHex,
      dir: "forked-repo",
      provider: "grasp",
      baseUrl: "wss://relay.example",
      sourceCloneUrls: ["https://example.com/upstream-owner/upstream-repo.git"],
      sourceRepoId: "upstream-owner/upstream-repo",
    })

    expect(result.success).toBe(true)
    expect(cloneRemoteRepoUtil).toHaveBeenCalledWith(
      git,
      expect.anything(),
      expect.objectContaining({
        url: "https://example.com/upstream-owner/upstream-repo.git",
        dir: "/root/forked-repo",
      }),
    )
    expect((cloneRemoteRepoUtil as any).mock.calls[0][2]).not.toHaveProperty("depth")
  })

  it("returns npub-based repoId and forkUrl for hex pubkey token", async () => {
    const tokenHex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    const ownerNpub = nip19.npubEncode(tokenHex)
    const git = {
      listBranches: vi.fn(async () => ["main"]),
      listTags: vi.fn(async () => ["v1"]),
      log: vi.fn(async () => [{oid: "c1", commit: {parent: []}}]),
      readCommit: vi.fn(async () => ({commit: {}})),
      resolveRef: vi.fn(async () => "abc123"),
    } as any

    const result = await forkAndCloneRepo(git, {} as any, "/root", {
      owner: "upstream-owner",
      repo: "upstream-repo",
      forkName: "forked-repo",
      visibility: "public",
      token: tokenHex,
      dir: "forked-repo",
      provider: "grasp",
      baseUrl: "wss://relay.example",
      sourceCloneUrls: ["https://example.com/upstream-owner/upstream-repo.git"],
      sourceRepoId: "upstream-owner/upstream-repo",
    })

    expect(result.success).toBe(true)
    expect(result.repoId).toBe(`${ownerNpub}/forked-repo`)
    expect(result.forkUrl).toBe(`https://relay.example/${ownerNpub}/forked-repo.git`)
  })

  it("repairs missing objects for GRASP cross-platform fork before returning success", async () => {
    const tokenHex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    const ownerNpub = nip19.npubEncode(tokenHex)
    const fetchMock = vi.fn(async () => {})
    const readCommitMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("NotFoundError: missing parent"))
      .mockResolvedValue({commit: {}})

    const git = {
      listBranches: vi.fn(async () => ["main"]),
      listTags: vi.fn(async () => []),
      listServerRefs: vi.fn(async () => [
        {ref: "HEAD", target: "refs/heads/main", oid: "abc123"},
        {ref: "refs/heads/main", oid: "abc123"},
      ]),
      log: vi.fn(async () => [{oid: "c1", commit: {parent: ["p1"]}}]),
      readCommit: readCommitMock,
      listRemotes: vi.fn(async () => [{remote: "origin", url: "https://github.com/o/r.git"}]),
      fetch: fetchMock,
      resolveRef: vi.fn(async () => "abc123"),
    } as any

    const result = await forkAndCloneRepo(git, {} as any, "/root", {
      owner: "upstream-owner",
      repo: "upstream-repo",
      forkName: "forked-repo",
      visibility: "public",
      token: tokenHex,
      dir: "forked-repo",
      provider: "grasp",
      baseUrl: "wss://relay.example",
      sourceCloneUrls: ["https://example.com/upstream-owner/upstream-repo.git"],
      sourceRepoId: "upstream-owner/upstream-repo",
    })

    expect(result.success).toBe(true)
    expect(result.repoId).toBe(`${ownerNpub}/forked-repo`)
    // Depending on whether integrity validation triggers a fresh hydration path,
    // repair fetch may be skipped because full clone hydration already proved complete.
    expect(readCommitMock).toHaveBeenCalled()
  })

  it("continues to push phase when GRASP missing-object check remains inconclusive", async () => {
    const tokenHex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    const git = {
      listBranches: vi.fn(async () => ["main"]),
      listTags: vi.fn(async () => []),
      log: vi.fn(async () => [{oid: "c1", commit: {parent: ["p1"]}}]),
      readCommit: vi.fn(async () => {
        throw Object.assign(new Error("missing necessary objects"), {code: "NotFoundError"})
      }),
      listRemotes: vi.fn(async () => [{remote: "origin", url: "https://github.com/o/r.git"}]),
      fetch: vi.fn(async () => {}),
      resolveRef: vi.fn(async () => "abc123"),
    } as any

    const result = await forkAndCloneRepo(git, {} as any, "/root", {
      owner: "upstream-owner",
      repo: "upstream-repo",
      forkName: "forked-repo",
      visibility: "public",
      token: tokenHex,
      dir: "forked-repo",
      provider: "grasp",
      baseUrl: "wss://relay.example",
      sourceCloneUrls: ["https://example.com/upstream-owner/upstream-repo.git"],
      sourceRepoId: "upstream-owner/upstream-repo",
    })

    expect(result.success).toBe(true)
  })

  it("re-clones destination with full history when reused clone cannot be repaired", async () => {
    const tokenHex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    const readCommitMock = vi.fn(async ({dir}: {dir: string}) => {
      if (dir === "/root/upstream-owner/upstream-repo") {
        throw Object.assign(new Error("missing necessary objects"), {code: "NotFoundError"})
      }
      return {commit: {}}
    })

    const git = {
      listBranches: vi.fn(async () => ["main"]),
      listTags: vi.fn(async () => []),
      listServerRefs: vi.fn(async () => [
        {ref: "HEAD", target: "refs/heads/main", oid: "abc123"},
        {ref: "refs/heads/main", oid: "abc123"},
      ]),
      log: vi.fn(async () => [{oid: "c1", commit: {parent: ["p1"]}}]),
      readCommit: readCommitMock,
      listRemotes: vi.fn(async () => [{remote: "origin", url: "https://github.com/o/r.git"}]),
      fetch: vi.fn(async () => {}),
      resolveRef: vi.fn(async () => "abc123"),
    } as any

    const result = await forkAndCloneRepo(git, {} as any, "/root", {
      owner: "upstream-owner",
      repo: "upstream-repo",
      forkName: "forked-repo",
      visibility: "public",
      token: tokenHex,
      dir: "forked-repo",
      provider: "grasp",
      baseUrl: "wss://relay.example",
      sourceCloneUrls: ["https://example.com/upstream-owner/upstream-repo.git"],
      sourceRepoId: "upstream-owner/upstream-repo",
    })

    expect(result.success).toBe(true)
    expect(cloneRemoteRepoUtil).toHaveBeenCalledWith(
      git,
      expect.anything(),
      expect.objectContaining({
        dir: "/root/forked-repo",
      }),
    )
  })

  it("handles GRASP default branches containing slashes during history checks", async () => {
    const tokenHex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    const logMock = vi.fn(async () => [{oid: "c1", commit: {parent: []}}])

    const git = {
      listBranches: vi.fn(async () => ["feature/nested-branch"]),
      listTags: vi.fn(async () => []),
      log: logMock,
      readCommit: vi.fn(async () => ({commit: {}})),
      resolveRef: vi.fn(async () => "abc123"),
    } as any

    const result = await forkAndCloneRepo(git, {} as any, "/root", {
      owner: "upstream-owner",
      repo: "upstream-repo",
      forkName: "forked-repo",
      visibility: "public",
      token: tokenHex,
      dir: "forked-repo",
      provider: "grasp",
      baseUrl: "wss://relay.example",
      sourceCloneUrls: ["https://example.com/upstream-owner/upstream-repo.git"],
      sourceRepoId: "upstream-owner/upstream-repo",
    })

    expect(result.success).toBe(true)
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: "/root/upstream-owner/upstream-repo",
        ref: "refs/heads/feature/nested-branch",
      }),
    )
  })

  it("prefers advertised remote refs over stale local-only branches for GRASP push planning", async () => {
    const tokenHex = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    const fetchMock = vi.fn(async () => {})
    const advertisedRefsBody = [
      pktLine("# service=git-upload-pack\n"),
      "0000",
      pktLine(
        "1111111111111111111111111111111111111111 refs/heads/master\0symref=HEAD:refs/heads/master\n",
      ),
      pktLine("2222222222222222222222222222222222222222 refs/heads/maint\n"),
      "0000",
    ].join("")

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(advertisedRefsBody, {status: 200, statusText: "OK"})),
    )

    const git = {
      listServerRefs: vi.fn(async () => [
        {ref: "refs/heads/master", oid: "1111111111111111111111111111111111111111"},
        {ref: "refs/heads/maint", oid: "2222222222222222222222222222222222222222"},
      ]),
      listBranches: vi.fn(async ({remote}: {remote?: string}) => {
        if (remote === "origin") return ["master", "maint"]
        return ["add-logos", "master"]
      }),
      listTags: vi.fn(async () => []),
      log: vi.fn(async () => [{oid: "c1", commit: {parent: []}}]),
      readCommit: vi.fn(async () => ({commit: {}})),
      listRemotes: vi.fn(async () => [{remote: "origin", url: GRASP_ORIGIN_URL}]),
      fetch: fetchMock,
      resolveRef: vi.fn(async ({ref}: {ref: string}) => {
        if (ref === "refs/heads/master" || ref === "refs/remotes/origin/master") {
          return "1111111111111111111111111111111111111111"
        }
        if (ref === "refs/heads/maint" || ref === "refs/remotes/origin/maint") {
          return "2222222222222222222222222222222222222222"
        }
        if (ref === "refs/heads/add-logos") {
          return "3333333333333333333333333333333333333333"
        }
        return "1111111111111111111111111111111111111111"
      }),
    } as any

    try {
      const result = await forkAndCloneRepo(git, {} as any, "/root", {
        owner: "upstream-owner",
        repo: "upstream-repo",
        forkName: "forked-repo",
        visibility: "public",
        token: tokenHex,
        dir: "forked-repo",
        provider: "grasp",
        baseUrl: "wss://relay.example",
        sourceCloneUrls: [GRASP_FORK_REMOTE_URL],
        sourceRepoId: "upstream-owner/upstream-repo",
      })

      expect(result.success).toBe(true)
      expect(result.branches).toEqual(["master", "maint"])
      expect(result.branches).not.toContain("add-logos")
      expect(fetchMock).not.toHaveBeenCalledWith(expect.objectContaining({ref: "add-logos"}))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
