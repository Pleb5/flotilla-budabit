import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent} from "nostr-tools"
import {Socket, SocketEvent} from "../src/socket"
import {AuthStateEvent, AuthStatus} from "../src/auth"
import {socketPolicyAuthBuffer} from "../src/policy"
import type {RelayMessage} from "../src/message"

vi.mock("isomorphic-ws", () => ({
  default: class {
    onopen?: () => void
    onclose?: () => void
    send = vi.fn()
    close = () => this.onclose?.()
    constructor() {
      setTimeout(() => this.onopen?.(), 0)
    }
  },
}))

const key = new Uint8Array(32).fill(39)

describe("AUTH and read-replay wire ordering", () => {
  let socket: Socket
  beforeEach(async () => {
    vi.useFakeTimers()
    socket = new Socket("wss://auth-order.test/", [socketPolicyAuthBuffer])
    socket.open()
    await vi.advanceTimersByTimeAsync(0)
  })
  afterEach(() => {
    socket.cleanup()
    vi.useRealTimers()
  })
  const receive = (message: RelayMessage) =>
    socket._ws!.onmessage?.({data: JSON.stringify(message)} as any)
  const authenticate = () => {
    const sign = vi.fn(async event => finalizeEvent(event, key))
    socket.auth.on(AuthStateEvent.Status, status => {
      if (status === AuthStatus.Requested) void socket.auth.authenticate(sign).catch(() => {})
    })
    return sign
  }

  it("holds adjacent AUTH/CLOSED until a matching ACK, replaying only the REQ once", async () => {
    const sign = authenticate()
    const received = vi.fn(),
      sent = vi.fn()
    socket.on(SocketEvent.Receive, received)
    socket.on(SocketEvent.Send, sent)
    const req = ["REQ", "history", {kinds: [1], since: 123, limit: 100}] as const
    socket.send(["REQ", req[1], req[2]])
    socket.send(["EVENT", {id: "original-write"} as any])
    await vi.advanceTimersByTimeAsync(200)
    receive(["AUTH", "challenge"])
    receive(["CLOSED", "history", "auth-required: authenticate"])
    await vi.advanceTimersByTimeAsync(200)
    expect(sign).toHaveBeenCalledOnce()
    expect(received.mock.calls.some(([message]) => message[0] === "CLOSED")).toBe(false)
    expect(sent.mock.calls.filter(([message]) => message[0] === "REQ")).toHaveLength(1)
    receive(["OK", "wrong-id", true, ""])
    await vi.advanceTimersByTimeAsync(200)
    expect(socket.auth.status).toBe(AuthStatus.PendingResponse)
    const proofId = socket.auth.request!
    receive(["OK", proofId, true, ""])
    await vi.advanceTimersByTimeAsync(200)
    expect(sent.mock.calls.filter(([message]) => message[0] === "REQ")).toEqual([
      [req, socket.url],
      [req, socket.url],
    ])
    expect(sent.mock.calls.filter(([message]) => message[0] === "EVENT")).toHaveLength(1)
    receive(["OK", proofId, true, "duplicate ACK"])
    receive(["CLOSED", "history", "auth-required: still denied"])
    await vi.advanceTimersByTimeAsync(200)
    expect(sent.mock.calls.filter(([message]) => message[0] === "REQ")).toHaveLength(2)
    expect(received.mock.calls.some(([message]) => message[0] === "CLOSED")).toBe(true)
  })

  it("does not swallow a closure when there is no authentication consent", async () => {
    socket.send(["REQ", "history", {}])
    const received = vi.fn()
    socket.on(SocketEvent.Receive, received)
    receive(["AUTH", "challenge"])
    receive(["CLOSED", "history", "auth-required: authenticate"])
    await vi.advanceTimersByTimeAsync(200)
    expect(socket.auth.status).toBe(AuthStatus.Requested)
    expect(received).toHaveBeenCalledWith(
      ["CLOSED", "history", "auth-required: authenticate"],
      socket.url,
    )
  })

  it("removes deferred auth closures from the disconnect flush after a probe continuation", async () => {
    socket.auth.on(AuthStateEvent.Status, status => {
      if (status === AuthStatus.Requested)
        void Promise.resolve().then(() =>
          socket.auth.authenticate(async event => finalizeEvent(event, key)).catch(() => {}),
        )
    })
    socket.send(["REQ", "history", {}])
    const received = vi.fn()
    socket.on(SocketEvent.Receive, received)
    receive(["AUTH", "challenge"])
    receive(["CLOSED", "history", "auth-required: authenticate"])
    await vi.advanceTimersByTimeAsync(200)
    expect(socket._pendingClosed.size).toBe(0)
    receive(["OK", socket.auth.request!, true, ""])
    await vi.advanceTimersByTimeAsync(200)
    socket._ws!.onclose?.({} as any)
    expect(received.mock.calls.some(([message]) => message[0] === "CLOSED")).toBe(false)
  })

  it("never restores an older challenge when its queued AUTH frame is delivered", async () => {
    const sign = authenticate()
    receive(["AUTH", "old"])
    receive(["AUTH", "new"])
    await vi.advanceTimersByTimeAsync(200)
    expect(socket.auth.challenge).toBe("new")
    expect(sign).toHaveBeenCalledOnce()
    expect(sign.mock.calls[0][0].tags).toContainEqual(["challenge", "new"])
  })

  it("drops signing, queued data and a buffered read when the peer immediately disconnects", async () => {
    const sign = authenticate()
    socket.send(["REQ", "history", {}])
    const received = vi.fn()
    socket.on(SocketEvent.Receive, received)
    receive(["AUTH", "challenge"])
    receive(["CLOSED", "history", "auth-required: authenticate"])
    socket._ws!.onclose?.({} as any)
    await vi.advanceTimersByTimeAsync(200)
    expect(sign).not.toHaveBeenCalled()
    expect(socket.auth.status).toBe(AuthStatus.None)
    expect(socket._sendQueue.items).toEqual([])
    expect(received).not.toHaveBeenCalled()
  })
})
