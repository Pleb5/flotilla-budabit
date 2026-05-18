import {describe, expect, it} from "vitest"
import {type TrustedEvent} from "@welshman/util"
import {PROFILE_LIST_KIND} from "./community"
import {
  addPubkeyToCommunityProfileList,
  makeCommunityGrantEvent,
  makeCommunityProfileList,
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
    expect(
      makeCommunityGrantEvent({profileList, profileListEvent, pubkey: memberPubkey}),
    ).toEqual({
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
})
