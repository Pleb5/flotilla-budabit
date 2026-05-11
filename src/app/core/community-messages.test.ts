import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  getCommunityRoomMessageParentId,
  makeCommunityRoomMessage,
  readCommunityRoomMessage,
  readCommunityRoomMessages,
} from "./community-messages"

const communityPubkey = "a".repeat(64)
const creatorPubkey = "b".repeat(64)
const authorPubkey = "c".repeat(64)
const parentPubkey = "d".repeat(64)

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

describe("community room message helpers", () => {
  it("builds room messages with community and room-root tags", () => {
    expect(
      makeCommunityRoomMessage({
        communityPubkey,
        room: {id: "room-root", creatorPubkey},
        relay: "wss://relay.example.com/",
        content: "GM",
      }),
    ).toEqual({
      content: "GM",
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
      ],
    })
  })

  it("builds NIP-C7 room replies with q tags", () => {
    expect(
      makeCommunityRoomMessage({
        communityPubkey,
        room: {id: "room-root", creatorPubkey},
        relay: "wss://relay.example.com/",
        content: "nostr:nevent1...\nyes",
        parent: {id: "parent-message", relay: "wss://relay.example.com/", pubkey: parentPubkey},
      }),
    ).toEqual({
      content: "nostr:nevent1...\nyes",
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["q", "parent-message", "wss://relay.example.com/", parentPubkey],
      ],
    })
  })

  it("reads room messages and parent ids", () => {
    const message = makeEvent({
      id: "message-id",
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-root", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["q", "parent-message", "wss://relay.example.com/", parentPubkey],
      ],
    })
    const otherRoom = makeEvent({
      id: "other-room-message",
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "other-room", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
      ],
    })

    expect(getCommunityRoomMessageParentId(message)).toBe("parent-message")
    expect(readCommunityRoomMessage(message, communityPubkey, "room-root")).toMatchObject({
      id: "message-id",
      communityPubkey,
      roomRootId: "room-root",
      parentMessageId: "parent-message",
    })
    expect(readCommunityRoomMessage(message, communityPubkey, "other-room")).toBeUndefined()
    expect(readCommunityRoomMessages([message, otherRoom], communityPubkey, "room-root").map(m => m.id)).toEqual([
      "message-id",
    ])
  })
})
