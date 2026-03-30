import {describe, expect, it, vi} from "vitest"
import {writable} from "svelte/store"

const signerStore = writable<any>(null)
const pubkeyStore = writable<string | null>(null)

vi.mock("@welshman/app", () => ({
  signer: signerStore,
  pubkey: pubkeyStore,
}))

vi.mock("@welshman/net", () => ({
  load: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@welshman/router", () => ({
  Router: {
    get: vi.fn(() => ({
      FromUser: () => ({getUrls: () => ["wss://relay.example.com"]}),
    })),
  },
}))

describe("event-io", () => {
  describe("createNip98AuthHeader", () => {
    it("returns null when no signer available", async () => {
      signerStore.set(null)

      const {createNip98AuthHeader} = await import("./event-io")
      const result = await createNip98AuthHeader("https://example.com", "POST")

      expect(result).toBeNull()
    })

    it("returns Nostr auth header when signer available", async () => {
      const signedEvent = {
        id: "evt123",
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["u", "https://example.com"],
          ["method", "POST"],
        ],
        content: "",
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signedEvent)})

      const {createNip98AuthHeader} = await import("./event-io")
      const result = await createNip98AuthHeader("https://example.com", "POST")

      expect(result).toMatch(/^Nostr /)
      expect(result).toBeTruthy()
    })
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

      const result = await eventIO.publishEvent({kind: 1, content: "", created_at: 0, tags: []})

      expect(result).toEqual({ok: false, error: "No signer available"})
    })

    it("publishEvent returns ok when signer signs and publishes", async () => {
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

      const result = await eventIO.publishEvent({kind: 1, content: "", created_at: 0, tags: []})

      expect(result).toMatchObject({ok: true, relays: ["wss://relay.example.com"]})
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

      const results = await eventIO.publishEvents([
        {kind: 1, content: "a", created_at: 0, tags: []},
        {kind: 1, content: "b", created_at: 0, tags: []},
      ])

      expect(results).toHaveLength(2)
      expect(results.every(r => r.ok === true)).toBe(true)
    })
  })
})
