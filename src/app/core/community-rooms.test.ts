import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_ROOM_LABEL_ACTIVE,
  COMMUNITY_ROOM_LABEL_ARCHIVED,
  COMMUNITY_ROOM_LABEL_KIND,
  COMMUNITY_ROOM_LABEL_NAMESPACE,
  getCommunityRoomArchiveLabelValue,
  isCommunityRoomArchived,
  makeCommunityRoomArchiveLabel,
  makeCommunityRoomRoot,
  readCommunityRoomRoot,
  readCommunityRoomRoots,
} from "./community-rooms"

const communityPubkey = "a".repeat(64)
const creatorPubkey = "b".repeat(64)
const adminPubkey = "c".repeat(64)
const outsiderPubkey = "d".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: creatorPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("community room helpers", () => {
  it("builds immutable room root content", () => {
    expect(makeCommunityRoomRoot({communityPubkey, name: "General", about: "Main room"})).toEqual({
      content: "Main room",
      tags: [["h", communityPubkey], ["room"], ["title", "General"]],
    })
  })

  it("reads room roots and filters out threads", () => {
    const room = makeEvent({
      id: "room-id",
      kind: 11,
      content: "Main room",
      tags: [["h", communityPubkey], ["room"], ["title", "General"]],
    })
    const thread = makeEvent({
      id: "thread-id",
      kind: 11,
      tags: [
        ["h", communityPubkey],
        ["title", "Thread"],
      ],
    })

    expect(readCommunityRoomRoot(room, communityPubkey)).toMatchObject({
      id: "room-id",
      communityPubkey,
      name: "General",
      about: "Main room",
      creatorPubkey,
    })
    expect(readCommunityRoomRoot(thread, communityPubkey)).toBeUndefined()
    expect(readCommunityRoomRoots([room, thread], communityPubkey).map(room => room.id)).toEqual([
      "room-id",
    ])
  })

  it("builds room archive labels", () => {
    expect(
      makeCommunityRoomArchiveLabel({
        communityPubkey,
        room: {id: "room-id", creatorPubkey},
        archived: true,
        relay: "wss://relay.example.com/",
      }),
    ).toEqual({
      content: "",
      tags: [
        ["h", communityPubkey],
        ["E", "room-id", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["L", COMMUNITY_ROOM_LABEL_NAMESPACE],
        ["l", COMMUNITY_ROOM_LABEL_ARCHIVED, COMMUNITY_ROOM_LABEL_NAMESPACE],
      ],
    })
  })

  it("uses latest authoritative archive label", () => {
    const outsiderArchived = makeEvent({
      id: "outsider-archived",
      kind: COMMUNITY_ROOM_LABEL_KIND,
      pubkey: outsiderPubkey,
      created_at: 30,
      tags: [
        ["E", "room-id"],
        ["L", COMMUNITY_ROOM_LABEL_NAMESPACE],
        ["l", COMMUNITY_ROOM_LABEL_ARCHIVED, COMMUNITY_ROOM_LABEL_NAMESPACE],
      ],
    })
    const adminArchived = makeEvent({
      id: "admin-archived",
      kind: COMMUNITY_ROOM_LABEL_KIND,
      pubkey: adminPubkey,
      created_at: 10,
      tags: [
        ["E", "room-id"],
        ["L", COMMUNITY_ROOM_LABEL_NAMESPACE],
        ["l", COMMUNITY_ROOM_LABEL_ARCHIVED, COMMUNITY_ROOM_LABEL_NAMESPACE],
      ],
    })
    const adminActive = makeEvent({
      id: "admin-active",
      kind: COMMUNITY_ROOM_LABEL_KIND,
      pubkey: adminPubkey,
      created_at: 20,
      tags: [
        ["E", "room-id"],
        ["L", COMMUNITY_ROOM_LABEL_NAMESPACE],
        ["l", COMMUNITY_ROOM_LABEL_ACTIVE, COMMUNITY_ROOM_LABEL_NAMESPACE],
      ],
    })

    expect(getCommunityRoomArchiveLabelValue(adminArchived, "room-id")).toBe(
      COMMUNITY_ROOM_LABEL_ARCHIVED,
    )
    expect(
      isCommunityRoomArchived({
        roomId: "room-id",
        labels: [outsiderArchived, adminArchived, adminActive],
        authoritativePubkeys: [adminPubkey],
      }),
    ).toBe(false)
  })
})
