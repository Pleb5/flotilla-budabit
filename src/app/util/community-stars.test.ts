import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {DELETE, REACTION, type TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, makeCommunityPointer} from "@app/core/community"
import {
  COMMUNITY_STAR_CONTENT,
  makeExactCommunityInputValue,
  makeCommunityStarDelete,
  makeCommunityStarDeleteFilter,
  makeCommunityStarReaction,
  makeCommunityStarReactionFilter,
  makeRecentCommunityStarDeleteFilter,
  parseCommunityStarReaction,
  selectActiveCommunityStars,
} from "@app/util/community-stars"

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const pointer = makeCommunityPointer({
  ownerPubkey: key(81),
  communityId: key(82),
  relayHints: ["wss://relay.example"],
})!
const sameIdBranch = makeCommunityPointer({
  ownerPubkey: key(83),
  communityId: pointer.communityId,
})!
const controllerSibling = makeCommunityPointer({
  ownerPubkey: pointer.ownerPubkey,
  communityId: key(86),
})!
const userPubkey = key(84)
const otherUserPubkey = key(85)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "1".repeat(64),
    pubkey: userPubkey,
    created_at: 1,
    kind: REACTION,
    tags: [],
    content: "",
    sig: "f".repeat(128),
    ...overrides,
  }) as TrustedEvent

const makeStar = (community = pointer, createdAt = 1) =>
  makeEvent({...makeCommunityStarReaction(community), created_at: createdAt})

describe("community stars", () => {
  it("builds exact branch reactions without a community person tag", () => {
    const reaction = makeCommunityStarReaction(pointer)

    expect(reaction.kind).toBe(REACTION)
    expect(reaction.content).toBe(COMMUNITY_STAR_CONTENT)
    expect(reaction.tags).toEqual([
      ["h", pointer.communityId],
      ["a", pointer.address, "wss://relay.example", "community"],
      ["k", String(COMMUNITY_DEFINITION_KIND)],
    ])
    expect(reaction.tags.some(tag => tag[0] === "p")).toBe(false)
  })

  it("parses only coherent exact branch reactions", () => {
    expect(parseCommunityStarReaction(makeStar())?.community.address).toBe(pointer.address)
    expect(
      parseCommunityStarReaction(
        makeEvent({
          ...makeStar(),
          tags: [
            ["h", pointer.communityId],
            ["a", sameIdBranch.address, "", "community"],
            ["p", pointer.communityId],
          ],
        }),
      ),
    ).toBeUndefined()
  })

  it("keeps same-ID branches independent", () => {
    expect(
      selectActiveCommunityStars({reactions: [makeStar(pointer), makeStar(sameIdBranch, 2)]}),
    ).toHaveLength(2)
  })

  it("keeps communities from the same owner independent", () => {
    expect(
      selectActiveCommunityStars({reactions: [makeStar(pointer), makeStar(controllerSibling, 2)]}),
    ).toHaveLength(2)
  })

  it("accepts only same-author exact branch deletions", () => {
    const star = makeStar()
    const deletion = makeEvent({...makeCommunityStarDelete(pointer, star.id)})
    const outsiderDeletion = makeEvent({
      ...makeCommunityStarDelete(pointer, star.id),
      kind: DELETE,
      pubkey: otherUserPubkey,
    })

    expect(selectActiveCommunityStars({reactions: [star], deleteEvents: [deletion]})).toEqual([])
    expect(
      selectActiveCommunityStars({reactions: [star], deleteEvents: [outsiderDeletion]}),
    ).toHaveLength(1)
  })

  it("rejects unscoped and sibling-community star deletions", () => {
    const star = makeStar()
    const unscopedDeletion = makeEvent({
      kind: DELETE,
      tags: [
        ["e", star.id],
        ["k", String(REACTION)],
      ],
    })
    const siblingDeletion = makeEvent({...makeCommunityStarDelete(sameIdBranch, star.id)})
    const sameControllerSiblingDeletion = makeEvent({
      ...makeCommunityStarDelete(controllerSibling, star.id),
    })

    expect(
      selectActiveCommunityStars({reactions: [star], deleteEvents: [unscopedDeletion]}),
    ).toHaveLength(1)
    // A same-author deletion of this exact star id is a retraction regardless
    // of which same-ID branch the deleter had selected: the star pins the branch.
    expect(
      selectActiveCommunityStars({reactions: [star], deleteEvents: [siblingDeletion]}),
    ).toHaveLength(0)
    expect(
      selectActiveCommunityStars({
        reactions: [star],
        deleteEvents: [sameControllerSiblingDeletion],
      }),
    ).toHaveLength(1)
  })

  it("accepts legacy star deletions that carried the marked community a", () => {
    const star = makeStar()
    const legacyDeletion = makeEvent({
      kind: DELETE,
      tags: [
        ["h", pointer.communityId],
        ["a", pointer.address, "", "community"],
        ["e", star.id],
        ["k", String(REACTION)],
      ],
    })
    const legacyOtherBranch = makeEvent({
      kind: DELETE,
      tags: [
        ["h", pointer.communityId],
        ["a", sameIdBranch.address, "", "community"],
        ["e", star.id],
        ["k", String(REACTION)],
      ],
    })

    expect(
      selectActiveCommunityStars({reactions: [star], deleteEvents: [legacyDeletion]}),
    ).toHaveLength(0)
    expect(
      selectActiveCommunityStars({reactions: [star], deleteEvents: [legacyOtherBranch]}),
    ).toHaveLength(1)
  })

  it("requires exact scope, event, and kind tags on star deletions", () => {
    const star = makeStar()
    const validTags = makeCommunityStarDelete(pointer, star.id).tags
    const invalidTagSets = [
      validTags.filter(tag => tag[0] !== "h"),
      [...validTags, ["h", pointer.communityId]],
      validTags.filter(tag => tag[0] !== "e"),
      validTags.map(tag => (tag[0] === "e" ? [...tag, "extra"] : tag)),
      validTags.filter(tag => tag[0] !== "k"),
      validTags.map(tag => (tag[0] === "k" ? ["k", "1"] : tag)),
    ]

    for (const tags of invalidTagSets) {
      expect(
        selectActiveCommunityStars({
          reactions: [star],
          deleteEvents: [makeEvent({kind: DELETE, tags})],
        }),
      ).toHaveLength(1)
    }
  })

  it("builds exact star deletions", () => {
    const star = makeStar()

    expect(makeCommunityStarDelete(pointer, star.id)).toEqual({
      kind: DELETE,
      content: "Deleted community star",
      tags: [
        ["h", pointer.communityId],
        ["e", star.id],
        ["k", String(REACTION)],
      ],
    })
  })

  it("builds star and delete filters", () => {
    const star = makeStar()
    expect(makeCommunityStarReactionFilter(userPubkey)).toMatchObject({
      kinds: [REACTION],
      authors: [userPubkey],
      "#k": [String(COMMUNITY_DEFINITION_KIND)],
    })
    expect(makeCommunityStarDeleteFilter(userPubkey, [star])).toMatchObject({"#e": [star.id]})
    expect(makeRecentCommunityStarDeleteFilter(userPubkey)).toMatchObject({
      "#k": [String(REACTION)],
    })
  })

  it("uses canonical definition naddr input values", () => {
    expect(makeExactCommunityInputValue(pointer)).toBe(pointer.naddr)
  })
})
