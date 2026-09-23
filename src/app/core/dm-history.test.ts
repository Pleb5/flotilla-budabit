import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {matchFilters, type TrustedEvent} from "@welshman/util"
import {createDmHistory, type DmHistoryContext} from "./dm-history"
import type {FiniteRelayRequestOptions, FiniteRelayResult} from "./finite-relay-request"

const self = "a".repeat(64)
const partner = "b".repeat(64)
const quietPartner = "c".repeat(64)
const relay = "wss://dm.example/"
const secondRelay = "wss://second.example/"
const event = (id: number, timestamp: number, other = partner): TrustedEvent => ({
  id: id.toString(16).padStart(64, "0"),
  pubkey: self,
  kind: 4444,
  tags: [["p", other]],
  created_at: timestamp,
  content: "encrypted",
  sig: "sig",
})
const result = (
  options: FiniteRelayRequestOptions,
  events: TrustedEvent[] = [],
  outcome: FiniteRelayResult["outcome"] = "eose",
  reason?: string,
): FiniteRelayResult => ({
  relay: options.relay,
  events,
  outcome,
  queuedAt: Date.now(),
  finishedAt: Date.now(),
  reason,
})
const context: DmHistoryContext = {
  pubkey: self,
  relays: [relay],
  active: true,
  available: true,
  signerReady: true,
}
const coordinators: ReturnType<typeof createDmHistory>[] = []
const make = (events: TrustedEvent[] = [], limit = 100) => {
  const delivered = new Set<string>()
  const request = vi.fn(async (options: FiniteRelayRequestOptions) => {
    options.onPhase?.("loading")
    const matches = options.filters.flatMap(filter =>
      events
        .filter(e => matchFilters([filter], e))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, filter.limit || limit),
    )
    matches.forEach(e => delivered.add(e.id))
    return result(options, matches)
  })
  const coordinator = createDmHistory({request, getRelayLimit: () => limit})
  coordinators.push(coordinator)
  return {coordinator, request, delivered}
}
const advance = (ms = 1000) => vi.advanceTimersByTimeAsync(ms)

