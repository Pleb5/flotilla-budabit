import {describe, expect, it, vi} from "vitest"
import {NIP46_PERMS} from "@app/core/state"
import {Nip46Controller} from "./nip46"

describe("Nip46Controller", () => {
  it("requests app permissions in QR nostrconnect URLs", async () => {
    const controller = new Nip46Controller({onNostrConnect: vi.fn()})
    const makeNostrconnectUrl = vi.fn().mockResolvedValue("nostrconnect://test")
    const waitForNostrconnect = vi.fn(
      (_url: string, signal: AbortSignal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(undefined))),
    )

    controller.broker = {
      makeNostrconnectUrl,
      waitForNostrconnect,
      cleanup: vi.fn(),
    } as any

    const started = controller.start()
    await Promise.resolve()
    await Promise.resolve()

    expect(makeNostrconnectUrl).toHaveBeenCalledWith(expect.objectContaining({perms: NIP46_PERMS}))

    controller.stop()
    await started
  })
})
