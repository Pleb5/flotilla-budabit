import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Repository} from "@welshman/net"
import {type TrustedEvent} from "@welshman/util"
import {
  createDeletionHydration,
  makeDeletionTargetFilters,
  type DeletionDemand,
} from "./deletion-hydration"
import type {
  FiniteRelayOutcome,
  FiniteRelayRequestOptions,
  FiniteRelayResult,
} from "./finite-relay-request"

const target = (n: number): TrustedEvent => ({
  id: n.toString(16).padStart(64, "0"),
  pubkey: n.toString(16).padStart(64, "a"),
  created_at: 1,
  kind: 11,
  tags: [],
  content: "",
  sig: "",
})
const deletion = (n: number, created_at = 100): TrustedEvent => ({
  ...target(n),
  id: `delete-${n}`,
  kind: 5,
  created_at,
  tags: [
    ["e", target(n).id],
    ["h", "community"],
  ],
})
const relays = ["wss://fast.example/", "wss://slow.example/"]
const demand: DeletionDemand = {
  scope: "account:community",
  navigation: "/threads",
  relays,
  filters: [{kinds: [5], "#h": ["community"]}],
}
const coordinators: ReturnType<typeof createDeletionHydration>[] = []
const harness = (getPageLimit?: (relay: string) => number) => {
  const pending: {
    options: FiniteRelayRequestOptions
    resolve: (result: FiniteRelayResult) => void
  }[] = []
  const repository = new Repository()
  const request = vi.fn(
    (options: FiniteRelayRequestOptions) =>
      new Promise<FiniteRelayResult>(resolve => {
        pending.push({options, resolve})
        options.signal?.addEventListener("abort", () =>
          resolve({
            relay: options.relay,
            outcome: "aborted",
            events: [],
            queuedAt: 0,
            finishedAt: 0,
          }),
        )
      }),
  )
  const coordinator = createDeletionHydration({
    request,
    receive: event => repository.publish(event),
    getPageLimit,
  })
  coordinators.push(coordinator)
  const finish = async (
    index: number,
    events: TrustedEvent[] = [],
    outcome: FiniteRelayOutcome = "eose",
  ) => {
    const {options, resolve} = pending[index]
    events.forEach(event => options.onEvent?.(event, options.relay))
    resolve({relay: options.relay, outcome, events, queuedAt: 0, finishedAt: Date.now()})
    await vi.advanceTimersByTimeAsync(100)
  }
  return {coordinator, request, pending, repository, finish}
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(2_000_000_000_000)
})
afterEach(() => {
  coordinators.splice(0).forEach(value => value.destroy())
  vi.useRealTimers()
})

