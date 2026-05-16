import {describe, expect, it} from "vitest"
import {BADGE_DEFINITION, type TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, FORM_TEMPLATE_KIND, PROFILE_LIST_KIND} from "@app/core/community"
import {makeCommunityDefinitionAddress} from "@app/core/community-forms"
import {COMMUNITY_STAR_CONTENT} from "@app/util/community-stars"
import {selectPreferredCommunities} from "@app/util/community-preferences"

const userPubkey = "a".repeat(64)
const moderatorCommunityPubkey = "b".repeat(64)
const starredCommunityPubkey = "c".repeat(64)
const otherCommunityPubkey = "d".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: overrides.id || "event-id",
    pubkey: userPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = ({
  id,
  pubkey,
  created_at = 1,
  profileListPubkey = userPubkey,
  badgePubkey = userPubkey,
  listIdentifier = "general-list",
  badgeIdentifier = "general-badge",
}: {
  id: string
  pubkey: string
  created_at?: number
  profileListPubkey?: string
  badgePubkey?: string
  listIdentifier?: string
  badgeIdentifier?: string
}) =>
  makeEvent({
    id,
    pubkey,
    created_at,
    kind: COMMUNITY_DEFINITION_KIND,
    tags: [
      ["r", "wss://community.example.com"],
      ["content", "General"],
      ["k", "7"],
      ["a", `${PROFILE_LIST_KIND}:${profileListPubkey}:${listIdentifier}`],
      ["badge", `${BADGE_DEFINITION}:${badgePubkey}:${badgeIdentifier}`],
    ],
  })

const makeProfileList = (identifier: string, created_at = 1) =>
  makeEvent({
    id: `profile-list-${identifier}`,
    pubkey: userPubkey,
    created_at,
    kind: PROFILE_LIST_KIND,
    tags: [["d", identifier]],
  })

const makeStar = (communityPubkey: string, created_at = 1) => {
  const reaction = makeEvent({
    id: `star-${communityPubkey}`,
    pubkey: userPubkey,
    created_at,
    kind: 7,
    content: COMMUNITY_STAR_CONTENT,
    tags: [["a", makeCommunityDefinitionAddress(communityPubkey), "wss://star.example.com"]],
  })

  return {communityPubkey, relayHints: ["wss://star.example.com/"], reaction}
}

describe("community preferences", () => {
  it("sorts admin, moderator, and star communities by score", () => {
    const adminDefinition = makeDefinition({id: "admin", pubkey: userPubkey, created_at: 1})
    const moderatorDefinition = makeDefinition({
      id: "moderator",
      pubkey: moderatorCommunityPubkey,
      created_at: 2,
      listIdentifier: "moderator-list",
    })
    const moderatorProfileList = makeProfileList("moderator-list", 3)
    const starred = makeStar(starredCommunityPubkey, 10)

    expect(
      selectPreferredCommunities({
        stars: [starred],
        adminDefinitionEvents: [adminDefinition],
        moderatorProfileListEvents: [moderatorProfileList],
        moderatorDefinitionEvents: [moderatorDefinition],
        author: userPubkey,
      }),
    ).toEqual([
      expect.objectContaining({communityPubkey: userPubkey, score: 4, isAdmin: true}),
      expect.objectContaining({
        communityPubkey: moderatorCommunityPubkey,
        score: 2,
        isModerator: true,
      }),
      expect.objectContaining({
        communityPubkey: starredCommunityPubkey,
        score: 1,
        isStarred: true,
      }),
    ])
  })

  it("combines role scores for the same community", () => {
    const adminDefinition = makeDefinition({id: "admin", pubkey: userPubkey, created_at: 1})
    const starred = makeStar(userPubkey, 5)

    expect(
      selectPreferredCommunities({
        stars: [starred],
        adminDefinitionEvents: [adminDefinition],
        author: userPubkey,
      }),
    ).toEqual([
      expect.objectContaining({
        communityPubkey: userPubkey,
        score: 5,
        isAdmin: true,
        isStarred: true,
        lastInteractedAt: 5,
      }),
    ])
  })

  it("uses user-authored admission forms as moderator evidence", () => {
    const form = makeEvent({
      id: "form",
      pubkey: userPubkey,
      created_at: 4,
      kind: FORM_TEMPLATE_KIND,
      tags: [
        ["d", "repo-application"],
        ["a", makeCommunityDefinitionAddress(moderatorCommunityPubkey)],
        ["content", "Repositories"],
      ],
    })

    expect(selectPreferredCommunities({moderatorFormEvents: [form], author: userPubkey})).toEqual([
      expect.objectContaining({
        communityPubkey: moderatorCommunityPubkey,
        score: 2,
        isModerator: true,
      }),
    ])
  })

  it("ignores definitions that reference non-grant-capable user lists", () => {
    const definition = makeDefinition({
      id: "not-moderator",
      pubkey: otherCommunityPubkey,
      listIdentifier: "general-list",
      badgePubkey: otherCommunityPubkey,
    })
    const profileList = makeProfileList("general-list", 3)

    expect(
      selectPreferredCommunities({
        moderatorProfileListEvents: [profileList],
        moderatorDefinitionEvents: [definition],
        author: userPubkey,
      }),
    ).toEqual([])
  })
})
