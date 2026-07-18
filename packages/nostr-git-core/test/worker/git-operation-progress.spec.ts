import {webcrypto} from "node:crypto"
import {beforeEach, describe, expect, it, vi} from "vitest"
import type {GitOperationProgressEvent} from "../../src/worker/progress.js"
import type {GitOperationStatusEvent} from "../../src/worker/operations.js"

const postMessageMock = vi.fn()
const pushMock = vi.fn(async (_opts?: any) => undefined)
const listServerRefsMock = vi.fn(async (_opts?: any) => [
  {ref: "refs/heads/main", oid: "a".repeat(40)},
])
const cloneMock = vi.fn(async (opts: any) => {
  opts.onProgress?.({phase: "Counting objects", loaded: 17, total: 31})
  opts.onProgress?.({phase: "Receiving objects", loaded: 1009, total: 4093})
  opts.onProgress?.({phase: "Resolving deltas", loaded: 23, total: 47})
  opts.onProgress?.({phase: "Updating workdir", loaded: 5, total: 13})
})

let exposed: any

vi.stubGlobal("self", {postMessage: postMessageMock, isSecureContext: true, crypto: webcrypto})

vi.mock("comlink", () => ({
  expose: (value: any) => {
    exposed = value
  },
}))

vi.mock("../../src/git/factory-browser.js", () => ({
  createGitProvider: () => ({
    clone: cloneMock,
    push: pushMock,
    listServerRefs: listServerRefsMock,
    checkout: vi.fn(async () => undefined),
    resolveRef: vi.fn(async () => "a".repeat(40)),
    listBranches: vi.fn(async () => ["main"]),
    addRemote: vi.fn(async () => undefined),
    setConfig: vi.fn(async () => undefined),
    statusMatrix: vi.fn(async () => []),
  }),
}))

vi.mock("../../src/worker/workers/fs-utils.js", () => ({
  getProviderFs: () => ({promises: {stat: vi.fn(async () => ({}))}}),
  isRepoClonedFs: vi.fn(async () => true),
  ensureDir: vi.fn(async () => undefined),
}))

vi.mock("../../src/worker/workers/cache.js", () => ({
  RepoCacheManager: class {
    async init() {}
    async setRepoCache() {}
  },
}))

vi.mock("../../src/api/git-provider.js", () => ({
  getNostrGitProvider: () => undefined,
  hasNostrGitProvider: () => false,
  initializeNostrGitProvider: () => undefined,
}))

await import("../../src/worker/worker.js")

function progressEvents(): GitOperationProgressEvent[] {
  return postMessageMock.mock.calls
    .map(([event]) => event)
    .filter((event): event is GitOperationProgressEvent => event?.type === "git-progress")
}

function statusEvents(): GitOperationStatusEvent[] {
  return postMessageMock.mock.calls
    .map(([event]) => event)
    .filter((event): event is GitOperationStatusEvent => event?.type === "git-operation-status")
}

