import {get} from "svelte/store"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {SocketStatus} from "@welshman/net"
import {pushToast} from "@app/util/toast"
import {
  Nip46Controller,
  cycleSignerRelaySockets,
  makeBudabitNip46Broker,
  restartNip46Receiver,
} from "./nip46"

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

  it("falls back to the current relay list when switch_relays fails", async () => {
    const relays = ["wss://relay.example/"]
    const broker = makeBudabitNip46Broker({clientSecret: "1".repeat(64), relays})
    const error = new Error("switch_relays unsupported")
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    vi.spyOn(broker, "send").mockRejectedValue(error)

    await expect(broker.switchRelays()).resolves.toBe(relays)
    expect(broker.params.relays).toBe(relays)
    expect(consoleWarn).toHaveBeenCalledWith(
      "[nip46] Failed to switch relays; keeping current relay list",
      error,
    )

    consoleWarn.mockRestore()
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

  it("ignores resume before the handshake starts", async () => {
    const controller = new Nip46Controller({onNostrConnect: vi.fn()})
    const start = vi.fn()

    controller.broker = {
      params: {relays: []},
      receiver: {abortController: undefined, start},
      cleanup: vi.fn(),
    } as any

    await controller.resume()

    expect(start).not.toHaveBeenCalled()
    expect(get(controller.resumed)).toBe(0)
  })

  it("restarts the receiver on resume, debounced, with retry forcing", async () => {
    const controller = new Nip46Controller({onNostrConnect: vi.fn()})
    const start = vi.fn().mockResolvedValue(undefined)
    const abort = vi.fn()

    controller.broker = {
      params: {relays: ["wss://relay.example/"]},
      receiver: {abortController: {abort}, start},
      makeNostrconnectUrl: vi.fn().mockResolvedValue("nostrconnect://test"),
      waitForNostrconnect: vi.fn(
        (_url: string, signal: AbortSignal) =>
          new Promise((_, reject) => signal.addEventListener("abort", () => reject(undefined))),
      ),
      cleanup: vi.fn(),
    } as any

    const started = controller.start()
    await Promise.resolve()
    await Promise.resolve()

    await controller.resume()

    expect(abort).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
    expect(get(controller.resumed)).toBe(1)

    // A second resume within the debounce window is a no-op
    await controller.resume()

    expect(start).toHaveBeenCalledOnce()
    expect(get(controller.resumed)).toBe(1)

    // Manual retry bypasses the debounce
    await controller.retry()

    expect(start).toHaveBeenCalledTimes(2)
    expect(get(controller.resumed)).toBe(2)

    controller.stop()
    await started

    // After stopping, resume is a no-op again
    await controller.retry()

    expect(start).toHaveBeenCalledTimes(2)
  })
})

describe("cycleSignerRelaySockets", () => {
  it("closes open sockets and skips missing or closed ones", () => {
    const close = vi.fn()
    const sockets = new Map<string, {status: SocketStatus; close: () => void}>([
      ["wss://open.example/", {status: SocketStatus.Open, close}],
      ["wss://closed.example/", {status: SocketStatus.Closed, close: vi.fn()}],
    ])
    const pool = {
      has: (url: string) => sockets.has(url),
      get: (url: string) => sockets.get(url),
    }

    cycleSignerRelaySockets(
      ["wss://open.example/", "wss://closed.example/", "wss://missing.example/"],
      pool as any,
    )

    expect(close).toHaveBeenCalledOnce()
    expect(sockets.get("wss://closed.example/")!.close).not.toHaveBeenCalled()
  })
})

describe("restartNip46Receiver", () => {
  it("aborts the current subscription and starts a fresh one", async () => {
    const abort = vi.fn()
    const start = vi.fn().mockResolvedValue(undefined)
    const receiver = {abortController: {abort}, start}

    await restartNip46Receiver({receiver} as any)

    expect(abort).toHaveBeenCalledOnce()
    expect(receiver.abortController).toBeUndefined()
    expect(start).toHaveBeenCalledOnce()
  })

  it("starts even when no subscription is active", async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const receiver = {abortController: undefined, start}

    await restartNip46Receiver({receiver} as any)

    expect(start).toHaveBeenCalledOnce()
  })
})
