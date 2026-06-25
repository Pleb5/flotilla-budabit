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
    it("scores community evidence higher than social follow evidence", () => {
      expect(getDmRelayRecommendationSourceScore({communityPubkey: "a", relays: []})).toBe(40)
      expect(
        getDmRelayRecommendationSourceScore({
          communityPubkey: "a",
          relays: [],
          isModerator: true,
        }),
      ).toBe(48)
      expect(
        getDmRelayRecommendationSourceScore({
          communityPubkey: "a",
          relays: [],
          isModerator: true,
          isAdmin: true,
        }),
      ).toBe(64)
      expect(
        getDmRelayRecommendationSourceScore({
          source: "active_community_relay",
          communityPubkey: "a",
          relays: [],
          isStarred: false,
        }),
      ).toBe(55)
      expect(
        getDmRelayRecommendationSourceScore({
          source: "follow_messaging",
          pubkey: "b",
          relays: [],
        }),
      ).toBe(8)
    })

    it("ranks active community relays without requiring stars", () => {
      const result = getDmRelayRecommendations([
        {
          source: "follow_messaging",
          pubkey: "f".repeat(64),
          relays: ["wss://follow.relay.example.com"],
        },
        {
          source: "active_community_relay",
          communityPubkey: "a".repeat(64),
          relays: ["wss://active.relay.example.com"],
          isStarred: false,
        },
      ])

      expect(result.map(recommendation => recommendation.url)).toEqual([
        "wss://active.relay.example.com/",
        "wss://follow.relay.example.com/",
      ])
      expect(result[0]).toMatchObject({
        score: 55,
        counts: expect.objectContaining({activeCommunities: 1, follows: 0}),
        communities: [
          expect.objectContaining({
            communityPubkey: "a".repeat(64),
            sources: ["active_community_relay"],
            isStarred: false,
          }),
        ],
      })
    })

    it("ranks starred community relays above social follows", () => {
      const followSources = Array.from({length: 6}, (_, index) => ({
        source: "follow_messaging" as const,
        pubkey: `${index}`.repeat(64),
        relays: ["wss://follow.relay.example.com"],
      }))
      const result = getDmRelayRecommendations([
        ...followSources,
        {
          source: "starred_community_relay",
          communityPubkey: "a".repeat(64),
          relays: ["wss://star.relay.example.com"],
          starredAt: 10,
        },
      ])

      expect(result.map(recommendation => recommendation.url)).toEqual([
        "wss://star.relay.example.com/",
        "wss://follow.relay.example.com/",
      ])
      expect(result[0]).toMatchObject({
        score: 40,
        counts: expect.objectContaining({starredCommunities: 1, follows: 0}),
      })
      expect(result[1]).toMatchObject({
        score: 48,
        counts: expect.objectContaining({starredCommunities: 0, follows: 6}),
      })
    })

    it("ranks moderator messaging lists above member messaging lists", () => {
      const result = getDmRelayRecommendations([
        {
          source: "member_messaging",
          pubkey: "m".repeat(64),
          communityPubkey: "c".repeat(64),
          relays: ["wss://member.relay.example.com"],
        },
        {
          source: "moderator_messaging",
          pubkey: "d".repeat(64),
          communityPubkey: "c".repeat(64),
          relays: ["wss://moderator.relay.example.com"],
        },
      ])

      expect(result.map(recommendation => recommendation.url)).toEqual([
        "wss://moderator.relay.example.com/",
        "wss://member.relay.example.com/",
      ])
      expect(result[0]).toMatchObject({
        score: 32,
        pubkeys: ["d".repeat(64)],
        counts: expect.objectContaining({messagingLists: 1}),
        evidence: [
          expect.objectContaining({
            source: "moderator_messaging",
            isModerator: true,
          }),
        ],
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

    it("deduplicates repeated relay evidence from the same source", () => {
      const result = getDmRelayRecommendations([
        {
          source: "starred_community_relay",
          communityPubkey: "a".repeat(64),
          relays: ["wss://relay.example.com", "wss://relay.example.com/"],
        },
        {
          source: "starred_community_relay",
          communityPubkey: "a".repeat(64),
          relays: ["wss://relay.example.com/"],
        },
      ])

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        url: "wss://relay.example.com/",
        communityPubkeys: ["a".repeat(64)],
        count: 1,
        score: 40,
        latestStarredAt: 0,
        isConfigured: false,
        counts: expect.objectContaining({sources: 1, starredCommunities: 1}),
        communities: [
          expect.objectContaining({
            communityPubkey: "a".repeat(64),
            score: 40,
            sources: ["starred_community_relay"],
            isStarred: true,
            isModerator: false,
            isAdmin: false,
          }),
        ],
        evidence: [expect.objectContaining({source: "starred_community_relay", score: 40})],
      })
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
