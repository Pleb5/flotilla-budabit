import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  COMMUNITY_SECTION_THREADS,
  PROFILE_LIST_KIND,
  parseCommunityDefinition,
} from "./community"
import type {EffectiveCommunityReportState} from "./community-reports"
import {selectCommunityMemberList, selectUserCommunityRefs} from "./community-membership"

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "a".repeat(64),
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
  sectionName = "General",
  profileListAddress,
  relays = ["wss://relay.example.com"],
}: {
  id: string
  pubkey: string
  sectionName?: string
  profileListAddress?: string
  relays?: string[]
}) =>
  parseCommunityDefinition(
    makeEvent({
      id,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: [
        ...relays.map(relay => ["r", relay]),
        ["content", sectionName],
        ["k", "1111"],
        ...(profileListAddress ? [["a", profileListAddress]] : []),
      ],
    }),
  )!

const makeMultiSectionDefinition = ({
  id,
  pubkey,
  sections,
}: {
  id: string
  pubkey: string
  sections: Array<{name: string; profileListAddresses: string[]}>
}) =>
  parseCommunityDefinition(
    makeEvent({
      id,
      pubkey,
      kind: COMMUNITY_DEFINITION_KIND,
      tags: sections.flatMap(section => [
        ["content", section.name],
        ["k", "1111"],
        ...section.profileListAddresses.map(address => ["a", address]),
      ]),
    }),
  )!

const makeProfileList = ({
  id,
  pubkey,
  identifier,
  members = [],
  createdAt = 1,
}: {
  id: string
  pubkey: string
  identifier: string
  members?: string[]
  createdAt?: number
}) =>
  makeEvent({
    id,
    pubkey,
    created_at: createdAt,
    kind: PROFILE_LIST_KIND,
    tags: [["d", identifier], ...members.map(member => ["p", member])],
  })

const makePersonBanState = (pubkey: string): EffectiveCommunityReportState =>
  ({
    eventReports: [],
    personReports: [{targetPubkey: pubkey}],
  }) as unknown as EffectiveCommunityReportState

