import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  getProfileListPubkeys,
  parseCommunityDefinition,
} from "./community"
import {
  addPubkeyToCommunityProfileList,
  applyCommunityBootstrapGrants,
  findCommunityProfileListEvent,
  getCommunityModeratorInviteProfileListRefs,
  getCommunityModeratorInviteStates,
  getOwnerMembershipGrantProfileList,
  getPendingCommunityModeratorInvites,
  makeCommunityGrantEvent,
  makeManualModeratorProfileListRef,
  makeCommunityProfileList,
  makeModeratorInviteResponseProfileList,
  makeCommunityRevokeEvent,
  removePubkeyFromCommunityProfileList,
} from "./community-admin"

const managerPubkey = getPublicKey(new Uint8Array(32).fill(5))
const memberPubkey = getPublicKey(new Uint8Array(32).fill(4))
const otherPubkey = getPublicKey(new Uint8Array(32).fill(6))
const v2Controller = getPublicKey(new Uint8Array(32).fill(1))
const v2CommunityId = getPublicKey(new Uint8Array(32).fill(2))
const generalIdentifier = `${v2CommunityId}-general`

const profileList = {
  kind: PROFILE_LIST_KIND,
  pubkey: managerPubkey,
  identifier: generalIdentifier,
  address: `${PROFILE_LIST_KIND}:${managerPubkey}:${generalIdentifier}`,
}

const profileListEvent = {
  id: "list-event",
  kind: PROFILE_LIST_KIND,
  pubkey: managerPubkey,
  created_at: 1,
  tags: [
    ["d", generalIdentifier],
    ["p", otherPubkey],
  ],
  content: "",
  sig: "sig",
} as TrustedEvent

const makeDefinition = (profileLists: Array<{address: string; relay?: string}>) => {
  const template = buildCommunityDefinition({
    communityId: v2CommunityId,
    name: "Community",
    relays: ["wss://relay.example.com"],
    sections: [{name: "General", kinds: [{kind: 1111}], profileLists}],
  })

  return parseCommunityDefinition({
    id: "definition",
    kind: COMMUNITY_DEFINITION_KIND,
    pubkey: managerPubkey,
    created_at: 1,
    tags: template.tags,
    content: "",
    sig: "sig",
  } as TrustedEvent)!
}

