import {beforeEach, describe, expect, it, vi} from "vitest"
import {writable} from "svelte/store"

const signerStore = writable<any>(null)
const pubkeyStore = writable<string | null>(null)
const loadMock = vi.fn().mockResolvedValue(undefined)
const publishMock = vi.fn().mockResolvedValue(undefined)
const routerGetMock = vi.fn(() => ({
  FromUser: () => ({getUrls: () => ["wss://ambient-outbox.example.com"]}),
}))

vi.mock("@welshman/app", () => ({
  signer: signerStore,
  pubkey: pubkeyStore,
}))

vi.mock("@welshman/net", () => ({
  load: loadMock,
  publish: publishMock,
}))

vi.mock("@welshman/router", () => ({
  Router: {
    get: routerGetMock,
  },
}))

describe("event-io", () => {
  beforeEach(() => {
    signerStore.set(null)
    pubkeyStore.set(null)
    vi.clearAllMocks()
  })

  describe("createEventIO", () => {
    it("getCurrentPubkey returns null when no pubkey", async () => {
      pubkeyStore.set(null)

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      expect(eventIO.getCurrentPubkey()).toBeNull()
    })

    it("getCurrentPubkey returns pubkey when set", async () => {
      const pk = "a".repeat(64)
      pubkeyStore.set(pk)

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      expect(eventIO.getCurrentPubkey()).toBe(pk)
    })

    it("publishEvent returns error when no signer", async () => {
      signerStore.set(null)

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      const result = await eventIO.publishEvent(
        {kind: 1, content: "", created_at: 0, tags: []},
        {relays: ["wss://repo.example.com"]},
      )

      expect(result).toEqual({ok: false, error: "No signer available"})
    })

    it("publishes only to normalized explicit relays without consulting the user outbox", async () => {
      const signed = {
        id: "evt",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      const sign = vi.fn().mockResolvedValue(signed)
      signerStore.set({sign})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      const result = await eventIO.publishEvent(
        {kind: 1, content: "", created_at: 0, tags: []},
        {
          relays: [" WSS://EXPLICIT.RELAY.EXAMPLE/path/ ", "wss://explicit.relay.example/path"],
        },
      )

      expect(result).toMatchObject({
        ok: true,
        relays: ["wss://explicit.relay.example/path"],
      })
      expect(sign).toHaveBeenCalledTimes(1)
      expect(publishMock).toHaveBeenCalledWith({
        event: signed,
        relays: ["wss://explicit.relay.example/path"],
      })
      expect(routerGetMock).not.toHaveBeenCalled()
    })

    it("rejects an empty publish scope before signer or publisher work", async () => {
      const sign = vi.fn()
      signerStore.set({sign})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()
      const result = await eventIO.publishEvent(
        {kind: 30618, content: "", created_at: 0, tags: [["d", "repo"]]},
        {relays: ["", "https://github.com/owner/repo.git"]},
      )

      expect(result).toEqual({
        ok: false,
        error: "Repository EventIO requires at least one explicit relay",
      })
      expect(sign).not.toHaveBeenCalled()
      expect(publishMock).not.toHaveBeenCalled()
      expect(routerGetMock).not.toHaveBeenCalled()
    })

    it("rejects a relayless repository announcement before signing", async () => {
      const sign = vi.fn()
      signerStore.set({sign})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()
      const result = await eventIO.publishEvent(
        {kind: 30617, content: "", created_at: 0, tags: [["d", "repo"]]},
        {relays: ["wss://discovery.example.com"]},
      )

      expect(result).toEqual({
        ok: false,
        error: "Repository announcements must declare at least one valid relay",
      })
      expect(sign).not.toHaveBeenCalled()
      expect(publishMock).not.toHaveBeenCalled()
    })

    it("fetches only from normalized explicit relays and rejects an empty fetch scope", async () => {
      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()
      const filters = [{kinds: [30618], "#d": ["repo"]}]

      await eventIO.fetchEvents(filters, {
        relays: ["wss://REPO.EXAMPLE.com/", "wss://repo.example.com"],
      })

      expect(loadMock).toHaveBeenCalledWith(
        expect.objectContaining({relays: ["wss://repo.example.com"], filters}),
      )
      expect(routerGetMock).not.toHaveBeenCalled()

      loadMock.mockClear()
      await expect(eventIO.fetchEvents(filters, {relays: []})).rejects.toThrow(
        "Repository EventIO requires at least one explicit relay",
      )
      expect(loadMock).not.toHaveBeenCalled()
    })

    it("signEvent throws when no signer", async () => {
      signerStore.set(null)

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      await expect(
        eventIO.signEvent!({kind: 1, content: "", created_at: 0, tags: []}),
      ).rejects.toThrow("No signer available")
    })

    it("signEvent returns signed event when signer available", async () => {
      const signed = {
        id: "evt",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signed)})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      const result = await eventIO.signEvent!({kind: 1, content: "", created_at: 0, tags: []})

      expect(result).toEqual(signed)
    })

    it("publishEvents calls publishEvent for each event", async () => {
      const signed = {
        id: "evt",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signed)})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      const results = await eventIO.publishEvents(
        [
          {kind: 1, content: "a", created_at: 0, tags: []},
          {kind: 1, content: "b", created_at: 0, tags: []},
        ],
        {relays: ["wss://repo.example.com"]},
      )

      expect(results).toHaveLength(2)
      expect(results.every(r => r.ok === true)).toBe(true)
    })
  })
})
