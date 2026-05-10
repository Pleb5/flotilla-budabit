// @vitest-environment jsdom

import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {makeRoomId} from "@app/core/state"
import {
  filterArchivedRoomMessages,
  getRoomInteractionState,
  isArchivedRoomReference,
  partitionArchivedItems,
} from "./room-archive"

const makeChannelReferenceId = (url: string, room: string) => `${url}'${room}`

const makeMessage = (id: string, h: string, pubkey = "other", created_at = 10) =>
  ({
    id,
    kind: 9,
    pubkey,
    created_at,
    tags: [["h", h]],
    content: "hello",
    sig: "sig",
  }) as TrustedEvent

describe("room archive helpers", () => {
  it("partitions active and archived items for room lists", () => {
    const items = [
      {id: "a", archived: false},
      {id: "b", archived: true},
      {id: "c", isArchived: true},
      {id: "d"},
    ]

    const result = partitionArchivedItems(items)

    expect(result.active.map(item => item.id)).toEqual(["a", "d"])
    expect(result.archived.map(item => item.id)).toEqual(["b", "c"])
  })

  it("detects archived room references from room or channel state", () => {
    const url = "wss://space.one"
    const roomsById = new Map([[makeRoomId(url, "room-a"), {isArchived: true}]])
    const channelsById = new Map([[makeChannelReferenceId(url, "room-b"), {archived: true}]])

    expect(isArchivedRoomReference({url, h: "room-a", roomsById, channelsById})).toBe(true)
    expect(isArchivedRoomReference({url, h: "room-b", roomsById, channelsById})).toBe(true)
    expect(isArchivedRoomReference({url, h: "room-c", roomsById, channelsById})).toBe(false)
  })

  it("filters archived-room messages from recent activity inputs", () => {
    const url = "wss://space.one"
    const roomsById = new Map([[makeRoomId(url, "archived-room"), {isArchived: true}]])
    const channelsById = new Map<string, {archived?: boolean}>()
    const messages = [
      makeMessage("active-1", "active-room", "alice", 10),
      makeMessage("archived-1", "archived-room", "bob", 20),
    ]

    const result = filterArchivedRoomMessages({url, messages, roomsById, channelsById})

    expect(result.map(event => event.id)).toEqual(["active-1"])
  })

  it("marks archived rooms as read-only and disables membership requests", () => {
    const result = getRoomInteractionState({
      isArchivedRoom: true,
      isClosed: false,
    })

    expect(result).toMatchObject({
      isReadOnly: true,
      showArchivedBanner: true,
      showPrivateGate: false,
      allowMembershipRequest: false,
      allowMessageActions: false,
      showCompose: false,
    })
  })

  it("keeps active rooms interactive without NIP-29 membership gates", () => {
    const result = getRoomInteractionState({
      isArchivedRoom: false,
      isClosed: false,
    })

    expect(result).toMatchObject({
      isReadOnly: false,
      showRestrictedGate: false,
      allowMembershipRequest: true,
      allowMessageActions: true,
      showCompose: true,
    })
  })
})
