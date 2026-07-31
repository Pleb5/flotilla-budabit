import {get} from "svelte/store"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {addSession, dropSession, getSigner, SessionMethod} from "@welshman/app"
import {MockAdapter, Socket, SocketAdapter, SocketEvent, SocketStatus} from "@welshman/net"
import {Nip46Receiver, Nip46Signer} from "@welshman/signer"
import {pushToast} from "@app/util/toast"
import {
  Nip46Controller,
  cycleSignerRelaySockets,
  makeBudabitNip46Broker,
  recoverActiveNip46Receiver,
  restartNip46Receiver,
  setupActiveNip46ReceiverResumeRecovery,
} from "./nip46"

vi.mock("@app/util/toast", () => ({pushToast: vi.fn()}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

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

  it("does not start waiting if the modal closes during URL generation", async () => {
    let finishUrl!: (url: string) => void
    const controller = new Nip46Controller({onNostrConnect: vi.fn()})
    const waitForNostrconnect = vi.fn()

    controller.broker = {
      makeNostrconnectUrl: vi.fn(() => new Promise(resolve => (finishUrl = resolve))),
      waitForNostrconnect,
      cleanup: vi.fn(),
    } as any

    const started = controller.start()
    controller.stop()
    finishUrl("nostrconnect://test")
    await started

    expect(waitForNostrconnect).not.toHaveBeenCalled()
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

  it("bounds optional switch_relays requests that a signer ignores", async () => {
    vi.useFakeTimers()
    const relays = ["wss://relay.example/"]
    const broker = makeBudabitNip46Broker({clientSecret: "1".repeat(64), relays})
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    vi.spyOn(broker.receiver, "start").mockResolvedValue(undefined)
    vi.spyOn(broker.sender, "send").mockResolvedValue(undefined)

    const switched = broker.switchRelays()
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(switched).resolves.toBe(relays)
    expect(consoleWarn).toHaveBeenCalledWith(
      "[nip46] Failed to switch relays; keeping current relay list",
      expect.objectContaining({error: "NIP-46 request timed out"}),
    )

    broker.cleanup()
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

    vi.useFakeTimers()
    const resumed = controller.resume()
    await vi.advanceTimersByTimeAsync(250)
    await resumed

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

  it("keeps recovery active while the accepted connection is finalized", async () => {
    let finishFinalization!: () => void
    const onNostrConnect = vi.fn(() => new Promise<void>(resolve => (finishFinalization = resolve)))
    const controller = new Nip46Controller({onNostrConnect})
    const receiverStart = vi.fn().mockResolvedValue(undefined)
    const response = {
      id: "response",
      url: "wss://relay.example/",
      result: "secret",
      event: {pubkey: "f".repeat(64)},
    }

    controller.broker = {
      params: {relays: []},
      receiver: {abortController: new AbortController(), start: receiverStart},
      makeNostrconnectUrl: vi.fn().mockResolvedValue("nostrconnect://test"),
      waitForNostrconnect: vi.fn().mockResolvedValue(response),
      cleanup: vi.fn(),
    } as any

    const started = controller.start()
    await vi.waitFor(() => expect(onNostrConnect).toHaveBeenCalledOnce())
    await controller.retry()

    expect(receiverStart).toHaveBeenCalledOnce()
    expect(get(controller.resumed)).toBe(1)

    finishFinalization()
    await started

    await controller.retry()
    expect(receiverStart).toHaveBeenCalledOnce()
  })

  it("delivers a buffered approval before replacing the foregrounded socket", async () => {
    vi.useFakeTimers()
    let accept!: (response: any) => void
    const onNostrConnect = vi.fn()
    const controller = new Nip46Controller({onNostrConnect})
    const receiverStart = vi.fn().mockResolvedValue(undefined)
    const response = {
      id: "response",
      url: "wss://relay.example/",
      result: "secret",
      event: {pubkey: "f".repeat(64)},
    }

    controller.broker = {
      params: {relays: []},
      receiver: {abortController: new AbortController(), start: receiverStart},
      makeNostrconnectUrl: vi.fn().mockResolvedValue("nostrconnect://test"),
      waitForNostrconnect: vi.fn(() => new Promise(resolve => (accept = resolve))),
      cleanup: vi.fn(),
    } as any

    const started = controller.start()
    await vi.waitFor(() => expect(accept).toBeTypeOf("function"))
    const resumed = controller.resume()

    accept(response)
    await started
    await vi.advanceTimersByTimeAsync(250)
    await resumed

    expect(onNostrConnect).toHaveBeenCalledWith(response)
    expect(receiverStart).not.toHaveBeenCalled()
  })
})

describe("cycleSignerRelaySockets", () => {
  it("evicts existing sockets and skips missing ones", () => {
    const sockets = new Set(["wss://open.example/", "wss://closed.example/"])
    const remove = vi.fn((url: string) => sockets.delete(url))
    const pool = {
      has: (url: string) => sockets.has(url),
      remove,
    }

    cycleSignerRelaySockets(
      ["wss://open.example/", "wss://closed.example/", "wss://missing.example/"],
      pool as any,
    )

    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenNthCalledWith(1, "wss://open.example/")
    expect(remove).toHaveBeenNthCalledWith(2, "wss://closed.example/")
  })
})

describe("restartNip46Receiver", () => {
  it("aborts the current subscription, evicts its socket, and starts a fresh one", async () => {
    const abort = vi.fn()
    const start = vi.fn().mockResolvedValue(undefined)
    const receiver = {abortController: {abort}, start}
    const remove = vi.fn()
    const pool = {has: vi.fn(() => true), remove}

    await restartNip46Receiver(
      {params: {relays: ["wss://relay.example/"]}, receiver} as any,
      pool as any,
    )

    expect(abort).toHaveBeenCalledOnce()
    expect(receiver.abortController).toBeUndefined()
    expect(remove).toHaveBeenCalledWith("wss://relay.example/")
    expect(start).toHaveBeenCalledOnce()
    expect(abort.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0])
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0])
  })

  it("starts even when no subscription is active", async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const receiver = {abortController: undefined, start}
    const pool = {has: vi.fn(() => false), remove: vi.fn()}

    await restartNip46Receiver({params: {relays: []}, receiver} as any, pool as any)

    expect(start).toHaveBeenCalledOnce()
  })

  it("coalesces concurrent restarts", async () => {
    let finishStart!: () => void
    const start = vi.fn(() => new Promise<void>(resolve => (finishStart = resolve)))
    const broker = {
      params: {relays: ["wss://relay.example/"]},
      receiver: {abortController: new AbortController(), start},
    } as any
    const pool = {has: vi.fn(() => true), remove: vi.fn()}

    const first = restartNip46Receiver(broker, pool as any)
    const second = restartNip46Receiver(broker, pool as any)
    await Promise.resolve()

    expect(first).toBe(second)
    expect(start).toHaveBeenCalledOnce()
    expect(pool.remove).toHaveBeenCalledOnce()

    finishStart()
    await first
  })
})

