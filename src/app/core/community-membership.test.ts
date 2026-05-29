import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND, parseCommunityDefinition} from "./community"
import type {EffectiveCommunityReportState} from "./community-reports"
import {selectUserCommunityRefs} from "./community-membership"

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

const makeProfileList = ({
  id,
  pubkey,
  identifier,
  members = [],
}: {
  id: string
  pubkey: string
  identifier: string
  members?: string[]
}) =>
  makeEvent({
    id,
    pubkey,
    kind: PROFILE_LIST_KIND,
    tags: [["d", identifier], ...members.map(member => ["p", member])],
  })

const makePersonBanState = (pubkey: string): EffectiveCommunityReportState =>
  ({
    eventReports: [],
    personReports: [{targetPubkey: pubkey}],
  }) as unknown as EffectiveCommunityReportState

describe("community membership", () => {
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
