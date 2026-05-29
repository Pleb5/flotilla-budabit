import {describe, expect, it} from "vitest"
import {EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {
  getCalendarEventAddress,
  makeCommunityCalendarEventReply,
  readCommunityCalendarEventReply,
} from "./community-calendar"

const communityPubkey = "a".repeat(64)
const creatorPubkey = "b".repeat(64)
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

describe("community calendar helpers", () => {
  it("builds and reads top-level calendar event replies", () => {
    const calendarEvent = makeEvent({
      id: "calendar-id",
      kind: EVENT_TIME,
      pubkey: creatorPubkey,
      tags: [["d", "calendar-1"]],
    })
    const address = getCalendarEventAddress(calendarEvent)
    const template = makeCommunityCalendarEventReply({
      communityPubkey,
      calendarEvent,
      relay: "wss://relay.example.com/",
      content: "Comment body",
    })
    const reply = makeEvent({
      id: "reply-id",
      kind: 1111,
      tags: template.tags,
      content: template.content,
    })

    expect(address).toBe(`${EVENT_TIME}:${creatorPubkey}:calendar-1`)
    expect(template).toEqual({
      content: "Comment body",
      tags: [
        ["h", communityPubkey],
        ["E", "calendar-id", "wss://relay.example.com/", creatorPubkey],
        ["K", String(EVENT_TIME)],
        ["P", creatorPubkey, "wss://relay.example.com/"],
        ["A", address, "wss://relay.example.com/", creatorPubkey],
        ["e", "calendar-id", "wss://relay.example.com/", creatorPubkey],
        ["k", String(EVENT_TIME)],
        ["p", creatorPubkey, "wss://relay.example.com/"],
        ["a", address, "wss://relay.example.com/", creatorPubkey],
      ],
    })
    expect(
      readCommunityCalendarEventReply(reply, communityPubkey, "calendar-id", address),
    ).toMatchObject({
      id: "reply-id",
      communityPubkey,
      calendarEventId: "calendar-id",
      calendarAddress: address,
      parentReplyId: "",
    })
    expect(
      readCommunityCalendarEventReply(reply, communityPubkey, "other-calendar", ""),
    ).toBeUndefined()
  })

  it("builds replies to comments while keeping the root calendar scope", () => {
    const calendarEvent = makeEvent({
      id: "calendar-id",
      kind: EVENT_TIME,
      pubkey: creatorPubkey,
      tags: [["d", "calendar-1"]],
    })
    const address = getCalendarEventAddress(calendarEvent)
    const template = makeCommunityCalendarEventReply({
      communityPubkey,
      calendarEvent,
      parent: {id: "parent-reply-id", pubkey: authorPubkey, relay: "wss://relay.example.com/"},
      relay: "wss://relay.example.com/",
      content: "Nested reply body",
    })
    const reply = makeEvent({
      id: "reply-id",
      kind: 1111,
      tags: template.tags,
      content: template.content,
    })

    expect(template.tags).toEqual([
      ["h", communityPubkey],
      ["E", "calendar-id", "wss://relay.example.com/", creatorPubkey],
      ["K", String(EVENT_TIME)],
      ["P", creatorPubkey, "wss://relay.example.com/"],
      ["A", address, "wss://relay.example.com/", creatorPubkey],
      ["e", "parent-reply-id", "wss://relay.example.com/", authorPubkey],
      ["k", "1111"],
      ["p", authorPubkey, "wss://relay.example.com/"],
    ])
    expect(
      readCommunityCalendarEventReply(reply, communityPubkey, "calendar-id", address),
    ).toMatchObject({
      id: "reply-id",
      calendarEventId: "calendar-id",
      calendarAddress: address,
      parentReplyId: "parent-reply-id",
    })
  })
})
