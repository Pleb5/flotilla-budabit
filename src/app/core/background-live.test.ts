import {describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import {catchUpThenSetBackgroundLive, createBackgroundLiveCoordinator} from "./background-live"

describe("background live coordinator", () => {
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
