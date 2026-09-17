import {readFileSync} from "node:fs"
import ts from "typescript"
import {afterEach, describe, expect, it, vi} from "vitest"
import {communityReadRecovery} from "./community-read-recovery"

const relay = "wss://denied-recovery.test/"
const healthy = "wss://healthy-recovery.test/"
let nextScope = 0
const recovery = () => communityReadRecovery(`community-${nextScope++}`, "member")
afterEach(() => vi.useRealTimers())

describe("community background read recovery", () => {
  it("keeps terminal denials scoped, including across remounts, until explicit retry", () => {
    const community = `community-${nextScope++}`
    const first = communityReadRecovery(community, "alice")
    first.closed(relay, "restricted: read access denied")
    expect(first.available([relay, healthy])).toEqual([healthy])
    first.record(relay, "complete") // late sibling EOSE must not undo a denial
    expect(first.blocked(relay)).toBe(true)
    expect(communityReadRecovery(community, "alice").blocked(relay)).toBe(true)
    expect(communityReadRecovery(community, "bob").blocked(relay)).toBe(false)
    expect(communityReadRecovery(`${community}-other`, "alice").blocked(relay)).toBe(false)
    first.reset([relay])
    expect(first.available([relay, healthy])).toEqual([relay, healthy])
  })

  it("bounds policy-unavailable recovery across attempts and honors finite-loader exhaustion", () => {
    const live = recovery()
    live.closed(relay, "error: policy unavailable")
    expect(live.blocked(relay)).toBe(false)
    live.closed(relay, "error: policy unavailable")
    expect(live.blocked(relay)).toBe(true)
    const finite = recovery()
    finite.result({
      events: [],
      complete: false,
      failedRelays: [relay],
      timedOutRelays: [],
      outcomes: {[relay]: "policy-unavailable", [healthy]: "complete"},
    })
    expect(finite.available([relay, healthy])).toEqual([healthy])
  })

  it("backs transport failures off to a bounded interval and resets after success", () => {
    const state = recovery()
    const delays = Array.from({length: 7}, () => {
      state.record(relay, "disconnected")
      return state.delay([relay])
    })
    expect(delays).toEqual([5500, 11000, 22000, 44000, 60000, 60000, 60000])
    expect(state.blocked(relay)).toBe(false)
    state.record(relay, "complete")
    expect(state.delay([relay])).toBe(5500)
  })

  // Execute the production effect (not a duplicate of its retry logic). Dependencies
  // are controlled; this tests scheduling and cleanup, not Svelte rendering or AUTH.
  const liveFixture = () => {
    const source = readFileSync("src/app/components/CommunityLayout.svelte", "utf8")
    const start = source.indexOf("  $effect(() => {\n    void communityLiveRetryVersion")
    const end = source.indexOf("  onDestroy(() => {", start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const effect = ts.transpileModule(source.slice(start, end), {
      compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
    }).outputText
    const requests: any[] = []
    const state = recovery()
    const environment = {
      communityLiveRetryVersion: 0,
      communityLiveRetryTimer: null,
      communityLiveFiltersKey: "",
      communityBackgroundHydrationReady: true,
      $pubkey: "member",
      $activeExactCommunityDefinition: {pointer: {address: "community"}},
      exactCommunity: {address: "community"},
      get readableRelays() {
        return state.available([relay, healthy])
      },
      readRecovery: state,
      communityLiveSubscriptionsByRelay: new Map(),
      admissionFormAddresses: [],
      RELAY_REQUEST_PRIORITY: {live: 200},
      buildCommunityLiveFilters: () => [{kinds: [32222]}],
      getCommunityLiveSubscriptionKey: () => "filters",
      registerCommunityLiveOwnership: () => vi.fn(),
      tracker: {addRelay: vi.fn()},
      repository: {publish: vi.fn()},
      stopCommunityLiveSubscription: () => {
        for (const subscription of environment.communityLiveSubscriptionsByRelay.values())
          subscription.controller.abort()
        environment.communityLiveSubscriptionsByRelay.clear()
        clearTimeout(environment.communityLiveRetryTimer!)
      },
      request: (options: any) => {
        requests.push(options)
        return new Promise(resolve => options.signal.addEventListener("abort", () => resolve([])))
      },
      $effect: (fn: () => void) => fn(),
    }
    // `with` provides mutable component-local bindings for this extracted effect.
    const run = new Function("env", `with (env) { ${effect} }`)
    return {run: () => run(environment), requests, state, environment}
  }

  it("does not reconnect a denied cached community on timers or rerenders; explicit retry resumes", async () => {
    vi.useFakeTimers()
    const fixture = liveFixture()
    fixture.run()
    expect(fixture.requests).toHaveLength(2)
    const originalHealthy = fixture.requests[1]
    fixture.requests[0].onClosed("restricted: read access denied")
    await vi.advanceTimersByTimeAsync(0)
    fixture.run() // reactive notification removes only the denied relay
    await vi.advanceTimersByTimeAsync(60_000)
    fixture.run() // unrelated component update cannot restart it either
    expect(fixture.requests).toHaveLength(2)
    expect(originalHealthy.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(fixture.environment.repository.publish).not.toHaveBeenCalled()
    fixture.state.reset([relay])
    fixture.run()
    expect(fixture.requests).toHaveLength(3)
    expect(fixture.requests[2].relays).toEqual([relay])
    fixture.environment.stopCommunityLiveSubscription()
  })

  it("stops live policy-unavailable retries after one retry", async () => {
    vi.useFakeTimers()
    const fixture = liveFixture()
    fixture.run()
    fixture.requests[0].onClosed("error: policy unavailable")
    await vi.advanceTimersByTimeAsync(5500)
    fixture.run()
    expect(fixture.requests).toHaveLength(3)
    fixture.requests[2].onClosed("error: policy unavailable")
    await vi.advanceTimersByTimeAsync(60_000)
    fixture.run()
    expect(fixture.requests).toHaveLength(3)
    expect(vi.getTimerCount()).toBe(0)
    fixture.environment.stopCommunityLiveSubscription()
  })
})
