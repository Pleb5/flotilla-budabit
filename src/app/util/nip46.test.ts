import {get} from "svelte/store"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {pushToast} from "@app/util/toast"
import {Nip46Controller} from "./nip46"

vi.mock("@app/util/toast", () => ({pushToast: vi.fn()}))

describe("Nip46Controller", () => {
  beforeEach(() => {
    vi.mocked(pushToast).mockClear()
  })

  it("does not request explicit permissions in QR nostrconnect URLs", async () => {
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

    expect(makeNostrconnectUrl).toHaveBeenCalledOnce()
    expect(makeNostrconnectUrl.mock.calls[0][0]).not.toHaveProperty("perms")

    controller.stop()
    await started
  })

  it("reports async finalization failures and clears loading", async () => {
    const error = new Error("finalization failed")
    const response = {
      id: "response",
      url: "wss://relay.example",
      result: "secret",
      event: {pubkey: "f".repeat(64)},
    }
    const controller = new Nip46Controller({onNostrConnect: vi.fn().mockRejectedValue(error)})
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    controller.broker = {
      makeNostrconnectUrl: vi.fn().mockResolvedValue("nostrconnect://test"),
      waitForNostrconnect: vi.fn().mockResolvedValue(response),
      cleanup: vi.fn(),
    } as any

    await controller.start()

    expect(controller.onNostrConnect).toHaveBeenCalledWith(response)
    expect(consoleError).toHaveBeenCalledWith(error)
    expect(pushToast).toHaveBeenCalledWith({
      theme: "error",
      message: "Something went wrong, please try again!",
    })
    expect(get(controller.loading)).toBe(false)

    consoleError.mockRestore()
  })
})
