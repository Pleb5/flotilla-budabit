import {describe, expect, it} from "vitest"
import {type TrustedEvent} from "@welshman/util"
import {PROFILE_LIST_KIND, getProfileListPubkeys, parseCommunityDefinition} from "./community"
import {
  addPubkeyToCommunityProfileList,
  applyCommunityBootstrapGrants,
  findCommunityProfileListEvent,
  getOwnerMembershipGrantProfileList,
  getPendingCommunityModeratorInvites,
  makeCommunityGrantEvent,
  makeManualModeratorProfileListRef,
  makeCommunityProfileList,
  makeModeratorInviteResponseProfileList,
  makeCommunityRevokeEvent,
  removePubkeyFromCommunityProfileList,
} from "./community-admin"

const managerPubkey = "a".repeat(64)
const memberPubkey = "c".repeat(64)
const otherPubkey = "d".repeat(64)

const profileList = {
  kind: PROFILE_LIST_KIND,
  pubkey: managerPubkey,
  identifier: "General",
  address: `${PROFILE_LIST_KIND}:${managerPubkey}:General`,
}

const profileListEvent = {
  id: "list-event",
  kind: PROFILE_LIST_KIND,
  pubkey: managerPubkey,
  created_at: 1,
  tags: [
    ["d", "General"],
    ["p", otherPubkey],
  ],
  content: "",
  sig: "sig",
} as TrustedEvent

