import {afterEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools/pure"
import {MockAdapter, netContext} from "@welshman/net"
import {Router} from "@welshman/router"
import {repository} from "@welshman/app"

vi.mock("./state", async original => ({
  ...(await original<typeof import("./state")>()),
  INDEXER_RELAYS: [],
}))
import {checkDmInboxRelayList} from "./dm"

const originalAdapter = netContext.getAdapter
const originalDeleted = netContext.isEventDeleted
let seed = 80
let key = new Uint8Array(32).fill(seed)
let author = getPublicKey(key)
const relays = ["wss://community.example/", "wss://indexer.example/"]
const event = (i: number, kind = 5, signer = key) =>
  finalizeEvent({kind, created_at: i + 1, tags: [], content: String(i)}, signer)
const inbox = () =>
  finalizeEvent(
    {kind: 10050, created_at: 1, tags: [["relay", "wss://inbox.example/"]], content: ""},
    key,
  )

afterEach(() => {
  netContext.getAdapter = originalAdapter
  netContext.isEventDeleted = originalDeleted
  vi.restoreAllMocks()
  repository.clear()
})

// Only the wire adapter is substituted: request/requestOne, shared Tracker,
// signature validation, filter matching, EOSE and all classifications are real.
async function start(cached = false) {
  // App list projections can outlive repository.clear(); isolate each author.
  key = new Uint8Array(32).fill(++seed)
  author = getPublicKey(key)
  vi.spyOn(Router, "get").mockReturnValue({FromPubkeys: () => ({getUrls: () => []})} as any)
  if (cached) repository.publish(inbox())
  const subscriptions = new Map<string, Map<number, {id: string; adapter: MockAdapter}>>()
  netContext.getAdapter = relay => {
    const adapter = new MockAdapter(relay, message => {
      if (message[0] === "REQ") {
        const byKind = subscriptions.get(relay) || new Map()
        for (const filter of message.slice(2) as {kinds?: number[]}[]) {
          for (const kind of filter.kinds || []) byKind.set(kind, {id: message[1], adapter})
        }
        subscriptions.set(relay, byKind)
      }
    })
    return adapter
  }
  const result = checkDmInboxRelayList(author, relays).then(
    value => ({value, error: undefined}),
    error => ({value: undefined, error: error as Error}),
  )
  await vi.waitFor(() =>
    expect(relays.map(relay => subscriptions.get(relay)?.size)).toEqual([2, 2]),
  )
  return {
    result,
    send: (
      source: number,
      value: ReturnType<typeof event>,
      kind = value.kind === 10050 ? 10050 : 5,
    ) => {
      const {adapter, id} = subscriptions.get(relays[source])!.get(kind)!
      adapter.receive(["EVENT", id, value])
    },
    finish: () =>
      subscriptions.forEach(byKind =>
        byKind.forEach(({adapter, id}) => adapter.receive(["EOSE", id])),
      ),
  }
}

describe("DM inbox raw transport completeness", () => {
  it.each([false, true])(
    "counts interleaved duplicate windows per source (cached inbox: %s)",
    async cached => {
      const wire = await start(cached)
      const deletions = Array.from({length: 200}, (_, i) => event(i))
      // Each source is first to deliver half. The shared Tracker dispatches the
      // other half to onDuplicate, leaving only 100 onEvent calls per source.
      deletions.slice(0, 100).forEach(e => wire.send(0, e))
      deletions.slice(100).forEach(e => wire.send(1, e))
      deletions.slice(100).forEach(e => wire.send(0, e))
      deletions.slice(0, 100).forEach(e => wire.send(1, e))
      wire.finish()
      expect((await wire.result).error?.message).toContain("all DM inbox relays")
    },
  )

  it.each([false, true])(
    "counts invalid, filtered and deleted deliveries (cached inbox: %s)",
    async cached => {
      const deleted = new Set<string>()
      netContext.isEventDeleted = e => deleted.has(e.id)
      const wire = await start(cached)
      for (let i = 0; i < 200; i++) {
        let e = event(i, i >= 100 && i < 150 ? 1 : 5)
        if (i >= 50 && i < 100) {
          // Wire serialization removes nostr-tools' cached verification symbol.
          e = JSON.parse(JSON.stringify({...e, sig: "0".repeat(128)}))
        }
        if (i >= 150) deleted.add(e.id)
        wire.send(0, e)
      }
      wire.finish()
      expect((await wire.result).error?.message).toContain("all DM inbox relays")
    },
  )

  it("accepts an unsaturated empty response after 199 raw deliveries", async () => {
    const wire = await start()
    for (let i = 0; i < 199; i++) wire.send(0, event(i))
    wire.finish()
    expect(await wire.result).toEqual({value: false, error: undefined})
  })

  it("counts unsolicited inbox events delivered on the deletion subscription", async () => {
    const wire = await start()
    const unsolicited = inbox()
    for (let i = 0; i < 200; i++) wire.send(0, unsolicited, 5)
    wire.finish()
    expect((await wire.result).error?.message).toContain("all DM inbox relays")
  })

  it("keeps semantic signature and exact-author validation separate from raw counts", async () => {
    const wire = await start()
    const valid = inbox()
    wire.send(0, JSON.parse(JSON.stringify({...valid, sig: "0".repeat(128)})))
    wire.send(1, event(10, 10050, new Uint8Array(32).fill(72)))
    wire.finish()
    expect(await wire.result).toEqual({value: false, error: undefined})
  })
})
