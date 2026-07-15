import {afterEach, describe, expect, it, vi} from "vitest"
import {
  ClientMessageType,
  MockAdapter,
  RelayMessageType,
  Socket,
  SocketAdapter,
  SocketEvent,
  SocketStatus,
  makeLoader,
  request,
  requestOne,
  setRequestPolicy,
  socketPolicyCloseInactive,
  type ClientMessage,
} from "@welshman/net"
import type {Filter} from "@welshman/util"

const relay = "wss://relay.example/"
const restorePolicies: Array<() => void> = []

const setPolicy = (policy: {
  maxFiltersPerSubscription?: number
  maxSubscriptions?: number
  maxMessageBytes?: number
  reservedSubscriptions?: number
  reservedPriority?: number
}) => {
  restorePolicies.push(setRequestPolicy(() => policy))
}

const makeSocketContext = () => {
  const socket = new Socket(relay, [])
  const send = vi.fn<(message: ClientMessage) => void>()
  socket.send = send

  return {
    socket,
    send,
    context: {getAdapter: () => new SocketAdapter(socket)},
  }
}

const getMessages = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map(([message]) => message as ClientMessage)

const getReqs = (send: ReturnType<typeof vi.fn>) =>
  getMessages(send).filter(message => message[0] === ClientMessageType.Req)

afterEach(() => {
  restorePolicies.splice(0).reverse().forEach(restore => restore())
  vi.useRealTimers()
})

