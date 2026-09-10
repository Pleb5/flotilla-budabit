import {afterEach, describe, expect, it, vi} from "vitest"
import {makeLoader, MockAdapter, netContext, type LoadOptions} from "@welshman/net"
import {matchFilters, type Filter} from "@welshman/util"
import {finalizeEvent} from "nostr-tools/pure"
import {queryExtensionRelays} from "./nostr-query"

const previousAdapter = netContext.getAdapter
afterEach(() => {
  netContext.getAdapter = previousAdapter
  vi.useRealTimers()
})

describe("real Welshman batching with overlapping relay histories", () => {
  it("accounts for each relay page independently, including concurrent bridge requests", async () => {
    vi.useFakeTimers()
    const history = Array.from({length: 150}, (_, i) =>
      finalizeEvent(
        {kind: 30063, created_at: 1000 - i, tags: [["d", String(i)]], content: ""},
        new Uint8Array(32).fill(1),
      ),
    )
    const relays = ["wss://overlap-a.example/", "wss://overlap-b.example/"]
    const adapters = new Map<string, MockAdapter>()
    netContext.getAdapter = relay => {
      if (!adapters.has(relay)) {
        const adapter = new MockAdapter(relay, message => {
          if (message[0] !== "REQ") return
          const [, id, ...filters] = message
          const available = relay === relays[0] ? history.slice(0, 100) : history
          queueMicrotask(() => {
            for (const event of available
              .filter(e => matchFilters(filters as Filter[], e))
              .slice(0, (filters[0] as Filter).limit)) {
              adapter.receive(["EVENT", id, event])
            }
            adapter.receive(["EOSE", id])
          })
        })
        adapters.set(relay, adapter)
      }
      return adapters.get(relay)!
    }
    const filter = {kinds: [30063], limit: 100}
    // Control: use the actual shared batcher/tracker, not a mocked load callback.
    const shared = makeLoader({delay: 1})
    const counts = [0, 0]
    const control = Promise.all(
      relays.map((relay, index) =>
        shared({relays: [relay], filters: [filter], onEvent: () => counts[index]++} as LoadOptions),
      ),
    )
    await vi.advanceTimersByTimeAsync(1000)
    await control
    expect(counts.sort((a, b) => b - a)).toEqual([100, 0])

    const pages = Promise.all(relays.map(relay => queryExtensionRelays([relay], filter)))
    await vi.advanceTimersByTimeAsync(1000)
    const first = await pages
    expect(first.map(p => p.events.length)).toEqual([100, 100])
    expect(first.every(p => p.complete)).toBe(true)
    const older = Promise.all(
      relays.map((relay, i) =>
        queryExtensionRelays([relay], {
          ...filter,
          until: Math.min(...first[i].events.map(e => e.created_at)),
        }),
      ),
    )
    await vi.advanceTimersByTimeAsync(1000)
    const last = await older
    expect(last.map(p => p.events.length)).toEqual([1, 51])
    expect(last.every(p => p.complete)).toBe(true)
    expect(new Set([...first, ...last].flatMap(p => p.events.map(e => e.id))).size).toBe(150)
  })
})
