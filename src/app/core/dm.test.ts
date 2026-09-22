import {describe, expect, it} from "vitest"
import {MESSAGING_RELAYS, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  parseCommunityDefinition,
} from "./community"
import {getPublicKey} from "nostr-tools/pure"
import type {ActiveUserCommunityRef} from "./community-membership"
import {
  buildDmRelayRecommendations,
  normalizeRelayUrls,
  getDmRelayUrls,
  getDmRelayRecommendations,
  getDmRelayRecommendationAuthors,
  getDmRelayRecommendationSourceScore,
  getDmPublishRelays,
  hasDmInbox,
  getDmCounterparty,
  getMessagingRelayHints,
} from "./dm"

const testPubkey = (value: number) => getPublicKey(new Uint8Array(32).fill(value))

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: overrides.id || "e".repeat(64),
    pubkey: overrides.pubkey || "a".repeat(64),
    created_at: overrides.created_at || 1,
    kind: overrides.kind || 1,
    tags: overrides.tags || [],
    content: overrides.content || "",
    sig: overrides.sig || "sig",
  }) as TrustedEvent

const communityIds = new Map<string, string>(
  ["community", "first", "second", "shared-id"].map((id, index) => [
    id,
    getPublicKey(new Uint8Array(32).fill(42 + index)),
  ]),
)

const makeCommunityRef = ({
  communityPubkey,
  moderatorPubkey,
  relay = "wss://active.relay.example.com",
  identifier = "community",
}: {
  communityPubkey: string
  moderatorPubkey: string
  relay?: string
  identifier?: string
}): ActiveUserCommunityRef => {
  const communityId = communityIds.get(identifier)!
  const listAddress = `${PROFILE_LIST_KIND}:${moderatorPubkey}:${communityId}-repositories`

  const definition = parseCommunityDefinition(
    makeEvent({
      pubkey: communityPubkey,
      created_at: 1,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: buildCommunityDefinition({
        communityId,
        name: identifier,
        relays: [relay],
        sections: [
          {
            name: "Repositories",
            kinds: [{kind: 30617}],
            profileLists: [{address: listAddress, relay}],
          },
        ],
      }).tags,
    }),
  )!

  return {
    community: definition.pointer,
    relayHints: [relay],
    roles: ["member"],
    writableSections: ["Repositories"],
    definition,
  }
}

