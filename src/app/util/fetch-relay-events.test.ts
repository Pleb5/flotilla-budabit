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
})
