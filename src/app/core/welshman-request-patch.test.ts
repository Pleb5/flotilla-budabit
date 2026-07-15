import {afterEach, describe, expect, it, vi} from "vitest"
import {
  ClientMessageType,
  getRequestSchedulerSnapshots,
  MockAdapter,
  RelayMessageType,
  RequestAdmissionError,
  Socket,
  SocketAdapter,
  SocketEvent,
  SocketStatus,
  makeLoader,
  request,
  requestOne,
  setRequestPolicy,
  socketPolicyCloseInactive,
  subscribeRequestScheduler,
  type ClientMessage,
} from "@welshman/net"
import type {Filter} from "@welshman/util"

const relay = "wss://relay.example/"
const restorePolicies: Array<() => void> = []

const setPolicy = (policy: {
  maxFiltersPerSubscription?: number
  maxSubscriptions?: number
  maxLiveSubscriptions?: number
  maxBackgroundLiveSubscriptions?: number
  maxMessageBytes?: number
  criticalLivePriority?: number
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

  it("does not let a caller limit permanently lower socket policy", async () => {
    setPolicy({maxFiltersPerSubscription: 1, maxSubscriptions: 3})
    const {context, send, socket} = makeSocketContext()
    const limitedController = new AbortController()
    const limited = requestOne({
      relay,
      filters: [{kinds: [1]}],
      maxSubscriptions: 1,
      signal: limitedController.signal,
      context,
    })

    limitedController.abort()
    await limited

    const finite = requestOne({
      relay,
      filters: [{kinds: [2]}, {kinds: [3]}, {kinds: [4]}],
      autoClose: true,
      context,
    })
    const finiteReqs = getReqs(send).slice(1)

    expect(finiteReqs).toHaveLength(3)
    finiteReqs.forEach(message =>
      socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, message[1]], relay),
    )
    await finite
  })

  it("relaxes updated resolver policy only after the scheduler is idle", async () => {
    let maxSubscriptions = 1
    restorePolicies.push(
      setRequestPolicy(() => ({
        maxFiltersPerSubscription: 1,
        maxSubscriptions,
      })),
    )
    const {context, send, socket} = makeSocketContext()
    const blockerController = new AbortController()
    const blocker = requestOne({
      relay,
      filters: [{kinds: [1]}],
      signal: blockerController.signal,
      context,
    })

    maxSubscriptions = 2
    const first = requestOne({relay, filters: [{kinds: [2]}], autoClose: true, context})
    const second = requestOne({relay, filters: [{kinds: [3]}], autoClose: true, context})

    expect(getReqs(send)).toHaveLength(1)
    blockerController.abort()
    await blocker

    const admitted = getReqs(send).slice(1)
    expect(admitted).toHaveLength(2)
    admitted.forEach(message =>
      socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, message[1]], relay),
    )
    await Promise.all([first, second])
  })

  it("applies resolver policy tightening to new admissions", async () => {
    let maxSubscriptions = 2
    restorePolicies.push(
      setRequestPolicy(() => ({
        maxFiltersPerSubscription: 1,
        maxSubscriptions,
      })),
    )
    const {context, send, socket} = makeSocketContext()
    const blockerController = new AbortController()
    const blocker = requestOne({
      relay,
      filters: [{kinds: [1]}],
      signal: blockerController.signal,
      context,
    })

    maxSubscriptions = 1
    const finite = requestOne({relay, filters: [{kinds: [2]}], autoClose: true, context})
    expect(getReqs(send)).toHaveLength(1)

    blockerController.abort()
    await blocker
    const admitted = getReqs(send)[1]
    expect(admitted).toBeDefined()
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, admitted[1]], relay)
    await finite
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

  it("retries a finite array rejection once with smaller filter groups", async () => {
    setPolicy({maxFiltersPerSubscription: 4, maxSubscriptions: 2})
    const {context, send, socket} = makeSocketContext()
    const onClosed = vi.fn()
    const onEose = vi.fn()
    const onStart = vi.fn()
    const result = requestOne({
      relay,
      filters: [{kinds: [1]}, {kinds: [2]}, {kinds: [3]}, {kinds: [4]}],
      autoClose: true,
      onClosed,
      onEose,
      onStart,
      context,
    })
    const initial = getReqs(send)[0]

    socket.emit(
      SocketEvent.Receive,
      [RelayMessageType.Closed, initial[1], "bad req: array too big"],
      relay,
    )

    const retries = getReqs(send).slice(1)
    expect(getReqs(send).map(message => message.slice(2).length)).toEqual([4, 2, 2])
    retries.forEach(message =>
      socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, message[1]], relay),
    )

    await result
    expect(onStart).toHaveBeenCalledTimes(3)
    expect(onClosed).not.toHaveBeenCalled()
    expect(onEose).toHaveBeenCalledOnce()
  })

  it("does not retry an array fallback more than once", async () => {
    setPolicy({maxFiltersPerSubscription: 2, maxSubscriptions: 2})
    const {context, send, socket} = makeSocketContext()
    const onClosed = vi.fn()
    const result = requestOne({
      relay,
      filters: [{kinds: [1]}, {kinds: [2]}],
      autoClose: true,
      onClosed,
      context,
    })
    const initial = getReqs(send)[0]

    socket.emit(
      SocketEvent.Receive,
      [RelayMessageType.Closed, initial[1], "bad req: arr too big"],
      relay,
    )
    const retries = getReqs(send).slice(1)
    socket.emit(
      SocketEvent.Receive,
      [RelayMessageType.Closed, retries[0][1], "bad req: arr too big"],
      relay,
    )
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, retries[1][1]], relay)

    await result
    expect(getReqs(send)).toHaveLength(3)
    expect(onClosed).toHaveBeenCalledOnce()
  })

  it("does not repartition live requests after array rejection", async () => {
    setPolicy({maxFiltersPerSubscription: 2, maxSubscriptions: 4})
    const {context, send, socket} = makeSocketContext()
    const onClosed = vi.fn()
    const result = requestOne({
      relay,
      filters: [{kinds: [1]}, {kinds: [2]}, {kinds: [3]}, {kinds: [4]}],
      onClosed,
      context,
    })
    const initial = getReqs(send)[0]

    socket.emit(
      SocketEvent.Receive,
      [RelayMessageType.Closed, initial[1], "bad req: array too big"],
      relay,
    )

    await result
    expect(getReqs(send)).toHaveLength(2)
    expect(
      getMessages(send).filter(message => message[0] === ClientMessageType.Close),
    ).toHaveLength(1)
    expect(onClosed).toHaveBeenCalledOnce()
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

  it("ages queued finite work past continuously newer priorities", async () => {
    vi.useFakeTimers()
    setPolicy({maxFiltersPerSubscription: 1, maxSubscriptions: 1})
    const {context, send, socket} = makeSocketContext()
    const blockerController = new AbortController()
    const blocker = requestOne({
      relay,
      filters: [{kinds: [1]}],
      signal: blockerController.signal,
      context,
    })
    const lowController = new AbortController()
    const low = requestOne({
      relay,
      filters: [{kinds: [2]}],
      autoClose: true,
      signal: lowController.signal,
      priority: 0,
      context,
    })

    await vi.advanceTimersByTimeAsync(101_000)

    const highController = new AbortController()
    const high = requestOne({
      relay,
      filters: [{kinds: [3]}],
      autoClose: true,
      signal: highController.signal,
      priority: 100,
      context,
    })
    blockerController.abort()
    await blocker

    const agedReq = getReqs(send)[1]
    expect((agedReq[2] as Filter).kinds).toEqual([2])
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, agedReq[1]], relay)

    const highReq = getReqs(send)[2]
    expect((highReq[2] as Filter).kinds).toEqual([3])
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, highReq[1]], relay)

    await Promise.all([low, high])
  })

  it("starts finite work while seven live subscriptions are active", async () => {
    setPolicy({
      maxFiltersPerSubscription: 1,
      maxSubscriptions: 9,
      maxLiveSubscriptions: 7,
      maxBackgroundLiveSubscriptions: 5,
      criticalLivePriority: 200,
    })
    const {context, send, socket} = makeSocketContext()
    const liveControllers = Array.from({length: 7}, () => new AbortController())
    const live = liveControllers.map((controller, index) =>
      requestOne({
        relay,
        filters: [{kinds: [index + 1]}],
        signal: controller.signal,
        priority: 200,
        context,
      }),
    )

    expect(getReqs(send)).toHaveLength(7)
    const finite = requestOne({
      relay,
      filters: [{kinds: [999]}],
      autoClose: true,
      context,
    })

    expect(getReqs(send)).toHaveLength(8)
    const finiteReq = getReqs(send)[7]
    expect((finiteReq[2] as Filter).kinds).toEqual([999])
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, finiteReq[1]], relay)

    liveControllers.forEach(controller => controller.abort())
    await Promise.all([...live, finite])
  })

  it("starts critical live work while five background live subscriptions are active", async () => {
    setPolicy({
      maxFiltersPerSubscription: 1,
      maxSubscriptions: 9,
      maxLiveSubscriptions: 7,
      maxBackgroundLiveSubscriptions: 5,
      criticalLivePriority: 200,
    })
    const {context, send} = makeSocketContext()
    const backgroundControllers = Array.from({length: 5}, () => new AbortController())
    const background = backgroundControllers.map((controller, index) =>
      requestOne({
        relay,
        filters: [{kinds: [index + 1]}],
        signal: controller.signal,
        priority: 0,
        context,
      }),
    )

    expect(getReqs(send)).toHaveLength(5)
    const criticalController = new AbortController()
    const critical = requestOne({
      relay,
      filters: [{kinds: [999]}],
      signal: criticalController.signal,
      priority: 200,
      context,
    })

    expect(getReqs(send)).toHaveLength(6)
    expect((getReqs(send)[5][2] as Filter).kinds).toEqual([999])

    backgroundControllers.forEach(controller => controller.abort())
    criticalController.abort()
    await Promise.all([...background, critical])
  })

  it("rejects oversized live groups before sending any REQ", () => {
    setPolicy({
      maxFiltersPerSubscription: 1,
      maxSubscriptions: 9,
      maxLiveSubscriptions: 7,
      maxBackgroundLiveSubscriptions: 5,
      criticalLivePriority: 200,
    })
    const {context, send} = makeSocketContext()
    const filters = Array.from({length: 6}, (_, index) => ({kinds: [index + 1]}))

    expect(() =>
      requestOne({
        relay,
        filters,
        autoClose: true,
        lifetime: "live",
        priority: 0,
        context,
      }),
    ).toThrow(RequestAdmissionError)
    expect(() =>
      requestOne({
        relay,
        filters,
        autoClose: true,
        lifetime: "live",
        priority: 0,
        context,
      }),
    ).toThrow("background-live request requires 6 subscriptions but its cap is 5")
    expect(getReqs(send)).toHaveLength(0)
  })

  it("queues a live group until all of its slots fit", async () => {
    setPolicy({
      maxFiltersPerSubscription: 1,
      maxSubscriptions: 9,
      maxLiveSubscriptions: 7,
      maxBackgroundLiveSubscriptions: 5,
      criticalLivePriority: 200,
    })
    const {context, send} = makeSocketContext()
    const activeControllers = Array.from({length: 6}, () => new AbortController())
    const active = activeControllers.map((controller, index) =>
      requestOne({
        relay,
        filters: [{kinds: [index + 1]}],
        signal: controller.signal,
        priority: 200,
        context,
      }),
    )
    const groupController = new AbortController()
    const group = requestOne({
      relay,
      filters: [{kinds: [100]}, {kinds: [101]}],
      signal: groupController.signal,
      priority: 200,
      context,
    })

    expect(getReqs(send)).toHaveLength(6)
    activeControllers[0].abort()
    expect(getReqs(send)).toHaveLength(8)
    expect(getReqs(send).slice(6).map(message => (message[2] as Filter).kinds)).toEqual([
      [100],
      [101],
    ])

    activeControllers.slice(1).forEach(controller => controller.abort())
    groupController.abort()
    await Promise.all([...active, group])
  })

  it("fires onStart only when queued physical work starts", async () => {
    setPolicy({
      maxFiltersPerSubscription: 1,
      maxSubscriptions: 1,
      maxLiveSubscriptions: 1,
      maxBackgroundLiveSubscriptions: 1,
    })
    const {context, send, socket} = makeSocketContext()
    const liveController = new AbortController()
    const live = requestOne({
      relay,
      filters: [{kinds: [1]}],
      signal: liveController.signal,
      context,
    })
    const onStart = vi.fn()
    const finite = requestOne({
      relay,
      filters: [{kinds: [2]}],
      autoClose: true,
      onStart,
      context,
    })

    expect(onStart).not.toHaveBeenCalled()
    liveController.abort()
    await live

    expect(onStart).toHaveBeenCalledOnce()
    expect(onStart).toHaveBeenCalledWith(relay)
    const finiteReq = getReqs(send)[1]
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, finiteReq[1]], relay)
    await finite
  })

  it("reports active scheduler diagnostics and drops idle schedulers until reused", async () => {
    vi.useFakeTimers()
    setPolicy({
      maxFiltersPerSubscription: 2,
      maxSubscriptions: 1,
      maxLiveSubscriptions: 1,
      maxBackgroundLiveSubscriptions: 1,
      criticalLivePriority: 200,
    })
    const diagnosticRelay = "wss://diagnostics.example/"
    const socket = new Socket(diagnosticRelay, [])
    const send = vi.fn<(message: ClientMessage) => void>()
    socket.send = send
    const context = {getAdapter: () => new SocketAdapter(socket)}
    const snapshots = vi.fn()
    const unsubscribeSnapshots = subscribeRequestScheduler(snapshots)
    const liveController = new AbortController()
    const live = requestOne({
      relay: diagnosticRelay,
      filters: [{kinds: [1]}, {kinds: [2]}],
      signal: liveController.signal,
      owner: "extension:test",
      context,
    })
    const finite = requestOne({
      relay: diagnosticRelay,
      filters: [{kinds: [3]}],
      autoClose: true,
      owner: "interactive-loader",
      context,
    })

    await vi.advanceTimersByTimeAsync(1_500)
    socket.emit(SocketEvent.Receive, [RelayMessageType.Notice, "relay busy"], diagnosticRelay)
    const queued = getRequestSchedulerSnapshots().find(item => item.relay === diagnosticRelay)

    expect(queued).toMatchObject({
      relay: diagnosticRelay,
      configuredMaxSubscriptions: 1,
      configuredMaxLiveSubscriptions: 1,
      configuredMaxBackgroundLiveSubscriptions: 1,
      learnedMaxSubscriptions: null,
      effectiveMaxSubscriptions: 1,
      active: {total: 1, finite: 0, live: 1, criticalLive: 0, backgroundLive: 1},
      queued: {total: 1, finite: 1, live: 0, criticalLive: 0, backgroundLive: 0},
      oldestQueuedAgeMs: 1_500,
      oldestQueuedAgeMsByClass: {finite: 1_500},
      noticeCount: 1,
      owners: [
        {
          owner: "extension:test",
          activeSubscriptions: 1,
          activeFilters: 2,
          queuedSubscriptions: 0,
          queuedFilters: 0,
        },
        {
          owner: "interactive-loader",
          activeSubscriptions: 0,
          activeFilters: 0,
          queuedSubscriptions: 1,
          queuedFilters: 1,
        },
      ],
    })

    liveController.abort()
    await live
    const started = getRequestSchedulerSnapshots().find(item => item.relay === diagnosticRelay)
    expect(started?.lastQueueStartDelayMs).toBe(1_500)
    expect(started?.maxQueueStartDelayMs).toBe(1_500)
    expect(started?.active).toMatchObject({total: 1, finite: 1, live: 0})
    expect(snapshots).toHaveBeenCalled()

    const finiteReq = getReqs(send).at(-1)!
    socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, finiteReq[1]], diagnosticRelay)
    await finite
    expect(getRequestSchedulerSnapshots().some(item => item.relay === diagnosticRelay)).toBe(false)

    const nextController = new AbortController()
    const next = requestOne({
      relay: diagnosticRelay,
      filters: [{kinds: [4]}],
      signal: nextController.signal,
      owner: "extension:next",
      context,
    })
    expect(getRequestSchedulerSnapshots()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relay: diagnosticRelay,
          active: expect.objectContaining({total: 1}),
        }),
      ]),
    )
    nextController.abort()
    await next
    expect(getRequestSchedulerSnapshots().some(item => item.relay === diagnosticRelay)).toBe(false)
    unsubscribeSnapshots()
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

  it("resets session-learned overflow limits when the socket reconnects", async () => {
    vi.useFakeTimers()
    setPolicy({maxFiltersPerSubscription: 1, maxSubscriptions: 3})
    const {context, send, socket} = makeSocketContext()
    const firstControllers = Array.from({length: 3}, () => new AbortController())
    const first = firstControllers.map((controller, index) =>
      requestOne({
        relay,
        filters: [{kinds: [index + 1]}],
        signal: controller.signal,
        context,
      }),
    )

    socket.emit(
      SocketEvent.Receive,
      [RelayMessageType.Notice, "ERROR: too many concurrent REQs"],
      relay,
    )
    firstControllers.forEach(controller => controller.abort())
    await Promise.all(first)
    await vi.advanceTimersByTimeAsync(250)

    const secondControllers = Array.from({length: 3}, () => new AbortController())
    const second = secondControllers.map((controller, index) =>
      requestOne({
        relay,
        filters: [{kinds: [index + 10]}],
        signal: controller.signal,
        context,
      }),
    )

    expect(getReqs(send)).toHaveLength(5)
    socket.emit(SocketEvent.Status, SocketStatus.Open, relay)
    expect(getReqs(send)).toHaveLength(6)

    secondControllers.forEach(controller => controller.abort())
    await Promise.all(second)
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
