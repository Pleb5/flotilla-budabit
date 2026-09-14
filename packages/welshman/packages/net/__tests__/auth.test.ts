import {describe, expect, it, vi, beforeEach, afterEach} from "vitest"
import {Socket, SocketStatus, SocketEvent} from "../src/socket"
import {
  type SignedEvent,
  type StampedEvent,
  sign,
  hash,
  own,
  getPubkey,
  verifiedSymbol,
} from "@welshman/util"
import {AuthStatus, AuthStateEvent} from "../src/auth"

const secret = "01".repeat(32)
const signed = (event: StampedEvent) => sign(hash(own(event, getPubkey(secret))), secret)
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return {promise, resolve, reject}
}
const deferredSign = () => {
  const slow = deferred<SignedEvent>()
  let template: StampedEvent
  return {
    ...slow,
    sign: (event: StampedEvent) => {
      template = event
      return slow.promise
    },
    complete: () => slow.resolve(signed(template)),
  }
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
    const sign = vi.fn(async event => signed(event))
    const send = vi.spyOn(socket, "send")
    const promise = socket.auth.authenticate(sign)
    expect(socket.auth.authenticate(sign)).toBe(promise)
    const resolved = vi.fn()
    promise.then(resolved)
    await vi.advanceTimersByTimeAsync(0)
    expect(sign).toHaveBeenCalledTimes(1)
    const proof = await sign.mock.results[0].value
    expect(send).toHaveBeenCalledExactlyOnceWith(["AUTH", expect.objectContaining(proof)])
    expect(socket.auth.status).toBe(AuthStatus.PendingResponse)
    socket.emit(SocketEvent.Receive, ["OK", "other", true, ""])
    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()
    socket.emit(SocketEvent.Receive, ["OK", proof.id, true, "accepted"])
    await promise
    expect(socket.auth.status).toBe(AuthStatus.Ok)
    socket.emit(SocketEvent.Receive, ["OK", proof.id, false, "late failure"])
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
    const promise = socket.auth.authenticate(async event => signed(event))
    const rejected = expect(promise).rejects.toMatchObject({reason: "forbidden"})
    await vi.advanceTimersByTimeAsync(0)
    socket.emit(SocketEvent.Receive, ["OK", socket.auth.request, false, "forbidden"])
    await rejected
    expect(socket.auth.status).toBe(AuthStatus.Forbidden)
  })

  it.each([true, false])(
    "ignores stale signer result after a newer challenge (success=%s)",
    async success => {
      challenge(socket, "old")
      const slow = deferredSign()
      const old = socket.auth.authenticate(slow.sign)
      const rejected = expect(old).rejects.toMatchObject({reason: "superseded"})
      await vi.advanceTimersByTimeAsync(0)
      challenge(socket, "new")
      await rejected
      const next = socket.auth.authenticate(async event => signed(event))
      await vi.advanceTimersByTimeAsync(0)
      const nextId = socket.auth.request
      socket.emit(SocketEvent.Receive, ["OK", nextId, true, ""])
      await next
      if (success) slow.complete()
      else slow.reject(Error("late signer denial"))
      await vi.advanceTimersByTimeAsync(0)
      expect(socket.auth.status).toBe(AuthStatus.Ok)
      expect(socket.auth.request).toBe(nextId)
    },
  )

  it("disconnect invalidates same-text challenges from the previous generation", async () => {
    challenge(socket)
    const slow = deferredSign()
    const promise = socket.auth.authenticate(slow.sign)
    const rejected = expect(promise).rejects.toMatchObject({reason: "disconnected"})
    await vi.advanceTimersByTimeAsync(0)
    socket.emit(SocketEvent.Status, SocketStatus.Closed)
    challenge(socket)
    slow.complete()
    await rejected
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.auth.status).toBe(AuthStatus.Requested)
    expect(socket._sendQueue.items).toEqual([])
  })

  it("bounds signing separately from ACK and cancels queued AUTH", async () => {
    challenge(socket)
    const slow = deferredSign()
    const promise = socket.auth.authenticate(slow.sign, {
      signTimeout: 90000,
      ackTimeout: 10000,
    })
    const rejected = expect(promise).rejects.toMatchObject({reason: "timeout"})
    await vi.advanceTimersByTimeAsync(80000)
    expect(socket.auth.status).toBe(AuthStatus.PendingSignature)
    slow.complete()
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
      slow = deferredSign()
    const promise = socket.auth.authenticate(slow.sign, {signal: controller.signal})
    const rejected = expect(promise).rejects.toMatchObject({reason: "cancelled"})
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    slow.complete()
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

  it.each([
    "kind",
    "content",
    "created_at",
    "challenge",
    "relay",
    "nonce",
    "id",
    "sig",
    "malformed",
    "cached",
  ])("rejects altered %s before AUTH even with a matching later ACK", async field => {
    challenge(socket)
    let returned: SignedEvent
    const send = vi.spyOn(socket, "send")
    const promise = socket.auth.authenticate(async template => {
      // Mutate the exact object passed in, not just a copy: the expected proof
      // must be captured before the signer is called.
      if (field === "kind") template.kind = 1
      if (field === "content") template.content = "changed"
      if (field === "created_at") template.created_at++
      if (["challenge", "relay", "nonce"].includes(field))
        template.tags.find(tag => tag[0] === field)![1] += "changed"
      returned = signed(template)
      if (field === "id") returned.id = "0".repeat(64)
      if (field === "sig") returned.sig = "0".repeat(128)
      if (field === "malformed") returned.tags = null as any
      if (field === "cached") {
        returned.sig = "0".repeat(128)
        returned[verifiedSymbol] = true
      }
      return returned
    })
    await expect(promise).rejects.toMatchObject({reason: "denied"})
    expect(send).not.toHaveBeenCalled()
    expect(socket._sendQueue.items).toEqual([])
    socket.emit(SocketEvent.Receive, ["OK", returned!.id, true, ""])
    expect(socket.auth.status).toBe(AuthStatus.DeniedSignature)
  })

  it("owns the validated proof so signer mutation cannot alter queued AUTH", async () => {
    challenge(socket)
    let returned: SignedEvent
    const promise = socket.auth.authenticate(async template => (returned = signed(template)))
    await vi.advanceTimersByTimeAsync(0)
    const queued = socket._sendQueue.items[0][1] as SignedEvent
    returned!.tags[0][1] = "changed-after-validation"
    returned!.sig = "bad"
    expect(queued.tags[0][1]).not.toBe("changed-after-validation")
    expect(queued.sig).not.toBe("bad")
    socket.emit(SocketEvent.Receive, ["OK", queued.id, true, ""])
    await promise
  })
})