describe("Welshman request patch", () => {
  it("caps caller-requested groups at the relay policy limit", async () => {
    setPolicy({maxFiltersPerSubscription: 5})
    const send = vi.fn()
    const adapter = new MockAdapter(relay, send)
    const controller = new AbortController()
    const filters = Array.from({length: 11}, (_, index) => ({kinds: [index + 1]}))
    const result = requestOne({
      relay: adapter.url,
      filters,
      maxFiltersPerSubscription: 100,
      signal: controller.signal,
      context: {getAdapter: () => adapter},
    })

    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls.map(([message]) => message.slice(2).length)).toEqual([5, 5, 1])
    expect(new Set(send.mock.calls.map(([message]) => message[1])).size).toBe(3)
    expect(send.mock.calls.flatMap(([message]) => message.slice(2))).toEqual(filters)

    controller.abort()
    await result
  })

  it("bounds serialized REQ bytes", async () => {
    setPolicy({maxFiltersPerSubscription: 5, maxMessageBytes: 90})
    const send = vi.fn()
    const adapter = new MockAdapter(relay, send)
    const controller = new AbortController()
    const filters = Array.from({length: 5}, (_, index) => ({search: `${index}-${"x".repeat(24)}`}))
    const result = requestOne({
      relay,
      filters,
      signal: controller.signal,
      context: {getAdapter: () => adapter},
    })

    expect(send.mock.calls.length).toBeGreaterThan(1)
    expect(
      send.mock.calls.every(
        ([message]) => new TextEncoder().encode(JSON.stringify(message)).byteLength <= 90,
      ),
    ).toBe(true)

    controller.abort()
    await result
  })

  it("runs finite chunks in bounded waves and closes each at EOSE", async () => {
    setPolicy({maxFiltersPerSubscription: 1, maxSubscriptions: 2})
    const {context, send, socket} = makeSocketContext()
    const filters = Array.from({length: 5}, (_, index) => ({kinds: [index + 1]}))
    const result = requestOne({relay, filters, autoClose: true, context})

    expect(getReqs(send)).toHaveLength(2)

    const completed = new Set<string>()
    while (completed.size < filters.length) {
      const req = getReqs(send).find(message => !completed.has(message[1]))
      expect(req).toBeDefined()
      completed.add(req![1])
      socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, req![1]], relay)
    }

    await result

    let active = 0
    let maxActive = 0
    for (const message of getMessages(send)) {
      if (message[0] === ClientMessageType.Req) active += 1
      if (message[0] === ClientMessageType.Close) active -= 1
      maxActive = Math.max(maxActive, active)
    }

    expect(getReqs(send)).toHaveLength(5)
    expect(maxActive).toBe(2)
    expect(active).toBe(0)
  })

  it.each([
    [RelayMessageType.Closed, RelayMessageType.Eose],
    [RelayMessageType.Eose, RelayMessageType.Closed],
  ])("settles finite requests after mixed %s and %s terminals", async (firstType, secondType) => {
    setPolicy({maxFiltersPerSubscription: 1, maxSubscriptions: 2})
    const {context, send, socket} = makeSocketContext()
    const result = requestOne({
      relay,
      filters: [{kinds: [1]}, {kinds: [2]}],
      autoClose: true,
      context,
    })
    const [first, second] = getReqs(send)

    socket.emit(
      SocketEvent.Receive,
      firstType === RelayMessageType.Closed
        ? [firstType, first[1], "restricted: denied"]
        : [firstType, first[1]],
      relay,
    )
    socket.emit(
      SocketEvent.Receive,
      secondType === RelayMessageType.Closed
        ? [secondType, second[1], "restricted: denied"]
        : [secondType, second[1]],
      relay,
    )

    await result
  })

  it("does not leak a slot when socket failure is emitted synchronously", async () => {
    setPolicy({maxFiltersPerSubscription: 1, maxSubscriptions: 1})
    const socket = new Socket(relay, [])
    const send = vi.fn<(message: ClientMessage) => void>()
    let failNextReq = true
    socket.send = message => {
      send(message)
      if (message[0] === ClientMessageType.Req && failNextReq) {
        failNextReq = false
        socket.emit(SocketEvent.Status, SocketStatus.Error, relay)
      }
    }
    const context = {getAdapter: () => new SocketAdapter(socket)}

    await requestOne({relay, filters: [{kinds: [1]}], autoClose: true, context})
    const controller = new AbortController()
    const second = requestOne({
      relay,
      filters: [{kinds: [2]}],
      signal: controller.signal,
      context,
    })

    expect(getReqs(send)).toHaveLength(2)
    controller.abort()
    await second
  })

  it("cancels reconnect replay when CLOSE is queued on a disconnected socket", async () => {
    vi.useFakeTimers()
    const socket = new Socket(relay, [socketPolicyCloseInactive])
    const attemptToOpen = vi.fn()
    socket.attemptToOpen = attemptToOpen
    const id = "REQ-reconnect"

    socket.emit(SocketEvent.Send, [ClientMessageType.Req, id, {kinds: [1]}], relay)
    socket.emit(SocketEvent.Status, SocketStatus.Error, relay)
    socket.send([ClientMessageType.Close, id])
    await vi.advanceTimersByTimeAsync(5000)

    expect(attemptToOpen).not.toHaveBeenCalled()
    socket.cleanup()
  })

  it("starts queued higher-priority work before older lower-priority chunks", async () => {
    setPolicy({maxFiltersPerSubscription: 1, maxSubscriptions: 1})
    const {context, send, socket} = makeSocketContext()
    const low = requestOne({
      relay,
      filters: [{kinds: [1]}, {kinds: [2]}],
      autoClose: true,
      priority: 0,
      context,
    })
    const high = requestOne({
      relay,
      filters: [{kinds: [999]}],
      autoClose: true,
      priority: 100,
      context,
    })
    const first = getReqs(send)[0]

    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, first[1]], relay)

    const second = getReqs(send)[1]
    expect((second[2] as Filter).kinds).toEqual([999])
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, second[1]], relay)

    const third = getReqs(send)[2]
    expect((third[2] as Filter).kinds).toEqual([2])
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, third[1]], relay)

    await Promise.all([low, high])
  })

  it("keeps reserved capacity available for priority work", async () => {
    setPolicy({
      maxFiltersPerSubscription: 1,
      maxSubscriptions: 3,
      reservedSubscriptions: 2,
      reservedPriority: 100,
    })
    const {context, send} = makeSocketContext()
    const lowControllers = [new AbortController(), new AbortController()]
    const low = lowControllers.map((controller, index) =>
      requestOne({
        relay,
        filters: [{kinds: [index + 1]}],
        signal: controller.signal,
        priority: 0,
        context,
      }),
    )

    expect(getReqs(send)).toHaveLength(1)
    const highController = new AbortController()
    const high = requestOne({
      relay,
      filters: [{kinds: [999]}],
      signal: highController.signal,
      priority: 100,
      context,
    })

    expect(getReqs(send)).toHaveLength(2)
    expect((getReqs(send)[1][2] as Filter).kinds).toEqual([999])

    lowControllers.forEach(controller => controller.abort())
    highController.abort()
    await Promise.all([...low, high])
  })

  it("retains a live slot after EOSE and releases it on abort", async () => {
    setPolicy({maxFiltersPerSubscription: 1, maxSubscriptions: 1})
    const {context, send, socket} = makeSocketContext()
    const liveController = new AbortController()
    const live = requestOne({
      relay,
      filters: [{kinds: [1]}],
      signal: liveController.signal,
      context,
    })
    const liveReq = getReqs(send)[0]
    const finite = requestOne({relay, filters: [{kinds: [2]}], autoClose: true, context})

    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, liveReq[1]], relay)
    expect(getReqs(send)).toHaveLength(1)

    liveController.abort()
    await live

    const finiteReq = getReqs(send)[1]
    expect((finiteReq[2] as Filter).kinds).toEqual([2])
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, finiteReq[1]], relay)
    await finite
  })

  it("lowers concurrency and pauses queued work after an overflow NOTICE", async () => {
    vi.useFakeTimers()
    setPolicy({maxFiltersPerSubscription: 1, maxSubscriptions: 3})
    const {context, send, socket} = makeSocketContext()
    const controllers = Array.from({length: 4}, () => new AbortController())
    const requests = controllers.map((controller, index) =>
      requestOne({
        relay,
        filters: [{kinds: [index + 1]}],
        signal: controller.signal,
        context,
      }),
    )

    expect(getReqs(send)).toHaveLength(3)
    socket.emit(
      SocketEvent.Receive,
      [RelayMessageType.Notice, "ERROR: too many concurrent REQs"],
      relay,
    )
    controllers[0].abort()
    controllers[1].abort()
    expect(getReqs(send)).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(250)
    expect(getReqs(send)).toHaveLength(4)

    controllers[2].abort()
    controllers[3].abort()
    await Promise.all(requests)
  })

  it("does not send loader work aborted before the batch flush", async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const adapter = new MockAdapter(relay, send)
    const loader = makeLoader({
      delay: 10,
      context: {getAdapter: () => adapter},
    })
    const controller = new AbortController()
    const pending = loader({relays: [relay], filters: [{kinds: [1]}], signal: controller.signal})

    controller.abort()
    await vi.advanceTimersByTimeAsync(10)

    await expect(pending).resolves.toEqual([])
    expect(send).not.toHaveBeenCalled()
  })

  it("rejects loader work when one filter exceeds the message limit", async () => {
    vi.useFakeTimers()
    const adapter = new MockAdapter(relay, vi.fn())
    const loader = makeLoader({
      delay: 0,
      maxMessageBytes: 32,
      context: {getAdapter: () => adapter},
    })
    const pending = loader({
      relays: [relay],
      filters: [{search: "x".repeat(100)}],
    })
    const rejected = expect(pending).rejects.toThrow("REQ exceeds maxMessageBytes")

    await vi.runAllTimersAsync()
    await rejected
  })

  it("does not let a fast CLOSED relay abort a slower healthy relay", async () => {
    const badRelay = "wss://bad.example/"
    const goodRelay = "wss://good.example/"
    const adapters = new Map<string, MockAdapter>()
    const pending = request({
      relays: [badRelay, goodRelay],
      filters: [{kinds: [1]}],
      autoClose: true,
      threshold: 0.5,
      context: {
        getAdapter: url => {
          const adapter = new MockAdapter(url, vi.fn())
          adapters.set(url, adapter)
          return adapter
        },
      },
    })
    const badReq = (adapters.get(badRelay)!.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const goodSend = adapters.get(goodRelay)!.send as ReturnType<typeof vi.fn>
    const goodReq = goodSend.mock.calls[0][0]

    adapters.get(badRelay)!.receive([RelayMessageType.Closed, badReq[1], "restricted: denied"])
    expect(goodSend.mock.calls.some(([message]) => message[0] === ClientMessageType.Close)).toBe(
      false,
    )

    adapters.get(goodRelay)!.receive([RelayMessageType.Eose, goodReq[1]])
    await pending
  })

  it("removes policy resolvers without resurrecting disposed registrations", async () => {
    const restoreFirst = setRequestPolicy(() => ({maxFiltersPerSubscription: 5}))
    const restoreSecond = setRequestPolicy(() => ({maxFiltersPerSubscription: 2}))
    restoreFirst()
    restoreSecond()
    const send = vi.fn()
    const adapter = new MockAdapter(relay, send)
    const controller = new AbortController()
    const pending = requestOne({
      relay,
      filters: [{kinds: [1]}, {kinds: [2]}, {kinds: [3]}],
      signal: controller.signal,
      context: {getAdapter: () => adapter},
    })

    expect(send.mock.calls).toHaveLength(3)
    controller.abort()
    await pending
  })
})
