// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {DAY} from "@welshman/lib"
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

describe("requests", () => {
  it("loadAlerts returns without throwing", async () => {
    const {loadAlerts} = await import("./requests")
    const pubkey = "a".repeat(64)
    expect(() => loadAlerts(pubkey)).not.toThrow()
  })

  it("loadAlertStatuses returns without throwing", async () => {
    const {loadAlertStatuses} = await import("./requests")
    const pubkey = "b".repeat(64)
    expect(() => loadAlertStatuses(pubkey)).not.toThrow()
  })

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
})
