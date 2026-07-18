import {beforeEach, describe, expect, it, vi} from "vitest"

const mockLoad = vi.fn()

vi.mock("@welshman/net", () => ({
  load: (options: unknown) => mockLoad(options),
}))

vi.mock("@app/util/event-links", () => ({
  normalizeRelayHints: (relays: string[]) => relays,
}))

describe("fetchRelayEventsWithTimeout", () => {
  beforeEach(() => {
    mockLoad.mockReset()
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
})
