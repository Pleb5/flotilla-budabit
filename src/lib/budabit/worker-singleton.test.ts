import {afterEach, describe, expect, it, vi} from "vitest"

const mockGetGitWorker = vi.fn().mockImplementation(() => {
  const worker = {terminate: vi.fn()}
  return {
    api: {
      ping: vi.fn().mockResolvedValue({success: true}),
      setGitConfig: vi.fn().mockResolvedValue(undefined),
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

vi.mock("./event-io", () => ({
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
})