describe("recoverActiveNip46Receiver", () => {
  it("cycles and restarts an active persisted NIP-46 receiver without sending a request", async () => {
    const relay = "wss://relay.example/"
    const broker = makeBudabitNip46Broker({
      clientSecret: "1".repeat(64),
      signerPubkey: "2".repeat(64),
      relays: [relay],
    })
    const receiverController = new AbortController()
    const start = vi.spyOn(broker.receiver, "start").mockImplementation(async () => {
      broker.receiver.abortController = new AbortController()
    })
    const send = vi.spyOn(broker, "send")
    const pool = {
      has: vi.fn(() => true),
      remove: vi.fn(),
    }

    broker.receiver.abortController = receiverController

    await expect(
      recoverActiveNip46Receiver({
        session: {
          method: SessionMethod.Nip46,
          pubkey: "3".repeat(64),
          secret: "1".repeat(64),
          handler: {pubkey: "2".repeat(64), relays: [relay]},
        },
        signer: {signer: new Nip46Signer(broker)} as any,
        pool: pool as any,
      }),
    ).resolves.toBe(true)

    expect(receiverController.signal.aborted).toBe(true)
    expect(pool.remove).toHaveBeenCalledWith(relay)
    expect(start).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
  })

  it("starts a persisted NIP-46 receiver that disconnected while the app was hidden", async () => {
    const broker = makeBudabitNip46Broker({
      clientSecret: "1".repeat(64),
      signerPubkey: "2".repeat(64),
      relays: ["wss://relay.example/"],
    })
    const start = vi.spyOn(broker.receiver, "start").mockResolvedValue(undefined)
    const pool = {has: vi.fn(() => false), remove: vi.fn()}

    await expect(
      recoverActiveNip46Receiver({
        session: {
          method: SessionMethod.Nip46,
          pubkey: "3".repeat(64),
          secret: "1".repeat(64),
          handler: {pubkey: "2".repeat(64), relays: broker.params.relays},
        },
        signer: {signer: new Nip46Signer(broker)} as any,
        pool: pool as any,
      }),
    ).resolves.toBe(true)

    expect(pool.has).toHaveBeenCalled()
    expect(start).toHaveBeenCalledOnce()
  })
})

