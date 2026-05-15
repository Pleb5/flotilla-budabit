import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {TARGETED_PUBLICATION_KIND, buildTargetedPublication} from "./community"
import {
  filterForumThreadRoots,
  filterRoomRoots,
  getRoomRootIdForMessage,
  isRoomMessage,
  makeCommunityExclusiveFilter,
  makeCommunityForumRepliesFilter,
  makeCommunityRoomMessagesFilter,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilters,
} from "./community-feeds"

const communityPubkey = "a".repeat(64)
const otherCommunityPubkey = "b".repeat(64)
const authorPubkey = "c".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: authorPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("community feed helpers", () => {
  it("builds exclusive community filters", () => {
    expect(makeCommunityExclusiveFilter(communityPubkey, [9], {since: 10})).toEqual({
      kinds: [9],
      "#h": [communityPubkey],
      since: 10,
    })
  })

  it("builds room message filters", () => {
    expect(makeCommunityRoomMessagesFilter(communityPubkey, "room-root", {limit: 50})).toEqual({
      kinds: [9],
      "#h": [communityPubkey],
      "#E": ["room-root"],
      limit: 50,
    })
  })

  it("builds forum reply filters", () => {
    expect(
      makeCommunityForumRepliesFilter(communityPubkey, {"#E": ["thread-root"], limit: 50}),
    ).toEqual({
      kinds: [1111],
      "#h": [communityPubkey],
      "#K": ["11"],
      "#E": ["thread-root"],
      limit: 50,
    })
  })

  it("builds targeted publication filters", () => {
    expect(makeCommunityTargetingFilter(communityPubkey, [31922, 9041], {limit: 100})).toEqual({
      kinds: [TARGETED_PUBLICATION_KIND],
      "#p": [communityPubkey],
      "#k": ["31922", "9041"],
      limit: 100,
    })
  })

  it("separates room roots from forum thread roots", () => {
    const room = makeEvent({
      id: "room",
      kind: 11,
      tags: [["h", communityPubkey], ["room"], ["title", "General"]],
    })
    const forum = makeEvent({
      id: "forum",
      kind: 11,
      tags: [
        ["h", communityPubkey],
        ["title", "Forum topic"],
      ],
    })
    const other = makeEvent({id: "other", kind: 11, tags: [["h", otherCommunityPubkey], ["room"]]})

    expect(filterRoomRoots([room, forum, other], communityPubkey).map(event => event.id)).toEqual([
      "room",
    ])
    expect(
      filterForumThreadRoots([room, forum, other], communityPubkey).map(event => event.id),
    ).toEqual(["forum"])
  })

  it("identifies room messages by community and room root", () => {
    const message = makeEvent({
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com", authorPubkey],
        ["K", "11"],
      ],
    })

    expect(getRoomRootIdForMessage(message)).toBe("room-root")
    expect(isRoomMessage(message, communityPubkey, "room-root")).toBe(true)
    expect(isRoomMessage(message, communityPubkey, "other-room")).toBe(false)
  })

  it("builds original publication filters from targeting events", () => {
    const calendarTarget = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "target-calendar",
        kind: 31922,
        ref: {type: "a", value: `31922:${authorPubkey}:calendar-1`},
        communities: [{pubkey: communityPubkey}],
      }).tags,
    })
    const permalinkTarget = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "target-permalink",
        kind: 1623,
        ref: {type: "e", value: "permalink-event-id"},
        communities: [{pubkey: communityPubkey}],
      }).tags,
    })
    const goalTarget = makeEvent({
      kind: TARGETED_PUBLICATION_KIND,
      tags: buildTargetedPublication({
        id: "target-goal",
        kind: 9041,
        communities: [{pubkey: communityPubkey}],
      }).tags,
    })

    expect(
      makeTargetedPublicationOriginalFilters([calendarTarget, permalinkTarget, goalTarget]),
    ).toEqual([
      {kinds: [31922], authors: [authorPubkey], "#d": ["calendar-1"]},
      {kinds: [1623], ids: ["permalink-event-id"]},
      {kinds: [9041], "#h": ["target-goal"]},
    ])
    expect(
      makeTargetedPublicationOriginalFilters(
        [calendarTarget, permalinkTarget, goalTarget],
        [authorPubkey],
      ),
    ).toEqual([
      {kinds: [31922], authors: [authorPubkey], "#d": ["calendar-1"]},
      {kinds: [1623], ids: ["permalink-event-id"], authors: [authorPubkey]},
      {kinds: [9041], "#h": ["target-goal"], authors: [authorPubkey]},
    ])
  })
})
