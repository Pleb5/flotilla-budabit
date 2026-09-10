import {afterEach, describe, expect, it, vi} from "vitest"
import type {LoadOptions} from "@welshman/net"
import {finalizeEvent} from "nostr-tools/pure"
import {queryExtensionRelays} from "./nostr-query"

const {load} = vi.hoisted(() => ({load: vi.fn()}))
vi.mock("@welshman/net", () => ({makeLoader: () => load}))
const event = (created_at = 1) =>
  finalizeEvent({kind: 30063, tags: [], content: "", created_at}, new Uint8Array(32).fill(1))
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe("extension query completion", () => {
  it("waits beyond the old 500ms early cutoff and closes each relay independently", async () => {
    vi.useFakeTimers()
    const first = event(),
      later = event(2)
    const options: LoadOptions[] = []
    load.mockImplementation((value: LoadOptions) => {
      options.push(value)
      value.onEvent?.(first, value.relays[0])
      return new Promise(resolve =>
        setTimeout(
          () => {
            value.onEvent?.(later, value.relays[0])
            value.onEose?.(value.relays[0])
            resolve([])
          },
          value.relays[0].includes("slow") ? 1200 : 700,
        ),
      )
    })
    let done = false
    const result = queryExtensionRelays(["wss://fast.example/", "wss://slow.example/"], {
      kinds: [30063],
      limit: 100,
    }).then(value => {
      done = true
      return value
    })
    await vi.advanceTimersByTimeAsync(501)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(await result).toMatchObject({complete: true, events: [first, later]})
    expect(options.every(value => value.signal?.aborted)).toBe(true)
  })
  it("does not mistake a settled loader or rejected relay for EOSE; ignores late events", async () => {
    let options!: LoadOptions
    load.mockImplementation(async (value: LoadOptions) => {
      options = value
      if (value.relays[0].includes("failed")) throw new Error("secret relay credential")
      value.onEvent?.(event(), value.relays[0])
    })
    const result = await queryExtensionRelays(
      ["wss://silent.example/", "wss://failed.example/?secret=value"],
      {kinds: [30063]},
    )
    expect(result.complete).toBe(false)
    expect(result.failedRelays).toEqual(["wss://failed.example/"])
    expect(result.timedOutRelays).toEqual(["wss://silent.example/"])
    options.onEvent?.(event(3), options.relays[0])
    expect(result.events).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain("secret")
  })
  it("bounds hanging loaders and rejects cached signature flags and out-of-filter events", async () => {
    vi.useFakeTimers()
    let options!: LoadOptions
    const tampered = event()
    tampered.content = "tampered"
    load.mockImplementation((value: LoadOptions) => {
      options = value
      value.onEvent?.(tampered, value.relays[0])
      return new Promise(() => {})
    })
    const pending = queryExtensionRelays(["wss://slow.example/"], {kinds: [30063]})
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toMatchObject({events: [], complete: false})
    expect(options.signal?.aborted).toBe(true)
  })
  it("recognizes exact ID completion when the loader closes at known cardinality", async () => {
    const asset = event()
    load.mockImplementation(async (options: LoadOptions) =>
      options.onEvent?.(asset, options.relays[0]),
    )
    expect(
      await queryExtensionRelays(["wss://relay.example/"], {kinds: [30063], ids: [asset.id]}),
    ).toMatchObject({complete: true})
  })
})
