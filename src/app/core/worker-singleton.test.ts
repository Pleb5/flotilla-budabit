import {afterEach, describe, expect, it, vi} from "vitest"

const mockGetGitWorker = vi.fn().mockImplementation(() => {
  const worker = {terminate: vi.fn()}
  return {
    api: {
      ping: vi.fn().mockResolvedValue({success: true}),
      setGitConfig: vi.fn().mockResolvedValue(undefined),
      pushToRemote: vi.fn().mockResolvedValue({success: true}),
    },
    worker,
  }
})
const mockConfigureWorkerEventIO = vi.fn().mockResolvedValue(undefined)

vi.mock("@nostr-git/core/worker", () => ({
  getGitWorker: (opts: any) => mockGetGitWorker(opts),
  configureWorkerEventIO: (api: any, eventIO: any) => mockConfigureWorkerEventIO(api, eventIO),
}))

vi.mock("@nostr-git/core/worker/worker.js?url", () => ({
  default: "/worker.js",
}))

vi.mock("@app/core/event-io", () => ({
  createEventIO: vi.fn(() => ({
    fetchEvents: vi.fn(),
    publishEvent: vi.fn(),
    getCurrentPubkey: () => null,
  })),
}))

describe("worker-singleton", () => {
  afterEach(async () => {
    const {terminateGitWorker} = await import("./worker-singleton")
    terminateGitWorker()
    vi.clearAllMocks()
  })

  it("getInitializedGitWorker returns worker with api", async () => {
    const {getInitializedGitWorker} = await import("./worker-singleton")

    const {api, worker} = await getInitializedGitWorker()

    expect(api).toBeDefined()
    expect(api.ping).toBeDefined()
    expect(worker).toBeDefined()
    expect(mockGetGitWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        workerUrl: "/worker.js",
        onError: expect.any(Function),
      }),
    )
  })

  it("keeps standard Git usable and does not log EventIO success when configuration rejects", async () => {
    const initializationError = new Error("Nostr provider unavailable")
    mockConfigureWorkerEventIO.mockRejectedValueOnce(initializationError)
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const {getInitializedGitWorker} = await import("./worker-singleton")
    const {api} = await getInitializedGitWorker()

    expect(consoleLog).not.toHaveBeenCalledWith("[GitWorker] EventIO configured successfully")
    expect(consoleWarn).toHaveBeenCalledWith(
      "[GitWorker] Failed to configure EventIO:",
      initializationError,
    )
    await expect(
      api.pushToRemote({
        repoId: "owner/repo",
        remoteUrl: "https://example.com/owner/repo.git",
      }),
    ).resolves.toEqual({success: true})

    consoleLog.mockRestore()
    consoleWarn.mockRestore()
  })

  it("getInitializedGitWorker returns same instance on subsequent calls", async () => {
    const {getInitializedGitWorker} = await import("./worker-singleton")

    const a = await getInitializedGitWorker()
    const b = await getInitializedGitWorker()

    expect(a).toBe(b)
    expect(mockGetGitWorker).toHaveBeenCalledTimes(1)
  })

  it("isGitWorkerInitialized returns false before init, true after", async () => {
    const {getInitializedGitWorker, isGitWorkerInitialized, terminateGitWorker} =
      await import("./worker-singleton")

    expect(isGitWorkerInitialized()).toBe(false)

    await getInitializedGitWorker()
    expect(isGitWorkerInitialized()).toBe(true)

    terminateGitWorker()
    expect(isGitWorkerInitialized()).toBe(false)
  })

  it("terminateGitWorker terminates worker and clears instance", async () => {
    const {getInitializedGitWorker, terminateGitWorker} = await import("./worker-singleton")

    const {worker} = await getInitializedGitWorker()
    terminateGitWorker()

    expect(worker.terminate).toHaveBeenCalled()

    const {worker: worker2} = await getInitializedGitWorker()
    expect(worker2).not.toBe(worker)
  })

  it("terminateGitWorker also terminates a worker still initializing", async () => {
    let resolvePing: (value: {success: boolean}) => void = () => {}
    const ping = new Promise<{success: boolean}>(resolve => {
      resolvePing = resolve
    })
    const worker = {terminate: vi.fn()}
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    mockGetGitWorker.mockImplementationOnce(() => ({
      api: {
        ping: vi.fn(() => ping),
        setGitConfig: vi.fn().mockResolvedValue(undefined),
      },
      worker,
    }))

    const {getInitializedGitWorker, terminateGitWorker} = await import("./worker-singleton")
    const pending = getInitializedGitWorker()

    await Promise.resolve()
    terminateGitWorker()
    resolvePing({success: true})

    await expect(pending).rejects.toThrow("Git worker initialization cancelled")
    expect(worker.terminate).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("setGitWorkerConfig updates config", async () => {
    const {getInitializedGitWorker, setGitWorkerConfig} = await import("./worker-singleton")

    setGitWorkerConfig({defaultCorsProxy: "https://custom.proxy.com"})
    const {api} = await getInitializedGitWorker()

    expect(api.setGitConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultCorsProxy: "https://custom.proxy.com",
      }),
    )
  })

  it("fans out operation progress and supports unsubscribe", async () => {
    const {getInitializedGitWorker, subscribeGitWorkerProgress} = await import("./worker-singleton")
    const listener = vi.fn()
    const unsubscribe = subscribeGitWorkerProgress(listener)

    await getInitializedGitWorker()
    const init = mockGetGitWorker.mock.calls.at(-1)?.[0]
    const event = {
      type: "git-progress",
      operationId: "import:1",
      repoId: "owner/repo",
      operation: "clone",
      phase: "Receiving objects",
      loaded: 2,
      total: 4,
      unit: "objects",
    }

    init.onProgress(event)
    expect(listener).toHaveBeenCalledWith(event)

    unsubscribe()
    init.onProgress({...event, loaded: 3})
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
