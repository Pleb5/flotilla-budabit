import {describe, expect, it} from "vitest"
import {BADGE_AWARD, BADGE_DEFINITION, BADGES, DELETE, type TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND, parseCommunityDefinition} from "./community"
import {
  PROFILE_BADGES_KIND,
  canCreateCommunityBadge,
  getAcceptedCommunityBadges,
  getCommunityBadgeImageUrl,
  getCommunityBadgeCreatorPubkeys,
  getPendingCommunityBadgeAwards,
  makeCommunityBadgeAwardDelete,
  makeCommunityBadgeAwardEvent,
  makeCommunityBadgeDefinitionEvent,
  makeProfileBadgeAcceptanceEvent,
  makeProfileBadgeRemovalEvent,
  parseCommunityBadgeAward,
  parseCommunityBadgeDefinition,
  parseProfileBadgePairs,
} from "./community-badges"

const communityPubkey = "a".repeat(64)
const moderatorPubkey = "b".repeat(64)
const bannedModeratorPubkey = "c".repeat(64)
const recipientPubkey = "d".repeat(64)
const outsiderPubkey = "e".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: communityPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeDefinition = () =>
  parseCommunityDefinition(
    makeEvent({
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: communityPubkey,
      tags: [
        ["content", "General"],
        ["k", "1111"],
        ["a", `${PROFILE_LIST_KIND}:${moderatorPubkey}:General`],
        ["a", `${PROFILE_LIST_KIND}:${bannedModeratorPubkey}:General`],
      ],
    }),
  )!

const makeBadgeDefinitionEvent = (overrides: Partial<TrustedEvent> = {}) =>
  makeEvent({
    id: "badge-definition",
    kind: BADGE_DEFINITION,
    pubkey: moderatorPubkey,
    tags: makeCommunityBadgeDefinitionEvent({
      communityPubkey,
      identifier: "helper",
      name: "Community helper",
      description: "Helped the community",
      image: "https://example.com/helper.png",
      imageDimensions: "1024x1024",
    }).tags,
    ...overrides,
  })

