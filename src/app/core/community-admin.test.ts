import {describe, expect, it} from "vitest"
import {BADGE_AWARD, BADGE_DEFINITION, type TrustedEvent} from "@welshman/util"
import {PROFILE_LIST_KIND} from "./community"
import {
  addPubkeyToCommunityProfileList,
  makeCommunityBadgeAward,
  makeCommunityGrantEvents,
  makeCommunityProfileList,
  makeCommunityRevokeEvent,
  removePubkeyFromCommunityProfileList,
} from "./community-admin"

const managerPubkey = "a".repeat(64)
const badgePubkey = "b".repeat(64)
const memberPubkey = "c".repeat(64)
const otherPubkey = "d".repeat(64)

const profileList = {
  kind: PROFILE_LIST_KIND,
  pubkey: managerPubkey,
  identifier: "General",
  address: `${PROFILE_LIST_KIND}:${managerPubkey}:General`,
}

const badge = {
  kind: BADGE_DEFINITION,
  pubkey: badgePubkey,
  identifier: "member",
  address: `${BADGE_DEFINITION}:${badgePubkey}:member`,
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

  it("builds badge awards", () => {
    expect(
      makeCommunityBadgeAward({
        badge,
        pubkeys: [memberPubkey],
        relayHints: {[memberPubkey]: "wss://relay.example.com/"},
      }),
    ).toEqual({
      kind: BADGE_AWARD,
      content: "",
      tags: [
        ["a", badge.address],
        ["p", memberPubkey, "wss://relay.example.com/"],
      ],
    })
  })

  it("builds grant and revoke event templates", () => {
    expect(
      makeCommunityGrantEvents({profileList, profileListEvent, badge, pubkey: memberPubkey}),
    ).toMatchObject({
      profileList: {
        kind: PROFILE_LIST_KIND,
        tags: [
          ["d", "General"],
          ["p", otherPubkey],
          ["p", memberPubkey],
        ],
      },
      badgeAward: {
        kind: BADGE_AWARD,
        tags: [
          ["a", badge.address],
          ["p", memberPubkey],
        ],
      },
    })
    expect(makeCommunityRevokeEvent({profileList, profileListEvent, pubkey: otherPubkey})).toEqual({
      kind: PROFILE_LIST_KIND,
      content: "",
      tags: [["d", "General"]],
    })
  })
})
