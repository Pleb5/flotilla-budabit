import {beforeEach, describe, it, expect, vi} from "vitest"
import "fake-indexeddb/auto"

const pushMock = vi.fn(async (_opts?: any) => undefined)
const fetchMock = vi.fn(async () => undefined)
const addRemoteMock = vi.fn(async () => undefined)
const listRemotesMock = vi.fn(async () => [])
const resolveRefMock = vi.fn(async () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
const logMock = vi.fn(async () => [] as any[])
const writeRefMock = vi.fn(async () => undefined)
const httpFetchMock = vi.fn(async () => ({
  ok: false,
  status: 404,
  statusText: "Not Found",
  headers: new Headers(),
  arrayBuffer: async () => new ArrayBuffer(0),
  text: async () => "",
}))

const GRASP_REMOTE_URL =
  "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git"

;(globalThis as any).fetch = httpFetchMock

// Capture the exposed API from the worker via comlink.expose
let exposed: any
vi.mock("comlink", () => ({
  expose: (obj: any) => {
    exposed = obj
  },
}))

// Mock Git provider used by the worker
vi.mock("../../src/git/factory-browser.js", () => ({
  createGitProvider: () => ({
    push: pushMock,
    fetch: fetchMock,
    addRemote: addRemoteMock,
    listRemotes: listRemotesMock,
    resolveRef: resolveRefMock,
    writeRef: writeRefMock,
    // Other methods may be referenced in unrelated API paths but are not invoked here
    statusMatrix: vi.fn(async () => []),
    log: logMock,
    listBranches: vi.fn(async () => ["main"]),
  }),
}))

// Mock provider FS accessor to a minimal FS
vi.mock("../../src/worker/workers/fs-utils.js", () => ({
  getProviderFs: (_g: any) => ({promises: {stat: async () => ({})}}),
  isRepoClonedFs: async (_g: any, _d: string) => true,
}))

// Default mock for getNostrGitProvider is undefined; individual tests will override
vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => {},
}))

// Import the worker module AFTER mocks so comlink.expose is intercepted
await import("../../src/worker/worker.js")