describe("setupActiveNip46ReceiverResumeRecovery", () => {
  it("recovers an active receiver when a tab installed while hidden becomes visible", async () => {
    vi.useFakeTimers()
    const documentListeners = new Map<string, (event: any) => void>()
    const windowListeners = new Map<string, (event: any) => void>()
    const documentMock = {
      visibilityState: "hidden",
      addEventListener: vi.fn((type: string, listener: (event: any) => void) => {
        documentListeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string) => documentListeners.delete(type)),
    }
    const windowMock = {
      addEventListener: vi.fn((type: string, listener: (event: any) => void) => {
        windowListeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string) => windowListeners.delete(type)),
    }
    let time = 10_000
    const recover = vi.fn().mockResolvedValue(true)
    vi.stubGlobal("document", documentMock)
    vi.stubGlobal("window", windowMock)

    const cleanup = setupActiveNip46ReceiverResumeRecovery({recover, now: () => time})
    windowListeners.get("online")?.(new Event("online"))
    await vi.advanceTimersByTimeAsync(250)
    expect(recover).not.toHaveBeenCalled()

    time += 1_500
    documentMock.visibilityState = "visible"
    documentListeners.get("visibilitychange")?.(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(250)

    expect(recover).toHaveBeenCalledOnce()

    cleanup()
    expect(documentListeners.size).toBe(0)
    expect(windowListeners.size).toBe(0)
  })

  it("also recovers on focus when visibility events are unavailable", async () => {
    vi.useFakeTimers()
    const documentListeners = new Map<string, (event: any) => void>()
    const windowListeners = new Map<string, (event: any) => void>()
    const documentMock = {
      visibilityState: "visible",
      addEventListener: vi.fn((type: string, listener: (event: any) => void) => {
        documentListeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string) => documentListeners.delete(type)),
    }
    const windowMock = {
      addEventListener: vi.fn((type: string, listener: (event: any) => void) => {
        windowListeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string) => windowListeners.delete(type)),
    }
    const recover = vi.fn().mockResolvedValue(true)
    vi.stubGlobal("document", documentMock)
    vi.stubGlobal("window", windowMock)

    const cleanup = setupActiveNip46ReceiverResumeRecovery({recover, now: () => 10_000})
    windowListeners.get("focus")?.(new Event("focus"))
    await vi.advanceTimersByTimeAsync(250)

    expect(recover).toHaveBeenCalledOnce()
    cleanup()
  })
})

describe("patched Welshman NIP-46 lifecycle", () => {
  it("clears receiver state when all relay subscriptions disconnect", async () => {
    const relay = "wss://relay.example/"
    const socket = new Socket(relay, [])
    socket.send = vi.fn()
    socket.emit(SocketEvent.Status, SocketStatus.Open, relay)
    const receiver = new Nip46Receiver(
      {
        getPubkey: vi.fn().mockResolvedValue("1".repeat(64)),
      } as any,
      {
        clientSecret: "2".repeat(64),
        relays: [relay],
        context: {getAdapter: () => new SocketAdapter(socket)},
      },
    )

    await receiver.start()
    expect(receiver.abortController).toBeDefined()

    socket.emit(SocketEvent.Status, SocketStatus.Closed, relay)

    await vi.waitFor(() => expect(receiver.abortController).toBeUndefined())
    socket.cleanup()
  })

  it("rejects promptly when no signer relay accepts an outgoing request", async () => {
    vi.useFakeTimers()
    const relay = "wss://relay.example/"
    const send = vi.fn()
    const broker = makeBudabitNip46Broker({
      clientSecret: "3".repeat(64),
      signerPubkey: "4".repeat(64),
      relays: [relay],
      context: {getAdapter: () => new MockAdapter(relay, send)},
    })
    vi.spyOn(broker.receiver, "start").mockResolvedValue(undefined)

    const pending = broker.ping()
    const rejected = expect(pending).rejects.toThrow("Unable to publish NIP-46 request")
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(10_000)

    await rejected
    broker.cleanup()
  })

  it("cancels an in-flight signer-relay publish when the broker stops", async () => {
    const relay = "wss://relay.example/"
    const send = vi.fn()
    const broker = makeBudabitNip46Broker({
      clientSecret: "9".repeat(64),
      signerPubkey: "a".repeat(64),
      relays: [relay],
      context: {getAdapter: () => new MockAdapter(relay, send)},
    })
    vi.spyOn(broker.receiver, "start").mockResolvedValue(undefined)

    const pending = broker.ping()
    const rejected = expect(pending).rejects.toThrow("NIP-46 sender stopped")
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())

    broker.cleanup()

    await rejected
    expect(broker.sender.queue).toHaveLength(0)
  })

  it("reconstructs changed sessions without an extra account-key request", async () => {
    const pubkey = "4".repeat(64)
    const firstSession = {
      method: SessionMethod.Nip46,
      pubkey,
      secret: "5".repeat(64),
      handler: {pubkey: "6".repeat(64), relays: ["wss://first.example/"]},
    }
    const secondSession = {
      ...firstSession,
      secret: "7".repeat(64),
      handler: {pubkey: "8".repeat(64), relays: ["wss://second.example/"]},
    }

    const first = getSigner(firstSession as any)
    const firstCleanup = vi.spyOn(first, "cleanup")
    addSession(firstSession as any)
    addSession(secondSession as any)
    const second = getSigner(secondSession as any)
    const secondSigner = second.signer as Nip46Signer
    const getPublicKey = vi.spyOn(secondSigner.broker, "getPublicKey")

    expect(second).not.toBe(first)
    expect(firstCleanup).toHaveBeenCalledOnce()
    expect(secondSigner.broker.params.clientSecret).toBe(secondSession.secret)
    await expect(secondSigner.getPubkey()).resolves.toBe(pubkey)
    expect(getPublicKey).not.toHaveBeenCalled()

    dropSession(pubkey)
  })
})
