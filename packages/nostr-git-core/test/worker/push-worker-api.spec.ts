import {beforeEach, describe, it, expect, vi} from "vitest"
import "fake-indexeddb/auto"
import {nip19} from "nostr-tools"

const pushMock = vi.fn(async (_opts?: any) => undefined)
const fetchMock = vi.fn(async () => undefined)
const addRemoteMock = vi.fn(async () => undefined)
const listRemotesMock = vi.fn(async () => [])
const listServerRefsMock = vi.fn(async () => [] as Array<{ref: string; oid: string}>)
const resolveRefMock = vi.fn(async () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
const logMock = vi.fn(async () => [] as any[])
const writeRefMock = vi.fn(async () => undefined)
const addMock = vi.fn(async () => undefined)
const commitMock = vi.fn(async () => "f".repeat(40))
const initMock = vi.fn(async () => undefined)
const mkdirMock = vi.fn(async () => undefined)
const writeFileMock = vi.fn(async () => undefined)
const readCommitMock = vi.fn(async ({oid}: {oid: string}) => ({
  oid,
  commit: {
    author: {name: "Test", email: "test@example.com", timestamp: 1},
    message: "commit",
    parent: [],
  },
}))
const walkMock = vi.fn(async () => [])
const readBlobMock = vi.fn(async () => ({blob: new Uint8Array()}))
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
    listServerRefs: listServerRefsMock,
    resolveRef: resolveRefMock,
    writeRef: writeRefMock,
    add: addMock,
    commit: commitMock,
    init: initMock,
    readCommit: readCommitMock,
    walk: walkMock,
    readBlob: readBlobMock,
    TREE: ({ref}: {ref: string}) => ({ref}),
    // Other methods may be referenced in unrelated API paths but are not invoked here
    statusMatrix: vi.fn(async () => []),
    log: logMock,
    listBranches: vi.fn(async () => ["main"]),
  }),
}))

