import {describe, expect, it, vi} from "vitest"
import {createDmDecryptionQueue} from "./dm-decryption-queue"

describe("DM decryption budget", () => {
  it("limits concurrency and prioritizes selected messages ahead of previews", async () => {
    const queue = createDmDecryptionQueue<string>(2)
    const started: string[] = []
    const finish = new Map<string, (value: string) => void>()
    const run = (id: string) => () =>
      new Promise<string>(resolve => {
        started.push(id)
        finish.set(id, resolve)
      })
    const first = queue("first", run("first"))
    const second = queue("second", run("second"))
    await Promise.resolve()
    await Promise.resolve()
    const preview = queue("preview", run("preview"))
    const foreground = queue("foreground", run("foreground"), {priority: 100})
    expect(started).toEqual(["first", "second"])
    finish.get("first")!("first")
    await first
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(["first", "second", "foreground"])
    finish.get("second")!("second")
    await second
    await Promise.resolve()
    await Promise.resolve()
    finish.get("foreground")!("foreground")
    finish.get("preview")!("preview")
    await Promise.all([preview, foreground])
  })

  it("drops queued offscreen work and coalesces live consumers safely", async () => {
    const queue = createDmDecryptionQueue<string>(1)
    const run = vi.fn(async () => "plaintext")
    const previewController = new AbortController()
    const preview = queue("shared", run, {signal: previewController.signal})
    const selected = queue("shared", run, {priority: 100})
    previewController.abort()
    const offscreen = new AbortController()
    const discarded = vi.fn(async () => "hidden")
    const hidden = queue("offscreen", discarded, {signal: offscreen.signal})
    offscreen.abort()
    await expect(preview).resolves.toBeUndefined()
    await expect(selected).resolves.toBe("plaintext")
    await expect(hidden).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledTimes(1)
    expect(discarded).not.toHaveBeenCalled()
  })

  it("does not remove replacement work when a cancelled preview releases late", async () => {
    const queue = createDmDecryptionQueue<string>(1)
    const controller = new AbortController()
    const cancelled = queue("same", async () => "old", {signal: controller.signal})
    controller.abort()
    const replacement = queue("same", async () => "new")
    await expect(cancelled).resolves.toBeUndefined()
    await expect(replacement).resolves.toBe("new")
  })
})
