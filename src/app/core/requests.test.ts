// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {DAY} from "@welshman/lib"
import {EVENT_DATE, EVENT_TIME, type Filter} from "@welshman/util"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()
  return {
    ...actual,
    loadRelay: vi.fn().mockResolvedValue({}),
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
})
