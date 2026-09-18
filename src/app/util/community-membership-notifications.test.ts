// @vitest-environment jsdom
import {describe, expect, it, vi} from "vitest"
import {getPublicKey} from "nostr-tools"
import type {TrustedEvent} from "@welshman/util"
import {
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
} from "@app/core/community"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import {
  updateCommunityMembershipNotifications as update,
  type CommunityMembershipNotificationState,
} from "./community-membership-notifications"

vi.mock("@app/core/storage", () => ({kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()}}))

const viewer = getPublicKey(new Uint8Array(32).fill(1))
const owner = getPublicKey(new Uint8Array(32).fill(2))
const other = getPublicKey(new Uint8Array(32).fill(3))
const community = makeCommunityPointer({ownerPubkey: owner, communityId: other})!
const address = `30000:${owner}:${community.communityId}-general`
const event = (
  id: string,
  created_at: number,
  members: string[],
  listAddress = address,
): TrustedEvent => ({
  id,
  created_at,
  kind: 30000,
  pubkey: owner,
  content: "",
  sig: "",
  tags: [
    ["d", listAddress.split(":").slice(2).join(":")],
    ["a", listAddress],
    ...members.map(pubkey => ["p", pubkey]),
  ],
})
const ref: ActiveUserCommunityRef = {
  community,
  relayHints: [],
  roles: [],
  writableSections: [],
  definition: parseCommunityDefinition({
    ...event("definition", 1, []),
    ...buildCommunityDefinition({
      communityId: community.communityId,
      name: "Community",
      relays: ["wss://community.example"],
      sections: [{name: "General", kinds: [{kind: 1111}], profileLists: [{address}]}],
    }),
  })!,
}

describe("community membership notification transitions", () => {
  it("notifies grants and removals, but not edits concerning other members", () => {
    let state = update({}, viewer, [ref], [event("empty", 1, [])])
    expect(state[viewer].rows).toEqual([])
    state = update(state, viewer, [ref], [event("granted", 2, [viewer])])
    expect(state[viewer].rows).toMatchObject([
      {eventId: "granted", title: "Community access granted"},
    ])
    state = update(state, viewer, [ref], [event("another-member", 3, [viewer, other])])
    expect(state[viewer].rows.map(row => row.eventId)).toEqual(["granted"])
    // Ref intentionally has no membership role: losing the final grant must still notify.
    state = update(state, viewer, [ref], [event("removed", 4, [other])])
    expect(state[viewer].rows.map(row => row.title)).toEqual([
      "Community grant removed",
      "Community access granted",
    ])
    state = update(state, viewer, [ref], [event("another-edit", 5, [])])
    expect(state[viewer].rows.map(row => row.eventId)).toEqual(["removed", "granted"])
    state = update(state, viewer, [ref], [event("regranted", 6, [viewer])])
    expect(state[viewer].rows[0].eventId).toBe("regranted")
  })

  it("detects offline removal from persisted observations without replaying old list versions", () => {
    const stored = update({}, viewer, [ref], [event("granted", 2, [viewer])])
    let state = JSON.parse(JSON.stringify(stored)) as CommunityMembershipNotificationState
    state = update(state, viewer, [ref], [event("removed-offline", 5, [])])
    expect(state[viewer].rows[0].eventId).toBe("removed-offline")
    expect(update(state, viewer, [ref], [event("stale", 3, [viewer])])).toBe(state)
    expect(update(state, viewer, [ref], [event("removed-offline", 5, [])])).toBe(state)
    expect(update(state, viewer, [ref], [])).toBe(state)
  })

  it("keeps accounts and referenced lists isolated", () => {
    const state = update({}, viewer, [ref], [event("grant", 1, [viewer])])
    const next = update(state, other, [ref], [event("grant", 1, [viewer])])
    expect(next[other].rows).toEqual([])
    expect(next[viewer]).toEqual(state[viewer])
    expect(
      update(
        next,
        viewer,
        [ref],
        [event("foreign-list", 2, [], `30000:${owner}:${community.communityId}-other`)],
      ),
    ).toBe(next)
  })

  it("ignores an impersonated list and notifies a declined list's former recipient", () => {
    const state = update({}, viewer, [ref], [event("grant", 1, [viewer])])
    expect(update(state, viewer, [ref], [{...event("forged", 3, []), pubkey: other}])).toBe(state)
    const declined = event("declined", 4, [viewer])
    declined.tags.push(["status", "declined"])
    expect(update(state, viewer, [ref], [declined])[viewer].rows[0].title).toBe(
      "Community grant removed",
    )
  })
})
