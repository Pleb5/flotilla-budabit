import {beforeEach, describe, expect, it, vi} from "vitest"

const mockLoad = vi.fn()
const mockMakeLoader = vi.fn((_options?: unknown) => mockLoad)
const mockPoolClear = vi.fn()

class MockPool {
  clear = mockPoolClear
}

vi.mock("@welshman/net", () => ({
  load: (options: unknown) => mockLoad(options),
  makeLoader: (options: unknown) => mockMakeLoader(options),
  Pool: MockPool,
}))

vi.mock("@app/util/event-links", () => ({
  normalizeRelayHints: (relays: string[]) => relays,
}))

describe("fetchRelayEventsWithTimeout", () => {
  beforeEach(() => {
    mockLoad.mockReset()
    mockMakeLoader.mockClear()
    mockPoolClear.mockReset()
  })

  it("accepts an empty exact query only after EOSE", async () => {
    mockLoad.mockImplementation(async options => {
      options.onEose("wss://relay.example")
      return []
    })
    const {fetchRelayEventsWithTimeout} = await import("./fetch-relay-events")

    await expect(
      fetchRelayEventsWithTimeout({
        relays: ["wss://relay.example"],
        filters: [{ids: ["event-id"]}],
        throwOnTimeout: true,
      }),
    ).resolves.toEqual([])
  })

  it("rejects a disconnected query that never reached EOSE", async () => {
    mockLoad.mockImplementation(async options => {
      options.onDisconnect("wss://relay.example")
      return []
    })
    const {fetchRelayEventsWithTimeout} = await import("./fetch-relay-events")

    await expect(
      fetchRelayEventsWithTimeout({
        relays: ["wss://relay.example"],
        filters: [{ids: ["event-id"]}],
        throwOnTimeout: true,
      }),
    ).rejects.toThrow("Relay disconnected before EOSE")
  })

  it("accepts an exact event returned before EOSE", async () => {
    const event = {id: "event-id"}
    mockLoad.mockImplementation(async options => {
      options.onEvent(event)
      return [event]
    })
    const {fetchRelayEventsWithTimeout} = await import("./fetch-relay-events")

    await expect(
      fetchRelayEventsWithTimeout({
        relays: ["wss://relay.example"],
        filters: [{ids: ["event-id"]}],
        throwOnTimeout: true,
      }),
    ).resolves.toEqual([event])
  })

  it("uses and disposes an isolated pool when requested", async () => {
    mockLoad.mockImplementation(async options => {
      options.onEose("wss://relay.example")
      return []
    })
    const {fetchRelayEventsWithTimeout} = await import("./fetch-relay-events")

    await fetchRelayEventsWithTimeout({
      relays: ["wss://relay.example"],
      filters: [{ids: ["event-id"]}],
      throwOnTimeout: true,
      isolated: true,
    })

    expect(mockMakeLoader).toHaveBeenCalledWith(
      expect.objectContaining({context: {pool: expect.any(MockPool)}}),
    )
    expect(mockPoolClear).toHaveBeenCalledOnce()
  })
  it("bounds initial-import exact reads and requires EOSE even after an event", async () => {
    const {fetchInitialImportRelayEvents} = await import("./fetch-relay-events")
    mockLoad.mockImplementation(async options => {
      options.onEvent({id: "event"})
      return []
    })
    await expect(
      fetchInitialImportRelayEvents({relays: ["wss://relay.example"], filters: [{ids: ["event"]}]}),
    ).rejects.toThrow("incomplete")
    mockLoad.mockImplementation(async options => {
      options.onEvent({id: "large", content: "x".repeat(65 * 1024)})
      options.onEose("wss://relay.example")
      expect(options.signal.aborted).toBe(true)
      return []
    })
    await expect(
      fetchInitialImportRelayEvents({relays: ["wss://relay.example"], filters: [{ids: ["large"]}]}),
    ).rejects.toThrow("budget")
  })
})

