import {describe, expect, it} from "vitest"
import {GIT_USER_GRASP_LIST} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {PROFILE_LIST_KIND} from "./community"
import type {ActiveUserCommunityRef} from "./community-membership"
import {
  buildGraspServerRecommendations,
  getGraspServerRecommendationAuthors,
  resolveDefaultCommunityGraspServerFallback,
  selectEffectiveGraspServerRecommendations,
} from "./grasp"

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: overrides.id || `${overrides.kind || 1}-${overrides.pubkey || ""}`.padStart(64, "0"),
    pubkey: overrides.pubkey || "a".repeat(64),
    created_at: overrides.created_at || 1,
    kind: overrides.kind || 1,
    tags: overrides.tags || [],
    content: overrides.content || "",
    sig: "0".repeat(128),
  }) as TrustedEvent

const makeCommunityRef = ({
  communityPubkey,
  moderatorPubkey,
  relay = "wss://community.relay.example",
}: {
  communityPubkey: string
  moderatorPubkey: string
  relay?: string
}): ActiveUserCommunityRef => {
  const listAddress = `${PROFILE_LIST_KIND}:${moderatorPubkey}:Repositories`

  return {
    communityPubkey,
    relayHints: [relay],
    roles: ["member"],
    writableSections: ["Repositories"],
    definition: {
      pubkey: communityPubkey,
      relays: [relay],
      sections: [
        {
          name: "Repositories",
          profileLists: [{address: listAddress, pubkey: moderatorPubkey, relay}],
        },
      ],
      event: makeEvent({pubkey: communityPubkey, created_at: 1}),
    },
  } as ActiveUserCommunityRef
}

const makeProfileList = ({pubkey, members = []}: {pubkey: string; members?: string[]}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-profile-list`,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [["d", "Repositories"], ...members.map(member => ["p", member])],
  })

const makeGraspList = ({
  pubkey,
  urls,
  created_at = 1,
}: {
  pubkey: string
  urls: string[]
  created_at?: number
}) =>
  makeEvent({
    id: `${pubkey.slice(0, 8)}-${created_at}`,
    pubkey,
    kind: GIT_USER_GRASP_LIST,
    created_at,
    tags: urls.map(url => ["g", url]),
  })

describe("grasp recommendations", () => {
  it("orders recommendation authors community-first with default community before moderators", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const moderator = "3".repeat(64)
    const member = "4".repeat(64)
    const follow = "5".repeat(64)
    const starred = "6".repeat(64)
    const defaultCommunity = "7".repeat(64)
    const communityRef = makeCommunityRef({communityPubkey: community, moderatorPubkey: moderator})
    const profileList = makeProfileList({pubkey: moderator, members: [viewer, member]})

    expect(
      getGraspServerRecommendationAuthors({
        viewerPubkey: viewer,
        follows: [follow],
        communityRefs: [communityRef],
        profileListEvents: [profileList],
        starredCommunityPubkeys: [starred],
        defaultCommunityPubkey: defaultCommunity,
      }).slice(0, 7),
    ).toEqual([viewer, community, defaultCommunity, moderator, starred, follow, member])
  })

  it("builds community-first GRASP server recommendations from kind 10317 lists", () => {
    const viewer = "1".repeat(64)
    const community = "2".repeat(64)
    const moderator = "3".repeat(64)
    const member = "4".repeat(64)
    const starred = "5".repeat(64)
    const follow = "6".repeat(64)
    const mutedFollow = "7".repeat(64)
    const communityRef = makeCommunityRef({communityPubkey: community, moderatorPubkey: moderator})
    const profileList = makeProfileList({pubkey: moderator, members: [viewer, member]})
    const recommendations = buildGraspServerRecommendations({
      viewerPubkey: viewer,
      communityRefs: [communityRef],
      profileListEvents: [profileList],
      follows: [follow, mutedFollow],
      mutes: [mutedFollow],
      starredCommunityPubkeys: [starred],
      userGraspListEvents: [
        makeGraspList({pubkey: community, urls: ["wss://community.grasp.example"]}),
        makeGraspList({pubkey: moderator, urls: ["wss://moderator.grasp.example"]}),
        makeGraspList({pubkey: member, urls: ["wss://member.grasp.example"]}),
        makeGraspList({pubkey: starred, urls: ["wss://starred.grasp.example"]}),
        makeGraspList({pubkey: follow, urls: ["wss://follow.grasp.example"]}),
        makeGraspList({pubkey: mutedFollow, urls: ["wss://muted.grasp.example"]}),
      ],
    })

    expect(recommendations.map(recommendation => recommendation.url)).toEqual([
      "wss://community.grasp.example",
      "wss://moderator.grasp.example",
      "wss://member.grasp.example",
      "wss://starred.grasp.example",
      "wss://follow.grasp.example",
    ])
    expect(recommendations.map(recommendation => recommendation.evidence[0].source)).toEqual([
      "community_grasp",
      "moderator_grasp",
      "member_grasp",
      "starred_community_grasp",
      "follow_grasp",
    ])
  })

  it("uses default community fallback only when no normal recommendation exists", () => {
    const defaultCommunity = "8".repeat(64)
    const follow = "9".repeat(64)
    const fallbackOnly = buildGraspServerRecommendations({
      defaultCommunityPubkey: defaultCommunity,
      userGraspListEvents: [
        makeGraspList({pubkey: defaultCommunity, urls: ["wss://default.grasp.example"]}),
      ],
    })
    const withFollow = buildGraspServerRecommendations({
      defaultCommunityPubkey: defaultCommunity,
      follows: [follow],
      userGraspListEvents: [
        makeGraspList({pubkey: defaultCommunity, urls: ["wss://default.grasp.example"]}),
        makeGraspList({pubkey: follow, urls: ["wss://follow.grasp.example"]}),
      ],
    })

    expect(selectEffectiveGraspServerRecommendations(fallbackOnly).map(item => item.url)).toEqual([
      "wss://default.grasp.example",
    ])
    expect(selectEffectiveGraspServerRecommendations(withFollow).map(item => item.url)).toEqual([
      "wss://follow.grasp.example",
    ])
  })

  it("resolves default community fallback through definition relays", async () => {
    const defaultCommunity = "a".repeat(64)
    const loaded: {authors: string[]; relays: string[]}[] = []
    const result = await resolveDefaultCommunityGraspServerFallback({
      communityInput: defaultCommunity,
      indexerRelays: ["wss://index.example"],
      loadDefinition: async () => ({relays: ["wss://community.example"]}) as any,
      loadEvents: async (authors, relays) => {
        loaded.push({authors, relays})
        return []
      },
      queryEvents: () => [
        makeGraspList({pubkey: defaultCommunity, urls: ["wss://default.grasp.example/"]}),
      ],
    })

    expect(result.urls).toEqual(["wss://default.grasp.example"])
    expect(loaded[0].authors).toEqual([defaultCommunity])
    expect(loaded[0].relays).toEqual(
      expect.arrayContaining(["wss://index.example/", "wss://community.example/"]),
    )
  })
})
