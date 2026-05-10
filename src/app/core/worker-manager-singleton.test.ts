import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mockDispose = vi.fn()
const MockWorkerManager = vi.fn().mockImplementation(() => ({
  dispose: mockDispose,
}))

vi.mock("@nostr-git/ui", () => ({
  WorkerManager: MockWorkerManager,
}))

vi.mock("@nostr-git/core/worker/worker.js?url", () => ({
  default: "worker.js",
}))

describe("worker-manager-singleton", () => {
  beforeEach(() => {
    MockWorkerManager.mockClear()
    mockDispose.mockClear()
  })

  afterEach(async () => {
    const {terminateSharedWorkerManager} = await import("./worker-manager-singleton")
    terminateSharedWorkerManager()
  })

  it("getSharedWorkerManager creates WorkerManager on first call", async () => {
    const {getSharedWorkerManager, isSharedWorkerManagerCreated} =
      await import("./worker-manager-singleton")

    expect(isSharedWorkerManagerCreated()).toBe(false)

    const manager = getSharedWorkerManager()

    expect(MockWorkerManager).toHaveBeenCalledWith(undefined, {workerUrl: "worker.js"})
    expect(manager).toBeDefined()
    expect(manager.dispose).toBeDefined()
    expect(isSharedWorkerManagerCreated()).toBe(true)
  })

  it("getSharedWorkerManager returns same instance on subsequent calls", async () => {
    const {getSharedWorkerManager} = await import("./worker-manager-singleton")

    const a = getSharedWorkerManager()
    const b = getSharedWorkerManager()

    expect(a).toBe(b)
    expect(MockWorkerManager).toHaveBeenCalledTimes(1)
  })

  it("terminateSharedWorkerManager disposes and clears instance", async () => {
    const {getSharedWorkerManager, terminateSharedWorkerManager, isSharedWorkerManagerCreated} =
      await import("./worker-manager-singleton")

    const manager = getSharedWorkerManager()
    terminateSharedWorkerManager()

    expect(mockDispose).toHaveBeenCalled()
    expect(isSharedWorkerManagerCreated()).toBe(false)

    const manager2 = getSharedWorkerManager()
    expect(manager2).not.toBe(manager)
    expect(MockWorkerManager).toHaveBeenCalledTimes(2) // once before terminate, once after
  })
})