describe("operation-scoped Git worker progress", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listServerRefsMock.mockResolvedValue([{ref: "refs/heads/main", oid: "a".repeat(40)}])
    pushMock.mockResolvedValue(undefined)
  })

  it("serializes and correlates native clone phases without changing counts", async () => {
    const operationId = "clone-operation-1"
    const target = "https://example.com/owner/repo.git"

    await exposed.cloneRemoteRepo({
      url: target,
      dir: "/repos/owner/repo",
      operationId,
    })

    const events = progressEvents()
    expect(JSON.parse(JSON.stringify(events))).toEqual(events)
    expect(events.every(event => event.operationId === operationId)).toBe(true)
    expect(events.every(event => event.repoId === "owner/repo")).toBe(true)
    expect(events.every(event => event.operation === "clone" && event.target === target)).toBe(true)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "Counting objects",
          loaded: 17,
          total: 31,
          unit: "objects",
        }),
        expect.objectContaining({
          phase: "Receiving objects",
          loaded: 1009,
          total: 4093,
          unit: "objects",
        }),
        expect.objectContaining({
          phase: "Resolving deltas",
          loaded: 23,
          total: 47,
          unit: "deltas",
        }),
        expect.objectContaining({
          phase: "Updating workdir",
          loaded: 5,
          total: 13,
          unit: "files",
        }),
      ]),
    )
    expect(events.every(event => !("progress" in event))).toBe(true)
    const signal = cloneMock.mock.calls[0][0].signal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(listServerRefsMock.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
    expect(listServerRefsMock.mock.calls[0][0].signal.aborted).toBe(false)
    expect(statusEvents().at(-1)).toMatchObject({operationId, state: "completed"})
  })

  it("emits indeterminate push boundaries and only real ref counts", async () => {
    const operationId = "push-operation-1"
    const target = "https://example.com/owner/repo.git"
    const refs = ["refs/heads/main", "refs/heads/topic"]

    const result = await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: target,
      refs,
      operationId,
    })

    expect(result.success).toBe(true)
    const events = progressEvents()
    expect(JSON.parse(JSON.stringify(events))).toEqual(events)
    expect(events.every(event => event.operationId === operationId)).toBe(true)
    expect(events.every(event => event.operation === "push" && event.target === target)).toBe(true)

    const activeEvents = events.filter(event => event.phase === "Pushing ref")
    expect(activeEvents).toEqual([
      expect.objectContaining({ref: refs[0], total: 2, unit: "refs"}),
      expect.objectContaining({ref: refs[1], total: 2, unit: "refs"}),
    ])
    expect(activeEvents.every(event => event.loaded === undefined)).toBe(true)

    const completedEvents = events.filter(event => event.phase === "Ref pushed")
    expect(completedEvents.map(event => [event.ref, event.loaded, event.total])).toEqual([
      [refs[0], 1, 2],
      [refs[1], 2, 2],
    ])
    expect(events.every(event => event.unit === "refs")).toBe(true)
    expect(events.every(event => !("progress" in event))).toBe(true)
    expect(pushMock.mock.calls.every(([options]) => options.signal instanceof AbortSignal)).toBe(
      true,
    )
  })

  it("cancels clone ref discovery cleanly before local side effects", async () => {
    let discoverySignal: AbortSignal | undefined
    listServerRefsMock.mockImplementationOnce(
      async (options: any) =>
        await new Promise((_resolve, reject) => {
          discoverySignal = options.signal
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            {once: true},
          )
        }),
    )

    const cloning = exposed.cloneRemoteRepo({
      url: "https://example.com/owner/repo.git",
      dir: "/repos/owner/repo",
      operationId: "cancel-ref-discovery",
    })
    await vi.waitFor(() => expect(discoverySignal).toBeInstanceOf(AbortSignal))

    const cancellation = exposed.cancelOperation({operationId: "cancel-ref-discovery"})
    expect(cancellation).toMatchObject({state: "running", sideEffectMayHaveOccurred: false})
    await expect(cloning).rejects.toThrow(/clone failed.*cancelled/i)

    await expect(
      exposed.waitForOperationTerminal({operationId: "cancel-ref-discovery"}),
    ).resolves.toMatchObject({state: "cancelled", sideEffectMayHaveOccurred: false})
    expect(discoverySignal?.aborted).toBe(true)
    expect(cloneMock).not.toHaveBeenCalled()
  })

  it("passes push signals and reports unknown after the remote boundary", async () => {
    let pushSignal: AbortSignal | undefined
    pushMock.mockImplementationOnce(
      async (options: any) =>
        await new Promise((_resolve, reject) => {
          pushSignal = options.signal
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            {once: true},
          )
        }),
    )

    const pushing = exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: "https://example.com/owner/repo.git",
      branch: "main",
      operationId: "cancel-push-request",
    })
    await vi.waitFor(() => expect(pushSignal).toBeInstanceOf(AbortSignal))

    exposed.cancelOperation({operationId: "cancel-push-request"})
    await expect(pushing).resolves.toMatchObject({success: false})
    await expect(
      exposed.waitForOperationTerminal({operationId: "cancel-push-request"}),
    ).resolves.toMatchObject({state: "unknown", sideEffectMayHaveOccurred: true})
    expect(pushSignal?.aborted).toBe(true)
  })

  it("keeps clone and push defaults silent when operationId is omitted", async () => {
    await exposed.cloneRemoteRepo({
      url: "https://example.com/owner/repo.git",
      dir: "/repos/owner/repo",
    })
    await exposed.pushToRemote({
      repoId: "owner/repo",
      remoteUrl: "https://example.com/owner/repo.git",
      branch: "main",
    })

    expect(progressEvents()).toEqual([])
  })
})
