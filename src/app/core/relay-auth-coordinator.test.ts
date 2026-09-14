import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {pubkey} from "@welshman/app"
import {Socket, Pool, SocketEvent, AuthStatus, socketPolicyAuthBuffer} from "@welshman/net"
import {
  authenticateRelay,
  cancelRelayAuthentication,
  coordinatedAuthPolicy,
} from "./relay-auth-coordinator"

const model = vi.hoisted(() => ({
  sign: vi.fn(),
  hasSigner: true,
  consent: true,
  auth: "required",
  subscribers: new Set<() => void>(),
}))
vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()
  const signing = {sign: model.sign}
  return {
    ...actual,
    signer: {
      get: () => (model.hasSigner ? signing : undefined),
      subscribe: (callback: () => void) => {
        model.subscribers.add(callback)
        callback()
        return () => model.subscribers.delete(callback)
      },
    },
  }
})
vi.mock("./relay-policy", async importOriginal => {
  const actual = await importOriginal<typeof import("./relay-policy")>()
  return {
    ...actual,
    getRelayPolicy: () => ({auth: model.auth}),
    recordRelayAuthRequired: () => {
      model.auth = "required"
    },
  }
})
vi.mock("./relay-auth-consent", () => ({
  isUserOwnedRelay: () => model.consent,
  subscribeRelayAuthConsent: () => () => {},
}))
vi.mock("./provider-relay-auth", () => ({isOperationScopedProviderAuthSocket: () => false}))

describe("relay auth coordinator", () => {
  let socket: Socket
  beforeEach(() => {
    vi.useFakeTimers()
    model.hasSigner = model.consent = true
    model.auth = "required"
    pubkey.set("1".repeat(64))
    model.sign.mockReset().mockImplementation(async event => ({
      ...event,
      id: "proof",
      pubkey: pubkey.get(),
      sig: "sig",
    }))
    socket = new Socket("wss://private.example/", [])
    vi.spyOn(socket, "attemptToOpen").mockImplementation(() => {})
    Pool.get()._data.set(socket.url, socket)
  })
  afterEach(() => {
    Pool.get().clear()
    pubkey.set(undefined)
    vi.useRealTimers()
  })
  const challenge = (socket: Socket, value = "challenge") =>
    socket.emit(SocketEvent.Receive, ["AUTH", value])
  const ack = (socket: Socket) =>
    socket.emit(SocketEvent.Receive, ["OK", socket.auth.request, true, ""])

  it("parallel loads and socket policy share one sign and wait for matching ACK", async () => {
    const cleanup = coordinatedAuthPolicy(socket)
    challenge(socket)
    const first = authenticateRelay(socket),
      second = authenticateRelay(socket)
    expect(first).toBe(second)
    await vi.advanceTimersByTimeAsync(0)
    expect(model.sign).toHaveBeenCalledOnce()
    expect(socket.auth.status).toBe(AuthStatus.PendingResponse)
    ack(socket)
    await Promise.all([first, second])
    cleanup()
  })

  it("runtime auth-required overrides stale public metadata and causes exactly one REQ replay", async () => {
    model.auth = "none"
    const release = socketPolicyAuthBuffer(socket),
      cleanup = coordinatedAuthPolicy(socket)
    const send = vi.spyOn(socket, "send"),
      received = vi.fn()
    socket.on(SocketEvent.Receive, received)
    challenge(socket)
    socket.send(["REQ", "read", {}])
    socket.send(["EVENT", {id: "write"} as any])
    const closed = ["CLOSED", "read", "auth-required: authenticate"] as any
    socket._recvQueue.push(closed)
    socket.emit(SocketEvent.Receiving, closed)
    await vi.advanceTimersByTimeAsync(0)
    expect(model.sign).toHaveBeenCalledOnce()
    expect(received.mock.calls.some(([m]) => m[0] === "CLOSED")).toBe(false)
    ack(socket)
    await vi.advanceTimersByTimeAsync(0)
    expect(send.mock.calls.filter(([m]) => m[0] === "REQ")).toHaveLength(2)
    expect(send.mock.calls.filter(([m]) => m[0] === "EVENT")).toHaveLength(1)
    cleanup()
    release()
  })

  it("refuses required-relay guest auth and pubkey-only identities before opening/signing", async () => {
    pubkey.set(undefined)
    model.hasSigner = false
    await expect(authenticateRelay(socket)).rejects.toMatchObject({status: "login-required"})
    pubkey.set("1".repeat(64))
    await expect(authenticateRelay(socket)).rejects.toMatchObject({status: "signer-required"})
    expect(model.sign).not.toHaveBeenCalled()
    expect(socket.attemptToOpen).not.toHaveBeenCalled()
  })

  it("requires independent authentication consent, without mutating trust settings", async () => {
    model.consent = false
    challenge(socket)
    await expect(authenticateRelay(socket)).rejects.toMatchObject({status: "consent-required"})
    expect(model.sign).not.toHaveBeenCalled()
    expect(socket.auth.status).toBe(AuthStatus.Requested)
  })

  it("removes old socket on identity change and ignores delayed signature", async () => {
    let finish!: (event: any) => void
    model.sign.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    challenge(socket)
    const pending = authenticateRelay(socket)
    const rejected = expect(pending).rejects.toMatchObject({reason: "cancelled"})
    await vi.advanceTimersByTimeAsync(0)
    pubkey.set("2".repeat(64))
    await rejected
    finish({id: "old"})
    await vi.advanceTimersByTimeAsync(0)
    expect(Pool.get().has(socket.url)).toBe(false)
    expect(socket._sendQueue.items).toEqual([])
    expect(socket._disposed).toBe(true)
  })

  it("one caller cancellation does not cancel a concurrent loader; explicit cancel does", async () => {
    challenge(socket)
    const controller = new AbortController()
    const first = authenticateRelay(socket, {signal: controller.signal}),
      second = authenticateRelay(socket)
    const rejected = expect(first).rejects.toMatchObject({reason: "cancelled"})
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(0)
    ack(socket)
    await second
    expect(socket.auth.status).toBe(AuthStatus.Ok)
    challenge(socket, "next")
    const pending = authenticateRelay(socket)
    const cancelled = expect(pending).rejects.toMatchObject({reason: "cancelled"})
    cancelRelayAuthentication(socket)
    await cancelled
  })

  it("uses 90s signing and a separate 10s ACK budget", async () => {
    let finish!: (event: any) => void
    model.sign.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    challenge(socket)
    const pending = authenticateRelay(socket)
    const rejected = expect(pending).rejects.toMatchObject({reason: "timeout"})
    await vi.advanceTimersByTimeAsync(85000)
    expect(socket.auth.status).toBe(AuthStatus.PendingSignature)
    finish({id: "proof"})
    await vi.advanceTimersByTimeAsync(5001)
    expect(socket.auth.status).toBe(AuthStatus.PendingResponse)
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
  })

  it("probes only an empty ID when a required relay has not challenged", async () => {
    const pending = authenticateRelay(socket)
    await vi.advanceTimersByTimeAsync(0)
    expect(socket._sendQueue.items).toContainEqual([
      "REQ",
      "auth-probe-0",
      {ids: ["0".repeat(64)], limit: 0},
    ])
    challenge(socket)
    await vi.advanceTimersByTimeAsync(0)
    ack(socket)
    await pending
    expect(model.sign).toHaveBeenCalledOnce()
  })
})