describe("worker.pushToRemote API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushMock.mockReset()
    fetchMock.mockReset()
    addRemoteMock.mockReset()
    listRemotesMock.mockReset()
    resolveRefMock.mockReset()
    logMock.mockReset()
    writeRefMock.mockReset()
    httpFetchMock.mockReset()
    pushMock.mockResolvedValue(undefined)
    fetchMock.mockResolvedValue(undefined)
    addRemoteMock.mockResolvedValue(undefined)
    listRemotesMock.mockResolvedValue([])
    resolveRefMock.mockResolvedValue("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    logMock.mockResolvedValue([])
    writeRefMock.mockResolvedValue(undefined)
    httpFetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
    })
  })

  it("materializes an imported pull request refs/nostr ref", async () => {
    const eventId = "b".repeat(64)
    const commit = "c".repeat(40)
    logMock.mockResolvedValue([{oid: commit}])
    resolveRefMock.mockResolvedValue(commit)

    const result = await exposed.materializeNostrRef({
      repoId: "owner/repo",
      eventId,
      commit,
      cloneUrls: ["https://github.com/owner/repo.git"],
      sourceRef: "refs/pull/42/head",
    })

    expect(result).toEqual({success: true, ref: `refs/nostr/${eventId}`, commit})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(writeRefMock).toHaveBeenCalledWith({
      dir: "/repos/owner/repo",
      ref: `refs/nostr/${eventId}`,
      value: commit,
      force: true,
    })
  })

  it("fetches complete pull request history before materializing a missing ref", async () => {
    const eventId = "d".repeat(64)
    const commit = "e".repeat(40)
    logMock.mockResolvedValueOnce([]).mockResolvedValue([{oid: commit}])
    resolveRefMock.mockResolvedValue(commit)

    await exposed.materializeNostrRef({
      repoId: "owner/repo",
      eventId,
      commit,
      cloneUrls: ["https://github.com/owner/repo.git"],
      sourceRef: "refs/pull/43/head",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: "/repos/owner/repo",
        url: "https://github.com/owner/repo.git",
        ref: "refs/pull/43/head",
        singleBranch: true,
      }),
    )
    expect(fetchMock.mock.calls[0]?.[0]).not.toHaveProperty("depth")
    expect(writeRefMock).toHaveBeenCalledWith({
      dir: "/repos/owner/repo",
      ref: `refs/nostr/${eventId}`,
      value: commit,
      force: true,
    })
  })

  it("uses Nostr provider path and propagates blossomSummary when available", async () => {
    // Arrange: install a nostr provider that returns a blossomSummary
    const summary = {uploaded: 3, failures: []} as any
    const pushSpy = vi.fn(async () => ({blossomSummary: summary}))
    const mod = await import("../../src/api/git-provider.js")
    ;(mod as any).getNostrGitProvider = () => ({push: pushSpy})
    ;(mod as any).hasNostrGitProvider = () => true

    // Act: call pushToRemote on exposed API
    // Use a Nostr URL pattern to trigger the NostrGitProvider path
    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl:
        "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/repo.git",
      branch: "main",
      repoRelays: [" WSS://RELAY.NGIT.DEV/ ", "wss://relay.ngit.dev"],
    })

    // Assert
    expect(res.success).toBe(true)
    expect(res.branch).toBe("main")
    expect(res.blossomSummary).toEqual(summary)
    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({repoRelays: ["wss://relay.ngit.dev"]}),
    )
  })

  it("fails a Nostr provider push with empty relay scope before provider or git work", async () => {
    const pushSpy = vi.fn(async () => ({}))
    const mod = await import("../../src/api/git-provider.js")
    ;(mod as any).getNostrGitProvider = () => ({push: pushSpy})
    ;(mod as any).hasNostrGitProvider = () => true
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      repoRelays: [],
    })

    expect(res).toEqual(
      expect.objectContaining({
        success: false,
        error: "Nostr repository push requires at least one explicit repository relay",
      }),
    )
    expect(pushSpy).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
    expect(writeRefMock).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("falls back to git.push when no Nostr provider and returns success without blossomSummary", async () => {
    // Arrange: ensure getNostrGitProvider returns undefined
    const mod = await import("../../src/api/git-provider.js")
    ;(mod as any).getNostrGitProvider = () => undefined

    // Act
    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: "https://example.com/owner/repo.git",
      branch: "main",
    })

    // Assert
    expect(res.success).toBe(true)
    expect(res.branch).toBe("main")
    expect(res.blossomSummary).toBeUndefined()
  })

  it("pushes all requested refs for standard providers", async () => {
    const mod = await import("../../src/api/git-provider.js")
    ;(mod as any).getNostrGitProvider = () => undefined

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: "https://example.com/owner/repo.git",
      branch: "main",
      refs: ["refs/heads/main", "refs/heads/feature/recent"],
    })

    expect(res.success).toBe(true)
    expect(res.details?.pushedRefs).toEqual(["refs/heads/main", "refs/heads/feature/recent"])
    expect(pushMock).toHaveBeenCalledTimes(2)
    expect(pushMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ref: "refs/heads/main",
        remoteRef: "refs/heads/main",
      }),
    )
    expect(pushMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ref: "refs/heads/feature/recent",
        remoteRef: "refs/heads/feature/recent",
      }),
    )
  })

  it("retries GRASP push once after missing-object repair fetch", async () => {
    const missingError = Object.assign(
      new Error("One or more branches were not updated: missing necessary objects"),
      {
        data: {
          prettyDetails: "- refs/heads/main: missing necessary objects",
        },
      },
    )

    pushMock.mockRejectedValueOnce(missingError).mockResolvedValueOnce(undefined)
    listRemotesMock.mockResolvedValue([
      {remote: "origin", url: "https://github.com/upstream/repo.git"},
    ] as any)

    const notFoundResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
    }
    const matchingRefResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({"content-type": "application/x-git-upload-pack-advertisement"}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "003faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\n0000",
    }

    // Pre-push check: no refs yet (404). Post-push verification: refs match.
    httpFetchMock
      .mockResolvedValueOnce(notFoundResponse) // pre-push upload-pack
      .mockResolvedValueOnce(notFoundResponse) // pre-push receive-pack
      .mockResolvedValue(matchingRefResponse) // post-push verification

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      token: "deadbeef",
      provider: "grasp",
    })

    expect(res.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: "main",
        remoteRef: "main",
        singleBranch: true,
      }),
    )
    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it("retries GRASP push once after empty receive-pack parse response", async () => {
    const parseError = new Error(
      'Expected "unpack ok" or "unpack [error message]" but received "".',
    )

    pushMock.mockRejectedValueOnce(parseError).mockResolvedValueOnce(undefined)

    const notFoundResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
    }
    const matchingRefResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({"content-type": "application/x-git-upload-pack-advertisement"}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "003faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\n0000",
    }

    // Pre-push: no refs. Post-push: refs match.
    httpFetchMock
      .mockResolvedValueOnce(notFoundResponse)
      .mockResolvedValueOnce(notFoundResponse)
      .mockResolvedValue(matchingRefResponse)

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      token: "deadbeef",
      provider: "grasp",
    })

    expect(res.success).toBe(true)
    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it("skips GRASP push when remote branch already at local tip", async () => {
    httpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({"content-type": "application/x-git-receive-pack-advertisement"}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "003faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\n0000",
    })

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      token: "deadbeef",
      provider: "grasp",
    })

    expect(res.success).toBe(true)
    expect(pushMock).toHaveBeenCalledTimes(0)
  })

  it("treats empty receive-pack parse failure as success when remote tip matches", async () => {
    const parseError = new Error(
      'Expected "unpack ok" or "unpack [error message]" but received "".',
    )

    pushMock.mockRejectedValueOnce(parseError).mockRejectedValueOnce(parseError)

    const notFoundResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
    }

    // Pre-push: no refs (404s). First retry check: mismatch. Second retry check: match.
    httpFetchMock
      .mockResolvedValueOnce(notFoundResponse) // pre-push upload-pack
      .mockResolvedValueOnce(notFoundResponse) // pre-push receive-pack
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({"content-type": "application/x-git-upload-pack-advertisement"}),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => "003fbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb refs/heads/main\n0000",
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({"content-type": "application/x-git-upload-pack-advertisement"}),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => "003faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\n0000",
      })

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      token: "deadbeef",
      provider: "grasp",
    })

    expect(res.success).toBe(true)
    // 2 initial push attempts (both fail with parse error) + 1 more retry after mismatch
    expect(pushMock).toHaveBeenCalled()
    expect(pushMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it("uses unauthenticated Smart HTTP for GRASP pushes", async () => {
    const infoRefsUrl = `${GRASP_REMOTE_URL}/info/refs?service=git-receive-pack`
    const receivePackUrl = `${GRASP_REMOTE_URL}/git-receive-pack`

    const notFoundResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
    }
    const matchingRefResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({"content-type": "application/x-git-upload-pack-advertisement"}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "003faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\n0000",
    }

    const seenAuth: Array<string | undefined> = []
    pushMock.mockImplementationOnce(async (opts: any) => {
      const firstReq = {url: infoRefsUrl, headers: {} as Record<string, string>}
      const secondReq = {url: receivePackUrl, headers: {} as Record<string, string>}
      await opts.http.request(firstReq)
      await opts.http.request(secondReq)
      seenAuth.push(firstReq.headers.Authorization)
      seenAuth.push(secondReq.headers.Authorization)
      return undefined
    })

    // Pre-push: no refs. Post-push: refs match.
    httpFetchMock
      .mockResolvedValueOnce(notFoundResponse)
      .mockResolvedValueOnce(notFoundResponse)
      .mockResolvedValue(matchingRefResponse)

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      token: "deadbeef",
      provider: "grasp",
    })

    expect(res.success).toBe(true)
    expect(seenAuth).toEqual([undefined, undefined])
  })
})