describe("foreground deletion history", () => {
  it("does no startup work and recovers old cached targets from a slower relay", async () => {
    const {coordinator, request, pending, repository, finish} = harness()
    repository.publish(target(1))
    await vi.advanceTimersByTimeAsync(1000)
    expect(request).not.toHaveBeenCalled()
    coordinator.register(demand)
    await vi.advanceTimersByTimeAsync(100)
    expect(request).toHaveBeenCalledTimes(2)
    expect(pending.every(({options}) => options.filters[0].since === undefined)).toBe(true)
    await finish(0)
    expect(pending[1].options.signal?.aborted).toBe(false)
    expect(coordinator.snapshot().map(value => value.status)).toEqual(["complete", "pending"])
    await finish(1, [deletion(1)])
    expect(repository.isDeleted(target(1))).toBe(true)
    expect(coordinator.snapshot().every(value => value.status === "complete")).toBe(true)
  })

  it("shares demands, keeps running chunks stable, and requests only appended targets", async () => {
    const {coordinator, request, pending, finish} = harness()
    const targets = Array.from({length: 100}, (_, i) => target(i + 1))
    const initial = {...demand, relays: [relays[0]], filters: [], targets}
    const registration = coordinator.register(initial)
    const other = coordinator.register(initial)
    await vi.advanceTimersByTimeAsync(100)
    expect(request).toHaveBeenCalledTimes(1)
    registration.update({...initial, targets: [...targets, target(101)]})
    other.release()
    await vi.advanceTimersByTimeAsync(100)
    expect(pending[0].options.signal?.aborted).toBe(false)
    await finish(0)
    expect(request).toHaveBeenCalledTimes(2)
    expect(pending[1].options.filters[0]["#e"]).toEqual([target(101).id])
  })

  it("queries newly discovered relays from the beginning without restarting completed relays", async () => {
    const {coordinator, request, pending, finish} = harness()
    const registration = coordinator.register({...demand, relays: [relays[0]]})
    await vi.advanceTimersByTimeAsync(100)
    await finish(0)
    registration.update(demand)
    await vi.advanceTimersByTimeAsync(100)
    expect(request).toHaveBeenCalledTimes(2)
    expect(pending[1].options.relay).toBe(relays[1])
    expect(pending[1].options.filters[0].since).toBeUndefined()
  })

  it("does not let frequent content updates postpone work indefinitely", async () => {
    const {coordinator, request} = harness()
    const registration = coordinator.register(demand)
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(10)
      registration.update({...demand, targets: [target(i)]})
    }
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("includes a full timestamp boundary and expands it without silently skipping events", async () => {
    const {coordinator, pending, finish} = harness(() => 200)
    coordinator.register({...demand, relays: [relays[0]]})
    await vi.advanceTimersByTimeAsync(100)
    const events = Array.from({length: 150}, (_, i) => deletion(i))
    await finish(0, events.slice(0, 100))
    expect(pending[1].options.filters[0].until).toBe(100)
    await finish(1, events.slice(0, 100))
    expect(pending[2].options.filters[0].limit).toBe(200)
    await finish(2, events)
    expect(coordinator.snapshot()[0].status).toBe("complete")
  })

  it("paginates when a smaller relay cap becomes known during the outstanding request", async () => {
    let cap = 200
    const {coordinator, pending, repository, finish} = harness(() => cap)
    coordinator.register({...demand, relays: [relays[0]]})
    await vi.advanceTimersByTimeAsync(100)
    expect(pending[0].options.filters[0].limit).toBe(100)
    cap = 50
    await finish(
      0,
      Array.from({length: 50}, (_, i) => deletion(i, 1000 - i)),
    )
    expect(coordinator.snapshot()[0].through).toBeUndefined()
    expect(pending[1].options.filters[0]).toMatchObject({limit: 50, until: 951})
    repository.publish(target(100))
    await finish(1, [deletion(49, 951), deletion(100, 100)])
    expect(repository.isDeleted(target(100))).toBe(true)
    expect(coordinator.snapshot()[0].status).toBe("complete")
  })

  it("replays uncertain coverage if the smaller cap arrives after EOSE", async () => {
    let cap = 200
    const {coordinator, pending, finish} = harness(() => cap)
    coordinator.register({...demand, relays: [relays[0]]})
    await vi.advanceTimersByTimeAsync(100)
    await finish(
      0,
      Array.from({length: 50}, (_, i) => deletion(i, 1000 - i)),
    )
    cap = 50
    coordinator.refresh()
    await vi.advanceTimersByTimeAsync(100)
    expect(pending[1].options.filters[0].since).toBeUndefined()
    expect(coordinator.snapshot()[0].through).toBeUndefined()
    await finish(
      1,
      Array.from({length: 50}, (_, i) => deletion(i, 1000 - i)),
    )
    expect(pending[2].options.filters[0]).toMatchObject({limit: 50, until: 951})
  })

  it("keeps saturated timestamp buckets incomplete and supports explicit retry", async () => {
    const {coordinator, request, finish} = harness(() => 100)
    coordinator.register({...demand, relays: [relays[0]]})
    await vi.advanceTimersByTimeAsync(100)
    const events = Array.from({length: 100}, (_, i) => deletion(i))
    await finish(0, events)
    await finish(1, events)
    expect(coordinator.snapshot()[0]).toMatchObject({status: "partial", through: undefined})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(request).toHaveBeenCalledTimes(2)
    coordinator.refresh()
    await vi.advanceTimersByTimeAsync(100)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it("drops an uncertain old watermark when the cap is learned during an incremental refresh", async () => {
    let cap = 200
    const {coordinator, pending, finish} = harness(() => cap)
    coordinator.register({...demand, relays: [relays[0]]})
    await vi.advanceTimersByTimeAsync(100)
    await finish(
      0,
      Array.from({length: 50}, (_, i) => deletion(i, 1000 - i)),
    )
    coordinator.refresh()
    await vi.advanceTimersByTimeAsync(100)
    expect(pending[1].options.filters[0].since).toBeDefined()
    cap = 50
    await finish(1)
    expect(coordinator.snapshot()[0].through).toBeUndefined()
    expect(pending[2].options.filters[0].since).toBeUndefined()
    await finish(
      2,
      Array.from({length: 50}, (_, i) => deletion(i, 1000 - i)),
    )
    expect(pending[3].options.filters[0].until).toBe(951)
  })

  it("does not let broad-history pagination starve exact targets or exceed concurrency", async () => {
    const {coordinator, request, pending, finish} = harness()
    coordinator.register({
      ...demand,
      relays: [...relays, "wss://third.example/"],
      targets: [target(1)],
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(request).toHaveBeenCalledTimes(2)
    await finish(
      0,
      Array.from({length: 100}, (_, i) => deletion(i)),
    )
    expect(pending[2].options.filters[0]["#e"]).toEqual([target(1).id])
    expect(pending[1].options.signal?.aborted).toBe(false)
  })

  it("refreshes completed relays while another relay is still waiting for authentication", async () => {
    const {coordinator, pending, request, finish} = harness()
    coordinator.register(demand)
    await vi.advanceTimersByTimeAsync(100)
    await finish(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(request).toHaveBeenCalledTimes(3)
    expect(pending[2].options.relay).toBe(relays[0])
    expect(pending[2].options.filters[0].since).toBeDefined()
    expect(pending[1].options.signal?.aborted).toBe(false)
  })

  it.each(["closed", "timeout", "disconnect", "error"] as const)(
    "retries %s without recording coverage",
    async outcome => {
      const {coordinator, request, finish} = harness()
      coordinator.register({...demand, relays: [relays[0]]})
      await vi.advanceTimersByTimeAsync(100)
      await finish(0, [], outcome)
      expect(coordinator.snapshot()[0]).toMatchObject({status: "partial", through: undefined})
      await vi.advanceTimersByTimeAsync(5_000)
      expect(request).toHaveBeenCalledTimes(2)
    },
  )

  it("cancels on background/exit and refreshes on foreground, route entry, and reconnect", async () => {
    const {coordinator, pending, request, finish} = harness()
    const registration = coordinator.register({...demand, relays: [relays[0]]})
    await vi.advanceTimersByTimeAsync(100)
    coordinator.setActive(false)
    expect(pending[0].options.signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(request).toHaveBeenCalledTimes(1)
    coordinator.setActive(true)
    await vi.advanceTimersByTimeAsync(100)
    await finish(1)
    registration.update({...demand, relays: [relays[0]], navigation: "/threads/one"})
    await vi.advanceTimersByTimeAsync(100)
    await finish(2)
    coordinator.refresh(relays[0])
    await vi.advanceTimersByTimeAsync(100)
    expect(request).toHaveBeenCalledTimes(4)
    registration.release()
    expect(pending[3].options.signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(request).toHaveBeenCalledTimes(4)
  })

  it("uses bounded cross-author filters and covers wrapper coordinates beyond the old 100 cap", () => {
    const events = Array.from({length: 451}, (_, i) => target(i))
    const filters = makeDeletionTargetFilters(events)
    expect(filters).toHaveLength(5)
    expect(filters.every(filter => !filter.authors && !filter["#h"] && !filter["#k"])).toBe(true)
    const wrappers = events.map(event => ({...event, kind: 30222, tags: [["d", event.id]]}))
    const wrapperFilters = makeDeletionTargetFilters(wrappers)
    expect(wrapperFilters.flatMap(filter => filter["#a"] || [])).toHaveLength(451)
    expect(wrapperFilters.every(filter => !filter["#e"])).toBe(true)
  })
})