describe("DM history recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
  })
  afterEach(() => {
    coordinators.splice(0).forEach(c => c.destroy())
    vi.useRealTimers()
  })

  it("discovers an old outgoing-only conversation from a cold inbox", async () => {
    const old = event(1, 1_600_000_000)
    const {coordinator, delivered, request} = make([old])
    coordinator.configure(context)
    await advance()
    expect(delivered.has(old.id)).toBe(true)
    expect(coordinator.getSnapshot().exhausted).toBe(true)
    expect(request.mock.calls.every(([o]) => o.priority === 350)).toBe(true)
    expect(request.mock.calls.every(([o]) => o.filters[0].since === undefined)).toBe(true)
  })

  it("paginates beyond a busy conversation to discover a quiet one", async () => {
    const messages = Array.from({length: 240}, (_, i) => event(i + 1, 1_700_000_000 - i))
    const quiet = event(300, 1_600_000_000, quietPartner)
    const {coordinator, delivered, request} = make([...messages, quiet])
    coordinator.configure(context)
    await advance(2000)
    expect(delivered.size).toBe(241)
    expect(delivered.has(quiet.id)).toBe(true)
    expect(coordinator.getSnapshot().exhausted).toBe(true)
    expect(request.mock.calls.length).toBeLessThan(10)
  })

  it("overlaps timestamps, counts duplicates as relay results, and does not skip a boundary", async () => {
    const messages = [event(1, 30), event(2, 20), event(3, 20), event(4, 10)]
    const {coordinator, delivered} = make(messages, 3)
    coordinator.configure(context)
    await advance()
    expect(delivered.size).toBe(4)
    expect(coordinator.getSnapshot().exhausted).toBe(true)
  })

  it("keeps an unpageable timestamp gap partial while still discovering older conversations", async () => {
    const {coordinator, delivered, request} = make(
      [...Array.from({length: 5}, (_, i) => event(i + 1, 30)), event(9, 10, quietPartner)],
      3,
    )
    coordinator.configure(context)
    await advance(2000)
    expect(delivered.has(event(9, 10).id)).toBe(true)
    expect(coordinator.getSnapshot()).toMatchObject({status: "partial", exhausted: false})
    expect(coordinator.getSnapshot().errors[0]).toContain("timestamp")
    expect(request.mock.calls.length).toBeLessThan(10)
  })

  it("caps global concurrency at two and serializes work on each relay", async () => {
    const {coordinator, request} = make()
    const running = new Set<string>()
    let max = 0
    request.mockImplementation(
      options =>
        new Promise(resolve => {
          expect(running.has(options.relay)).toBe(false)
          running.add(options.relay)
          max = Math.max(max, running.size)
          const finish = () => {
            running.delete(options.relay)
            resolve(result(options))
          }
          setTimeout(finish, 500)
        }),
    )
    coordinator.configure({...context, relays: [relay, secondRelay, "wss://third.example/"]})
    await advance(3000)
    expect(max).toBe(2)
    expect(coordinator.getSnapshot().exhausted).toBe(true)
  })

  it("preempts blocking inbox work for a directly opened conversation", async () => {
    const {coordinator, request} = make([event(1, 10)])
    request.mockImplementationOnce(
      options =>
        new Promise(resolve => {
          options.signal!.addEventListener("abort", () => resolve(result(options, [], "aborted")))
        }),
    )
    coordinator.configure(context)
    await advance(30)
    const inboxRequest = request.mock.calls[0][0]
    coordinator.configure({...context, partner})
    await advance(250)
    expect(inboxRequest.signal?.aborted).toBe(true)
    const thread = request.mock.calls[1][0]
    expect(thread.priority).toBe(350)
    expect(thread.filters[0]).toMatchObject({authors: [partner], "#p": [self]})
    expect(coordinator.getSnapshot(partner).initialComplete).toBe(true)
  })

  it("promotes an already-queued background inbox request when /chat opens", async () => {
    const {coordinator, request} = make()
    request.mockImplementationOnce(
      options =>
        new Promise(resolve => {
          options.signal!.addEventListener("abort", () => resolve(result(options, [], "aborted")))
        }),
    )
    coordinator.configure({...context, active: false})
    await advance(30)
    expect(request.mock.calls[0][0].priority).toBe(-100)
    coordinator.configure(context)
    await advance(250)
    expect(request.mock.calls[0][0].signal?.aborted).toBe(true)
    expect(request.mock.calls[1][0].priority).toBe(350)
  })

  it("loads from self relays before partner relay discovery and queries a newly arriving relay", async () => {
    const {coordinator, request} = make([event(1, 10)])
    coordinator.configure({...context, partner})
    await advance()
    expect(coordinator.getSnapshot(partner).exhausted).toBe(true)
    request.mockClear()
    coordinator.configure({...context, partner, partnerRelays: [secondRelay]})
    await advance()
    expect(request.mock.calls.every(([o]) => o.relay === secondRelay)).toBe(true)
  })

  it("does not treat denial as empty history and retries only the failed relay", async () => {
    const {coordinator, request} = make()
    let denied = true
    request.mockImplementation(async options =>
      options.relay === secondRelay && denied
        ? result(options, [], "closed", "restricted: AUTH disabled")
        : result(options),
    )
    coordinator.configure({...context, relays: [relay, secondRelay]})
    await advance()
    expect(coordinator.getSnapshot()).toMatchObject({status: "partial", exhausted: false})
    request.mockClear()
    denied = false
    coordinator.retry()
    await advance()
    expect(request.mock.calls.every(([o]) => o.relay === secondRelay)).toBe(true)
    expect(coordinator.getSnapshot().exhausted).toBe(true)
  })

  it("bounds automatic retries and requires a recovery signal after exhaustion", async () => {
    const {coordinator, request} = make()
    request.mockImplementation(async options => result(options, [], "timeout"))
    coordinator.configure(context)
    await advance(60_000)
    expect(request).toHaveBeenCalledTimes(6) // two directions, initial + two retries each
    expect(coordinator.getSnapshot().exhausted).toBe(false)
    coordinator.configure({...context}) // unrelated store churn is not a retry trigger
    await advance(60_000)
    expect(request).toHaveBeenCalledTimes(6)
    coordinator.recover(relay)
    await advance(30)
    expect(request.mock.calls.length).toBeGreaterThan(6)
  })

  it("uses recent-only startup work and resumes older scans on chat entry", async () => {
    const messages = Array.from({length: 8}, (_, i) => event(i + 1, 30 - i))
    const {coordinator, delivered, request} = make(messages, 3)
    coordinator.configure({...context, active: false})
    await advance()
    expect(delivered.size).toBe(3)
    expect(request.mock.calls.every(([o]) => o.priority === -100)).toBe(true)
    coordinator.configure(context)
    await advance()
    expect(delivered.size).toBe(8)
  })

  it("resumes history without restarting successful pages during rapid navigation", async () => {
    const {coordinator, request} = make([event(1, 10)])
    coordinator.configure(context)
    await advance()
    request.mockClear()
    for (let i = 0; i < 20; i++) {
      coordinator.configure({...context, active: false})
      coordinator.configure(context)
    }
    await advance()
    expect(request).not.toHaveBeenCalled()
  })

  it("pages a large warm recent gap rather than stopping at the first known message", async () => {
    const messages = [event(1, Math.floor(Date.now() / 1000) - 100)]
    const {coordinator, delivered} = make(messages, 3)
    coordinator.configure(context)
    await advance()
    coordinator.configure({...context, active: false})
    await advance(40_000)
    const timestamp = Math.floor(Date.now() / 1000)
    messages.push(...Array.from({length: 8}, (_, i) => event(i + 2, timestamp - i)))
    coordinator.configure(context)
    await advance(2000)
    expect(delivered.size).toBe(9)
    expect(coordinator.getSnapshot().exhausted).toBe(true)
  })

  it("pauses hidden/offline work and rejects stale results after an account switch", async () => {
    const {coordinator, request} = make()
    let finish: (() => void) | undefined
    request.mockImplementationOnce(
      options =>
        new Promise(resolve => {
          finish = () => resolve(result(options, [event(1, 10)]))
        }),
    )
    coordinator.configure(context)
    await advance(30)
    coordinator.configure({...context, available: false})
    expect(request.mock.calls[0][0].signal?.aborted).toBe(true)
    await advance(2000)
    expect(request).toHaveBeenCalledTimes(1)
    coordinator.configure({...context, pubkey: quietPartner})
    finish!()
    await advance()
    expect(coordinator.getSnapshot().exhausted).toBe(true)
    expect(
      request.mock.calls
        .slice(1)
        .every(([o]) =>
          o.filters.every(f => !f.authors?.includes(self) && !f["#p"]?.includes(self)),
        ),
    ).toBe(true)
  })

  it("prioritizes an exact linked message and does not duplicate it on render churn", async () => {
    const {coordinator, request} = make([event(1, 10)])
    coordinator.configure({...context, partner})
    coordinator.loadEvent(partner, event(1, 10).id)
    await advance()
    expect(request.mock.calls[0][0]).toMatchObject({
      priority: 350,
      filters: [expect.objectContaining({ids: [event(1, 10).id]}), expect.anything()],
    })
    request.mockClear()
    coordinator.loadEvent(partner, event(1, 10).id)
    await advance()
    expect(request).not.toHaveBeenCalled()
  })
})
