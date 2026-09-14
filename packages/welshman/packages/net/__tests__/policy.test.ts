import {describe, expect, it, vi, beforeEach, afterEach} from "vitest"
import {Socket, SocketStatus, SocketEvent} from "../src/socket"
import {AuthStatus} from "../src/auth"
import {
  socketPolicyAuthBuffer,
  socketPolicyConnectOnSend,
  socketPolicyCloseInactive,
} from "../src/policy"
import {type RelayMessage} from "../src/message"

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

describe("read replay policies", () => {
  let socket: Socket
  beforeEach(() => {
    vi.useFakeTimers()
    socket = new Socket("wss://test.relay", [
      socketPolicyAuthBuffer,
      socketPolicyConnectOnSend,
      socketPolicyCloseInactive,
    ])
  })
  afterEach(() => {
    socket.cleanup()
    vi.useRealTimers()
  })
  const receive = (socket: Socket, message: RelayMessage) => {
    socket._recvQueue.push(message)
    socket.emit(SocketEvent.Receiving, message)
  }

  it("replays one auth-required REQ exactly once, never EVENT, never hides EVENT rejection", async () => {
    const sent = vi.fn(),
      received = vi.fn()
    socket.on(SocketEvent.Send, sent)
    socket.on(SocketEvent.Receive, received)
    socket.send(["REQ", "one", {kinds: [1]}])
    const event = {id: "event"} as any
    socket.send(["EVENT", event])
    await vi.advanceTimersByTimeAsync(200)
    socket.auth.challenge = "challenge"
    socket.auth.setStatus(AuthStatus.PendingSignature)
    receive(socket, ["CLOSED", "one", "auth-required: authenticate"])
    receive(socket, ["OK", "event", false, "auth-required: authenticate"])
    await vi.advanceTimersByTimeAsync(0)
    expect(received).toHaveBeenCalledWith(
      ["OK", "event", false, "auth-required: authenticate"],
      socket.url,
    )
    expect(received.mock.calls.some(([m]) => m[0] === "CLOSED")).toBe(false)
    socket.auth.setStatus(AuthStatus.Ok)
    await vi.advanceTimersByTimeAsync(200)
    expect(sent.mock.calls.filter(([m]) => m[0] === "REQ")).toHaveLength(2)
    expect(sent.mock.calls.filter(([m]) => m[0] === "EVENT")).toHaveLength(1)
    socket.auth.setStatus(AuthStatus.Ok)
    receive(socket, ["CLOSED", "one", "restricted: not a member"])
    await vi.advanceTimersByTimeAsync(200)
    expect(sent.mock.calls.filter(([m]) => m[0] === "REQ")).toHaveLength(2)
    expect(received).toHaveBeenCalledWith(["CLOSED", "one", "restricted: not a member"], socket.url)
  })

  it("holds new reads during signing; CLOSE cancels buffered requests", async () => {
    socket.open()
    await vi.advanceTimersByTimeAsync(0)
    socket.auth.setStatus(AuthStatus.PendingSignature)
    const sent = vi.fn()
    socket.on(SocketEvent.Send, sent)
    socket.send(["REQ", "cancelled", {}])
    socket.send(["REQ", "active", {}])
    socket.send(["CLOSE", "cancelled"])
    await vi.advanceTimersByTimeAsync(200)
    expect(sent.mock.calls.some(([m]) => m[0] === "REQ")).toBe(false)
    socket.auth.setStatus(AuthStatus.Ok)
    await vi.advanceTimersByTimeAsync(200)
    expect(sent.mock.calls.filter(([m]) => m[0] === "REQ")).toEqual([
      [["REQ", "active", {}], socket.url],
    ])
  })

  it("delivers EOSE and denial when optional auth is ignored", async () => {
    socket.auth.setStatus(AuthStatus.Requested)
    const received = vi.fn()
    socket.on(SocketEvent.Receive, received)
    receive(socket, ["EOSE", "public"])
    receive(socket, ["CLOSED", "closed", "auth-required: sign in"])
    await vi.advanceTimersByTimeAsync(0)
    expect(received).toHaveBeenCalledTimes(2)
  })

  it("returns buffered closure on signing failure rather than silently hanging", async () => {
    socket.auth.setStatus(AuthStatus.PendingSignature)
    socket.send(["REQ", "one", {}])
    const received = vi.fn()
    socket.on(SocketEvent.Receive, received)
    socket.auth.setStatus(AuthStatus.DeniedSignature)
    await vi.advanceTimersByTimeAsync(200)
    expect(received.mock.calls[0][0][0]).toBe("CLOSED")
    expect(received.mock.calls[0][0][2]).toMatch(/^auth-required:/)
  })

  it("reconnects once, waits for AUTH ACK, retains full history filters and never replays EVENT", async () => {
    socket.send(["REQ", "history", {kinds: [1], since: 123, limit: 100}])
    socket.send(["EVENT", {id: "published"} as any])
    await vi.advanceTimersByTimeAsync(200)
    socket.emit(SocketEvent.Receive, ["AUTH", "old"])
    socket.auth.setStatus(AuthStatus.Ok)
    socket.close()
    const sent = vi.fn()
    socket.on(SocketEvent.Send, sent)
    socket.on(SocketEvent.Status, status => {
      if (status === SocketStatus.Open) {
        socket.emit(SocketEvent.Receive, ["AUTH", "new"])
        socket.auth.setStatus(AuthStatus.PendingSignature)
      }
    })
    await vi.advanceTimersByTimeAsync(6000)
    expect(sent).not.toHaveBeenCalled()
    socket.auth.setStatus(AuthStatus.Ok)
    await vi.advanceTimersByTimeAsync(200)
    expect(sent).toHaveBeenCalledExactlyOnceWith(
      ["REQ", "history", {kinds: [1], since: 123, limit: 100}],
      socket.url,
    )
  })

  it("CLOSE during reconnect wait prevents replay and disposal cancels timers", async () => {
    socket.send(["REQ", "one", {}])
    await vi.advanceTimersByTimeAsync(200)
    socket.close()
    socket.send(["CLOSE", "one"])
    const sent = vi.fn()
    socket.on(SocketEvent.Send, sent)
    await vi.advanceTimersByTimeAsync(6000)
    expect(sent.mock.calls.some(([m]) => m[0] === "REQ")).toBe(false)
    socket.cleanup()
    await vi.advanceTimersByTimeAsync(40000)
  })

  it("does not reopen for unacknowledged EVENT alone", async () => {
    socket.send(["EVENT", {id: "once"} as any])
    await vi.advanceTimersByTimeAsync(200)
    socket.close()
    const open = vi.spyOn(socket, "attemptToOpen")
    await vi.advanceTimersByTimeAsync(6000)
    expect(open).not.toHaveBeenCalled()
  })

  it("connects on send, respects recent error, closes after idle", async () => {
    socket.emit(SocketEvent.Status, SocketStatus.Error)
    socket.send(["CLOSE", "one"])
    expect(socket._ws).toBeUndefined()
    await vi.advanceTimersByTimeAsync(6000)
    socket.send(["CLOSE", "one"])
    await vi.advanceTimersByTimeAsync(200)
    expect(socket.status).toBe(SocketStatus.Open)
    await vi.advanceTimersByTimeAsync(35000)
    expect(socket.status).toBe(SocketStatus.Closed)
  })
})
