import {describe, expect, it} from "vitest"
import {
  normalizeRelayUrls,
  getDmRelayUrls,
  hasDmInbox,
  getDmCounterparty,
  getMessagingRelayHints,
} from "./dm"

describe("dm", () => {
  describe("normalizeRelayUrls", () => {
    it("normalizes and deduplicates relay URLs", () => {
      const input = ["wss://relay.damus.io", "wss://relay.damus.io/", "  wss://relay.damus.io  "]
      const result = normalizeRelayUrls(input)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatch(/relay\.damus\.io/)
    })

    it("filters invalid URLs", () => {
      const input = ["wss://valid.relay.com", "not-a-url", "", "wss://another.valid.com"]
      const result = normalizeRelayUrls(input)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.every(url => url.startsWith("wss://"))).toBe(true)
    })

    it("returns empty array for null/undefined input", () => {
      expect(normalizeRelayUrls(null as any)).toEqual([])
      expect(normalizeRelayUrls(undefined as any)).toEqual([])
    })

    it("handles empty array", () => {
      expect(normalizeRelayUrls([])).toEqual([])
    })

    it("skips non-string values without throwing", () => {
      const input = ["wss://valid.relay.com", 123, null, undefined, {}] as any
      const result = normalizeRelayUrls(input)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.every(url => typeof url === "string")).toBe(true)
    })
  })

  describe("getDmRelayUrls", () => {
    it("extracts relay URLs from list with relay tags", () => {
      const list = {publicTags: [["relay", "wss://relay.damus.io"]], privateTags: []} as any
      const result = getDmRelayUrls(list)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.some(url => url.includes("relay.damus.io"))).toBe(true)
    })

    it("returns empty array for undefined list", () => {
      expect(getDmRelayUrls(undefined)).toEqual([])
    })

    it("extracts from r tags", () => {
      const list = {publicTags: [["r", "wss://relay.nostr.info"]], privateTags: []} as any
      const result = getDmRelayUrls(list)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("hasDmInbox", () => {
    it("returns true when list has relay URLs", () => {
      const list = {publicTags: [["relay", "wss://relay.damus.io"]], privateTags: []} as any
      expect(hasDmInbox(list)).toBe(true)
    })

    it("returns false when list has no relay URLs", () => {
      expect(hasDmInbox(undefined)).toBe(false)
      expect(hasDmInbox({publicTags: [], privateTags: []} as any)).toBe(false)
    })
  })

  describe("getDmCounterparty", () => {
    it("returns p tag value when event is from self", () => {
      const event = {
        pubkey: "self-pubkey",
        tags: [["p", "other-pubkey"]],
      } as any
      expect(getDmCounterparty(event, "self-pubkey")).toBe("other-pubkey")
    })

    it("returns event pubkey when event is from counterparty", () => {
      const event = {
        pubkey: "other-pubkey",
        tags: [["p", "self-pubkey"]],
      } as any
      expect(getDmCounterparty(event, "self-pubkey")).toBe("other-pubkey")
    })
  })

  describe("getMessagingRelayHints", () => {
    it("returns array of normalized relay URLs", () => {
      const hints = getMessagingRelayHints()
      expect(Array.isArray(hints)).toBe(true)
      expect(hints.every(url => typeof url === "string")).toBe(true)
    })
  })
})
