import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  makeCommunityThread,
  makeCommunityThreadReply,
  readCommunityThread,
  readCommunityThreadReply,
  readCommunityThreads,
} from "./community-threads"

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

describe("community thread helpers", () => {
  it("builds thread roots without room markers", () => {
    expect(
      makeCommunityThread({
        communityPubkey,
        title: "Thread topic",
        content: "Thread body",
      }),
    ).toEqual({
      content: "Thread body",
      tags: [
        ["h", communityPubkey],
        ["title", "Thread topic"],
      ],
    })
  })

  it("reads threads and excludes room roots", () => {
    const thread = makeEvent({
      id: "thread-id",
      kind: 11,
      pubkey: creatorPubkey,
      content: "Thread body",
      tags: [
        ["h", communityPubkey],
        ["title", "Thread topic"],
      ],
    })
    const room = makeEvent({
      id: "room-id",
      kind: 11,
      tags: [["h", communityPubkey], ["room"], ["title", "General"]],
    })

    expect(readCommunityThread(thread, communityPubkey)).toMatchObject({
      id: "thread-id",
      communityPubkey,
      title: "Thread topic",
      content: "Thread body",
      creatorPubkey,
    })
    expect(readCommunityThread(room, communityPubkey)).toBeUndefined()
    expect(readCommunityThreads([thread, room], communityPubkey).map(thread => thread.id)).toEqual([
      "thread-id",
    ])
  })

  it("builds and reads community-scoped thread replies", () => {
    const template = makeCommunityThreadReply({
      communityPubkey,
      thread: {id: "thread-id", creatorPubkey},
      relay: "wss://relay.example.com/",
      content: "Reply body",
    })
    const reply = makeEvent({
      id: "reply-id",
      kind: 1111,
      tags: template.tags,
      content: template.content,
    })

    expect(template).toEqual({
      content: "Reply body",
      tags: [
        ["h", communityPubkey],
        ["E", "thread-id", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["P", creatorPubkey, "wss://relay.example.com/"],
      ],
    })
    expect(readCommunityThreadReply(reply, communityPubkey, "thread-id")).toMatchObject({
      id: "reply-id",
      communityPubkey,
      threadId: "thread-id",
      parentReplyId: "",
    })
    expect(readCommunityThreadReply(reply, communityPubkey, "other-thread")).toBeUndefined()
  })

  it("builds thread replies to other replies while keeping the root thread scope", () => {
    const template = makeCommunityThreadReply({
      communityPubkey,
      thread: {id: "thread-id", creatorPubkey},
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
      ["E", "thread-id", "wss://relay.example.com/", creatorPubkey],
      ["K", "11"],
      ["P", creatorPubkey, "wss://relay.example.com/"],
      ["e", "parent-reply-id", "wss://relay.example.com/", authorPubkey],
      ["k", "1111"],
      ["p", authorPubkey, "wss://relay.example.com/"],
    ])
    expect(readCommunityThreadReply(reply, communityPubkey, "thread-id")).toMatchObject({
      id: "reply-id",
      threadId: "thread-id",
      parentReplyId: "parent-reply-id",
    })
  })
})
