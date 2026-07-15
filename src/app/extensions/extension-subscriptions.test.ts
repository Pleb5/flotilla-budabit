import {describe, expect, it, vi} from "vitest"
import type {RequestOptions} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {
  ExtensionSubscriptionRegistry,
  MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION,
  MAX_EXTENSION_SUBSCRIPTIONS,
  MAX_EXTENSION_SUBSCRIPTIONS_PER_RELAY,
} from "./extension-subscriptions"

const makeEvent = (kind: number, tags: string[][] = []): TrustedEvent =>
  ({
    id: `${kind}-${JSON.stringify(tags)}`,
    pubkey: "a".repeat(64),
    created_at: 1,
    kind,
    tags,
    content: "",
    sig: "sig",
  }) as TrustedEvent

const makeRegistry = () => {
  const calls: RequestOptions[] = []
  let sequence = 0
  const request = vi.fn((options: RequestOptions) => {
    calls.push(options)
    return new Promise<TrustedEvent[]>(resolve => {
      options.signal?.addEventListener("abort", () => resolve([]), {once: true})
    })
  })
  const registry = new ExtensionSubscriptionRegistry({
    request,
    makeSubscriptionId: () => `host-${++sequence}`,
  })

  return {calls, registry, request}
}

describe("extension subscription registry", () => {
  it("groups physical filters by normalized relay and extension domain", () => {
    const {calls, registry} = makeRegistry()

    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example", "wss://relay.example/"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })
    expect(registry.getSnapshot()).toMatchObject({groups: [{active: false, pending: true}]})
    calls[0].onEose?.("wss://relay.example/")
    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example/"],
      filters: [{kinds: [2]}],
      onEvent: vi.fn(),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0].signal?.aborted).toBe(false)
    expect(calls[1]).toMatchObject({
      relays: ["wss://relay.example/"],
      filters: [{kinds: [1]}, {kinds: [2]}],
      lifetime: "live",
      priority: -100,
      owner: "extension:extension-a",
    })
    expect(registry.getSnapshot()).toMatchObject({
      logicalSubscriptions: 2,
      groups: [
        {
          relay: "wss://relay.example/",
          logicalSubscriptions: 2,
          active: true,
          pending: true,
        },
      ],
    })
    calls[1].onEose?.("wss://relay.example/")
    expect(calls[0].signal?.aborted).toBe(true)
    expect(registry.getSnapshot()).toMatchObject({groups: [{active: true, pending: false}]})

    registry.close()
  })

  it("matches each event against every logical subscription's original filters", () => {
    const {calls, registry} = makeRegistry()
    const first = vi.fn()
    const second = vi.fn()
    const firstId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1], "#d": ["one"]}],
      onEvent: first,
    })
    calls[0].onEose?.("wss://relay.example/")
    const secondId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1], "#d": ["two"]}],
      onEvent: second,
    })

    const firstEvent = makeEvent(1, [["d", "one"]])
    calls[0].onEvent?.(firstEvent, "wss://relay.example/")
    calls[1].onEvent?.(firstEvent, "wss://relay.example/")

    expect(first).toHaveBeenCalledWith(firstId, expect.objectContaining({kind: 1}))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    calls.at(-1)?.onDuplicate?.(makeEvent(1, [["d", "two"]]), "wss://relay.example/")
    expect(second).toHaveBeenCalledWith(secondId, expect.objectContaining({kind: 1}))
    registry.close()
  })

  it("replaces removed filters at EOSE without interrupting prior traffic", () => {
    const {calls, registry} = makeRegistry()
    const firstId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })
    calls[0].onEose?.("wss://relay.example/")
    const secondId = registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [2]}],
      onEvent: vi.fn(),
    })
    calls[1].onEose?.("wss://relay.example/")

    expect(calls).toHaveLength(2)
    expect(calls[0].signal?.aborted).toBe(true)
    expect(registry.unsubscribe("extension-a", secondId)).toBe(true)
    expect(calls).toHaveLength(3)
    expect(calls[2].filters).toEqual([{kinds: [1]}])
    expect(calls[1].signal?.aborted).toBe(false)
    calls[2].onEose?.("wss://relay.example/")
    expect(calls[1].signal?.aborted).toBe(true)
    expect(calls[2].signal?.aborted).toBe(false)
    expect(registry.unsubscribe("extension-a", firstId)).toBe(true)
    expect(calls[2].signal?.aborted).toBe(true)
    registry.close()
  })

  it("closes every relay registration during extension cleanup", () => {
    const {calls, registry} = makeRegistry()
    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://one.example", "wss://two.example"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })

    registry.cleanupExtension("extension-a")

    expect(calls).toHaveLength(2)
    expect(calls.every(call => call.signal?.aborted)).toBe(true)
    expect(registry.getSnapshot()).toEqual({logicalSubscriptions: 0, groups: []})
  })

  it("retries a live request that ends while its logical registration remains", async () => {
    vi.useFakeTimers()
    const calls: RequestOptions[] = []
    const registry = new ExtensionSubscriptionRegistry({
      retryDelayMs: 1_000,
      request: async options => {
        calls.push(options)
        options.onStart?.(options.relays[0])
        return []
      },
    })
    registry.subscribe({
      extensionId: "extension-a",
      relays: ["wss://relay.example"],
      filters: [{kinds: [1]}],
      onEvent: vi.fn(),
    })

    await Promise.resolve()
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(2)

    registry.cleanupExtension("extension-a")
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(2)
    vi.useRealTimers()
  })

  it("enforces extension, relay-per-subscription, and per-relay logical quotas", () => {
    const first = makeRegistry()
    for (let index = 0; index < MAX_EXTENSION_SUBSCRIPTIONS; index += 1) {
      first.registry.subscribe({
        extensionId: "extension-a",
        relays: ["wss://relay.example"],
        filters: [{kinds: [index + 1]}],
        onEvent: vi.fn(),
      })
    }
    expect(() =>
      first.registry.subscribe({
        extensionId: "extension-a",
        relays: ["wss://other.example"],
        filters: [{kinds: [100]}],
        onEvent: vi.fn(),
      }),
    ).toThrow(`Subscription limit reached (max ${MAX_EXTENSION_SUBSCRIPTIONS})`)
    first.registry.close()

    const second = makeRegistry()
    expect(() =>
      second.registry.subscribe({
        extensionId: "extension-a",
        relays: Array.from(
          {length: MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION + 1},
          (_, index) => `wss://relay-${index}.example`,
        ),
        filters: [{kinds: [1]}],
        onEvent: vi.fn(),
      }),
    ).toThrow(`Relay limit reached (max ${MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION} per subscription)`)

    for (let index = 0; index < MAX_EXTENSION_SUBSCRIPTIONS_PER_RELAY; index += 1) {
      second.registry.subscribe({
        extensionId: `extension-${index}`,
        relays: ["wss://relay.example"],
        filters: [{kinds: [index + 1]}],
        onEvent: vi.fn(),
      })
    }
    expect(() =>
      second.registry.subscribe({
        extensionId: "extension-overflow",
        relays: ["wss://relay.example"],
        filters: [{kinds: [100]}],
        onEvent: vi.fn(),
      }),
    ).toThrow(`Relay subscription limit reached for wss://relay.example/`)
    second.registry.close()
  })
})
