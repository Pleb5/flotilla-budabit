import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {
  makeCommunityForumReply,
  makeCommunityForumThread,
  readCommunityForumReply,
  readCommunityForumThread,
  readCommunityForumThreads,
} from "./community-forum"

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

describe("community forum helpers", () => {
  it("builds forum thread roots without room markers", () => {
    expect(
      makeCommunityForumThread({
        communityPubkey,
        title: "Forum topic",
        content: "Thread body",
      }),
    ).toEqual({
      content: "Thread body",
      tags: [
        ["h", communityPubkey],
        ["title", "Forum topic"],
      ],
    })
  })

  it("reads forum threads and excludes room roots", () => {
    const forum = makeEvent({
      id: "forum-id",
      kind: 11,
      pubkey: creatorPubkey,
      content: "Thread body",
      tags: [
        ["h", communityPubkey],
        ["title", "Forum topic"],
      ],
    })
    const room = makeEvent({
      id: "room-id",
      kind: 11,
      tags: [
        ["h", communityPubkey],
        ["room"],
        ["title", "General"],
      ],
    })

    expect(readCommunityForumThread(forum, communityPubkey)).toMatchObject({
      id: "forum-id",
      communityPubkey,
      title: "Forum topic",
      content: "Thread body",
      creatorPubkey,
    })
    expect(readCommunityForumThread(room, communityPubkey)).toBeUndefined()
    expect(readCommunityForumThreads([forum, room], communityPubkey).map(thread => thread.id)).toEqual([
      "forum-id",
    ])
  })

  it("builds and reads community-scoped forum replies", () => {
    const template = makeCommunityForumReply({
      communityPubkey,
      thread: {id: "thread-id", creatorPubkey},
      relay: "wss://relay.example.com/",
      content: "Reply body",
    })
    const reply = makeEvent({id: "reply-id", kind: 1111, tags: template.tags, content: template.content})

    expect(template).toEqual({
      content: "Reply body",
      tags: [
        ["h", communityPubkey],
        ["E", "thread-id", "wss://relay.example.com/", creatorPubkey],
        ["K", "11"],
        ["P", creatorPubkey, "wss://relay.example.com/"],
      ],
    })
    expect(readCommunityForumReply(reply, communityPubkey, "thread-id")).toMatchObject({
      id: "reply-id",
      communityPubkey,
      threadId: "thread-id",
    })
    expect(readCommunityForumReply(reply, communityPubkey, "other-thread")).toBeUndefined()
  })
})
