import {describe, expect, it, vi, beforeEach, afterEach} from "vitest"
import {Socket, SocketStatus, SocketEvent} from "../src/socket"
import {type SignedEvent} from "@welshman/util"
import {AuthStatus, AuthStateEvent} from "../src/auth"

const signed = (id = "proof") => ({id, kind: 22242}) as SignedEvent
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return {promise, resolve, reject}
}

describe("ACK-confirmed auth", () => {
  let socket: Socket
  beforeEach(() => {
    vi.useFakeTimers()
    socket = new Socket("wss://test.relay")
  })
  afterEach(() => {
    socket.cleanup()
    vi.useRealTimers()
  })
  const challenge = (socket: Socket, text = "challenge") =>
    socket.emit(SocketEvent.Receive, ["AUTH", text])

  it("initializes/reset state, emits status and ignores unsolicited ACKs", () => {
    expect(socket.auth.status).toBe(AuthStatus.None)
    const listener = vi.fn()
    socket.auth.on(AuthStateEvent.Status, listener)
    challenge(socket)
    expect(listener).toHaveBeenCalledWith(AuthStatus.Requested)
    socket.emit(SocketEvent.Receive, ["OK", "unsolicited", true, ""])
    expect(socket.auth.status).toBe(AuthStatus.Requested)
    socket.emit(SocketEvent.Status, SocketStatus.Closed)
    expect(socket.auth.status).toBe(AuthStatus.None)
    expect(socket.auth.generation).toBe(1)
    expect(socket.auth.challenge).toBeUndefined()
  })

  it("shares one signature/AUTH, resolves only for matching successful ACK", async () => {
    challenge(socket)
    const sign = vi.fn(async () => signed())
    const send = vi.spyOn(socket, "send")
    const promise = socket.auth.authenticate(sign)
    expect(socket.auth.authenticate(sign)).toBe(promise)
    const resolved = vi.fn()
    promise.then(resolved)
    await vi.advanceTimersByTimeAsync(0)
    expect(sign).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledExactlyOnceWith(["AUTH", signed()])
    expect(socket.auth.status).toBe(AuthStatus.PendingResponse)
    socket.emit(SocketEvent.Receive, ["OK", "other", true, ""])
    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()
    socket.emit(SocketEvent.Receive, ["OK", "proof", true, "accepted"])
    await promise
    expect(socket.auth.status).toBe(AuthStatus.Ok)
    socket.emit(SocketEvent.Receive, ["OK", "proof", false, "late failure"])
    expect(socket.auth.status).toBe(AuthStatus.Ok)
  })

  it("separates denied signatures from forbidden AUTH", async () => {
    challenge(socket)
    await expect(
      socket.auth.authenticate(async () => {
        throw Error("denied")
      }),
    ).rejects.toMatchObject({reason: "denied"})
    expect(socket.auth.status).toBe(AuthStatus.DeniedSignature)
    socket.auth.setStatus(AuthStatus.Requested)
    const promise = socket.auth.authenticate(async () => signed())
    const rejected = expect(promise).rejects.toMatchObject({reason: "forbidden"})
    await vi.advanceTimersByTimeAsync(0)
    socket.emit(SocketEvent.Receive, ["OK", "proof", false, "forbidden"])
    await rejected
    expect(socket.auth.status).toBe(AuthStatus.Forbidden)
  })

  it.each([true, false])(
    "ignores stale signer result after a newer challenge (success=%s)",
    async success => {
      challenge(socket, "old")
      const slow = deferred<SignedEvent>()
      const old = socket.auth.authenticate(() => slow.promise)
      const rejected = expect(old).rejects.toMatchObject({reason: "superseded"})
      await vi.advanceTimersByTimeAsync(0)
      challenge(socket, "new")
      await rejected
      const next = socket.auth.authenticate(async () => signed("new-proof"))
      await vi.advanceTimersByTimeAsync(0)
      socket.emit(SocketEvent.Receive, ["OK", "new-proof", true, ""])
      await next
      if (success) slow.resolve(signed("stale"))
      else slow.reject(Error("late signer denial"))
      await vi.advanceTimersByTimeAsync(0)
      expect(socket.auth.status).toBe(AuthStatus.Ok)
      expect(socket.auth.request).toBe("new-proof")
    },
  )

  it("disconnect invalidates same-text challenges from the previous generation", async () => {
    challenge(socket)
    const slow = deferred<SignedEvent>()
    const promise = socket.auth.authenticate(() => slow.promise)
    const rejected = expect(promise).rejects.toMatchObject({reason: "disconnected"})
    await vi.advanceTimersByTimeAsync(0)
    socket.emit(SocketEvent.Status, SocketStatus.Closed)
    challenge(socket)
    slow.resolve(signed())
    await rejected
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.auth.status).toBe(AuthStatus.Requested)
    expect(socket._sendQueue.items).toEqual([])
  })

  it("bounds signing separately from ACK and cancels queued AUTH", async () => {
    challenge(socket)
    const slow = deferred<SignedEvent>()
    const promise = socket.auth.authenticate(() => slow.promise, {
      signTimeout: 90000,
      ackTimeout: 10000,
    })
    const rejected = expect(promise).rejects.toMatchObject({reason: "timeout"})
    await vi.advanceTimersByTimeAsync(80000)
    expect(socket.auth.status).toBe(AuthStatus.PendingSignature)
    slow.resolve(signed())
    await vi.advanceTimersByTimeAsync(1)
    expect(socket.auth.status).toBe(AuthStatus.PendingResponse)
    await vi.advanceTimersByTimeAsync(10000)
    await rejected
    expect(socket._sendQueue.items).toEqual([])
    socket.emit(SocketEvent.Receive, ["OK", "proof", true, "late"])
    expect(socket.auth.status).toBe(AuthStatus.DeniedSignature)
  })

  it("cancels delayed signing without sending its late result", async () => {
    challenge(socket)
    const controller = new AbortController(),
      slow = deferred<SignedEvent>()
    const promise = socket.auth.authenticate(() => slow.promise, {signal: controller.signal})
    const rejected = expect(promise).rejects.toMatchObject({reason: "cancelled"})
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    slow.resolve(signed())
    await rejected
    await vi.advanceTimersByTimeAsync(0)
    expect(socket._sendQueue.items).toEqual([])
  })

  it("rejects missing challenge; compatibility attempt doesn't wait for public relays", async () => {
    await expect(socket.auth.authenticate(vi.fn())).rejects.toMatchObject({reason: "no-challenge"})
    vi.spyOn(socket, "attemptToOpen").mockImplementation(() => {})
    const sign = vi.fn()
    await socket.auth.attemptAuth(sign)
    expect(sign).not.toHaveBeenCalled()
  })
})
