import {describe, expect, it, vi} from "vitest"

import {ImportAbortController, ImportAbortedError} from "../../src/git/abort-controller.js"

describe("ImportAbortController", () => {
  it("detaches listeners after thousands of successful and failed operations", async () => {
    const controller = new ImportAbortController()
    const add = vi.spyOn(controller.signal, "addEventListener")
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    for (let i = 0; i < 2000; i++) await controller.raceWithAbort(Promise.resolve(i))
    await expect(controller.raceWithAbort(Promise.reject(new Error("failed")))).rejects.toThrow(
      "failed",
    )
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length)
    add.mock.calls.forEach(([type, listener], i) => {
      expect(remove.mock.calls[i]).toEqual([type, listener])
    })
  })

  it("settles cancellation without waiting for an unresolved operation", async () => {
    const controller = new ImportAbortController()
    const result = controller.raceWithAbort(new Promise(() => {}))
    controller.abort("stop")
    await expect(result).rejects.toThrow("stop")
  })
  it("rejects waitForAbort when abort is triggered", async () => {
    const controller = new ImportAbortController()
    const waitPromise = controller.waitForAbort()

    controller.abort("user cancelled")

    await expect(waitPromise).rejects.toBeInstanceOf(ImportAbortedError)
    await expect(waitPromise).rejects.toThrow("user cancelled")
  })

  it("rejects waitForAbort immediately when already aborted", async () => {
    const controller = new ImportAbortController()
    controller.abort("already cancelled")

    await expect(controller.waitForAbort()).rejects.toBeInstanceOf(ImportAbortedError)
    await expect(controller.waitForAbort()).rejects.toThrow("already cancelled")
  })

  it("resets abort state and signal", () => {
    const controller = new ImportAbortController()
    controller.abort("cancel once")

    expect(controller.signal.aborted).toBe(true)
    expect(() => controller.throwIfAborted()).toThrow(ImportAbortedError)

    controller.reset()

    expect(controller.signal.aborted).toBe(false)
    expect(controller.isAborted()).toBe(false)
    expect(() => controller.throwIfAborted()).not.toThrow()
  })
})
