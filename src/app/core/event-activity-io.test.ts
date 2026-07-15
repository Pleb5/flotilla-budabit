import {readFileSync} from "node:fs"
import {afterEach, describe, expect, it, vi} from "vitest"
import type {Filter, TrustedEvent} from "@welshman/util"
import {
  createEventActivityIO,
  type EventActivityRegistration,
  type EventActivityRequestOptions,
} from "./event-activity-io"

const BATCH_MS = 75
const RELAYS = ["wss://one.example", "wss://two.example"]
const BASE_FILTER = {kinds: [1111], "#K": ["1"]}

const ordinaryFilters = (id: string): Filter[] => [{...BASE_FILTER, "#E": [id]}]
const replaceableFilters = (id: string): Filter[] => [
  {...BASE_FILTER, "#E": [id]},
  {...BASE_FILTER, "#A": [`30023:author:${id}`]},
  {...BASE_FILTER, "#a": [`30023:author:${id}`]},
]

const makeRegistration = (
  filters: Filter[],
  overrides: Partial<EventActivityRegistration> = {},
): EventActivityRegistration => ({
  routeScope: "/activity",
  relays: RELAYS,
  filters,
  ...overrides,
})

const makeHarness = () => {
  let now = 1_000_000
  const calls: EventActivityRequestOptions[] = []
  const publish = vi.fn()
  const track = vi.fn()
  const request = vi.fn((options: EventActivityRequestOptions) => {
    calls.push(options)
    if (options.lifetime === "finite") return Promise.resolve([])

    return new Promise<unknown>(resolve => {
      options.signal.addEventListener("abort", () => resolve([]), {once: true})
    })
  })
  const io = createEventActivityIO({
    request,
    publish,
    track,
    now: () => now,
    batchMs: BATCH_MS,
  })

  return {
    calls,
    io,
    publish,
    request,
    setNow: (value: number) => (now = value),
    track,
  }
}

const flushBatch = () => vi.advanceTimersByTimeAsync(BATCH_MS)
const getLiveCalls = (calls: EventActivityRequestOptions[]) =>
  calls.filter(call => call.lifetime === "live")
const getHistoryCalls = (calls: EventActivityRequestOptions[]) =>
  calls.filter(call => call.lifetime === "finite")

afterEach(() => {
  vi.useRealTimers()
})

describe("event activity coordinator", () => {
  it("groups 100 ordinary registrations into one live #E filter", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()

    for (let index = 0; index < 100; index += 1) {
      io.register(makeRegistration(ordinaryFilters(`event-${index}`)))
    }
    await flushBatch()

    const liveCalls = getLiveCalls(calls)
    expect(liveCalls).toHaveLength(1)
    expect(liveCalls[0].filters).toHaveLength(1)
    expect(liveCalls[0].filters[0]["#E"]).toHaveLength(100)
    expect(liveCalls[0]).toMatchObject({lifetime: "live", priority: -100})
    io.close()
  })

  it("packs replaceable references into at most three live filters", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()

    for (let index = 0; index < 100; index += 1) {
      io.register(makeRegistration(replaceableFilters(`event-${index}`)))
    }
    await flushBatch()

    const [live] = getLiveCalls(calls)
    expect(live.filters).toHaveLength(3)
    expect(
      live.filters.map(filter => Object.keys(filter).find(key => /^#[EAa]$/.test(key))),
    ).toEqual(["#E", "#A", "#a"])
    io.close()
  })

  it("suppresses live activity when core community COMMENT #h coverage is declared", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()

    for (let index = 0; index < 100; index += 1) {
      io.register(
        makeRegistration([{...BASE_FILTER, "#h": ["community"], "#E": [`event-${index}`]}], {
          scopeH: "community",
          coreCommunityLiveCovered: true,
        }),
      )
    }
    await flushBatch()

    expect(getLiveCalls(calls)).toHaveLength(0)
    expect(getHistoryCalls(calls)).toHaveLength(1)
    io.close()
  })

  it("loads exact historical filters through finite background requests and publishes events", async () => {
    vi.useFakeTimers()
    const {calls, io, publish, track} = makeHarness()
    const filters = replaceableFilters("event-1")

    io.register(makeRegistration(filters))
    await flushBatch()

    const [history] = getHistoryCalls(calls)
    expect(history).toMatchObject({autoClose: true, lifetime: "finite", priority: -100})
    expect(history.filters).toEqual(filters.map(filter => ({...filter, until: 995})))

    const event = {id: "reply-1"} as TrustedEvent
    history.onEvent(event, "wss://one.example/")
    expect(track).toHaveBeenCalledWith("reply-1", "wss://one.example/")
    expect(publish).toHaveBeenCalledWith(event)
    io.close()
  })

  it("keeps the original live since boundary for late registrations", async () => {
    vi.useFakeTimers()
    const {calls, io, setNow} = makeHarness()

    io.register(makeRegistration(ordinaryFilters("event-1")))
    await flushBatch()
    const first = getLiveCalls(calls)[0]

    setNow(2_000_000)
    io.register(makeRegistration(ordinaryFilters("event-2")))
    await flushBatch()
    const replacement = getLiveCalls(calls)[1]

    expect(first.filters[0].since).toBe(995)
    expect(replacement.filters.every(filter => filter.since === 995)).toBe(true)
    io.close()
  })

  it("reference-counts registrations and closes live activity after the last unregister", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()
    const registration = makeRegistration(ordinaryFilters("event-1"))
    const unregisterFirst = io.register(registration)
    const unregisterSecond = io.register(registration)
    await flushBatch()

    const [live] = getLiveCalls(calls)
    unregisterFirst()
    expect(live.signal.aborted).toBe(false)
    unregisterSecond()
    expect(live.signal.aborted).toBe(true)
    io.close()
  })

  it("keeps the old live request until its replacement reaches EOSE on every relay", async () => {
    vi.useFakeTimers()
    const {calls, io} = makeHarness()

    io.register(makeRegistration(ordinaryFilters("event-1")))
    await flushBatch()
    const first = getLiveCalls(calls)[0]

    io.register(makeRegistration(ordinaryFilters("event-2")))
    await flushBatch()
    const replacement = getLiveCalls(calls)[1]

    expect(first.signal.aborted).toBe(false)
    replacement.onEose?.("wss://one.example/")
    expect(first.signal.aborted).toBe(false)
    replacement.onEose?.("wss://two.example/")
    expect(first.signal.aborted).toBe(true)
    io.close()
  })
})

describe("activity request ownership", () => {
  const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

  it("keeps EventActivity repository-driven and removes CommunityMenu room request ownership", () => {
    const activity = readProjectFile("../components/EventActivity.svelte")
    const menu = readProjectFile("../components/CommunityMenu.svelte")

    expect(activity).toContain("registerEventActivity")
    expect(activity).not.toContain('from "@welshman/net"')
    expect(menu).not.toContain("request({relays: $activeCommunityRelays, filters: roomFilters")
    expect(menu).toContain("deriveEventsById({repository, filters: roomFilters})")
  })

  it("keeps issue-label prefetch finite, background, and repository-published", () => {
    const page = readProjectFile("../../routes/git/[id=naddr]/issues/+page.svelte")
    const prefetch = page.slice(
      page.indexOf("// Prefetch recent issue edit events"),
      page.indexOf("// Persist filters per repo"),
    )

    expect(prefetch).toContain("autoClose: true")
    expect(prefetch).toContain('lifetime: "finite"')
    expect(prefetch).toContain("priority: RELAY_REQUEST_PRIORITY.background")
    expect(prefetch).toContain("repository.publish(event)")
  })
})
