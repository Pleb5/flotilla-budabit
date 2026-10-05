import {afterEach, describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import {catchUpThenSetBackgroundLive, createBackgroundLiveCoordinator} from "./background-live"

describe("background live coordinator", () => {
  afterEach(() => vi.useRealTimers())

  it("reconnects an interrupted subscription and signals catch-up only after EOSE", async () => {
    vi.useFakeTimers()
    let interrupt: (() => void) | undefined
    const calls: RequestOptions[] = []
    const onReconnect = vi.fn()
    const coordinator = createBackgroundLiveCoordinator({
      request: options => {
        calls.push(options)
        return new Promise(resolve => {
          interrupt = () => resolve([])
        })
      },
      onEvent: vi.fn(),
      onError: vi.fn(),
      onReconnect,
    })
    coordinator.set({}, "wss://relay.example/", [{kinds: [11]}])
    interrupt?.()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(2)
    expect(onReconnect).not.toHaveBeenCalled()
    calls[1].onEose?.("wss://relay.example/")
    calls[1].onEose?.("wss://relay.example/")
    expect(onReconnect).toHaveBeenCalledExactlyOnceWith("wss://relay.example/")
    coordinator.close()
  })

  it("aborts partial CLOSED coverage and cancels queued recovery when its source leaves", async () => {
    vi.useFakeTimers()
    const calls: RequestOptions[] = []
    const coordinator = createBackgroundLiveCoordinator({
      request: options => {
        calls.push(options)
        return new Promise(resolve => options.signal?.addEventListener("abort", () => resolve([])))
      },
      onEvent: vi.fn(),
      onError: vi.fn(),
    })
    const source = {}
    coordinator.set(source, "wss://relay.example/", [{kinds: [11]}, {kinds: [1984]}])
    calls[0].onClosed?.("error: lost chunk", "wss://relay.example/")
    expect(calls[0].signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(2)
    calls[1].onClosed?.("error: lost chunk", "wss://relay.example/")
    await vi.advanceTimersByTimeAsync(0)
    coordinator.clear(source)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(2)
    coordinator.close()
  })

  it("backs off repeated interruptions and does not resurrect replaced filters", async () => {
    vi.useFakeTimers()
    const calls: RequestOptions[] = []
    const coordinator = createBackgroundLiveCoordinator({
      request: async options => {
        calls.push(options)
        return []
      },
      onEvent: vi.fn(),
      onError: vi.fn(),
    })
    const source = {}
    coordinator.set(source, "wss://relay.example/", [{kinds: [11]}])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(calls).toHaveLength(2)
    coordinator.set(source, "wss://relay.example/", [{kinds: [9]}])
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(3)
    expect(calls[2].filters).toEqual([{kinds: [9], limit: 0}])
    coordinator.close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(3)
  })

  it("keeps one explicit background-live request per relay while grouping sources", () => {
    const calls: RequestOptions[] = []
    const request = vi.fn((options: RequestOptions) => {
      calls.push(options)
      return new Promise<never>(() => {})
    })
    const coordinator = createBackgroundLiveCoordinator({
      request,
      onEvent: vi.fn(),
      onError: vi.fn(),
    })
    const first = {}
    const second = {}

    coordinator.set(first, "wss://relay.example/", [{kinds: [1]}])
    coordinator.set(second, "wss://relay.example/", [{kinds: [2]}])

    expect(calls).toHaveLength(2)
    expect(calls[0].signal?.aborted).toBe(true)
    expect(calls[1]).toMatchObject({
      relays: ["wss://relay.example/"],
      lifetime: "live",
      priority: -100,
      filters: [
        {kinds: [1], limit: 0},
        {kinds: [2], limit: 0},
      ],
    })

    coordinator.clear(first)
    expect(calls.at(-1)?.filters).toEqual([{kinds: [2], limit: 0}])
    coordinator.close()
  })

  it("settles explicit finite catch-up before installing live filters", async () => {
    let settleCatchUp: (() => void) | undefined
    const calls: RequestOptions[] = []
    const request = vi.fn((options: RequestOptions) => {
      calls.push(options)
      if (options.lifetime === "finite") {
        return new Promise<any[]>(resolve => {
          settleCatchUp = () => resolve([])
        })
      }
      return new Promise<never>(() => {})
    })
    const coordinator = createBackgroundLiveCoordinator({
      request,
      onEvent: vi.fn(),
      onError: vi.fn(),
    })
    const catchUp = catchUpThenSetBackgroundLive({
      request,
      coordinator,
      source: {},
      relay: "wss://relay.example/",
      filters: [{kinds: [1], limit: 20}],
      liveFilters: [{kinds: [1]}],
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      onError: vi.fn(),
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      autoClose: true,
      lifetime: "finite",
      priority: -100,
    })

    settleCatchUp?.()
    await catchUp
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({lifetime: "live", priority: -100})
    coordinator.close()
  })
})
