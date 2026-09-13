import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {BADGE_AWARD, BADGE_DEFINITION, BADGES, DELETE, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  makeCommunityProfileListIdentifier,
  makeCommunityPointer,
  parseCommunityDefinition,
} from "./community"
import {
  PROFILE_BADGES_KIND,
  canCreateCommunityBadge,
  getAcceptedCommunityBadges,
  getCommunityBadgeAward,
  getCommunityBadgeImageUrl,
  getCommunityBadgeCreatorPubkeys,
  getPendingCommunityBadgeAwards,
  isCommunityBadgeAwardDeleted,
  makeCommunityBadgeAwardDelete,
  makeCommunityBadgeAwardEvent,
  makeCommunityBadgeDefinitionEvent,
  makeCommunityBadgeIdentifier,
  makeProfileBadgeAcceptanceEvent,
  makeProfileBadgeRemovalEvent,
  parseCommunityBadgeAward,
  parseCommunityBadgeDefinition,
  parseProfileBadgePairs,
  selectCommunityBadgeDefinitions,
} from "./community-badges"

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const ownerPubkey = key(1)
const communityId = key(2)
const moderatorPubkey = key(3)
const bannedModeratorPubkey = key(4)
const recipientPubkey = key(5)
const outsiderPubkey = key(6)
const community = makeCommunityPointer({ownerPubkey, communityId})!
const badgeIdentifier = `budabit-${communityId}-helper`
const badgeAddress = `${BADGE_DEFINITION}:${moderatorPubkey}:${badgeIdentifier}`
const moderatorListIdentifier = makeCommunityProfileListIdentifier(communityId, "moderator-list")!
const bannedListIdentifier = makeCommunityProfileListIdentifier(communityId, "banned-list")!

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: ownerPubkey,
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
      pubkey: ownerPubkey,
      tags: buildCommunityDefinition({
        communityId,
        name: "Community",
        relays: ["wss://relay.example.com"],
        sections: [
          {
            name: "General",
            kinds: [{kind: 1111}],
            profileLists: [
              {address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:${moderatorListIdentifier}`},
              {address: `${PROFILE_LIST_KIND}:${bannedModeratorPubkey}:${bannedListIdentifier}`},
            ],
          },
        ],
      }).tags,
    }),
  )!

const makeBadgeDefinitionEvent = (overrides: Partial<TrustedEvent> = {}) =>
  makeEvent({
    id: "badge-definition",
    kind: BADGE_DEFINITION,
    pubkey: moderatorPubkey,
    tags: makeCommunityBadgeDefinitionEvent({
      community,
      identifier: badgeIdentifier,
      name: "Community helper",
      description: "Helped the community",
      image: "https://example.com/helper.png",
      imageDimensions: "1024x1024",
    }).tags,
    ...overrides,
  })

const makeProfileListEvent = (pubkey: string, tags: string[][] = []) =>
  makeEvent({
    id: `profile-list-${pubkey[0]}`,
    kind: PROFILE_LIST_KIND,
    pubkey,
    tags: [
      ["d", pubkey === moderatorPubkey ? moderatorListIdentifier : bannedListIdentifier],
      ...tags,
    ],
  })

describe("community badges", () => {
  it("builds and parses community badge definitions", () => {
    const template = makeCommunityBadgeDefinitionEvent({
      community,
      identifier: badgeIdentifier,
      name: "Community helper",
      description: "Helped the community",
      image: "https://example.com/helper.png",
      imageDimensions: "1024x1024",
      thumbs: [{url: "https://example.com/helper-64.png", dimensions: "64x64"}],
    })
    const parsed = parseCommunityBadgeDefinition(
      makeEvent({kind: BADGE_DEFINITION, pubkey: moderatorPubkey, tags: template.tags}),
      community,
    )!

    expect(template.kind).toBe(BADGE_DEFINITION)
    expect(template.tags).toContainEqual(["a", community.address, "", "community"])
    expect(parsed).toMatchObject({
      pubkey: moderatorPubkey,
      identifier: badgeIdentifier,
      name: "Community helper",
      description: "Helped the community",
      image: "https://example.com/helper.png",
      imageDimensions: "1024x1024",
      deprecated: false,
      community,
    })
    expect(parsed.thumbs).toEqual([{url: "https://example.com/helper-64.png", dimensions: "64x64"}])
  })

  it("rejects the same community ID on a different owner branch", () => {
    const sameIdBranch = makeCommunityPointer({ownerPubkey: key(7), communityId})!
    const definition = makeEvent({
      kind: BADGE_DEFINITION,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeDefinitionEvent({community, identifier: "helper"}).tags,
    })
    const award = makeEvent({
      id: "branch-award",
      kind: BADGE_AWARD,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeAwardEvent({
        community,
        definitionAddress: badgeAddress,
        recipientPubkey,
      }).tags,
    })

    expect(parseCommunityBadgeDefinition(definition, sameIdBranch)).toBeUndefined()
    expect(parseCommunityBadgeAward(award, sameIdBranch)).toBeUndefined()
    // A same-author deletion of this exact award id retracts it regardless of
    // the same-ID branch the deleter had selected; the award pins the branch.
    expect(
      isCommunityBadgeAwardDeleted(award, [
        makeEvent({
          kind: DELETE,
          pubkey: moderatorPubkey,
          tags: makeCommunityBadgeAwardDelete({
            community: sameIdBranch,
            awardId: award.id,
          }).tags,
        }),
      ]),
    ).toBe(true)
    // A legacy deletion that still names another branch does not.
    expect(
      isCommunityBadgeAwardDeleted(award, [
        makeEvent({
          kind: DELETE,
          pubkey: moderatorPubkey,
          tags: [
            ["h", communityId],
            ["a", sameIdBranch.address, "", "community"],
            ["e", award.id],
            ["k", String(BADGE_AWARD)],
          ],
        }),
      ]),
    ).toBe(false)
  })

  it("isolates badge definitions and awards between same-owner sibling communities", () => {
    const sibling = makeCommunityPointer({ownerPubkey, communityId: key(7)})!
    const definition = makeDefinition()
    const siblingDefinition = parseCommunityDefinition(
      makeEvent({
        id: "sibling-community-definition",
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: ownerPubkey,
        tags: buildCommunityDefinition({
          communityId: sibling.communityId,
          name: "Sibling community",
          relays: ["wss://relay.example.com"],
          sections: [
            {
              name: "General",
              kinds: [{kind: 1111}],
              profileLists: [
                {
                  address: `${PROFILE_LIST_KIND}:${moderatorPubkey}:${sibling.communityId}-moderator-list`,
                },
              ],
            },
          ],
        }).tags,
      }),
    )!
    const firstBadge = makeBadgeDefinitionEvent()
    const siblingBadge = makeEvent({
      id: "sibling-badge-definition",
      kind: BADGE_DEFINITION,
      pubkey: ownerPubkey,
      tags: makeCommunityBadgeDefinitionEvent({
        community: sibling,
        identifier: "helper",
        name: "Sibling helper",
      }).tags,
    })
    const siblingBadgeAddress = `${BADGE_DEFINITION}:${ownerPubkey}:${makeCommunityBadgeIdentifier(sibling, "helper")}`
    const siblingAward = makeEvent({
      id: "sibling-award",
      kind: BADGE_AWARD,
      pubkey: ownerPubkey,
      tags: makeCommunityBadgeAwardEvent({
        community: sibling,
        definitionAddress: siblingBadgeAddress,
        recipientPubkey,
      }).tags,
    })

    expect(
      selectCommunityBadgeDefinitions({
        definition,
        badgeDefinitionEvents: [firstBadge, siblingBadge],
        profileListEvents: [makeProfileListEvent(moderatorPubkey)],
      }).map(item => item.event.id),
    ).toEqual([firstBadge.id])
    expect(
      selectCommunityBadgeDefinitions({
        definition: siblingDefinition,
        badgeDefinitionEvents: [firstBadge, siblingBadge],
      }).map(item => item.event.id),
    ).toEqual([siblingBadge.id])
    expect(parseCommunityBadgeAward(siblingAward, community)).toBeUndefined()
    expect(parseCommunityBadgeAward(siblingAward, sibling)?.definitionAddress).toBe(
      siblingBadgeAddress,
    )
  })

  it("uses the full community ID in badge child identifiers", () => {
    const other = makeCommunityPointer({ownerPubkey, communityId: key(8)})!

    expect(makeCommunityBadgeIdentifier(community, "helper")).toBe(badgeIdentifier)
    expect(makeCommunityBadgeIdentifier(other, "helper")).not.toBe(badgeIdentifier)
    expect(makeCommunityBadgeIdentifier(other, "helper")).toContain(other.communityId)
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
      community,
      identifier: "helper",
      name: "Community helper",
      deprecated: true,
    })
    const parsed = parseCommunityBadgeDefinition(
      makeEvent({kind: BADGE_DEFINITION, pubkey: moderatorPubkey, tags: template.tags}),
      community,
    )!

    expect(template.tags).toContainEqual(["deprecated"])
    expect(parsed.deprecated).toBe(true)
  })

  it("builds and parses badge award events", () => {
    const template = makeCommunityBadgeAwardEvent({
      community,
      definitionAddress: badgeAddress,
      recipientPubkey,
    })
    const parsed = parseCommunityBadgeAward(makeEvent({kind: BADGE_AWARD, tags: template.tags}))!

    expect(template).toEqual({
      kind: BADGE_AWARD,
      content: "",
      tags: [
        ["h", communityId],
        ["a", community.address, "", "community"],
        ["a", badgeAddress, "", "badge"],
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
          ["h", communityId],
          ["a", community.address, "", "community"],
          ["a", badgeAddress, "", "badge"],
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
        ["a", badgeAddress, "", "badge"],
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
        ["a", badgeAddress, "", "badge"],
        ["e", "award-id"],
      ],
    })

    expect(parseProfileBadgePairs(current)).toEqual([
      {
        definitionAddress: badgeAddress,
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
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:existing`, "", "badge"],
        ["e", "existing-award"],
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:set`],
      ],
    })
    const template = makeProfileBadgeAcceptanceEvent({
      currentEvent: current,
      pair: {
        definitionAddress: badgeAddress,
        awardId: "award-id",
      },
    })

    expect(template.kind).toBe(PROFILE_BADGES_KIND)
    expect(template.tags).toEqual([
      ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:existing`, "", "badge"],
      ["e", "existing-award"],
      ["a", badgeAddress, "", "badge"],
      ["e", "award-id"],
      ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:set`],
    ])
  })

  it("removes profile badge acceptance while preserving extra tags", () => {
    const current = makeEvent({
      kind: PROFILE_BADGES_KIND,
      pubkey: recipientPubkey,
      tags: [
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:existing`, "", "badge"],
        ["e", "existing-award"],
        ["a", badgeAddress, "", "badge"],
        ["e", "award-id"],
        ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:set`],
      ],
    })
    const template = makeProfileBadgeRemovalEvent({
      currentEvent: current,
      pair: {
        definitionAddress: badgeAddress,
        awardId: "award-id",
      },
    })

    expect(template.tags).toEqual([
      ["a", `${BADGE_DEFINITION}:${moderatorPubkey}:existing`, "", "badge"],
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
          event: makeEvent({pubkey: ownerPubkey}),
          target: "person" as const,
          community,
          communityAddress: community.address,
          communityId,
          ownerPubkey,
          targetPubkey: bannedModeratorPubkey,
          reporterPubkey: ownerPubkey,
          adminAuthored: true,
        },
      ],
    }

    expect(getCommunityBadgeCreatorPubkeys({definition, reportState})).toEqual([ownerPubkey])
    expect(canCreateCommunityBadge({definition, pubkey: moderatorPubkey, reportState})).toBe(false)
    expect(canCreateCommunityBadge({definition, pubkey: bannedModeratorPubkey, reportState})).toBe(
      false,
    )
    expect(canCreateCommunityBadge({definition, pubkey: outsiderPubkey, reportState})).toBe(false)

    const activeProfileListEvents = [
      makeProfileListEvent(moderatorPubkey),
      makeProfileListEvent(bannedModeratorPubkey),
    ]

    expect(
      getCommunityBadgeCreatorPubkeys({
        definition,
        profileListEvents: activeProfileListEvents,
        reportState,
      }),
    ).toEqual([ownerPubkey, moderatorPubkey])
    expect(
      canCreateCommunityBadge({
        definition,
        pubkey: moderatorPubkey,
        profileListEvents: activeProfileListEvents,
        reportState,
      }),
    ).toBe(true)
    expect(
      canCreateCommunityBadge({
        definition,
        pubkey: moderatorPubkey,
        profileListEvents: [],
        reportState,
      }),
    ).toBe(false)
    expect(
      getCommunityBadgeCreatorPubkeys({
        definition,
        profileListEvents: [makeProfileListEvent(moderatorPubkey, [["status", "declined"]])],
        reportState,
      }),
    ).toEqual([ownerPubkey])
    expect(
      getCommunityBadgeCreatorPubkeys({
        definition,
        profileListEvents: [
          makeProfileListEvent(moderatorPubkey),
          makeEvent({
            kind: DELETE,
            pubkey: moderatorPubkey,
            tags: [["a", `${PROFILE_LIST_KIND}:${moderatorPubkey}:${moderatorListIdentifier}`]],
          }),
        ],
        reportState,
      }),
    ).toEqual([ownerPubkey])
  })

  it("requires trusted issuer, recipient award, and profile acceptance for display", () => {
    const definition = makeDefinition()
    const badgeDefinition = makeBadgeDefinitionEvent()
    const award = makeEvent({
      id: "award-id",
      kind: BADGE_AWARD,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeAwardEvent({
        community,
        definitionAddress: badgeAddress,
        recipientPubkey,
      }).tags,
    })
    const profileBadges = makeEvent({
      id: "profile-badges",
      kind: PROFILE_BADGES_KIND,
      pubkey: recipientPubkey,
      tags: [
        ["a", badgeAddress, "", "badge"],
        ["e", "award-id"],
      ],
    })

    expect(
      getAcceptedCommunityBadges({
        definition,
        badgeDefinitionEvents: [badgeDefinition],
        profileListEvents: [makeProfileListEvent(moderatorPubkey)],
        badgeAwardEvents: [award],
        profileBadgeEvents: [profileBadges],
        profilePubkey: recipientPubkey,
      }),
    ).toHaveLength(1)
    expect(
      getAcceptedCommunityBadges({
        definition,
        badgeDefinitionEvents: [badgeDefinition],
        profileListEvents: [],
        badgeAwardEvents: [award],
        profileBadgeEvents: [profileBadges],
        profilePubkey: recipientPubkey,
      }),
    ).toHaveLength(0)
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
        community,
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
        community,
        definitionAddress: badgeAddress,
        recipientPubkey,
      }).tags,
    })
    const deleteAward = makeEvent({
      id: "delete-award",
      kind: DELETE,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeAwardDelete({community, awardId: award.id}).tags,
    })
    const profileBadges = makeEvent({
      id: "profile-badges",
      kind: PROFILE_BADGES_KIND,
      pubkey: recipientPubkey,
      tags: [
        ["a", badgeAddress, "", "badge"],
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
        community,
        definitionAddress: badgeAddress,
        recipientPubkey,
      }).tags,
    })

    expect(
      getPendingCommunityBadgeAwards({
        definition,
        badgeDefinitionEvents: [badgeDefinition],
        profileListEvents: [makeProfileListEvent(moderatorPubkey)],
        badgeAwardEvents: [award],
        profileBadgeEvents: [],
        profilePubkey: recipientPubkey,
      }).map(item => item.award.event.id),
    ).toEqual(["award-id"])
  })

  it("finds an active existing award for a badge and recipient", () => {
    const badgeDefinition = parseCommunityBadgeDefinition(makeBadgeDefinitionEvent(), community)!
    const olderAward = makeEvent({
      id: "older-award",
      kind: BADGE_AWARD,
      created_at: 1,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeAwardEvent({
        community,
        definitionAddress: badgeAddress,
        recipientPubkey,
      }).tags,
    })
    const newerAward = makeEvent({
      id: "newer-award",
      kind: BADGE_AWARD,
      created_at: 2,
      pubkey: moderatorPubkey,
      tags: makeCommunityBadgeAwardEvent({
        community,
        definitionAddress: badgeAddress,
        recipientPubkey,
      }).tags,
    })

    expect(
      getCommunityBadgeAward({
        definition: badgeDefinition,
        badgeAwardEvents: [olderAward, newerAward],
        profilePubkey: recipientPubkey,
      })?.event.id,
    ).toBe("newer-award")

    expect(
      getCommunityBadgeAward({
        definition: badgeDefinition,
        badgeAwardEvents: [olderAward, newerAward],
        badgeAwardDeleteEvents: [
          makeEvent({
            id: "delete-newer-award",
            kind: DELETE,
            pubkey: moderatorPubkey,
            tags: makeCommunityBadgeAwardDelete({community, awardId: newerAward.id}).tags,
          }),
        ],
        profilePubkey: recipientPubkey,
      })?.event.id,
    ).toBe("older-award")
  })
})
