// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {accessExtensionStorage, storageRevision, supportsAtomicStorage} from "./storage-concurrency"

const locations = ["test:current", "test:legacy"]
const scope = vi.fn()
const access = (operation: Parameters<typeof accessExtensionStorage>[1], max = 1024) =>
  accessExtensionStorage(locations, operation, scope, max)

beforeEach(() => {
  localStorage.clear()
  scope.mockReset()
  vi.stubGlobal("navigator", {locks: {request: vi.fn(async (_key, _opts, work) => work())}})
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("conditional extension storage", () => {
  it("validates required revisions/data and the UTF-8 value limit before modifying storage", async () => {
    for (const expectedRevision of [undefined, "", 1, "invalid"]) {
      await expect(access({action: "compareAndSet", expectedRevision, data: {}})).rejects.toThrow(
        "revision",
      )
    }
    await expect(access({action: "compareAndSet", expectedRevision: null})).rejects.toThrow(
      "requires data",
    )
    await expect(
      access({action: "compareAndSet", expectedRevision: null, data: "é".repeat(10)}, 20),
    ).rejects.toThrow("maximum size")
    expect(localStorage.length).toBe(0)
  })

  it("pins corrupt JSON for conditional discard without pretending the slot is empty", async () => {
    localStorage.setItem(locations[0], "{invalid")
    const read = await access({action: "get", withRevision: true})
    expect(read).toEqual({
      status: "ok",
      data: null,
      invalid: true,
      atomic: true,
      revision: storageRevision("{invalid"),
    })
    await expect(access({action: "get"})).rejects.toThrow()
    expect(await access({action: "compareAndSet", expectedRevision: null, data: {}})).toEqual({
      status: "conflict",
    })
    expect(
      await access({action: "compareAndSet", expectedRevision: read.revision, data: null}),
    ).toEqual({status: "ok", revision: null})
  })

  it("migrates legacy bytes under the same lock used for normal and conditional writes/removal", async () => {
    const raw = JSON.stringify({batch: "legacy"})
    localStorage.setItem(locations[1], raw)
    expect(await access({action: "get", withRevision: true})).toMatchObject({
      data: {batch: "legacy"},
      revision: storageRevision(raw),
    })
    expect(localStorage.getItem(locations[1])).toBeNull()
    expect(localStorage.getItem(locations[0])).toBe(raw)
    await access({action: "set", data: {batch: "next"}})
    await access({action: "remove"})
    expect(vi.mocked(navigator.locks.request).mock.calls.map(([name]) => name)).toEqual(
      Array(3).fill("budabit:storage:test:current"),
    )
    expect(scope).toHaveBeenCalledTimes(3)
    expect(localStorage.length).toBe(0)
  })

  it("does not downgrade atomic calls when locks are missing or fail", async () => {
    vi.stubGlobal("navigator", {})
    expect(supportsAtomicStorage()).toBe(false)
    await expect(access({action: "get", withRevision: true})).rejects.toThrow("Web Locks")
    vi.stubGlobal("navigator", {
      locks: {request: vi.fn().mockRejectedValue(new Error("lock denied"))},
    })
    await expect(
      access({action: "compareAndSet", expectedRevision: null, data: {}}),
    ).rejects.toThrow("lock denied")
    expect(scope).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })
})