describe("community membership", () => {
  it("selects sorted non-banned owner, moderator, and member list items", () => {
    const ownerPubkey = "a".repeat(64)
    const moderatorManyPubkey = "b".repeat(64)
    const moderatorFewPubkey = "c".repeat(64)
    const memberManyPubkey = "d".repeat(64)
    const memberFewPubkey = "e".repeat(64)
    const bannedPubkey = "f".repeat(64)
    const removedPubkey = "9".repeat(64)
    const generalAddress = `${PROFILE_LIST_KIND}:${moderatorManyPubkey}:General`
    const generalExtraAddress = `${PROFILE_LIST_KIND}:${moderatorFewPubkey}:GeneralExtra`
    const threadsAddress = `${PROFILE_LIST_KIND}:${moderatorManyPubkey}:${COMMUNITY_SECTION_THREADS}`
    const reposAddress = `${PROFILE_LIST_KIND}:${moderatorFewPubkey}:Repos`
    const definition = makeMultiSectionDefinition({
      id: "community-definition",
      pubkey: ownerPubkey,
      sections: [
        {name: "General", profileListAddresses: [generalAddress, generalExtraAddress]},
        {name: COMMUNITY_SECTION_THREADS, profileListAddresses: [threadsAddress]},
        {name: "Repos", profileListAddresses: [reposAddress]},
      ],
    })

    const members = selectCommunityMemberList({
      definition,
      profileListEvents: [
        makeProfileList({
          id: "old-general",
          pubkey: moderatorManyPubkey,
          identifier: "General",
          members: [removedPubkey],
          createdAt: 1,
        }),
        makeProfileList({
          id: "new-general",
          pubkey: moderatorManyPubkey,
          identifier: "General",
          members: [memberManyPubkey, memberFewPubkey, bannedPubkey],
          createdAt: 2,
        }),
        makeProfileList({
          id: "general-extra",
          pubkey: moderatorFewPubkey,
          identifier: "GeneralExtra",
          members: [memberManyPubkey],
        }),
        makeProfileList({
          id: "threads",
          pubkey: moderatorManyPubkey,
          identifier: COMMUNITY_SECTION_THREADS,
          members: [memberManyPubkey, moderatorManyPubkey],
        }),
        makeProfileList({
          id: "repos",
          pubkey: moderatorFewPubkey,
          identifier: "Repos",
          members: [memberManyPubkey, memberFewPubkey, moderatorManyPubkey, moderatorFewPubkey],
        }),
      ],
      reportState: makePersonBanState(bannedPubkey),
    })

    expect(members.map(member => member.pubkey)).toEqual([
      ownerPubkey,
      moderatorManyPubkey,
      moderatorFewPubkey,
      memberManyPubkey,
      memberFewPubkey,
    ])
    expect(members.map(member => member.grantCount)).toEqual([0, 3, 3, 3, 2])
    expect(members.map(member => member.moderatorSectionCount)).toEqual([0, 2, 2, 0, 0])
    expect(members[0]).toMatchObject({isOwner: true, isAdmin: true})
    expect(members[1]).toMatchObject({isModerator: true})
    expect(members[3].sectionGrants.map(grant => grant.displayName)).toEqual([
      "General",
      "Repos",
      COMMUNITY_SECTION_THREADS,
    ])
    expect(members[3].sectionGrants[0].profileListAddresses).toEqual([
      generalAddress,
      generalExtraAddress,
    ])
    expect(members.some(member => member.pubkey === bannedPubkey)).toBe(false)
    expect(members.some(member => member.pubkey === removedPubkey)).toBe(false)
  })

  it("selects admin, moderator, and member community refs", () => {
    const userPubkey = "b".repeat(64)
    const moderatorCommunityPubkey = "d".repeat(64)
    const memberCommunityPubkey = "e".repeat(64)
    const memberListOwner = "f".repeat(64)
    const moderatorListAddress = `${PROFILE_LIST_KIND}:${userPubkey}:Moderators`
    const memberListAddress = `${PROFILE_LIST_KIND}:${memberListOwner}:Members`

    const refs = selectUserCommunityRefs({
      author: userPubkey,
      definitions: [
        makeDefinition({id: "admin-definition", pubkey: userPubkey}),
        makeDefinition({
          id: "moderator-definition",
          pubkey: moderatorCommunityPubkey,
          sectionName: "Moderated",
          profileListAddress: moderatorListAddress,
        }),
        makeDefinition({
          id: "member-definition",
          pubkey: memberCommunityPubkey,
          sectionName: "Members",
          profileListAddress: memberListAddress,
        }),
      ],
      profileListEvents: [
        makeProfileList({id: "moderator-list", pubkey: userPubkey, identifier: "Moderators"}),
        makeProfileList({
          id: "member-list",
          pubkey: memberListOwner,
          identifier: "Members",
          members: [userPubkey],
        }),
      ],
    })

    expect(refs.map(ref => ({pubkey: ref.communityPubkey, roles: ref.roles}))).toEqual([
      {pubkey: userPubkey, roles: ["admin"]},
      {pubkey: moderatorCommunityPubkey, roles: ["moderator", "member"]},
      {pubkey: memberCommunityPubkey, roles: ["member"]},
    ])
    expect(refs.map(ref => ref.writableSections)).toEqual([["General"], ["Moderated"], ["Members"]])
  })

  it("uses stored section names for member grant display", () => {
    const ownerPubkey = "a".repeat(64)
    const moderatorPubkey = "b".repeat(64)
    const memberPubkey = "c".repeat(64)
    const definition = parseCommunityDefinition(
      makeEvent({
        id: "goals-community-definition",
        pubkey: ownerPubkey,
        kind: COMMUNITY_DEFINITION_KIND,
        tags: [
          ["content", "Goals"],
          ["k", "9041"],
          ["a", `${PROFILE_LIST_KIND}:${moderatorPubkey}:Goals`],
        ],
      }),
    )!

    const members = selectCommunityMemberList({
      definition,
      profileListEvents: [
        makeProfileList({
          id: "goals-list",
          pubkey: moderatorPubkey,
          identifier: "Goals",
          members: [memberPubkey],
        }),
      ],
    })
    const member = members.find(item => item.pubkey === memberPubkey)

    expect(member?.sectionGrants.map(section => section.displayName)).toEqual(["Goals"])
  })

  it("treats missing moderator profile-list evidence as member access only", () => {
    const userPubkey = "b".repeat(64)
    const communityPubkey = "d".repeat(64)

    expect(
      selectUserCommunityRefs({
        author: userPubkey,
        definitions: [
          makeDefinition({
            id: "moderator-definition",
            pubkey: communityPubkey,
            profileListAddress: `${PROFILE_LIST_KIND}:${userPubkey}:General`,
          }),
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        communityPubkey,
        roles: ["member"],
        writableSections: ["General"],
      }),
    ])
  })

  it("marks missing moderator profile-list refs as pending moderation invites", () => {
    const userPubkey = "b".repeat(64)
    const communityPubkey = "d".repeat(64)
    const definition = makeDefinition({
      id: "moderator-definition",
      pubkey: communityPubkey,
      profileListAddress: `${PROFILE_LIST_KIND}:${userPubkey}:General`,
    })

    const members = selectCommunityMemberList({definition})
    const pendingModerator = members.find(member => member.pubkey === userPubkey)

    expect(members.map(member => member.pubkey)).toEqual([communityPubkey, userPubkey])
    expect(pendingModerator).toMatchObject({
      isModerator: false,
      isPendingModerator: true,
      moderatorSectionCount: 0,
      pendingModeratorSectionCount: 1,
      grantCount: 1,
    })
    expect(pendingModerator?.pendingModeratorSections.map(section => section.displayName)).toEqual([
      "General",
    ])
    expect(pendingModerator?.sectionGrants.map(section => section.displayName)).toEqual(["General"])
  })

  it("marks existing empty moderator profile-list refs as active moderators", () => {
    const userPubkey = "b".repeat(64)
    const communityPubkey = "d".repeat(64)
    const definition = makeDefinition({
      id: "moderator-definition",
      pubkey: communityPubkey,
      profileListAddress: `${PROFILE_LIST_KIND}:${userPubkey}:General`,
    })

    const members = selectCommunityMemberList({
      definition,
      profileListEvents: [
        makeProfileList({id: "moderator-list", pubkey: userPubkey, identifier: "General"}),
      ],
    })
    const moderator = members.find(member => member.pubkey === userPubkey)

    expect(moderator).toMatchObject({
      isModerator: true,
      isPendingModerator: false,
      moderatorSectionCount: 1,
      pendingModeratorSectionCount: 0,
      grantCount: 1,
    })
    expect(moderator?.sectionGrants.map(section => section.displayName)).toEqual(["General"])
  })

  it("treats declined moderator refs as member access only", () => {
    const userPubkey = "b".repeat(64)
    const communityPubkey = "d".repeat(64)
    const definition = makeDefinition({
      id: "moderator-definition",
      pubkey: communityPubkey,
      profileListAddress: `${PROFILE_LIST_KIND}:${userPubkey}:General`,
    })
    const declinedList = makeProfileList({
      id: "declined-list",
      pubkey: userPubkey,
      identifier: "General",
    })
    declinedList.tags.push(["status", "declined"])

    expect(
      selectUserCommunityRefs({
        author: userPubkey,
        definitions: [definition],
        profileListEvents: [declinedList],
      }),
    ).toEqual([
      expect.objectContaining({
        communityPubkey,
        roles: ["member"],
        writableSections: ["General"],
      }),
    ])
    expect(selectCommunityMemberList({definition, profileListEvents: [declinedList]})).toEqual([
      expect.objectContaining({pubkey: communityPubkey, isOwner: true}),
      expect.objectContaining({
        pubkey: userPubkey,
        isModerator: false,
        isPendingModerator: false,
        grantCount: 1,
      }),
    ])
  })

  it("excludes person-banned non-admin refs but keeps admin refs", () => {
    const userPubkey = "b".repeat(64)
    const memberCommunityPubkey = "d".repeat(64)
    const memberListOwner = "f".repeat(64)

    const refs = selectUserCommunityRefs({
      author: userPubkey,
      definitions: [
        makeDefinition({id: "admin-definition", pubkey: userPubkey}),
        makeDefinition({
          id: "member-definition",
          pubkey: memberCommunityPubkey,
          profileListAddress: `${PROFILE_LIST_KIND}:${memberListOwner}:General`,
        }),
      ],
      profileListEvents: [
        makeProfileList({
          id: "member-list",
          pubkey: memberListOwner,
          identifier: "General",
          members: [userPubkey],
        }),
      ],
      reportStates: new Map([
        [userPubkey, makePersonBanState(userPubkey)],
        [memberCommunityPubkey, makePersonBanState(userPubkey)],
      ]),
    })

    expect(refs.map(ref => ref.communityPubkey)).toEqual([userPubkey])
  })

  it("returns relay hints only for eligible active community refs", () => {
    const userPubkey = "b".repeat(64)
    const memberCommunityPubkey = "d".repeat(64)
    const bannedCommunityPubkey = "e".repeat(64)
    const unrelatedCommunityPubkey = "f".repeat(64)
    const memberListOwner = "7".repeat(64)
    const bannedListOwner = "8".repeat(64)

    const refs = selectUserCommunityRefs({
      author: userPubkey,
      definitions: [
        makeDefinition({
          id: "admin-definition",
          pubkey: userPubkey,
          relays: ["wss://admin-relay.example.com", "bad-relay"],
        }),
        makeDefinition({
          id: "member-definition",
          pubkey: memberCommunityPubkey,
          profileListAddress: `${PROFILE_LIST_KIND}:${memberListOwner}:General`,
          relays: ["wss://member-relay.example.com", "wss://member-relay.example.com/"],
        }),
        makeDefinition({
          id: "banned-definition",
          pubkey: bannedCommunityPubkey,
          profileListAddress: `${PROFILE_LIST_KIND}:${bannedListOwner}:General`,
          relays: ["wss://banned-relay.example.com"],
        }),
        makeDefinition({
          id: "unrelated-definition",
          pubkey: unrelatedCommunityPubkey,
          relays: ["wss://unrelated-relay.example.com"],
        }),
      ],
      profileListEvents: [
        makeProfileList({
          id: "member-list",
          pubkey: memberListOwner,
          identifier: "General",
          members: [userPubkey],
        }),
        makeProfileList({
          id: "banned-list",
          pubkey: bannedListOwner,
          identifier: "General",
          members: [userPubkey],
        }),
      ],
      reportStates: new Map([[bannedCommunityPubkey, makePersonBanState(userPubkey)]]),
    })

    expect(refs.map(ref => ({pubkey: ref.communityPubkey, relayHints: ref.relayHints}))).toEqual([
      {pubkey: userPubkey, relayHints: ["wss://admin-relay.example.com/"]},
      {pubkey: memberCommunityPubkey, relayHints: ["wss://member-relay.example.com/"]},
    ])
  })
})