describe("fetchCompleteRelayInventory", () => {
  beforeEach(() => {
    mockLoad.mockReset()
    mockMakeLoader.mockClear()
    mockPoolClear.mockReset()
  })

  it("requires EOSE independently from every normalized relay", async () => {
    mockLoad.mockImplementation(async options => {
      const relay = options.relays[0]
      options.onEvent({id: `event-${relay}`, pubkey: "a".repeat(64), kind: 1621, tags: []})
      options.onEose(relay)
      return []
    })
    const {fetchCompleteRelayInventory} = await import("./fetch-relay-events")

    const result = await fetchCompleteRelayInventory({
      relays: ["wss://one.example", "wss://two.example/", "wss://one.example/"],
      filters: [{kinds: [1621]}],
    })

    expect(result.relays).toEqual(["wss://one.example/", "wss://two.example/"])
    expect(result.events).toHaveLength(2)
    expect(mockLoad.mock.calls.map(([options]) => options.relays)).toEqual([
      ["wss://one.example/"],
      ["wss://two.example/"],
    ])
    expect(mockPoolClear).toHaveBeenCalledOnce()
  })

  it("accepts an empty inventory only after every relay reaches EOSE", async () => {
    mockLoad.mockImplementation(async options => {
      options.onEose(options.relays[0])
      return []
    })
    const {fetchCompleteRelayInventory} = await import("./fetch-relay-events")

    await expect(
      fetchCompleteRelayInventory({
        relays: ["wss://empty.example"],
        filters: [{kinds: [30617]}],
      }),
    ).resolves.toMatchObject({events: [], relays: ["wss://empty.example/"]})
  })

  it("rejects events followed by disconnect before EOSE", async () => {
    mockLoad.mockImplementation(async options => {
      options.onEvent({id: "partial"})
      options.onDisconnect(options.relays[0])
      return []
    })
    const {fetchCompleteRelayInventory} = await import("./fetch-relay-events")

    await expect(
      fetchCompleteRelayInventory({
        relays: ["wss://partial.example"],
        filters: [{kinds: [1621]}],
      }),
    ).rejects.toThrow("disconnected before EOSE")
    expect(mockPoolClear).toHaveBeenCalledOnce()
  })

  it("rejects CLOSED and missing-EOSE completion", async () => {
    const {fetchCompleteRelayInventory} = await import("./fetch-relay-events")
    mockLoad.mockImplementationOnce(async options => {
      options.onClosed("policy", options.relays[0])
      return []
    })

    await expect(
      fetchCompleteRelayInventory({
        relays: ["wss://closed.example"],
        filters: [{kinds: [1621]}],
      }),
    ).rejects.toThrow("closed before EOSE")

    mockLoad.mockResolvedValueOnce([])
    await expect(
      fetchCompleteRelayInventory({
        relays: ["wss://timeout.example"],
        filters: [{kinds: [1621]}],
      }),
    ).rejects.toThrow("did not complete repository inventory with EOSE")
  })

  it("disables local deletion filtering in an isolated all-relay loader", async () => {
    mockLoad.mockImplementation(async options => {
      options.onEose(options.relays[0])
      return []
    })
    const {fetchCompleteRelayInventory} = await import("./fetch-relay-events")

    await fetchCompleteRelayInventory({
      relays: ["wss://relay.example"],
      filters: [{kinds: [1621]}],
    })

    expect(mockMakeLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        threshold: 1,
        context: {pool: expect.any(MockPool)},
        isEventDeleted: expect.any(Function),
      }),
    )
    const options = mockMakeLoader.mock.calls.at(-1)?.[0] as any
    expect(options.isEventDeleted({id: "locally-deleted"}, "wss://relay.example/")).toBe(false)
  })

  it("fails closed when there are no valid declared relays or the caller aborts", async () => {
    const {fetchCompleteRelayInventory} = await import("./fetch-relay-events")

    await expect(
      fetchCompleteRelayInventory({relays: ["not-a-relay"], filters: [{kinds: [30617]}]}),
    ).rejects.toThrow("requires declared metadata relays")

    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchCompleteRelayInventory({
        relays: ["wss://relay.example"],
        filters: [{kinds: [30617]}],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({name: "AbortError"})
  })
})