const makeProfileList = ({
  pubkey,
  members = [],
  community = "community",
}: {
  pubkey: string
  members?: string[]
  community?: string
}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-profile-list`,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [
      ["d", `${communityIds.get(community)!}-repositories`],
      ...members.map(member => ["p", member]),
    ],
  })

const makeMessagingRelayList = ({
  pubkey,
  relays,
  created_at = 1,
}: {
  pubkey: string
  relays: string[]
  created_at?: number
}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-${created_at}`,
    pubkey,
    kind: MESSAGING_RELAYS,
    created_at,
    tags: relays.map(relay => ["relay", relay]),
  })

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

  describe("getDmRelayRecommendationAuthors", () => {
    it("prioritizes community authors before follows and members", () => {
      const viewer = testPubkey(1)
      const community = testPubkey(2)
      const moderator = testPubkey(3)
      const member = testPubkey(4)
      const follow = testPubkey(5)
      const starred = testPubkey(6)
      const communityRef = makeCommunityRef({
        communityPubkey: community,
        moderatorPubkey: moderator,
      })
      const profileList = makeProfileList({pubkey: moderator, members: [viewer, member]})

      const authors = getDmRelayRecommendationAuthors({
        viewerPubkey: viewer,
        follows: [follow],
        communityRefs: [communityRef],
        profileListEvents: [profileList],
        starredCommunityPubkeys: [starred],
      })

      expect(authors.slice(0, 6)).toEqual([viewer, community, moderator, starred, follow, member])
    })
  })

  describe("buildDmRelayRecommendations", () => {
    it("builds community-first recommendations from messaging lists and relay sources", () => {
      const viewer = testPubkey(1)
      const community = testPubkey(2)
      const moderator = testPubkey(3)
      const member = testPubkey(4)
      const follow = testPubkey(5)
      const mutedFollow = testPubkey(6)
      const communityRef = makeCommunityRef({
        communityPubkey: community,
        moderatorPubkey: moderator,
      })
      const profileList = makeProfileList({pubkey: moderator, members: [viewer, member]})
      const recommendations = buildDmRelayRecommendations({
        viewerPubkey: viewer,
        communityRefs: [communityRef],
        profileListEvents: [profileList],
        follows: [follow, mutedFollow],
        mutes: [mutedFollow],
        extraSources: [
          {
            source: "starred_community_relay",
            communityPubkey: community,
            relays: ["wss://star.relay.example.com"],
            starredAt: 10,
          },
        ],
        messagingRelayListEvents: [
          makeMessagingRelayList({
            pubkey: community,
            relays: ["wss://community-list.relay.example.com"],
          }),
          makeMessagingRelayList({
            pubkey: moderator,
            relays: ["wss://moderator-list.relay.example.com"],
          }),
          makeMessagingRelayList({
            pubkey: member,
            relays: ["wss://member-list.relay.example.com"],
          }),
          makeMessagingRelayList({
            pubkey: follow,
            relays: ["wss://follow-list.relay.example.com"],
          }),
          makeMessagingRelayList({
            pubkey: mutedFollow,
            relays: ["wss://muted-list.relay.example.com"],
          }),
        ],
      })
      const urls = recommendations.map(recommendation => recommendation.url)

      expect(urls).toEqual([
        "wss://active.relay.example.com/",
        "wss://star.relay.example.com/",
        "wss://community-list.relay.example.com/",
        "wss://moderator-list.relay.example.com/",
        "wss://member-list.relay.example.com/",
        "wss://follow-list.relay.example.com/",
      ])
      expect(urls).not.toContain("wss://muted-list.relay.example.com/")
      expect(recommendations[0].evidence[0]).toMatchObject({
        source: "active_community_relay",
        isPrimary: true,
      })
      expect(recommendations[1].evidence[0]).toMatchObject({source: "starred_community_relay"})
      expect(recommendations[2].evidence[0]).toMatchObject({source: "community_messaging"})
      expect(recommendations[3].evidence[0]).toMatchObject({source: "moderator_messaging"})
      expect(recommendations[4].evidence[0]).toMatchObject({source: "member_messaging"})
      expect(recommendations[5].evidence[0]).toMatchObject({source: "follow_messaging"})
    })

    it("prefers the latest community primary over legacy personal inboxes and secondary relays", () => {
      const community = testPubkey(2)
      const moderator = testPubkey(3)
      const legacy = "wss://budabit.nostr1.com"
      const primary = "wss://relay.budabit.club"
      const oldRef = makeCommunityRef({
        communityPubkey: community,
        moderatorPubkey: moderator,
        relay: legacy,
      })
      const currentRef = makeCommunityRef({
        communityPubkey: community,
        moderatorPubkey: moderator,
        relay: primary,
      })
      currentRef.definition.event.created_at = 2
      currentRef.definition.relays.push("wss://aaa-secondary.example")
      const recommendations = buildDmRelayRecommendations({
        communityRefs: [oldRef, currentRef],
        messagingRelayListEvents: [
          makeMessagingRelayList({
            pubkey: community,
            relays: [legacy, "wss://aaa-secondary.example"],
          }),
        ],
      })

      expect(recommendations.map(item => item.url)).toEqual([
        `${primary}/`,
        "wss://aaa-secondary.example/",
        `${legacy}/`,
      ])
      expect(recommendations[2].evidence.map(item => item.source)).toEqual(["community_messaging"])
      expect(recommendations[0].evidence[0].isPrimary).toBe(true)
    })

    it("respects primary relay order for starred communities despite accumulated messaging evidence", () => {
      const primary = "wss://relay.budabit.club"
      const secondary = "wss://aaa-secondary.example"
      const recommendations = getDmRelayRecommendations([
        {
          source: "starred_community_relay",
          communityAddress: "first",
          communityPubkey: "a",
          relays: [primary, secondary],
          primaryRelay: primary,
        },
        ...Array.from({length: 20}, (_, index) => ({
          source: "member_messaging" as const,
          pubkey: `${index}`,
          relays: [secondary],
        })),
      ])
      expect(recommendations.map(item => item.url)).toEqual([`${primary}/`, `${secondary}/`])
      expect(recommendations[0].score).toBeLessThan(recommendations[1].score)
    })

    it("keeps same-owner sibling messaging evidence on exact addresses", () => {
      const viewer = testPubkey(1)
      const owner = testPubkey(2)
      const moderatorA = testPubkey(3)
      const moderatorB = testPubkey(4)
      const recommender = testPubkey(5)
      const first = makeCommunityRef({
        communityPubkey: owner,
        moderatorPubkey: moderatorA,
        identifier: "first",
        relay: "wss://first.active.example.com",
      })
      const second = makeCommunityRef({
        communityPubkey: owner,
        moderatorPubkey: moderatorB,
        identifier: "second",
        relay: "wss://second.active.example.com",
      })
      const recommendations = buildDmRelayRecommendations({
        viewerPubkey: viewer,
        communityRefs: [first, second],
        profileListEvents: [
          makeProfileList({pubkey: moderatorA, members: [recommender], community: "first"}),
          makeProfileList({pubkey: moderatorB, members: [recommender], community: "second"}),
        ],
        messagingRelayListEvents: [
          makeMessagingRelayList({
            pubkey: recommender,
            relays: ["wss://shared.messaging.example.com"],
          }),
        ],
      })
      const evidence = recommendations.find(item => item.url.includes("shared.messaging"))?.evidence

      expect(evidence).toHaveLength(2)
      expect(evidence?.map(item => item.communityAddress)).toEqual(
        expect.arrayContaining([first.community.address, second.community.address]),
      )
    })

    it("keeps same-ID messaging branches distinct by owner address", () => {
      const recommender = testPubkey(1)
      const firstController = testPubkey(2)
      const secondController = testPubkey(3)
      const firstModerator = getPublicKey(new Uint8Array(32).fill(54))
      const secondModerator = getPublicKey(new Uint8Array(32).fill(55))
      const recommendations = buildDmRelayRecommendations({
        communityRefs: [
          makeCommunityRef({
            communityPubkey: firstController,
            moderatorPubkey: firstModerator,
            identifier: "shared-id",
          }),
          makeCommunityRef({
            communityPubkey: secondController,
            moderatorPubkey: secondModerator,
            identifier: "shared-id",
          }),
        ],
        profileListEvents: [
          makeProfileList({pubkey: firstModerator, members: [recommender], community: "shared-id"}),
          makeProfileList({
            pubkey: secondModerator,
            members: [recommender],
            community: "shared-id",
          }),
        ],
        messagingRelayListEvents: [
          makeMessagingRelayList({pubkey: recommender, relays: ["wss://shared-id.example.com"]}),
        ],
      })

      expect(
        recommendations
          .find(item => item.url.includes("shared-id"))
          ?.evidence.map(item => item.communityAddress),
      ).toEqual(
        expect.arrayContaining([
          `32222:${firstController}:${communityIds.get("shared-id")}`,
          `32222:${secondController}:${communityIds.get("shared-id")}`,
        ]),
      )
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
