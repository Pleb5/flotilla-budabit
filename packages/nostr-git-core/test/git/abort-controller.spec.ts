import {describe, expect, it} from "vitest"

import {ImportAbortController, ImportAbortedError} from "../../src/git/abort-controller.js"

describe("ImportAbortController", () => {
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