describe("community badges", () => {
  it("builds and parses community badge definitions", () => {
    const template = makeCommunityBadgeDefinitionEvent({
      communityPubkey,
      identifier: "helper",
      name: "Community helper",
      description: "Helped the community",
      image: "https://example.com/helper.png",
      imageDimensions: "1024x1024",
      thumbs: [{url: "https://example.com/helper-64.png", dimensions: "64x64"}],
    })
    const parsed = parseCommunityBadgeDefinition(
      makeEvent({kind: BADGE_DEFINITION, pubkey: moderatorPubkey, tags: template.tags}),
      communityPubkey,
    )!

    expect(template.kind).toBe(BADGE_DEFINITION)
    expect(template.tags).toContainEqual(["a", `${COMMUNITY_DEFINITION_KIND}:${communityPubkey}:`])
    expect(parsed).toMatchObject({
      pubkey: moderatorPubkey,
      identifier: "helper",
      name: "Community helper",
      description: "Helped the community",
      image: "https://example.com/helper.png",
      imageDimensions: "1024x1024",
      deprecated: false,
      communityPubkey,
    })
    expect(parsed.thumbs).toEqual([{url: "https://example.com/helper-64.png", dimensions: "64x64"}])
  })

  it("selects the smallest useful badge thumbnail", () => {
    expect(
      getCommunityBadgeImageUrl(
        {
          image: "https://example.com/full.png",
          thumbs: [
            {url: "https://example.com/16.png", dimensions: "16x16"},
            {url: "https://example.com/64.png", dimensions: "64x64"},
            {url: "https://example.com/256.png", dimensions: "256x256"},
          ],
        } as any,
        48,
      ),
    ).toBe("https://example.com/64.png")
    expect(
      getCommunityBadgeImageUrl({image: "https://example.com/full.png", thumbs: []} as any),
    ).toBe("https://example.com/full.png")
  })

  it("marks badge definitions as deprecated when retired", () => {
    const template = makeCommunityBadgeDefinitionEvent({
      communityPubkey,
      identifier: "helper",
      name: "Community helper",
      deprecated: true,
    })
    const parsed = parseCommunityBadgeDefinition(
      makeEvent({kind: BADGE_DEFINITION, pubkey: moderatorPubkey, tags: template.tags}),
      communityPubkey,
    )!

    expect(template.tags).toContainEqual(["deprecated"])
    expect(parsed.deprecated).toBe(true)
  })

  it("builds and parses badge award events", () => {
    const template = makeCommunityBadgeAwardEvent({
      definitionAddress: `${BADGE_DEFINITION}:${moderatorPubkey}:helper`,
      recipientPubkey,
    })
    const parsed = parseCommunityBadgeAward(makeEvent({kind: BADGE_AWARD, tags: template.tags}))!

    expect(template).toEqual({
      kind: BADGE_AWARD,
      content: "",
      tags: [
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:helper`],
        ["p", recipientPubkey],
      ],
    })
    expect(parsed.recipientPubkey).toBe(recipientPubkey)
  })

  it("rejects multi-recipient badge award events", () => {
    const parsed = parseCommunityBadgeAward(
      makeEvent({
        kind: BADGE_AWARD,
        tags: [
          ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:helper`],
          ["p", recipientPubkey],
          ["p", outsiderPubkey],
        ],
      }),
    )

    expect(parsed).toBeUndefined()
  })

  it("parses current and deprecated profile badge pairs", () => {
    const current = makeEvent({
      kind: PROFILE_BADGES_KIND,
      pubkey: recipientPubkey,
      tags: [
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:helper`],
        ["e", "award-id", "wss://relay.example.com"],
        ["e", "ignored"],
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:orphaned`],
      ],
    })
    const deprecated = makeEvent({
      kind: BADGES,
      pubkey: recipientPubkey,
      tags: [
        ["d", "profile_badges"],
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:helper`],
        ["e", "award-id"],
      ],
    })

    expect(parseProfileBadgePairs(current)).toEqual([
      {
        definitionAddress: `${BADGE_DEFINITION}:${moderatorPubkey}:helper`,
        definitionRelay: undefined,
        awardId: "award-id",
        awardRelay: "wss://relay.example.com",
      },
    ])
    expect(parseProfileBadgePairs(deprecated)).toHaveLength(1)
  })

  it("appends profile badge acceptance while preserving extra tags", () => {
    const current = makeEvent({
      kind: PROFILE_BADGES_KIND,
      pubkey: recipientPubkey,
      tags: [
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:existing`],
        ["e", "existing-award"],
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:set`],
      ],
    })
    const template = makeProfileBadgeAcceptanceEvent({
      currentEvent: current,
      pair: {
        definitionAddress: `${BADGE_DEFINITION}:${moderatorPubkey}:helper`,
        awardId: "award-id",
      },
    })

    expect(template.kind).toBe(PROFILE_BADGES_KIND)
    expect(template.tags).toEqual([
      ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:existing`],
      ["e", "existing-award"],
      ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:helper`],
      ["e", "award-id"],
      ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:set`],
    ])
  })

  it("removes profile badge acceptance while preserving extra tags", () => {
    const current = makeEvent({
      kind: PROFILE_BADGES_KIND,
      pubkey: recipientPubkey,
      tags: [
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:existing`],
        ["e", "existing-award"],
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:helper`],
        ["e", "award-id"],
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:set`],
      ],
    })
    const template = makeProfileBadgeRemovalEvent({
      currentEvent: current,
      pair: {
        definitionAddress: `${BADGE_DEFINITION}:${moderatorPubkey}:helper`,
        awardId: "award-id",
      },
    })

    expect(template.tags).toEqual([
      ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:existing`],
      ["e", "existing-award"],
      ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:set`],
    ])
  })

  it("limits badge creators to admin and active non-banned moderators", () => {
    const definition = makeDefinition()
    const reportState = {
      eventReports: [],
      personReports: [
        {
          event: makeEvent({pubkey: communityPubkey}),
          target: "person" as const,
          communityAddress: `${COMMUNITY_DEFINITION_KIND}:${communityPubkey}:`,
          communityPubkey,
          targetPubkey: bannedModeratorPubkey,
          reporterPubkey: communityPubkey,
          adminAuthored: true,
        },
      ],
    }

    expect(getCommunityBadgeCreatorPubkeys({definition, reportState})).toEqual([
      communityPubkey,
      moderatorPubkey,
    ])
    expect(canCreateCommunityBadge({definition, pubkey: moderatorPubkey, reportState})).toBe(true)
    expect(canCreateCommunityBadge({definition, pubkey: bannedModeratorPubkey, reportState})).toBe(
      false,
    )
    expect(canCreateCommunityBadge({definition, pubkey: outsiderPubkey, reportState})).toBe(false)
  })

  it("requires trusted issuer, recipient award, and profile acceptance for display", () => {
    const definition = makeDefinition()
    const badgeDefinition = makeBadgeDefinitionEvent()
    const award = makeEvent({
      id: "award-id",
      kind: BADGE_AWARD,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeAwardEvent({
        definitionAddress: `${BADGE_DEFINITION}:${moderatorPubkey}:helper`,
        recipientPubkey,
      }).tags,
    })
    const profileBadges = makeEvent({
      id: "profile-badges",
      kind: PROFILE_BADGES_KIND,
      pubkey: recipientPubkey,
      tags: [
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:helper`],
        ["e", "award-id"],
      ],
    })

    expect(
      getAcceptedCommunityBadges({
        definition,
        badgeDefinitionEvents: [badgeDefinition],
        badgeAwardEvents: [award],
        profileBadgeEvents: [profileBadges],
        profilePubkey: recipientPubkey,
      }),
    ).toHaveLength(1)
    expect(
      getAcceptedCommunityBadges({
        definition,
        badgeDefinitionEvents: [badgeDefinition],
        badgeAwardEvents: [award],
        profileBadgeEvents: [],
        profilePubkey: recipientPubkey,
      }),
    ).toHaveLength(0)
  })

  it("hides accepted badges after award revocation or definition retirement", () => {
    const definition = makeDefinition()
    const badgeDefinition = makeBadgeDefinitionEvent()
    const retiredDefinition = makeBadgeDefinitionEvent({
      id: "badge-definition-retired",
      created_at: 2,
      tags: makeCommunityBadgeDefinitionEvent({
        communityPubkey,
        identifier: "helper",
        name: "Community helper",
        deprecated: true,
      }).tags,
    })
    const award = makeEvent({
      id: "award-id",
      kind: BADGE_AWARD,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeAwardEvent({
        definitionAddress: `${BADGE_DEFINITION}:${moderatorPubkey}:helper`,
        recipientPubkey,
      }).tags,
    })
    const deleteAward = makeEvent({
      id: "delete-award",
      kind: DELETE,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeAwardDelete({awardId: award.id}).tags,
    })
    const profileBadges = makeEvent({
      id: "profile-badges",
      kind: PROFILE_BADGES_KIND,
      pubkey: recipientPubkey,
      tags: [
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:helper`],
        ["e", "award-id"],
      ],
    })

    expect(
      getAcceptedCommunityBadges({
        definition,
        badgeDefinitionEvents: [badgeDefinition],
        badgeAwardEvents: [award],
        badgeAwardDeleteEvents: [deleteAward],
        profileBadgeEvents: [profileBadges],
        profilePubkey: recipientPubkey,
      }),
    ).toHaveLength(0)
    expect(
      getAcceptedCommunityBadges({
        definition,
        badgeDefinitionEvents: [badgeDefinition, retiredDefinition],
        badgeAwardEvents: [award],
        profileBadgeEvents: [profileBadges],
        profilePubkey: recipientPubkey,
      }),
    ).toHaveLength(0)
  })

  it("returns pending awards until the recipient accepts them", () => {
    const definition = makeDefinition()
    const badgeDefinition = makeBadgeDefinitionEvent()
    const award = makeEvent({
      id: "award-id",
      kind: BADGE_AWARD,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeAwardEvent({
        definitionAddress: `${BADGE_DEFINITION}:${moderatorPubkey}:helper`,
        recipientPubkey,
      }).tags,
    })

    expect(
      getPendingCommunityBadgeAwards({
        definition,
        badgeDefinitionEvents: [badgeDefinition],
        badgeAwardEvents: [award],
        profileBadgeEvents: [],
        profilePubkey: recipientPubkey,
      }).map(item => item.award.event.id),
    ).toEqual(["award-id"])
  })
})