describe("community admin helpers", () => {
  it("builds profile lists with normalized unique pubkeys", () => {
    expect(
      makeCommunityProfileList({profileList, pubkeys: [memberPubkey, memberPubkey, "bad"]}),
    ).toEqual({
      kind: PROFILE_LIST_KIND,
      content: "",
      tags: [
        ["d", generalIdentifier],
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
        ["d", generalIdentifier],
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
      tags: [["d", generalIdentifier]],
    })
  })

  it("builds grant and revoke event templates", () => {
    expect(makeCommunityGrantEvent({profileList, profileListEvent, pubkey: memberPubkey})).toEqual({
      kind: PROFILE_LIST_KIND,
      content: "",
      tags: [
        ["d", generalIdentifier],
        ["p", otherPubkey],
        ["p", memberPubkey],
      ],
    })
    expect(makeCommunityRevokeEvent({profileList, profileListEvent, pubkey: otherPubkey})).toEqual({
      kind: PROFILE_LIST_KIND,
      content: "",
      tags: [["d", generalIdentifier]],
    })
  })

  it("applies manual member grants to community-owned section lists", () => {
    const definition = makeDefinition([
      {address: `${PROFILE_LIST_KIND}:${managerPubkey}:${generalIdentifier}`},
    ])

    const result = applyCommunityBootstrapGrants({
      sections: definition.sections,
      communityId: definition.communityId,
      ownerPubkey: managerPubkey,
      relays: definition.relays,
      profileListEvents: [profileListEvent],
      grants: [{pubkey: memberPubkey, role: "member", sectionNames: ["General"]}],
    })

    expect(result.sections[0].profileLists).toHaveLength(1)
    expect(result.profileListUpdates).toEqual([
      {profileList: definition.sections[0].profileLists[0], pubkeys: [otherPubkey, memberPubkey]},
    ])
  })

  it("does not add the owner as a member when creating the first section list", () => {
    const definition = makeDefinition([])
    const result = applyCommunityBootstrapGrants({
      sections: definition.sections,
      communityId: definition.communityId,
      ownerPubkey: managerPubkey,
      relays: definition.relays,
      grants: [{pubkey: memberPubkey, role: "member", sectionNames: ["General"]}],
    })

    expect(result.sections[0].profileLists).toHaveLength(1)
    expect(result.profileListUpdates).toEqual([
      {profileList: result.sections[0].profileLists[0], pubkeys: [memberPubkey]},
    ])
  })

  it("preserves the exact definition envelope and opaque tags when adding an owner grant list", () => {
    const template = buildCommunityDefinition({
      communityId: v2CommunityId,
      name: "Sibling community",
      relays: ["wss://relay.example.com"],
      graspServers: ["wss://grasp.example.com"],
      ciRepoWatchers: [{pubkey: memberPubkey, relays: ["wss://ci.example.com"]}],
      sections: [
        {
          name: "Threads",
          kinds: [{kind: 11, subtype: "threads"}],
          profileLists: [],
        },
      ],
    })
    const unknownTag = ["future-extension", "opaque", "value"]
    const definition = parseCommunityDefinition({
      id: "definition",
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: v2Controller,
      created_at: 1,
      tags: [...template.tags.slice(0, 2), unknownTag, ...template.tags.slice(2)],
      content: "",
      sig: "sig",
    } as TrustedEvent)!
    const result = getOwnerMembershipGrantProfileList({
      definition,
      sectionName: "Threads",
      relays: definition.relays,
    })
    const update = result.definitionUpdate!
    const reparsed = parseCommunityDefinition({
      ...definition.event,
      id: "updated-definition",
      kind: update.kind,
      tags: update.tags,
    } as TrustedEvent)!

    expect(update.kind).toBe(COMMUNITY_DEFINITION_KIND)
    expect(result.profileList?.address.split(":")[1]).toBe(v2Controller)
    expect(update.tags).toContainEqual(["d", v2CommunityId])
    expect(update.tags).toContainEqual(unknownTag)
    expect(update.tags).toContainEqual([
      "a",
      result.profileList!.address,
      "wss://relay.example.com",
    ])
    expect(reparsed.ownerPubkey).toBe(v2Controller)
    expect(reparsed.communityId).toBe(v2CommunityId)
    expect(reparsed.pointer.address).toBe(definition.pointer.address)
    expect(reparsed.ciRepoWatchers).toEqual(definition.ciRepoWatchers)
  })

  it("reuses an existing owner member grant list ref", () => {
    const template = buildCommunityDefinition({
      communityId: v2CommunityId,
      name: "Sibling community",
      relays: ["wss://relay.example.com"],
      sections: [
        {
          name: "General",
          kinds: [{kind: 1111}],
          profileLists: [{address: `${PROFILE_LIST_KIND}:${v2Controller}:${generalIdentifier}`}],
        },
      ],
    })
    const definition = parseCommunityDefinition({
      id: "definition",
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: v2Controller,
      created_at: 1,
      tags: template.tags,
      content: "",
      sig: "sig",
    } as TrustedEvent)!
    const result = getOwnerMembershipGrantProfileList({
      definition,
      sectionName: "General",
      relays: ["wss://relay.example.com"],
    })

    expect(result.profileList?.address).toEqual(definition.sections[0].profileLists[0].address)
    expect(result.definitionUpdate).toBeUndefined()
  })

  it("adds manual moderator refs and creates accept or decline list events", () => {
    const moderatorRef = makeManualModeratorProfileListRef({
      communityId: v2CommunityId,
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
      communityId: v2CommunityId,
      ownerPubkey: managerPubkey,
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
    expect(accepted.tags).toEqual([["d", generalIdentifier]])
    expect(declined.tags).toEqual([
      ["d", generalIdentifier],
      ["status", "declined"],
    ])
    expect(getProfileListPubkeys(declined as TrustedEvent)).toEqual([])
  })

  it("selects the latest profile list event by address", () => {
    const newer = {
      ...profileListEvent,
      id: "newer",
      created_at: 2,
      tags: [["d", generalIdentifier]],
    }

    expect(findCommunityProfileListEvent(profileList, [profileListEvent, newer])).toBe(newer)
  })

  it("rejects malformed profile-list coordinates and applies exact authority tombstones", () => {
    const malformed = {
      ...profileListEvent,
      id: "malformed",
      created_at: 4,
      tags: [
        ["d", "General"],
        ["d", "Other"],
        ["p", memberPubkey],
      ],
    }
    const deletion = {
      ...profileListEvent,
      id: "deletion",
      kind: 5,
      created_at: 1,
      tags: [["a", profileList.address]],
    }
    const newerDeletion = {...deletion, id: "newer-deletion", created_at: 2}
    const recreated = {...profileListEvent, id: "recreated", created_at: 3}
    const foreignDeletion = {...deletion, id: "foreign-deletion", pubkey: memberPubkey}
    const multiAddressDeletion = {
      ...deletion,
      id: "multi-address-deletion",
      tags: [
        ["a", profileList.address],
        ["a", `${PROFILE_LIST_KIND}:${managerPubkey}:Other`],
      ],
    }

    expect(findCommunityProfileListEvent(profileList, [profileListEvent, malformed])).toBe(
      profileListEvent,
    )
    expect(findCommunityProfileListEvent(profileList, [profileListEvent, deletion])).toBeUndefined()
    expect(
      findCommunityProfileListEvent(profileList, [profileListEvent, newerDeletion]),
    ).toBeUndefined()
    expect(
      findCommunityProfileListEvent(profileList, [profileListEvent, deletion, recreated]),
    ).toBe(recreated)
    expect(findCommunityProfileListEvent(profileList, [profileListEvent, foreignDeletion])).toBe(
      profileListEvent,
    )
    expect(
      findCommunityProfileListEvent(profileList, [profileListEvent, multiAddressDeletion]),
    ).toBe(profileListEvent)
  })

  it("detects pending moderator invites until the moderator responds", () => {
    const moderatorRef = makeManualModeratorProfileListRef({
      communityId: v2CommunityId,
      moderatorPubkey: memberPubkey,
      sectionName: "General",
      relays: ["wss://relay.example.com"],
    })
    const definition = makeDefinition([moderatorRef])
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
    expect(
      getCommunityModeratorInviteStates({definition, profileListEvents: []}).map(
        invite => invite.status,
      ),
    ).toEqual(["pending"])
    expect(
      getCommunityModeratorInviteStates({definition, profileListEvents: [accepted]}).map(
        invite => invite.status,
      ),
    ).toEqual(["accepted"])
    expect(
      getCommunityModeratorInviteStates({
        definition,
        profileListEvents: [accepted, declined],
      }).map(invite => invite.status),
    ).toEqual(["declined"])
  })

  it("selects moderator invite refs for the active user", () => {
    const moderatorRef = makeManualModeratorProfileListRef({
      communityId: v2CommunityId,
      moderatorPubkey: memberPubkey,
      sectionName: "General",
      relays: ["wss://relay.example.com"],
    })
    const otherModeratorRef = makeManualModeratorProfileListRef({
      communityId: v2CommunityId,
      moderatorPubkey: otherPubkey,
      sectionName: "General",
      relays: ["wss://relay.example.com"],
    })
    const definition = makeDefinition([moderatorRef, otherModeratorRef])

    expect(
      getCommunityModeratorInviteProfileListRefs({
        definition,
        moderatorPubkey: memberPubkey,
      }).map(ref => ref.address),
    ).toEqual([moderatorRef.address])
    expect(
      getCommunityModeratorInviteProfileListRefs({
        definition,
        moderatorPubkey: managerPubkey,
      }),
    ).toEqual([])
  })
})
