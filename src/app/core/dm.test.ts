import {describe, expect, it} from "vitest"
import {
  normalizeRelayUrls,
  getDmRelayUrls,
  getDmRelayRecommendations,
  getDmRelayRecommendationSourceScore,
  getDmPublishRelays,
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

  describe("getDmPublishRelays", () => {
    it("includes both recipient and self inbox relays without duplicates", () => {
      const result = getDmPublishRelays(
        ["wss://self.relay.example.com", "wss://shared.relay.example.com"],
        ["wss://shared.relay.example.com", "wss://recipient.relay.example.com"],
      )

      expect(result).toEqual([
        "wss://shared.relay.example.com/",
        "wss://recipient.relay.example.com/",
        "wss://self.relay.example.com/",
      ])
    })
  })

  describe("getDmRelayRecommendations", () => {
    it("scores starred, moderator, and admin relay recommendations additively", () => {
      expect(getDmRelayRecommendationSourceScore({communityPubkey: "a", relays: []})).toBe(1)
      expect(
        getDmRelayRecommendationSourceScore({
          communityPubkey: "a",
          relays: [],
          isModerator: true,
        }),
      ).toBe(3)
      expect(
        getDmRelayRecommendationSourceScore({
          communityPubkey: "a",
          relays: [],
          isModerator: true,
          isAdmin: true,
        }),
      ).toBe(7)
    })

    it("ranks relays by summed star, moderator, and admin score", () => {
      const result = getDmRelayRecommendations([
        {
          communityPubkey: "a".repeat(64),
          relays: ["wss://shared.relay.example.com", "wss://star.relay.example.com"],
          starredAt: 10,
        },
        {
          communityPubkey: "b".repeat(64),
          relays: ["wss://shared.relay.example.com", "wss://mod.relay.example.com"],
          starredAt: 20,
          isModerator: true,
        },
        {
          communityPubkey: "c".repeat(64),
          relays: ["wss://admin.relay.example.com"],
          starredAt: 5,
          isModerator: true,
          isAdmin: true,
        },
      ])

      expect(result.map(recommendation => recommendation.url)).toEqual([
        "wss://admin.relay.example.com/",
        "wss://shared.relay.example.com/",
        "wss://mod.relay.example.com/",
        "wss://star.relay.example.com/",
      ])
      expect(result[0]).toMatchObject({
        score: 7,
        count: 1,
        communityPubkeys: ["c".repeat(64)],
        communities: [
          expect.objectContaining({
            communityPubkey: "c".repeat(64),
            score: 7,
            isStarred: true,
            isModerator: true,
            isAdmin: true,
          }),
        ],
      })
      expect(result[1]).toMatchObject({
        score: 4,
        count: 2,
        communityPubkeys: ["a".repeat(64), "b".repeat(64)],
      })
    })

    it("keeps already configured messaging relays visible", () => {
      const result = getDmRelayRecommendations(
        [
          {
            communityPubkey: "a".repeat(64),
            relays: ["wss://already.relay.example.com", "wss://new.relay.example.com"],
          },
        ],
        ["wss://already.relay.example.com/"],
      )

      expect(result.map(recommendation => recommendation.url)).toEqual([
        "wss://already.relay.example.com/",
        "wss://new.relay.example.com/",
      ])
      expect(result[0]).toMatchObject({isConfigured: true})
      expect(result[1]).toMatchObject({isConfigured: false})
    })

    it("deduplicates repeated relays within a single community source", () => {
      const result = getDmRelayRecommendations([
        {
          communityPubkey: "a".repeat(64),
          relays: ["wss://relay.example.com", "wss://relay.example.com/"],
        },
      ])

      expect(result).toEqual([
        {
          url: "wss://relay.example.com/",
          communityPubkeys: ["a".repeat(64)],
          communities: [
            {
              communityPubkey: "a".repeat(64),
              score: 1,
              isStarred: true,
              isModerator: false,
              isAdmin: false,
            },
          ],
          count: 1,
          score: 1,
          latestStarredAt: 0,
          isConfigured: false,
        },
      ])
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