// Mock provider FS accessor to a minimal FS
vi.mock("../../src/worker/workers/fs-utils.js", () => ({
  getProviderFs: (_g: any) => ({
    promises: {stat: async () => ({}), mkdir: mkdirMock, writeFile: writeFileMock},
  }),
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
    listServerRefsMock.mockReset().mockResolvedValue([])
    resolveRefMock.mockReset()
    logMock.mockReset()
    writeRefMock.mockReset()
    addMock.mockReset()
    commitMock.mockReset()
    initMock.mockReset()
    mkdirMock.mockReset()
    writeFileMock.mockReset()
    readCommitMock.mockClear()
    walkMock.mockClear()
    readBlobMock.mockReset()
    httpFetchMock.mockReset()
    nostrProviderMock = undefined
    pushMock.mockResolvedValue(undefined)
    fetchMock.mockResolvedValue(undefined)
    addRemoteMock.mockResolvedValue(undefined)
    listRemotesMock.mockResolvedValue([])
    resolveRefMock.mockResolvedValue("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    logMock.mockResolvedValue([])
    writeRefMock.mockResolvedValue(undefined)
    addMock.mockResolvedValue(undefined)
    commitMock.mockResolvedValue("f".repeat(40))
    initMock.mockResolvedValue(undefined)
    mkdirMock.mockResolvedValue(undefined)
    writeFileMock.mockResolvedValue(undefined)
    readBlobMock.mockResolvedValue({blob: new Uint8Array()})
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

  it("refuses changed initial-import tips and never repairs them with a new fetch", async () => {
    const params = {
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      provider: "grasp",
      token: GRASP_OWNER_PUBKEY,
      repoRelays: [GRASP_RELAY],
      refs: ["refs/heads/main"],
      initialImportRefs: [{ref: "refs/heads/main", oid: "b".repeat(40)}],
    }
    const changed = await exposed.pushToRemote(params)
    expect(changed.success).toBe(false)
    expect(pushMock).not.toHaveBeenCalled()
    pushMock.mockRejectedValue(new Error("missing necessary objects"))
    const incomplete = await exposed.pushToRemote({
      ...params,
      initialImportRefs: [{ref: "refs/heads/main", oid: "a".repeat(40)}],
    })
    expect(incomplete.success).toBe(false)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("pushes pinned initial-import heads and tags without force and verifies bounded advertisements", async () => {
    const refs = [
      {ref: "refs/heads/main", oid: "a".repeat(40)},
      {ref: "refs/tags/v1", oid: "b".repeat(40)},
    ]
    const remote: typeof refs = []
    listServerRefsMock.mockImplementation(async () => remote)
    resolveRefMock.mockImplementation(
      async (args: any) => refs.find(item => item.ref === args.ref)?.oid || "",
    )
    pushMock.mockImplementation(async (args: any) => {
      remote.push(refs.find(item => item.ref === args.remoteRef)!)
    })
    const result = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      provider: "grasp",
      token: GRASP_OWNER_PUBKEY,
      repoRelays: [GRASP_RELAY],
      refs: refs.map(item => item.ref),
      initialImportRefs: refs,
    })
    expect(result.success).toBe(true)
    expect(pushMock).toHaveBeenCalledTimes(2)
    expect(pushMock.mock.calls.every(([args]) => args.force === false)).toBe(true)
    expect(listServerRefsMock).toHaveBeenCalledWith(
      expect.objectContaining({maxHttpBytes: 2 * 1024 * 1024, corsProxy: null}),
    )
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

  it("fails a strict Nostr remote before Git work while the direct provider is disabled", async () => {
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
        error: "Direct NostrGitProvider is disabled for worker push",
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

  it("rejects an explicit Bitbucket provider before custom-host Git work", async () => {
    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: "https://git.example.com/owner/repo.git",
      branch: "main",
      provider: "bitbucket",
    })

    expect(res).toEqual(
      expect.objectContaining({
        success: false,
        error: "Bitbucket provider is disabled for worker push",
      }),
    )
    expect(resolveRefMock).not.toHaveBeenCalled()
    expect(addRemoteMock).not.toHaveBeenCalled()
    expect(listRemotesMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(httpFetchMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it.each([
    ["bitbucket", "Bitbucket provider is disabled for file update"],
    ["grasp", "GRASP file updates require the coordinated pushToRemote flow"],
  ])("rejects %s updateAndPushFiles before local or remote Git work", async (provider, error) => {
    const res = await exposed.updateAndPushFiles({
      repoId: "owner/repo",
      dir: "/repos/owner/repo",
      remoteUrl: "https://github.com/owner/repo.git",
      files: [{path: "README.md", content: "updated"}],
      commitMessage: "Update README",
      token: "token",
      provider,
    })

    expect(res).toEqual({success: false, error})
    expect(resolveRefMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("pushes file edits to the explicit declared remote", async () => {
    const remoteUrl = "https://github.com/owner/repo.git"
    const res = await exposed.updateAndPushFiles({
      repoId: "owner/repo",
      dir: "/repos/owner/repo",
      remoteUrl,
      files: [{path: "README.md", content: "updated"}],
      commitMessage: "Update README",
      token: "token",
      provider: "github",
    })

    expect(res).toEqual({success: true, commitId: "f".repeat(40)})
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({dir: "/repos/owner/repo", url: remoteUrl}),
    )
  })

  it("rejects mismatched exact-OID evidence from a scoped clone fallback", async () => {
    const requestedOid = "a".repeat(40)
    const staleOid = "b".repeat(40)
    logMock.mockResolvedValue([{oid: requestedOid}])
    fetchMock.mockResolvedValue({fetchHead: staleOid})

    const result = await exposed.getCommitMeta({
      repoId: "owner/repo",
      commitId: requestedOid,
      cloneUrls: ["https://authorized.example/owner/repo.git"],
      cloneFallbackReason: "missing-filter-capability",
    })

    expect(result.success).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: requestedOid,
        url: "https://authorized.example/owner/repo.git",
      }),
    )
    expect(readCommitMock).not.toHaveBeenCalled()
  })

  it("accepts lowercase fetch evidence for an uppercase requested OID", async () => {
    const fetchedOid = "c".repeat(40)
    const requestedOid = fetchedOid.toUpperCase()
    logMock.mockResolvedValue([{oid: fetchedOid}])
    fetchMock.mockResolvedValue({fetchHead: fetchedOid})

    const result = await exposed.getCommitMeta({
      repoId: "owner/repo",
      commitId: requestedOid,
      cloneUrls: ["https://authorized.example/owner/repo.git"],
      cloneFallbackReason: "missing-filter-capability",
    })

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ref: fetchedOid}))
    expect(readCommitMock).toHaveBeenCalledWith(expect.objectContaining({oid: fetchedOid}))
  })

  it("normalizes uppercase OIDs for commit detail object reads", async () => {
    const fetchedOid = "d".repeat(40)
    const requestedOid = fetchedOid.toUpperCase()
    logMock.mockResolvedValue([
      {
        oid: fetchedOid,
        commit: {
          author: {name: "Test", email: "test@example.com", timestamp: 1},
          message: "commit",
          parent: [],
        },
      },
    ])
    fetchMock.mockResolvedValue({fetchHead: fetchedOid})

    const result = await exposed.getCommitDetails({
      repoId: "owner/repo",
      commitId: requestedOid,
      cloneUrls: ["https://authorized.example/owner/repo.git"],
      cloneFallbackReason: "missing-filter-capability",
    })

    expect(result.success).toBe(true)
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ref: fetchedOid}))
    expect(walkMock).toHaveBeenCalledWith(
      expect.objectContaining({trees: [expect.objectContaining({ref: fetchedOid})]}),
    )
  })

  it("fails clone-backed commit details when a changed blob cannot be read", async () => {
    const commitId = "e".repeat(40)
    const blobOid = "f".repeat(40)
    logMock.mockResolvedValue([
      {
        oid: commitId,
        commit: {
          author: {name: "Test", email: "test@example.com", timestamp: 1},
          message: "root commit",
          parent: [],
        },
      },
    ])
    fetchMock.mockResolvedValue({fetchHead: commitId})
    walkMock.mockResolvedValue([{path: "README.md", oid: blobOid, mode: "100644", type: "blob"}])
    readBlobMock.mockRejectedValue(new Error("blob read failed"))

    const result = await exposed.getCommitDetails({
      repoId: "owner/repo",
      commitId,
      cloneUrls: ["https://authorized.example/owner/repo.git"],
      cloneFallbackReason: "missing-filter-capability",
    })

    expect(result).toMatchObject({success: false, error: "blob read failed"})
  })

  it("serializes file edits and local creation behind an active repository push", async () => {
    let releasePush!: () => void
    const pushGate = new Promise<void>(resolve => {
      releasePush = resolve
    })
    pushMock.mockImplementationOnce(async () => await pushGate)

    const pushing = exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: "https://github.com/owner/repo.git",
      branch: "main",
    })
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledOnce())

    const editing = exposed.updateAndPushFiles({
      repoId: "owner/repo",
      dir: "/repos/owner/repo",
      remoteUrl: "https://github.com/owner/repo.git",
      files: [{path: "README.md", content: "updated"}],
      commitMessage: "Update README",
      token: "token",
      provider: "github",
    })
    const creating = exposed.createLocalRepo({
      repoId: "owner/repo",
      name: "repo",
      authorName: "Test",
      authorEmail: "test@example.com",
    })
    await Promise.resolve()
    expect(writeFileMock).not.toHaveBeenCalled()
    expect(initMock).not.toHaveBeenCalled()

    releasePush()
    await Promise.all([pushing, editing, creating])
    expect(writeFileMock).toHaveBeenCalled()
    expect(initMock).toHaveBeenCalledOnce()
  })

  it("rejects provider-managed Nostr pushes while the direct provider is disabled", async () => {
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
        error: "Direct NostrGitProvider is disabled for worker push",
      }),
    )
    expect(pushSpy).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
    expect(addRemoteMock).not.toHaveBeenCalled()
  })

  it("applies the direct-provider policy before validating Nostr relay scope", async () => {
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
        error: "Direct NostrGitProvider is disabled for worker push",
      }),
    )
    expect(pushSpy).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
    expect(writeRefMock).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("configures EventIO without initializing or reusing the disabled direct provider", async () => {
    const stalePush = vi.fn(async () => ({}))
    nostrProviderMock = {push: stalePush}
    await exposed.setEventIO({id: "working"})
    await exposed.setEventIO({id: "replacement"})
    expect(initializeNostrGitProviderMock).not.toHaveBeenCalled()

    const nostrResult = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      repoRelays: [GRASP_RELAY],
    })
    expect(nostrResult).toEqual(
      expect.objectContaining({
        success: false,
        error: "Direct NostrGitProvider is disabled for worker push",
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
  })

  it("accepts concurrent EventIO configuration without direct-provider initialization", async () => {
    const first = exposed.setEventIO({id: "first"})
    const second = exposed.setEventIO({id: "second"})
    await Promise.all([first, second])
    expect(initializeNostrGitProviderMock).not.toHaveBeenCalled()
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

  it("rejects a moved branch before pushing an asserted source OID", async () => {
    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: "https://example.com/owner/repo.git",
      branch: "main",
      expectedSourceOid: "b".repeat(40),
    })

    expect(res.success).toBe(false)
    expect(res.reason).toBe("source_changed")
    expect(pushMock).not.toHaveBeenCalled()
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

  it("accepts a maintainer token for an owner-scoped GRASP push", async () => {
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
      token: "b".repeat(64),
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
    expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({url: GRASP_REMOTE_URL}))
  })

  it("reconciles an empty receive-pack response without repeating the push", async () => {
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
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it("records an unreconciled receive-pack response as an unknown operation", async () => {
    pushMock.mockRejectedValueOnce(
      new Error('Expected "unpack ok" or "unpack [error message]" but received "".'),
    )
    httpFetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
    })

    const res = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: GRASP_REMOTE_URL,
      branch: "main",
      token: GRASP_OWNER_PUBKEY,
      provider: "grasp",
      repoRelays: [GRASP_RELAY],
      operationId: "ambiguous-grasp-push",
    })

    expect(res.success).toBe(false)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(await exposed.getOperationStatus({operationId: "ambiguous-grasp-push"})).toMatchObject({
      state: "unknown",
      sideEffectMayHaveOccurred: true,
    })
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
    expect(pushMock).toHaveBeenCalledTimes(1)
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
    const pathRemote = `https://relay.ngit.dev/git/${GRASP_OWNER_NPUB}/repo.git?tenant=x`
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
      repoRelays: [" WSS://RELAY.NGIT.DEV/git/?tenant=x "],
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
