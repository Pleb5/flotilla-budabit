import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Socket, SocketEvent, SocketStatus} from "../src/socket"
import {AuthStatus} from "../src/auth"
import {SocketAdapter} from "../src/adapter"
import {requestOne} from "../src/request"
import {socketPolicyAuthBuffer} from "../src/policy"
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

describe("terminal relay frames at disconnect", () => {
  let socket: Socket
  beforeEach(async () => {
    vi.useFakeTimers()
    socket = new Socket("wss://terminal.test/", [socketPolicyAuthBuffer])
    socket.open()
    await vi.advanceTimersByTimeAsync(0)
  })
  afterEach(() => {
    socket.cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const receive = (socket: Socket, message: RelayMessage) =>
    socket._ws!.onmessage?.({data: JSON.stringify(message)} as any)

  it.each(["close", "error"] as const)(
    "delivers queued CLOSED before peer %s without draining EVENT/EOSE",
    async termination => {
      const order: unknown[] = []
      socket.on(SocketEvent.Receive, message => order.push(message))
      socket.on(SocketEvent.Status, status => order.push(status))
      for (let i = 0; i < Socket.batchSize + 1; i++)
        receive(socket, ["EVENT", "one", {id: String(i)}])
      receive(socket, ["EOSE", "one"])
      const denial = ["CLOSED", "one", "restricted: read access denied"]
      receive(socket, denial)
      expect(order).toEqual([])

      const ws = socket._ws!
      if (termination === "close") ws.onclose?.({} as any)
      else ws.onerror?.({} as any)
      await vi.runAllTimersAsync()

      expect(order).toEqual([
        denial,
        termination === "close" ? SocketStatus.Closed : SocketStatus.Error,
      ])
    },
  )

  it("preserves normal EVENT/EOSE/CLOSED order and never redelivers a processed closure", async () => {
    const received = vi.fn()
    socket.on(SocketEvent.Receive, received)
    const messages = [
      ["EVENT", "one", {id: "first"}],
      ["EOSE", "one"],
      ["CLOSED", "one", "restricted: read access denied"],
    ]
    messages.forEach(message => receive(socket, message))
    await vi.runAllTimersAsync()
    socket._ws!.onclose?.({} as any)
    await vi.runAllTimersAsync()
    expect(received.mock.calls.map(([message]) => message)).toEqual(messages)
  })

  it("preserves CLOSED from an already-popped batch but drops its remaining data", async () => {
    const received: RelayMessage[] = []
    const ws = socket._ws!
    socket.on(SocketEvent.Receive, message => {
      received.push(message)
      if (message[0] === "EVENT") ws.onclose?.({} as any)
    })
    const first = ["EVENT", "one", {id: "first"}]
    const denial = ["CLOSED", "one", "restricted: read access denied"]
    for (const message of [first, ["EVENT", "one", {id: "stale"}], ["EOSE", "one"], denial])
      receive(socket, message)
    await vi.runAllTimersAsync()
    expect(received).toEqual([first, denial])
  })

  it("flushes multiple subscription closures in wire order", async () => {
    const received = vi.fn()
    socket.on(SocketEvent.Receive, received)
    const messages = [
      ["CLOSED", "one", "restricted: read access denied"],
      ["CLOSED", "two", "error: read policy temporarily unavailable"],
    ]
    messages.forEach(message => receive(socket, message))
    socket._ws!.onclose?.({} as any)
    await vi.runAllTimersAsync()
    expect(received.mock.calls.map(([message]) => message)).toEqual(messages)
  })

  it("does not flush an auth-required closure held by the replay policy", async () => {
    socket.auth.setStatus(AuthStatus.PendingSignature)
    socket.send(["REQ", "one", {}])
    const received = vi.fn()
    socket.on(SocketEvent.Receive, received)
    receive(socket, ["CLOSED", "one", "auth-required: authenticate"])
    expect(socket._recvQueue.items).toEqual([])
    socket._ws!.onclose?.({} as any)
    await vi.runAllTimersAsync()
    expect(received).not.toHaveBeenCalled()
  })

  it.each(["close", "cleanup"] as const)(
    "discards pending closures on local %s instead of delivering cancelled work",
    async cancellation => {
      const received = vi.fn()
      socket.on(SocketEvent.Receive, received)
      const ws = socket._ws!
      receive(socket, ["CLOSED", "one", "restricted: read access denied"])
      socket[cancellation]()
      ws.onclose?.({} as any)
      await vi.runAllTimersAsync()
      expect(received).not.toHaveBeenCalled()
    },
  )

  it("allows a CLOSED handler to dispose the socket without duplicate disconnects", async () => {
    const received = vi.fn(() => socket.cleanup())
    const status = vi.fn()
    socket.on(SocketEvent.Receive, received)
    socket.on(SocketEvent.Status, status)
    const ws = socket._ws!
    receive(socket, ["CLOSED", "one", "restricted: read access denied"])
    ws.onclose?.({} as any)
    await vi.runAllTimersAsync()
    expect(received).toHaveBeenCalledTimes(1)
    expect(status).toHaveBeenCalledExactlyOnceWith(SocketStatus.Closed, socket.url)
    expect(socket._disposed).toBe(true)
  })

  it("does not reset a replacement transport opened by a CLOSED handler", async () => {
    const received = vi.fn(() => {
      socket.close()
      socket.open()
    })
    socket.on(SocketEvent.Receive, received)
    const old = socket._ws!
    receive(socket, ["CLOSED", "one", "restricted: read access denied"])
    receive(socket, ["CLOSED", "two", "restricted: stale closure"])
    old.onclose?.({} as any)
    const replacement = socket._ws
    expect(replacement).toBeDefined()
    expect(replacement).not.toBe(old)
    old.onmessage?.({data: '["CLOSED","one","restricted: stale callback"]'} as any)
    old.onerror?.({} as any)
    old.onclose?.({} as any)
    await vi.runAllTimersAsync()
    expect(socket._ws).toBe(replacement)
    expect(socket.status).toBe(SocketStatus.Open)
    expect(received).toHaveBeenCalledTimes(1)
  })

  it("continues teardown when a terminal listener throws", async () => {
    const error = Error("controlled listener failure")
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const received = vi.fn(() => {
      throw error
    })
    socket.on(SocketEvent.Receive, received)
    receive(socket, ["CLOSED", "one", "restricted: read access denied"])
    receive(socket, ["CLOSED", "two", "restricted: read access denied"])
    socket._ws!.onclose?.({} as any)
    await vi.runAllTimersAsync()
    expect(received).toHaveBeenCalledTimes(2)
    expect(logged).toHaveBeenCalledTimes(2)
    expect(logged).toHaveBeenCalledWith(error)
    expect(socket.status).toBe(SocketStatus.Closed)
    expect(socket._ws).toBeUndefined()
  })

  it("reports a bare disconnect without inventing an explicit denial", async () => {
    const onClosed = vi.fn()
    const onDisconnect = vi.fn()
    const result = requestOne({
      relay: socket.url,
      filters: [{kinds: [1]}],
      context: {getAdapter: () => new SocketAdapter(socket)},
      onClosed,
      onDisconnect,
    })
    socket._ws!.onclose?.({} as any)
    await vi.runAllTimersAsync()
    expect(await result).toEqual([])
    expect(onClosed).not.toHaveBeenCalled()
    expect(onDisconnect).toHaveBeenCalledExactlyOnceWith(socket.url)
  })

  it.each(["restricted: read access denied", "error: read policy temporarily unavailable"])(
    "routes %s through requestOne.onClosed, not onDisconnect",
    async reason => {
      const onClosed = vi.fn()
      const onDisconnect = vi.fn()
      const onEvent = vi.fn()
      const onEose = vi.fn()
      const controller = new AbortController()
      const result = requestOne({
        relay: socket.url,
        filters: [{kinds: [1]}],
        signal: controller.signal,
        context: {getAdapter: () => new SocketAdapter(socket)},
        onClosed,
        onDisconnect,
        onEvent,
        onEose,
      })
      const req = socket._sendQueue.items.find(message => message[0] === "REQ")!
      expect(req).toBeDefined()
      const ws = socket._ws!
      receive(socket, ["EVENT", req[1], {id: "stale", kind: 1}])
      receive(socket, ["EOSE", req[1]])
      receive(socket, ["CLOSED", req[1], reason])
      ws.onclose?.({} as any)
      await vi.runAllTimersAsync()
      expect(await result).toEqual([])
      expect(onClosed).toHaveBeenCalledExactlyOnceWith(reason, socket.url)
      expect(onDisconnect).not.toHaveBeenCalled()
      expect(onEvent).not.toHaveBeenCalled()
      expect(onEose).not.toHaveBeenCalled()
      controller.abort()
    },
  )
})
