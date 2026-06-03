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
    expect(members.map(member => member.grantCount)).toEqual([0, 2, 1, 3, 2])
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
      {pubkey: moderatorCommunityPubkey, roles: ["moderator"]},
      {pubkey: memberCommunityPubkey, roles: ["member"]},
    ])
    expect(refs.map(ref => ref.writableSections)).toEqual([["General"], ["Moderated"], ["Members"]])
  })

  it("requires loaded profile-list evidence for moderator refs", () => {
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
    ).toEqual([])
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
