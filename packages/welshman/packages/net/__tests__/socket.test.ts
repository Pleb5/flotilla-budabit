import WebSocket from "isomorphic-ws"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Socket, SocketStatus, SocketEvent} from "../src/socket"
import {ClientMessage, RelayMessage} from "../src/message"
import {sign, hash, own, getPubkey} from "@welshman/util"

vi.mock("isomorphic-ws", () => {
  const WebSocket = vi.fn(function (this: any) {
    setTimeout(() => this.onopen())
  })

  WebSocket.prototype.send = vi.fn()

  WebSocket.prototype.close = vi.fn(function (this: any) {
    this.onclose()
  })

  return {default: WebSocket}
})

describe("Socket", () => {
  let socket: Socket

  beforeEach(() => {
    vi.useFakeTimers()
    socket = new Socket("wss://test.relay")
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    socket.cleanup()
  })

  it("should initialize with correct url", () => {
    expect(socket.url).toBe("wss://test.relay")
  })

  describe("open", () => {
    it("should create websocket and emit opening status", () => {
      const statusSpy = vi.fn()
      socket.on(SocketEvent.Status, statusSpy)

      socket.open()

      expect(socket._ws).toBeDefined()
      expect(statusSpy).toHaveBeenCalledWith(SocketStatus.Opening, "wss://test.relay")

      vi.runAllTimers()

      expect(statusSpy).toHaveBeenCalledWith(SocketStatus.Open, "wss://test.relay")
    })

    it("should throw error if socket already exists", () => {
      socket.open()
      expect(() => socket.open()).toThrow("Attempted to open a websocket that has not been closed")
    })

    it("should emit error status on invalid URL", () => {
      const statusSpy = vi.fn()
      socket.on(SocketEvent.Status, statusSpy)

      vi.mocked(WebSocket).mockImplementationOnce(() => {
        throw new Error()
      })

      socket.open()

      expect(statusSpy).toHaveBeenCalledWith(SocketStatus.Error, "wss://test.relay")
    })
  })

  describe("close", () => {
    it("should close websocket and emit closed status", () => {
      const statusSpy = vi.fn()
      socket.on(SocketEvent.Status, statusSpy)

      socket.open()

      const closeSpy = vi.spyOn(socket._ws!, "close")

      socket.close()

      expect(closeSpy).toHaveBeenCalled()
      expect(statusSpy).toHaveBeenCalledWith(SocketStatus.Closed, "wss://test.relay")
    })
  })

  describe("send", () => {
    it("should queue messages and emit enqueue event", () => {
      const enqueueSpy = vi.fn()
      socket.on(SocketEvent.Sending, enqueueSpy)

      const message: ClientMessage = ["EVENT", {id: "123", kind: 1}]
      socket.send(message)

      expect(enqueueSpy).toHaveBeenCalledWith(message, "wss://test.relay")
    })

    it("should send messages when socket is open", async () => {
      const sendSpy = vi.fn()
      socket.on(SocketEvent.Send, sendSpy)

      socket.open()
      socket._ws?.onopen?.(undefined as unknown as any)

      const message: ClientMessage = ["EVENT", {id: "123", kind: 1}]
      socket.send(message)

      await vi.runAllTimers()

      expect(socket._ws!.send).toHaveBeenCalledWith(JSON.stringify(message))
      expect(sendSpy).toHaveBeenCalledWith(message, "wss://test.relay")
    })
  })

  describe("receive", () => {
    it("should handle valid relay messages", async () => {
      const receiveSpy = vi.fn()
      socket.on(SocketEvent.Receive, receiveSpy)

      socket.open()
      const message: RelayMessage = ["EVENT", "123", {id: "123", kind: 1}]
      socket._ws?.onmessage?.({data: JSON.stringify(message)} as unknown as any)

      await vi.runAllTimers()

      expect(receiveSpy).toHaveBeenCalledWith(message, "wss://test.relay")
    })

    it("should drain large receive bursts without recurring delays", async () => {
      const receiveSpy = vi.fn()
      socket.on(SocketEvent.Receive, receiveSpy)
      socket.open()

      for (let index = 0; index < 101; index += 1) {
        socket._ws?.onmessage?.({
          data: JSON.stringify(["EVENT", "123", {id: String(index), kind: 1}]),
        } as unknown as any)
      }
      const eose: RelayMessage = ["EOSE", "123"]
      socket._ws?.onmessage?.({data: JSON.stringify(eose)} as unknown as any)

      await vi.runAllTimersAsync()

      expect(receiveSpy).toHaveBeenCalledTimes(102)
      expect(receiveSpy).toHaveBeenLastCalledWith(eose, "wss://test.relay")
    })

    it("should emit error on invalid JSON", () => {
      const errorSpy = vi.fn()
      socket.on(SocketEvent.Error, errorSpy)

      socket.open()
      socket._ws?.onmessage?.({data: "invalid json"} as unknown as any)

      expect(errorSpy).toHaveBeenCalledWith("Invalid message received", "wss://test.relay")
    })

    it("should emit error on non-array message", () => {
      const errorSpy = vi.fn()
      socket.on(SocketEvent.Error, errorSpy)

      socket.open()
      socket._ws?.onmessage?.({data: JSON.stringify({not: "an array"})} as unknown as any)

      expect(errorSpy).toHaveBeenCalledWith("Invalid message received", "wss://test.relay")
    })
  })

  describe("cleanup", () => {
    it("should close socket and clear queues", () => {
      socket.open()

      const ws = socket._ws

      socket.cleanup()

      expect(ws!.close).toHaveBeenCalled()
      expect(socket.listenerCount(SocketEvent.Send)).toBe(0)
    })
  })

  describe("error handling", () => {
    it("checks a cancelled managed AUTH even after its queue batch was popped", async () => {
      socket.open()
      await vi.advanceTimersByTimeAsync(0)
      socket.emit(SocketEvent.Receiving, ["AUTH", "challenge"])
      socket.send(["REQ", "first", {}])
      const controller = new AbortController()
      const proof = socket.auth.authenticate(
        async event => sign(hash(own(event, getPubkey("01".repeat(32)))), "01".repeat(32)),
        {
          signal: controller.signal,
        },
      )
      const rejected = expect(proof).rejects.toMatchObject({reason: "cancelled"})
      await vi.advanceTimersByTimeAsync(0)
      const sent = vi.fn(() => controller.abort())
      socket.on(SocketEvent.Send, sent)
      await vi.advanceTimersByTimeAsync(200)
      await rejected
      expect(sent).toHaveBeenCalledTimes(1)
      expect(sent.mock.calls[0][0][0]).toBe("REQ")
    })

    it("ignores open, close, error and data callbacks from a replaced transport", async () => {
      socket.open()
      const old = socket._ws!
      socket.close()
      socket.open()
      const current = socket._ws!
      await vi.advanceTimersByTimeAsync(0)
      const received = vi.fn()
      socket.on(SocketEvent.Receive, received)
      old.onopen?.({} as any)
      old.onerror?.({} as any)
      old.onclose?.({} as any)
      old.onmessage?.({data: '["AUTH","old"]'} as any)
      await vi.advanceTimersByTimeAsync(0)
      expect(socket._ws).toBe(current)
      expect(socket.status).toBe(SocketStatus.Open)
      expect(received).not.toHaveBeenCalled()
    })

    it("does not carry queued EVENT or AUTH into a new generation", async () => {
      socket.open()
      await vi.advanceTimersByTimeAsync(0)
      socket.send(["EVENT", {id: "old-event"} as any])
      socket.send(["AUTH", {id: "old-auth"} as any])
      socket.close()
      socket.open()
      const ws = socket._ws!
      await vi.advanceTimersByTimeAsync(200)
      expect(ws.send).not.toHaveBeenCalled()
    })

    it("drops a popped send/receive batch after disconnect during its first callback", async () => {
      socket.open()
      await vi.advanceTimersByTimeAsync(0)
      const sent = vi.fn(() => socket.close())
      socket.on(SocketEvent.Send, sent)
      for (let n = 0; n < 5; n++) socket.send(["EVENT", {id: String(n)} as any])
      await vi.advanceTimersByTimeAsync(200)
      expect(sent).toHaveBeenCalledTimes(1)
      socket.open()
      await vi.advanceTimersByTimeAsync(0)
      const received = vi.fn(() => socket.close())
      socket.on(SocketEvent.Receive, received)
      for (let n = 0; n < 5; n++)
        socket._ws!.onmessage?.({data: JSON.stringify(["AUTH", String(n)])} as any)
      await vi.advanceTimersByTimeAsync(0)
      expect(received).toHaveBeenCalledTimes(1)
    })

    it("should emit error status on websocket error", () => {
      const statusSpy = vi.fn()
      socket.on(SocketEvent.Status, statusSpy)

      socket.open()
      socket._ws?.onerror?.(undefined as unknown as any)

      expect(statusSpy).toHaveBeenCalledWith(SocketStatus.Error, "wss://test.relay")
    })
  })

  describe("attemptToOpen", () => {
    it("should open socket if not already open", () => {
      const openSpy = vi.spyOn(socket, "open")

      socket.attemptToOpen()
      expect(openSpy).toHaveBeenCalled()
    })

    it("should not open socket if already open", () => {
      const openSpy = vi.spyOn(socket, "open")

      socket.open()
      socket.attemptToOpen()

      expect(openSpy).toHaveBeenCalledTimes(1)
    })
  })
})
