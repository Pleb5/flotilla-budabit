import {describe, expect, it} from "vitest"
import {DELETE, REACTION, type TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND} from "@app/core/community"
import {makeCommunityDefinitionAddress} from "@app/core/community-forms"
import {
  COMMUNITY_STAR_CONTENT,
  makeCommunityInputValue,
  makeCommunityStarDeleteFilter,
  makeCommunityStarReaction,
  makeCommunityStarReactionFilter,
  makeRecentCommunityStarDeleteFilter,
  parseCommunityStarReaction,
  selectActiveCommunityStars,
} from "@app/util/community-stars"

const communityPubkey = "a".repeat(64)
const userPubkey = "b".repeat(64)
const otherUserPubkey = "c".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: userPubkey,
    created_at: 1,
    kind: REACTION,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeStar = (id: string, pubkey = communityPubkey, created_at = 1) =>
  makeEvent({
    id,
    created_at,
    content: COMMUNITY_STAR_CONTENT,
    tags: [
      ["a", makeCommunityDefinitionAddress(pubkey), "wss://relay.example.com/"],
      ["p", pubkey],
      ["k", String(COMMUNITY_DEFINITION_KIND)],
    ],
  })

describe("community stars", () => {
  it("builds positive kind 7 reactions for community definitions", () => {
    const reaction = makeCommunityStarReaction({
      communityPubkey,
      relayHints: ["wss://relay.example.com"],
    })

    expect(reaction.kind).toBe(REACTION)
    expect(reaction.content).toBe(COMMUNITY_STAR_CONTENT)
    expect(reaction.tags).toEqual(
      expect.arrayContaining([
        ["a", makeCommunityDefinitionAddress(communityPubkey), "wss://relay.example.com/"],
        ["p", communityPubkey],
        ["k", String(COMMUNITY_DEFINITION_KIND)],
      ]),
    )
  })

  it("parses active community star reactions", () => {
    const star = makeStar("star-1")

    expect(parseCommunityStarReaction(star)).toMatchObject({
      communityPubkey,
      relayHints: ["wss://relay.example.com/"],
      reaction: star,
    })
  })

  it("filters deleted reaction events out of starred communities", () => {
    const star = makeStar("star-1")
    const deleteEvent = makeEvent({
      id: "delete-1",
      kind: DELETE,
      content: "",
      tags: [["e", star.id]],
    })

    expect(
      selectActiveCommunityStars({
        reactions: [star],
        deleteEvents: [deleteEvent],
        author: userPubkey,
      }),
    ).toEqual([])
  })

  it("ignores deletes from other users", () => {
    const star = makeStar("star-1")
    const deleteEvent = makeEvent({
      id: "delete-1",
      pubkey: otherUserPubkey,
      kind: DELETE,
      content: "",
      tags: [["e", star.id]],
    })

    expect(
      selectActiveCommunityStars({
        reactions: [star],
        deleteEvents: [deleteEvent],
        author: userPubkey,
      }),
    ).toHaveLength(1)
  })

  it("dedupes community stars by latest reaction", () => {
    const older = makeStar("older", communityPubkey, 1)
    const newer = makeStar("newer", communityPubkey, 2)

    expect(selectActiveCommunityStars({reactions: [older, newer], author: userPubkey})).toEqual([
      expect.objectContaining({reaction: newer}),
    ])
  })

  it("builds filters for loading star reactions and deletes", () => {
    const star = makeStar("star-1")

    expect(makeCommunityStarReactionFilter(userPubkey)).toMatchObject({
      kinds: [REACTION],
      authors: [userPubkey],
      "#k": [String(COMMUNITY_DEFINITION_KIND)],
    })
    expect(makeCommunityStarDeleteFilter(userPubkey, [star])).toMatchObject({
      kinds: [DELETE],
      authors: [userPubkey],
      "#e": [star.id],
    })
    expect(makeRecentCommunityStarDeleteFilter(userPubkey)).toMatchObject({
      kinds: [DELETE],
      authors: [userPubkey],
      "#k": [String(REACTION)],
    })
  })

  it("preserves relay hints when building ncommunity input values", () => {
    expect(
      makeCommunityInputValue({pubkey: communityPubkey, relayHints: ["wss://relay.example.com"]}),
    ).toBe(`ncommunity://${communityPubkey}?relay=wss%3A%2F%2Frelay.example.com%2F`)
  })
})
