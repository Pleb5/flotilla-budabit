import {beforeEach, describe, it, expect, vi} from "vitest"
import "fake-indexeddb/auto"
import {nip19} from "nostr-tools"

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

const GRASP_OWNER_NPUB = "npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw"
const GRASP_OWNER_PUBKEY = nip19.decode(GRASP_OWNER_NPUB).data as string
const GRASP_REMOTE_URL = `https://relay.ngit.dev/${GRASP_OWNER_NPUB}/repo.git`
const GRASP_RELAY = "wss://relay.ngit.dev"

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

let nostrProviderMock: {push: ReturnType<typeof vi.fn>} | undefined
const initializeNostrGitProviderMock = vi.fn(async () => undefined)

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => nostrProviderMock,
  hasNostrGitProvider: () => Boolean(nostrProviderMock),
  initializeNostrGitProvider: initializeNostrGitProviderMock,
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
    nostrProviderMock = undefined
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
    initializeNostrGitProviderMock.mockResolvedValue(undefined)
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

  it("fails a strict Nostr remote before Git work when its provider is unavailable", async () => {
    await exposed.setEventIO({})

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      repoRelays: [GRASP_RELAY],
    })

    expect(res).toEqual(
      expect.objectContaining({
        success: false,
        error: "NostrGitProvider is not ready for Nostr repository push",
      }),
    )
    expect(addRemoteMock).not.toHaveBeenCalled()
    expect(listRemotesMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resolveRefMock).not.toHaveBeenCalled()
    expect(writeRefMock).not.toHaveBeenCalled()
    expect(httpFetchMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("rejects provider-managed Nostr pushes until real state publication exists", async () => {
    const pushSpy = vi.fn(async () => ({}))
    nostrProviderMock = {push: pushSpy}
    await exposed.setEventIO({})

    // Act: call pushToRemote on exposed API
    // Use a Nostr URL pattern to trigger the NostrGitProvider path
    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      repoRelays: [" WSS://RELAY.NGIT.DEV/ ", "wss://relay.ngit.dev"],
    })

    expect(res).toEqual(
      expect.objectContaining({
        success: false,
        error:
          "Provider-managed Nostr repository pushes are unavailable until real state publication is implemented",
      }),
    )
    expect(pushSpy).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
    expect(addRemoteMock).not.toHaveBeenCalled()
  })

  it("fails a Nostr provider push with empty relay scope before provider or git work", async () => {
    const pushSpy = vi.fn(async () => ({}))
    nostrProviderMock = {push: pushSpy}
    await exposed.setEventIO({})
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

  it("rejects failed EventIO configuration and does not reuse a stale Nostr provider", async () => {
    const stalePush = vi.fn(async () => ({}))
    nostrProviderMock = {push: stalePush}
    await exposed.setEventIO({id: "working"})

    const initializationError = new Error("provider initialization failed")
    initializeNostrGitProviderMock.mockRejectedValueOnce(initializationError)
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(exposed.setEventIO({id: "broken"})).rejects.toBe(initializationError)

    const nostrResult = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      repoRelays: [GRASP_RELAY],
    })
    expect(nostrResult).toEqual(
      expect.objectContaining({
        success: false,
        error: "NostrGitProvider is not ready for Nostr repository push",
      }),
    )
    expect(stalePush).not.toHaveBeenCalled()
    expect(addRemoteMock).not.toHaveBeenCalled()
    expect(listRemotesMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(writeRefMock).not.toHaveBeenCalled()
    expect(httpFetchMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()

    const standardResult = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: "https://example.com/owner/repo.git",
      branch: "main",
    })
    expect(standardResult.success).toBe(true)
    expect(pushMock).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })

  it("serializes concurrent EventIO configuration attempts", async () => {
    let releaseFirst!: () => void
    initializeNostrGitProviderMock
      .mockImplementationOnce(
        async () =>
          await new Promise<void>(resolve => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValueOnce(undefined)

    const first = exposed.setEventIO({id: "first"})
    const second = exposed.setEventIO({id: "second"})
    await vi.waitFor(() => expect(initializeNostrGitProviderMock).toHaveBeenCalledTimes(1))

    releaseFirst()
    await Promise.all([first, second])

    expect(initializeNostrGitProviderMock).toHaveBeenCalledTimes(2)
    expect(initializeNostrGitProviderMock).toHaveBeenNthCalledWith(1, {
      eventIO: {id: "first"},
    })
    expect(initializeNostrGitProviderMock).toHaveBeenNthCalledWith(2, {
      eventIO: {id: "second"},
    })
  })

  it.each([
    {
      name: "non-GRASP URL",
      remoteUrl: "https://example.com/owner/repo.git",
      token: GRASP_OWNER_PUBKEY,
      repoRelays: [GRASP_RELAY],
    },
    {
      name: "empty relay scope",
      remoteUrl: GRASP_REMOTE_URL,
      token: GRASP_OWNER_PUBKEY,
      repoRelays: [],
    },
    {
      name: "target relay outside scope",
      remoteUrl: GRASP_REMOTE_URL,
      token: GRASP_OWNER_PUBKEY,
      repoRelays: ["wss://other.example"],
    },
    {
      name: "HTTP relay scope",
      remoteUrl: GRASP_REMOTE_URL,
      token: GRASP_OWNER_PUBKEY,
      repoRelays: ["https://relay.ngit.dev"],
    },
    {
      name: "bare-host relay scope",
      remoteUrl: GRASP_REMOTE_URL,
      token: GRASP_OWNER_PUBKEY,
      repoRelays: ["relay.ngit.dev"],
    },
    {
      name: "invalid pubkey token",
      remoteUrl: GRASP_REMOTE_URL,
      token: "deadbeef",
      repoRelays: [GRASP_RELAY],
    },
    {
      name: "mismatched owner pubkey",
      remoteUrl: GRASP_REMOTE_URL,
      token: "b".repeat(64),
      repoRelays: [GRASP_RELAY],
    },
    {
      name: "non-WSS target",
      remoteUrl: `http://relay.ngit.dev/${GRASP_OWNER_NPUB}/repo.git`,
      token: GRASP_OWNER_PUBKEY,
      repoRelays: ["ws://relay.ngit.dev"],
    },
    {
      name: "credentialed target URL",
      remoteUrl: `https://user:pass@relay.ngit.dev/${GRASP_OWNER_NPUB}/repo.git`,
      token: GRASP_OWNER_PUBKEY,
      repoRelays: [GRASP_RELAY],
    },
    {
      name: "non-canonical service path",
      remoteUrl: `https://relay.ngit.dev/git//${GRASP_OWNER_NPUB}/repo.git`,
      token: GRASP_OWNER_PUBKEY,
      repoRelays: ["wss://relay.ngit.dev/git"],
    },
  ])("rejects explicit GRASP $name before any Git or network work", async options => {
    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      branch: "main",
      provider: "grasp",
      ...options,
    })

    expect(res.success).toBe(false)
    expect(addRemoteMock).not.toHaveBeenCalled()
    expect(listRemotesMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resolveRefMock).not.toHaveBeenCalled()
    expect(writeRefMock).not.toHaveBeenCalled()
    expect(httpFetchMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("records validation failures as known pre-side-effect operation failures", async () => {
    const operationId = "invalid-grasp-authority"
    const result = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      token: GRASP_OWNER_PUBKEY,
      provider: "grasp",
      repoRelays: [],
      operationId,
    })

    expect(result.success).toBe(false)
    expect(exposed.getOperationStatus({operationId})).toMatchObject({
      state: "failed",
      sideEffectMayHaveOccurred: false,
    })
    expect(addRemoteMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("falls back to git.push when no Nostr provider and returns success without blossomSummary", async () => {
    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: "https://example.com/owner/repo.git",
      branch: "main",
    })

    // Assert
    expect(res.success).toBe(true)
    expect(res.branch).toBe("main")
    expect(res.blossomSummary).toBeUndefined()
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it("pushes all requested refs for standard providers", async () => {
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
      token: GRASP_OWNER_PUBKEY,
      provider: "grasp",
      repoRelays: [GRASP_RELAY],
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
      token: GRASP_OWNER_PUBKEY,
      provider: "grasp",
      repoRelays: [GRASP_RELAY],
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
      token: GRASP_OWNER_PUBKEY,
      provider: "grasp",
      repoRelays: [GRASP_RELAY],
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
      token: GRASP_OWNER_PUBKEY,
      provider: "grasp",
      repoRelays: [GRASP_RELAY],
    })

    expect(res.success).toBe(true)
    // 2 initial push attempts (both fail with parse error) + 1 more retry after mismatch
    expect(pushMock).toHaveBeenCalled()
    expect(pushMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it("requires the repository owner pubkey and uses unauthenticated Smart HTTP", async () => {
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
      token: GRASP_OWNER_PUBKEY,
      provider: "grasp",
      repoRelays: [GRASP_RELAY],
    })

    expect(res.success).toBe(true)
    expect(seenAuth).toEqual([undefined, undefined])
  })

  it("preserves a GRASP deployment path when pushing", async () => {
    const pathRemote = `https://relay.ngit.dev/git/${GRASP_OWNER_NPUB}/repo.git`
    httpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({"content-type": "application/x-git-upload-pack-advertisement"}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "003faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\n0000",
    })

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: pathRemote,
      branch: "main",
      token: GRASP_OWNER_PUBKEY,
      provider: "grasp",
      repoRelays: [" WSS://RELAY.NGIT.DEV/git/ "],
    })

    expect(res.success).toBe(true)
    expect(addRemoteMock).toHaveBeenCalledWith({
      dir: "/repos/owner/repo",
      remote: "origin",
      url: pathRemote,
    })
    expect(pushMock).not.toHaveBeenCalled()
  })
})