describe("community admin helpers", () => {
  it("builds profile lists with normalized unique pubkeys", () => {
    expect(
      makeCommunityProfileList({profileList, pubkeys: [memberPubkey, memberPubkey, "bad"]}),
    ).toEqual({
      kind: PROFILE_LIST_KIND,
      content: "",
      tags: [
        ["d", "General"],
        ["p", memberPubkey],
      ],
    })
  })

  it("adds and removes pubkeys from profile lists", () => {
    expect(
      addPubkeyToCommunityProfileList({profileList, event: profileListEvent, pubkey: memberPubkey}),
    ).toEqual({
      kind: PROFILE_LIST_KIND,
      content: "",
      tags: [
        ["d", "General"],
        ["p", otherPubkey],
        ["p", memberPubkey],
      ],
    })
    expect(
      removePubkeyFromCommunityProfileList({
        profileList,
        event: profileListEvent,
        pubkey: otherPubkey,
      }),
    ).toEqual({
      kind: PROFILE_LIST_KIND,
      content: "",
      tags: [["d", "General"]],
    })
  })

  it("builds grant and revoke event templates", () => {
    expect(makeCommunityGrantEvent({profileList, profileListEvent, pubkey: memberPubkey})).toEqual({
      kind: PROFILE_LIST_KIND,
      content: "",
      tags: [
        ["d", "General"],
        ["p", otherPubkey],
        ["p", memberPubkey],
      ],
    })
    expect(makeCommunityRevokeEvent({profileList, profileListEvent, pubkey: otherPubkey})).toEqual({
      kind: PROFILE_LIST_KIND,
      content: "",
      tags: [["d", "General"]],
    })
  })

  it("applies manual member grants to community-owned section lists", () => {
    const definition = parseCommunityDefinition({
      id: "definition",
      kind: 10222,
      pubkey: managerPubkey,
      created_at: 1,
      tags: [
        ["r", "wss://relay.example.com"],
        ["content", "General"],
        ["k", "1111"],
        ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:General`],
      ],
      content: "",
      sig: "sig",
    } as TrustedEvent)!

    const result = applyCommunityBootstrapGrants({
      sections: definition.sections,
      communityPubkey: managerPubkey,
      relays: definition.relays,
      profileListEvents: [profileListEvent],
      grants: [{pubkey: memberPubkey, role: "member", sectionNames: ["General"]}],
    })

    expect(result.sections[0].profileLists).toHaveLength(1)
    expect(result.profileListUpdates).toEqual([
      {profileList: definition.sections[0].profileLists[0], pubkeys: [otherPubkey, memberPubkey]},
    ])
  })

  it("creates an owner-managed member grant list only when a grant needs one", () => {
    const moderatorRef = makeManualModeratorProfileListRef({
      moderatorPubkey: memberPubkey,
      sectionName: "Threads",
      relays: ["wss://relay.example.com"],
    })
    const definition = parseCommunityDefinition({
      id: "definition",
      kind: 10222,
      pubkey: managerPubkey,
      created_at: 1,
      tags: [
        ["r", "wss://relay.example.com"],
        ["content", "Threads"],
        ["k", "11", "threads"],
        ["a", moderatorRef.address, moderatorRef.relay || ""],
      ],
      content: "",
      sig: "sig",
    } as TrustedEvent)!
    const result = getOwnerMembershipGrantProfileList({
      definition,
      sectionName: "Threads",
      relays: ["wss://relay.example.com"],
    })

    expect(result.profileList).toMatchObject({pubkey: managerPubkey})
    expect(result.definitionUpdate?.tags).toContainEqual([
      "a",
      result.profileList!.address,
      "wss://relay.example.com/",
    ])
  })

  it("reuses an existing owner member grant list ref", () => {
    const definition = parseCommunityDefinition({
      id: "definition",
      kind: 10222,
      pubkey: managerPubkey,
      created_at: 1,
      tags: [
        ["content", "General"],
        ["k", "1111"],
        ["a", profileList.address],
      ],
      content: "",
      sig: "sig",
    } as TrustedEvent)!
    const result = getOwnerMembershipGrantProfileList({
      definition,
      sectionName: "General",
      relays: ["wss://relay.example.com"],
    })

    expect(result.profileList).toEqual(definition.sections[0].profileLists[0])
    expect(result.definitionUpdate).toBeUndefined()
  })

  it("adds manual moderator refs and creates accept or decline list events", () => {
    const moderatorRef = makeManualModeratorProfileListRef({
      moderatorPubkey: memberPubkey,
      sectionName: "General",
      relays: ["wss://relay.example.com"],
    })
    const result = applyCommunityBootstrapGrants({
      sections: [
        {
          name: "General",
          kinds: [{kind: 1111}],
          profileLists: [],
          badges: [],
          retention: [],
        },
      ],
      communityPubkey: managerPubkey,
      relays: ["wss://relay.example.com"],
      grants: [{pubkey: memberPubkey, role: "moderator", sectionNames: ["General"]}],
    })
    const accepted = makeModeratorInviteResponseProfileList({profileList: moderatorRef})
    const declined = makeModeratorInviteResponseProfileList({
      profileList: moderatorRef,
      declined: true,
    })

    expect(result.sections[0].profileLists).toEqual([moderatorRef])
    expect(result.profileListUpdates).toEqual([])
    expect(accepted.tags).toEqual([["d", "General"]])
    expect(declined.tags).toEqual([
      ["d", "General"],
      ["status", "declined"],
    ])
    expect(getProfileListPubkeys(declined as TrustedEvent)).toEqual([])
  })

  it("selects the latest profile list event by address", () => {
    const newer = {...profileListEvent, id: "newer", created_at: 2, tags: [["d", "General"]]}

    expect(findCommunityProfileListEvent(profileList, [profileListEvent, newer])).toBe(newer)
  })

  it("detects pending moderator invites until the moderator responds", () => {
    const moderatorRef = makeManualModeratorProfileListRef({
      moderatorPubkey: memberPubkey,
      sectionName: "General",
      relays: ["wss://relay.example.com"],
    })
    const definition = parseCommunityDefinition({
      id: "definition",
      kind: 10222,
      pubkey: managerPubkey,
      created_at: 1,
      tags: [
        ["content", "General"],
        ["k", "1111"],
        ["a", moderatorRef.address, moderatorRef.relay || ""],
      ],
      content: "",
      sig: "sig",
    } as TrustedEvent)!
    const accepted = {
      ...makeModeratorInviteResponseProfileList({profileList: moderatorRef}),
      id: "accepted",
      pubkey: memberPubkey,
      created_at: 1,
      sig: "sig",
    } as TrustedEvent
    const declined = {
      ...makeModeratorInviteResponseProfileList({profileList: moderatorRef, declined: true}),
      id: "declined",
      pubkey: memberPubkey,
      created_at: 2,
      sig: "sig",
    } as TrustedEvent

    expect(
      getPendingCommunityModeratorInvites({
        definition,
        moderatorPubkey: memberPubkey,
        profileListEvents: [],
      }).map(invite => invite.profileList.address),
    ).toEqual([moderatorRef.address])
    expect(
      getPendingCommunityModeratorInvites({
        definition,
        moderatorPubkey: memberPubkey,
        profileListEvents: [accepted],
      }),
    ).toEqual([])
    expect(
      getPendingCommunityModeratorInvites({
        definition,
        moderatorPubkey: memberPubkey,
        profileListEvents: [declined],
      }),
    ).toEqual([])
  })
})
