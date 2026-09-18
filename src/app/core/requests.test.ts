// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {DAY} from "@welshman/lib"
import type {RequestOptions} from "@welshman/net"
import {EVENT_DATE, EVENT_TIME, type Filter, type TrustedEvent} from "@welshman/util"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@lib/html", async importOriginal => ({
  ...(await importOriginal<typeof import("@lib/html")>()),
  createScroller: vi.fn(() => ({check: vi.fn(), stop: vi.fn()})),
}))

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()
  return {
    ...actual,
    loadRelay: vi.fn().mockResolvedValue({}),
    makeFeedController: vi.fn(actual.makeFeedController),
  }
})

vi.mock("@welshman/net", async importOriginal => ({
  ...(await importOriginal<typeof import("@welshman/net")>()),
  request: vi.fn(),
}))

describe("requests", () => {
  it("discoverRelays returns promise for empty lists", async () => {
    const {discoverRelays} = await import("./requests")
    const result = discoverRelays([])
    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toEqual([])
  })

  it("discoverRelays filters to shareable relay URLs from lists", async () => {
    const {discoverRelays} = await import("./requests")
    const listWithRelays = {
      kind: 10003,
      publicTags: [["r", "wss://relay.damus.io"]],
      privateTags: [],
    } as any
    const result = discoverRelays([listWithRelays])
    expect(result).toBeInstanceOf(Promise)
    const resolved = await result
    expect(Array.isArray(resolved)).toBe(true)
  })

  it("builds separate date and time calendar feed filters", async () => {
    const {makeCalendarDateBasedFilters, makeCalendarTimeBasedFilters} = await import("./requests")
    const filters: Filter[] = [
      {kinds: [EVENT_DATE, EVENT_TIME], authors: ["a"], "#h": ["target"]},
      {kinds: [EVENT_TIME], authors: ["b"]},
      {kinds: [EVENT_DATE], authors: ["c"]},
    ]

    expect(makeCalendarDateBasedFilters(filters)).toEqual([
      {kinds: [EVENT_DATE], authors: ["a"], "#h": ["target"]},
      {kinds: [EVENT_DATE], authors: ["c"]},
    ])
    expect(makeCalendarTimeBasedFilters(filters, 0, DAY)).toEqual([
      {kinds: [EVENT_TIME], authors: ["a"], "#h": ["target"], "#D": ["0"]},
      {kinds: [EVENT_TIME], authors: ["b"], "#D": ["0"]},
    ])
  })

  it("uses structural calendar relay filters while admitting current writers locally", async () => {
    const {makeCalendarFeed} = await import("./requests")
    const {request} = await import("@welshman/net")
    const {repository} = await import("@welshman/app")
    const relay = "wss://broad-calendar.test"
    const allowedAuthor = "1".repeat(64)
    const makeEvent = (id: string, pubkey: string): TrustedEvent => ({
      id: id.repeat(64),
      pubkey,
      created_at: 100,
      kind: EVENT_DATE,
      tags: [
        ["d", id],
        ["start", "2026-08-14"],
        ["h", "community"],
      ],
      content: "",
      sig: "3".repeat(128),
    })
    const allowed = makeEvent("4", allowedAuthor)
    const outsider = makeEvent("5", "2".repeat(64))
    const requestMock = vi.mocked(request)
    requestMock.mockImplementation(async options => {
      expect(options.filters[0]).not.toHaveProperty("authors")
      options.onEvent?.(outsider, relay)
      options.onEvent?.(allowed, relay)
      options.onEose?.(relay)
      return [outsider, allowed]
    })
    const originalAbortSignalAny = AbortSignal.any
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      value: (signals: AbortSignal[]) => signals[0],
    })
    const onInitialLoad = vi.fn()
    const feed = makeCalendarFeed({
      element: document.createElement("div"),
      relays: [relay],
      filters: [{kinds: [EVENT_DATE], authors: [allowedAuthor], "#h": ["community"]}],
      relayFilters: [{kinds: [EVENT_DATE], "#h": ["community"]}],
      onInitialLoad,
    })

    try {
      await vi.waitFor(() => expect(onInitialLoad).toHaveBeenCalledOnce())

      expect(onInitialLoad).toHaveBeenCalledWith({
        complete: true,
        timedOut: false,
      })
      expect(get(feed.events).map(event => event.id)).toEqual([allowed.id])
    } finally {
      feed.cleanup()
      repository.removeEvent(allowed.id)
      repository.removeEvent(outsider.id)
      requestMock.mockReset()
      if (originalAbortSignalAny) {
        Object.defineProperty(AbortSignal, "any", {
          configurable: true,
          value: originalAbortSignalAny,
        })
      } else {
        Reflect.deleteProperty(AbortSignal, "any")
      }
    }
  })

  it("keeps a live event visible when its signed replacement uses the same id", async () => {
    vi.useFakeTimers()

    const {makeFeed} = await import("./requests")
    const {repository, tracker} = await import("@welshman/app")
    const relay = "wss://room-feed.test"
    const event: TrustedEvent = {
      id: "1".repeat(64),
      pubkey: "2".repeat(64),
      created_at: 123,
      kind: 1,
      tags: [],
      content: "live message",
      sig: "3".repeat(128),
    }
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: [relay],
      feedFilters: [{kinds: [event.kind], authors: [event.pubkey]}],
    })

    try {
      vi.advanceTimersByTime(3000)
      tracker.addRelay(event.id, relay)
      repository.publish(event)

      expect(get(feed.events).map(item => item.id)).toEqual([event.id])

      repository.removeEvent(event.id)
      repository.publish({...event, sig: "4".repeat(128)})

      expect(get(feed.events).map(item => item.id)).toEqual([event.id])
    } finally {
      feed.cleanup()
      repository.removeEvent(event.id)
      tracker.removeRelay(event.id, relay)
      vi.useRealTimers()
    }
  })

  it("adds a cached event when a room relay acknowledges it later", async () => {
    vi.useFakeTimers()

    const {makeFeed} = await import("./requests")
    const {repository, tracker} = await import("@welshman/app")
    const relay = "wss://acknowledged-room-feed.test"
    const otherRelay = "wss://other-room-feed.test"
    const event: TrustedEvent = {
      id: "4".repeat(64),
      pubkey: "5".repeat(64),
      created_at: 456,
      kind: 9,
      tags: [],
      content: "optimistic room message",
      sig: "6".repeat(128),
    }
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: [relay],
      feedFilters: [{kinds: [event.kind], authors: [event.pubkey]}],
    })

    try {
      vi.advanceTimersByTime(3000)
      repository.publish(event)

      expect(get(feed.events)).toEqual([])

      tracker.addRelay(event.id, otherRelay)
      expect(get(feed.events)).toEqual([])

      tracker.addRelay(event.id, relay)
      expect(get(feed.events).map(item => item.id)).toEqual([event.id])
    } finally {
      feed.cleanup()
      repository.removeEvent(event.id)
      tracker.removeRelay(event.id, relay)
      tracker.removeRelay(event.id, otherRelay)
      vi.useRealTimers()
    }
  })

  it("honors a custom initial timeout and forwards request scheduling metadata", async () => {
    vi.useFakeTimers()

    const {makeFeed} = await import("./requests")
    const {makeFeedController} = await import("@welshman/app")
    const onInitialLoad = vi.fn()
    const controllerMock = vi.mocked(makeFeedController)
    controllerMock.mockClear()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: ["wss://priority-room.test"],
      feedFilters: [{kinds: [9]}],
      initialLoadTimeoutMs: 10_000,
      priority: 350,
      owner: "active-room:test",
      onInitialLoad,
    })

    try {
      expect(controllerMock).toHaveBeenCalledWith(
        expect.objectContaining({priority: 350, owner: "active-room:test"}),
      )

      await vi.advanceTimersByTimeAsync(9_999)
      expect(onInitialLoad).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(onInitialLoad).toHaveBeenCalledOnce()
      expect(onInitialLoad).toHaveBeenCalledWith({complete: false, timedOut: true})
    } finally {
      feed.cleanup()
      vi.useRealTimers()
    }
  })

  it("removes per-request limits before building a paginated feed", async () => {
    vi.useFakeTimers()

    const {makeFeed} = await import("./requests")
    const {makeFeedController} = await import("@welshman/app")
    const controllerMock = vi.mocked(makeFeedController)
    const limitedFilter: Filter = {kinds: [9041], ids: ["a".repeat(64)], limit: 1}
    controllerMock.mockClear()

    const feed = makeFeed({
      element: document.createElement("div"),
      relays: ["wss://goal-feed.test"],
      feedFilters: [{kinds: [9041]}, limitedFilter],
      relayFilters: [{kinds: [9041], "#h": ["community"]}, limitedFilter],
    })

    try {
      const controllerFeed = controllerMock.mock.calls[0][0].feed

      expect(JSON.stringify(controllerFeed)).toContain("a".repeat(64))
      expect(JSON.stringify(controllerFeed)).not.toContain('"limit"')
      expect(limitedFilter).toHaveProperty("limit", 1)
    } finally {
      feed.cleanup()
      vi.useRealTimers()
    }
  })

  it("uses broad relay filters while admitting only current writers locally", async () => {
    vi.useFakeTimers()

    const {makeFeed} = await import("./requests")
    const {makeFeedController, repository, tracker} = await import("@welshman/app")
    const relay = "wss://broad-community-feed.test"
    const allowedAuthors = Array.from({length: 1001}, (_, index) =>
      index.toString(16).padStart(64, "0"),
    )
    const allowedAuthor = allowedAuthors[1000]
    const outsiderAuthor = "8".repeat(64)
    const makeEvent = (id: string, pubkey: string): TrustedEvent => ({
      id: id.repeat(64),
      pubkey,
      created_at: 789,
      kind: 9,
      tags: [["h", "community"]],
      content: "message",
      sig: "9".repeat(128),
    })
    const controllerMock = vi.mocked(makeFeedController)
    controllerMock.mockClear()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: [relay],
      feedFilters: [{kinds: [9], authors: allowedAuthors, "#h": ["community"]}],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
    })
    const outsider = makeEvent("a", outsiderAuthor)
    const allowed = makeEvent("b", allowedAuthor)

    try {
      expect(JSON.stringify(controllerMock.mock.calls[0][0].feed)).not.toContain(allowedAuthor)
      vi.advanceTimersByTime(3000)

      tracker.addRelay(outsider.id, relay)
      repository.publish(outsider)
      tracker.addRelay(allowed.id, relay)
      repository.publish(allowed)

      expect(get(feed.events).map(event => event.id)).toEqual([allowed.id])
    } finally {
      feed.cleanup()
      repository.removeEvent(outsider.id)
      repository.removeEvent(allowed.id)
      tracker.removeRelay(outsider.id, relay)
      tracker.removeRelay(allowed.id, relay)
      vi.useRealTimers()
    }
  })

  it("applies local admission to caller-provided initial events", async () => {
    const {makeFeed} = await import("./requests")
    const allowedAuthor = "1".repeat(64)
    const makeEvent = (id: string, pubkey: string): TrustedEvent => ({
      id: id.repeat(64),
      pubkey,
      created_at: 1,
      kind: 11,
      tags: [["h", "community"]],
      content: "thread",
      sig: "2".repeat(128),
    })
    const allowed = makeEvent("3", allowedAuthor)
    const outsider = makeEvent("4", "5".repeat(64))
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: [],
      feedFilters: [{kinds: [11], authors: [allowedAuthor], "#h": ["community"]}],
      relayFilters: [{kinds: [11], "#h": ["community"]}],
      initialEvents: [outsider, allowed],
    })

    try {
      expect(get(feed.events).map(event => event.id)).toEqual([allowed.id])
    } finally {
      feed.cleanup()
    }
  })

  it("bounds unauthorized-only scanning and reports an incomplete initial load", async () => {
    const {makeFeed} = await import("./requests")
    const {makeFeedController} = await import("@welshman/app")
    const {createScroller} = await import("@lib/html")
    const controllerMock = vi.mocked(makeFeedController)
    const scrollerMock = vi.mocked(createScroller)
    const outsider: TrustedEvent = {
      id: "d".repeat(64),
      pubkey: "e".repeat(64),
      created_at: 1,
      kind: 9,
      tags: [["h", "community"]],
      content: "outsider",
      sig: "f".repeat(128),
    }
    const load = vi.fn()
    controllerMock.mockImplementationOnce(options => {
      load.mockImplementation(async () => options.onEvent?.(outsider))
      return {load} as any
    })
    const onInitialLoad = vi.fn()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: ["wss://saturated-community-feed.test"],
      feedFilters: [{kinds: [9], authors: ["c".repeat(64)], "#h": ["community"]}],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
      onInitialLoad,
    })

    try {
      const onScroll = scrollerMock.mock.calls.at(-1)?.[0].onScroll
      expect(onScroll).toBeTypeOf("function")
      await onScroll?.()

      expect(load).toHaveBeenCalledTimes(3)
      expect(onInitialLoad).toHaveBeenCalledWith({
        complete: false,
        timedOut: false,
        saturated: true,
      })
    } finally {
      feed.cleanup()
    }
  })

  it("does not treat an empty non-exhausted broad scan as authoritative", async () => {
    const {makeFeed} = await import("./requests")
    const {makeFeedController} = await import("@welshman/app")
    const {createScroller} = await import("@lib/html")
    const controllerMock = vi.mocked(makeFeedController)
    const scrollerMock = vi.mocked(createScroller)
    controllerMock.mockImplementationOnce(
      () => ({load: vi.fn().mockResolvedValue(undefined)}) as any,
    )
    const onInitialLoad = vi.fn()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: ["wss://disconnected-community-feed.test"],
      feedFilters: [{kinds: [9], authors: ["1".repeat(64)], "#h": ["community"]}],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
      onInitialLoad,
    })

    try {
      const onScroll = scrollerMock.mock.calls.at(-1)?.[0].onScroll
      await onScroll?.()

      expect(onInitialLoad).toHaveBeenCalledWith({complete: false, timedOut: false})
    } finally {
      feed.cleanup()
    }
  })

  it("does not count repeated exhaustion from one relay as multi-relay exhaustion", async () => {
    const {makeFeed} = await import("./requests")
    const {makeFeedController} = await import("@welshman/app")
    const {createScroller} = await import("@lib/html")
    const controllerMock = vi.mocked(makeFeedController)
    const scrollerMock = vi.mocked(createScroller)
    const outsider: TrustedEvent = {
      id: "6".repeat(64),
      pubkey: "7".repeat(64),
      created_at: 1,
      kind: 9,
      tags: [["h", "community"]],
      content: "outsider",
      sig: "8".repeat(128),
    }
    controllerMock.mockImplementationOnce(
      options =>
        ({
          load: vi.fn(async () => {
            options.onEvent?.(outsider)
            options.onExhausted?.()
          }),
        }) as any,
    )
    controllerMock.mockImplementationOnce(
      options =>
        ({
          load: vi.fn(async () => options.onEvent?.({...outsider, id: "9".repeat(64)})),
        }) as any,
    )
    const onExhausted = vi.fn()
    const feed = makeFeed({
      element: document.createElement("div"),
      relays: ["wss://exhausted.test", "wss://active.test"],
      feedFilters: [{kinds: [9], authors: ["a".repeat(64)], "#h": ["community"]}],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
      onExhausted,
    })

    try {
      const onScroll = scrollerMock.mock.calls.at(-1)?.[0].onScroll
      await onScroll?.()

      expect(onExhausted).not.toHaveBeenCalled()
    } finally {
      feed.cleanup()
    }
  })

  it("continues past an outsider-only page and admits an authorized older page", async () => {
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const relay = "wss://bounded-community-history.test"
    const allowedAuthor = "1".repeat(64)
    const makeEvent = (id: string, pubkey: string, createdAt: number): TrustedEvent => ({
      id: id.repeat(64),
      pubkey,
      created_at: createdAt,
      kind: 9,
      tags: [["h", "community"]],
      content: "message",
      sig: "f".repeat(128),
    })
    const outsiderPage = [makeEvent("2", "3".repeat(64), 200), makeEvent("4", "5".repeat(64), 200)]
    const allowed = makeEvent("6", allowedAuthor, 180)
    const request = vi.fn(async (options: RequestOptions) => {
      const events = options.filters[0].until === undefined ? outsiderPage : [allowed]
      for (const event of events) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return events
    })
    const publish = vi.fn()
    const track = vi.fn()
    const loadHistory = createBoundedCommunityHistoryLoader({request, publish, track})

    const result = await loadHistory({
      relays: [relay],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
      localFilters: [{kinds: [9], "#h": ["community"], authors: [allowedAuthor]}],
      pageSize: 2,
      maxPages: 3,
      timeoutMs: 1000,
    })

    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0][0].filters[0]).toMatchObject({limit: 2})
    expect(request.mock.calls[0][0].filters[0]).not.toHaveProperty("authors")
    expect(request.mock.calls[1][0].filters[0]).toMatchObject({limit: 2, until: 199})
    expect(result).toEqual({events: [allowed], complete: false, timedOut: false, saturated: true})
    expect(track).toHaveBeenCalledWith(allowed.id, relay)
    expect(publish).toHaveBeenCalledWith(allowed)
  })

  it("does not let one hundred outsider wrappers create a false empty result", async () => {
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const relay = "wss://bounded-community-wrappers.test"
    const community = "a".repeat(64)
    const controller = "c".repeat(64)
    const allowedAuthor = "b".repeat(64)
    const makeWrapper = (id: string, pubkey: string, createdAt: number): TrustedEvent => ({
      id,
      pubkey,
      created_at: createdAt,
      kind: 30222,
      tags: [
        ["d", id],
        ["k", "9041"],
        ["h", community],
        ["a", `32222:${controller}:${community}`, "", "community"],
      ],
      content: "",
      sig: "f".repeat(128),
    })
    const outsiders = Array.from({length: 100}, (_, index) =>
      makeWrapper(
        index.toString(16).padStart(64, "0"),
        (index + 1).toString(16).padStart(64, "0"),
        300 - index,
      ),
    )
    const allowed = makeWrapper("f".repeat(64), allowedAuthor, 100)
    const request = vi.fn(async (options: RequestOptions) => {
      expect(options.filters[0]).not.toHaveProperty("authors")
      const events = options.filters[0].until === undefined ? outsiders : [allowed]
      for (const event of events) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return events
    })
    const loadHistory = createBoundedCommunityHistoryLoader({
      request,
      publish: vi.fn(),
      track: vi.fn(),
    })

    const result = await loadHistory({
      relays: [relay],
      relayFilters: [{kinds: [30222], "#h": [community], "#k": ["9041"]}],
      localFilters: [{kinds: [30222], authors: [allowedAuthor], "#h": [community], "#k": ["9041"]}],
      pageSize: 100,
      maxPages: 2,
      timeoutMs: 1000,
    })

    expect(request).toHaveBeenCalledTimes(2)
    expect(result.events).toEqual([allowed])
    expect(result).toMatchObject({complete: false, saturated: true})
  })

  it("stops at the broad history page budget and reports saturation", async () => {
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const relay = "wss://saturated-bounded-history.test"
    let page = 0
    const request = vi.fn(async (options: RequestOptions) => {
      const events = [0, 1].map(index => ({
        id: `${page}${index}`.padEnd(64, "0"),
        pubkey: "7".repeat(64),
        created_at: 1000 - page * 10 - index,
        kind: 9,
        tags: [["h", "community"]],
        content: "outsider",
        sig: "8".repeat(128),
      })) as TrustedEvent[]
      page += 1
      for (const event of events) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return events
    })
    const loadHistory = createBoundedCommunityHistoryLoader({
      request,
      publish: vi.fn(),
      track: vi.fn(),
    })

    const result = await loadHistory({
      relays: [relay],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
      localFilters: [{kinds: [9], "#h": ["community"], authors: ["9".repeat(64)]}],
      pageSize: 2,
      maxPages: 2,
      timeoutMs: 1000,
    })

    expect(request).toHaveBeenCalledTimes(2)
    expect(result).toEqual({events: [], complete: false, timedOut: false, saturated: true})
  })

  it("reports a full same-timestamp cursor boundary as saturated incomplete history", async () => {
    const {loadBoundedCommunityHistory} = await import("./requests")
    const {request} = await import("@welshman/net")
    const relay = "wss://same-timestamp-boundary.test"
    const allowedAuthor = "1".repeat(64)
    const boundaryTimestamp = 500
    const makeEvent = (id: string, pubkey: string): TrustedEvent => ({
      id: id.repeat(64),
      pubkey,
      created_at: boundaryTimestamp,
      kind: 9,
      tags: [["h", "community"]],
      content: "message",
      sig: "f".repeat(128),
    })
    const boundaryPage = [
      makeEvent("2", "3".repeat(64)),
      makeEvent("4", "5".repeat(64)),
      makeEvent("6", "7".repeat(64)),
    ]
    const hiddenAllowedEvent = makeEvent("8", allowedAuthor)
    const relayEvents = [...boundaryPage, hiddenAllowedEvent]
    const requestMock = vi.mocked(request)
    requestMock.mockImplementation(async options => {
      const filter = options.filters[0]
      const events = relayEvents
        .filter(event => filter.until === undefined || event.created_at <= filter.until)
        .slice(0, filter.limit)

      for (const event of events) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return events
    })

    try {
      const result = await loadBoundedCommunityHistory({
        relays: [relay],
        relayFilters: [{kinds: [9], "#h": ["community"]}],
        localFilters: [{kinds: [9], "#h": ["community"], authors: [allowedAuthor]}],
        pageSize: boundaryPage.length,
        maxPages: 2,
        timeoutMs: 1000,
      })

      expect(requestMock).toHaveBeenCalledTimes(2)
      expect(requestMock.mock.calls[0][0].filters[0]).toMatchObject({limit: 3})
      expect(requestMock.mock.calls[0][0].filters[0]).not.toHaveProperty("authors")
      expect(requestMock.mock.calls[1][0].filters[0]).toMatchObject({limit: 3, until: 499})
      expect(result).toEqual({events: [], complete: false, timedOut: false, saturated: true})
    } finally {
      requestMock.mockReset()
    }
  })

  it("completes an exact identity history across full pages by proving timestamp boundaries", async () => {
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const {matchFilters} = await import("@welshman/util")
    const relay = "wss://identity-history.test"
    const author = "1".repeat(64)
    const events = Array.from({length: 205}, (_, index) => ({
      id: index.toString(16).padStart(64, "0"),
      pubkey: author,
      created_at: 1000 - index,
      kind: 7,
      tags: [["k", "30617"]],
      content: "+",
      sig: "f".repeat(128),
    })) as TrustedEvent[]
    const request = vi.fn(async (options: RequestOptions) => {
      const found = events
        .filter(event => matchFilters(options.filters, event))
        .slice(0, options.filters[0].limit)
      for (const event of found) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return found
    })
    const load = createBoundedCommunityHistoryLoader({request, publish: vi.fn(), track: vi.fn()})
    const filter = {kinds: [7], authors: [author], "#k": ["30617"]}
    const result = await load({
      relays: [relay],
      relayFilters: [filter],
      localFilters: [filter],
      verifyTimestampBoundaries: true,
    })
    expect(result).toMatchObject({complete: true, saturated: false, timedOut: false})
    expect(result.events).toHaveLength(205)
    expect(request).toHaveBeenCalledTimes(5)
    expect(request.mock.calls[1][0].filters[0]).toMatchObject({since: 901, until: 901})
  })

  it("keeps a failed boundary request retryable rather than marking history saturated", async () => {
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const relay = "wss://failed-identity-boundary.test"
    const events = [100, 99].map((created_at, index) => ({
      id: index.toString(16).padStart(64, "0"),
      pubkey: "1".repeat(64),
      created_at,
      kind: 7,
      tags: [],
      content: "+",
      sig: "f".repeat(128),
    })) as TrustedEvent[]
    const request = vi.fn(async (options: RequestOptions) => {
      if (options.filters[0].since !== undefined) {
        options.onClosed?.("error: temporary failure", relay)
        return []
      }
      for (const event of events) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return events
    })
    const load = createBoundedCommunityHistoryLoader({request, publish: vi.fn(), track: vi.fn()})
    const filter = {kinds: [7], authors: ["1".repeat(64)]}
    const result = await load({
      relays: [relay],
      relayFilters: [filter],
      localFilters: [filter],
      pageSize: 2,
      verifyTimestampBoundaries: true,
    })
    expect(result).toMatchObject({complete: false, saturated: false, events})
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("retains uncertainty if an exact identity scan cannot exhaust a timestamp boundary", async () => {
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const {matchFilters} = await import("@welshman/util")
    const relay = "wss://identity-boundary.test"
    const events = Array.from({length: 101}, (_, index) => ({
      id: index.toString(16).padStart(64, "0"),
      pubkey: "1".repeat(64),
      created_at: 100,
      kind: 7,
      tags: [],
      content: "+",
      sig: "f".repeat(128),
    })) as TrustedEvent[]
    const request = vi.fn(async (options: RequestOptions) => {
      const found = events
        .filter(event => matchFilters(options.filters, event))
        .slice(0, options.filters[0].limit)
      for (const event of found) options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return found
    })
    const load = createBoundedCommunityHistoryLoader({request, publish: vi.fn(), track: vi.fn()})
    const filter = {kinds: [7], authors: ["1".repeat(64)]}
    const result = await load({
      relays: [relay],
      relayFilters: [filter],
      localFilters: [filter],
      verifyTimestampBoundaries: true,
    })
    expect(result).toMatchObject({complete: false, saturated: true})
    expect(result.events).toHaveLength(100)
  })

  it("does not report complete history when a relay disconnects", async () => {
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const relay = "wss://disconnected-bounded-history.test"
    const request = vi.fn(async (options: RequestOptions) => {
      options.onDisconnect?.(relay)
      return []
    })
    const loadHistory = createBoundedCommunityHistoryLoader({
      request,
      publish: vi.fn(),
      track: vi.fn(),
    })

    await expect(
      loadHistory({
        relays: [relay],
        relayFilters: [{kinds: [9], "#h": ["community"]}],
        localFilters: [{kinds: [9], "#h": ["community"], authors: ["a".repeat(64)]}],
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({events: [], complete: false, timedOut: false, saturated: false})
  })

  it("does not consume the bounded history timeout while a request remains queued", async () => {
    vi.useFakeTimers()
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const relay = "wss://queued-bounded-history.test"
    const request = vi.fn(
      (options: RequestOptions) =>
        new Promise(resolve => {
          options.signal?.addEventListener("abort", () => resolve([]), {once: true})
        }),
    )
    const loadHistory = createBoundedCommunityHistoryLoader({
      request,
      publish: vi.fn(),
      track: vi.fn(),
    })
    let settled = false

    try {
      const pending = loadHistory({
        relays: [relay],
        relayFilters: [{kinds: [9]}],
        localFilters: [{kinds: [9]}],
        timeoutMs: 1000,
      }).then(result => {
        settled = true
        return result
      })

      await vi.advanceTimersByTimeAsync(29_999)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toEqual({
        events: [],
        complete: false,
        timedOut: true,
        saturated: false,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("starts the bounded history timeout when queued work physically starts", async () => {
    vi.useFakeTimers()
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const relay = "wss://delayed-bounded-history.test"
    const request = vi.fn(
      (options: RequestOptions) =>
        new Promise(resolve => {
          setTimeout(() => options.onStart?.(relay), 5000)
          options.signal?.addEventListener("abort", () => resolve([]), {once: true})
        }),
    )
    const loadHistory = createBoundedCommunityHistoryLoader({
      request,
      publish: vi.fn(),
      track: vi.fn(),
    })
    let settled = false

    try {
      const pending = loadHistory({
        relays: [relay],
        relayFilters: [{kinds: [9]}],
        localFilters: [{kinds: [9]}],
        timeoutMs: 1000,
      }).then(result => {
        settled = true
        return result
      })

      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(999)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).resolves.toMatchObject({complete: false, timedOut: true})
    } finally {
      vi.useRealTimers()
    }
  })

  it("settles queued bounded history immediately when the caller aborts", async () => {
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const relay = "wss://aborted-bounded-history.test"
    const controller = new AbortController()
    const request = vi.fn(
      (options: RequestOptions) =>
        new Promise(resolve => {
          options.signal?.addEventListener("abort", () => resolve([]), {once: true})
        }),
    )
    const loadHistory = createBoundedCommunityHistoryLoader({
      request,
      publish: vi.fn(),
      track: vi.fn(),
    })
    const pending = loadHistory({
      relays: [relay],
      relayFilters: [{kinds: [9]}],
      localFilters: [{kinds: [9]}],
      signal: controller.signal,
      timeoutMs: 1000,
    })

    controller.abort()

    await expect(pending).resolves.toEqual({
      events: [],
      complete: false,
      timedOut: false,
      saturated: false,
    })
    expect(request.mock.calls[0][0].signal?.aborted).toBe(true)
  })

  it("admits a writer beyond one thousand without putting the ACL on the wire", async () => {
    const {createBoundedCommunityHistoryLoader} = await import("./requests")
    const relay = "wss://large-community-history.test"
    const allowedAuthors = Array.from({length: 1001}, (_, index) =>
      index.toString(16).padStart(64, "0"),
    )
    const event: TrustedEvent = {
      id: "b".repeat(64),
      pubkey: allowedAuthors[1000],
      created_at: 100,
      kind: 9,
      tags: [["h", "community"]],
      content: "authorized",
      sig: "c".repeat(128),
    }
    const request = vi.fn(async (options: RequestOptions) => {
      expect(options.filters[0]).not.toHaveProperty("authors")
      options.onEvent?.(event, relay)
      options.onEose?.(relay)
      return [event]
    })
    const publish = vi.fn()
    const track = vi.fn()
    const loadHistory = createBoundedCommunityHistoryLoader({request, publish, track})

    const result = await loadHistory({
      relays: [relay],
      relayFilters: [{kinds: [9], "#h": ["community"]}],
      localFilters: [{kinds: [9], "#h": ["community"], authors: allowedAuthors}],
      timeoutMs: 1000,
    })

    expect(result).toEqual({events: [event], complete: true, timedOut: false, saturated: false})
    expect(track).toHaveBeenCalledWith(event.id, relay)
    expect(publish).toHaveBeenCalledWith(event)
  })

  it("builds exact same-author delete filters without requiring a community tag", async () => {
    const {makeSameAuthorDeleteFilters} = await import("./requests")
    const author = "d".repeat(64)
    const otherAuthor = "e".repeat(64)
    const makeTarget = (id: string, pubkey: string, kind: number): TrustedEvent => ({
      id,
      pubkey,
      created_at: 100,
      kind,
      tags: [["h", "community"]],
      content: "",
      sig: "f".repeat(128),
    })

    const filters = makeSameAuthorDeleteFilters([
      makeTarget("reaction", author, 7),
      makeTarget("report", author, 1984),
      {
        id: "wrapper",
        pubkey: author,
        created_at: 100,
        kind: 30222,
        tags: [["d", "targeting-id"]],
        content: "",
        sig: "f".repeat(128),
      } as TrustedEvent,
      makeTarget("other-report", otherAuthor, 1984),
    ])

    expect(filters).toEqual([
      {kinds: [5], authors: [author], "#e": ["reaction", "report", "wrapper"]},
      {kinds: [5], authors: [author], "#a": [`30222:${author}:targeting-id`]},
      {kinds: [5], authors: [otherAuthor], "#e": ["other-report"]},
    ])
    expect(filters.every(filter => !("#h" in filter))).toBe(true)
  })

  it("chunks exact delete targets without splitting author identity", async () => {
    const {makeSameAuthorDeleteFilters} = await import("./requests")
    const author = "1".repeat(64)
    const events = Array.from({length: 201}, (_, index) => ({
      id: `event-${index}`,
      pubkey: author,
      created_at: index,
      kind: 7,
      tags: [],
      content: "",
      sig: "2".repeat(128),
    })) as TrustedEvent[]

    expect(makeSameAuthorDeleteFilters(events).map(filter => filter["#e"]?.length)).toEqual([
      100, 100, 1,
    ])
  })
})
