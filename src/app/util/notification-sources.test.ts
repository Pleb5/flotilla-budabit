// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {readable} from "svelte/store"
import {GIT_COMMENT, GIT_ISSUE, GIT_STATUS_CLOSED} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {COMMENT, MESSAGE, NOTE, REACTION, THREAD, ZAP_RESPONSE} from "@welshman/util"
import type {Chat} from "@app/core/state"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import {
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_THREADS,
  PROFILE_LIST_KIND,
} from "@app/core/community"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
}))

vi.mock("@app/core/repo-watch", () => ({
  repoWatchNotificationSeen: readable({}),
}))

vi.mock("@app/util/repo-watch-notifications", () => ({
  repoWatchNotificationCandidates: readable([]),
}))

const makeEvent = (overrides: Partial<TrustedEvent> = {}) =>
  ({
    id: "event-a",
    kind: 4444,
    pubkey: "alice",
    created_at: 100,
    tags: [["p", "viewer"]],
    content: "ciphertext",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeChat = (event: TrustedEvent, overrides: Partial<Chat> = {}): Chat => ({
  id: event.pubkey,
  pubkeys: ["viewer", event.pubkey],
  messages: [event],
  latestMessage: event,
  latestIncomingMessage: event,
  last_activity: event.created_at,
  search_text: event.pubkey,
  ...overrides,
})

const viewer = "a".repeat(64)
const writer = "b".repeat(64)
const outsider = "c".repeat(64)
const banned = "d".repeat(64)
const muted = "e".repeat(64)
const communityPubkey = "f".repeat(64)
const profileListPubkey = "1".repeat(64)
const zapper = "2".repeat(64)
const profileListAddress = `${PROFILE_LIST_KIND}:${profileListPubkey}:${COMMUNITY_SECTION_GENERAL}`
const threadProfileListAddress = `${PROFILE_LIST_KIND}:${profileListPubkey}:${COMMUNITY_SECTION_THREADS}`

const makeCommunityRef = (): ActiveUserCommunityRef => ({
  communityPubkey,
  relayHints: [],
  roles: ["member"],
  writableSections: [COMMUNITY_SECTION_GENERAL, COMMUNITY_SECTION_THREADS],
  definition: {
    event: makeEvent({id: "community", kind: 10222, pubkey: communityPubkey}),
    pubkey: communityPubkey,
    relays: [],
    blossomServers: [],
    mints: [],
    sections: [
      {
        name: COMMUNITY_SECTION_GENERAL,
        kinds: [{kind: MESSAGE, subtype: "room-message"}, {kind: COMMENT}],
        profileLists: [
          {
            kind: PROFILE_LIST_KIND,
            pubkey: profileListPubkey,
            identifier: COMMUNITY_SECTION_GENERAL,
            address: profileListAddress,
          },
        ],
        badges: [],
        retention: [],
      },
      {
        name: COMMUNITY_SECTION_THREADS,
        kinds: [{kind: THREAD, subtype: "threads"}],
        profileLists: [
          {
            kind: PROFILE_LIST_KIND,
            pubkey: profileListPubkey,
            identifier: COMMUNITY_SECTION_THREADS,
            address: threadProfileListAddress,
          },
        ],
        badges: [],
        retention: [],
      },
    ],
  },
})

const makeProfileList = (address = profileListAddress) => {
  const [, pubkey, identifier] = address.split(":")

  return makeEvent({
    id: `profile-list-${identifier}`,
    kind: PROFILE_LIST_KIND,
    pubkey,
    tags: [
      ["d", identifier],
      ["p", writer],
      ["p", viewer],
    ],
  })
}

describe("notification sources", () => {
  it("builds unread chat rows from latest incoming DM events", async () => {
    const {buildChatNotificationRows} = await import("./notification-sources")
    const event = makeEvent()

    expect(
      buildChatNotificationRows({
        chats: [makeChat(event)],
        getPlaintext: () => "hello from alice",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "event:event-a",
        eventId: "event-a",
        actorPubkey: "alice",
        source: "chat",
        type: "chat",
        title: "Direct message",
        preview: "hello from alice",
        action: "messaged you",
        contextLabel: "Direct message",
        path: "/chat/alice",
        readPath: "/chat/alice",
        navigationEventId: "event-a",
        detail: expect.objectContaining({label: "Message", actionLabel: "Open chat"}),
        createdAt: 100,
      }),
    ])
  })

  it("builds route fallback rows with source labels and read paths", async () => {
    const {buildRouteNotificationRows} = await import("./notification-sources")

    const rows = buildRouteNotificationRows({
      paths: [
        "/chat",
        "/chat/alice",
        "/git/repo",
        "/c/community/rooms/root",
        "/c/community/git",
        "/settings",
        "/settings/git",
      ],
      excludedPaths: new Set(["/chat/alice"]),
    })

    expect(rows).toHaveLength(4)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: "chat", path: "/chat", readPath: "/chat/*"}),
        expect.objectContaining({source: "git", path: "/git/repo"}),
        expect.objectContaining({source: "other", path: "/settings"}),
        expect.objectContaining({source: "other", path: "/settings/git"}),
      ]),
    )
    expect(rows.map(row => row.path)).not.toEqual(
      expect.arrayContaining(["/c/community/rooms/root", "/c/community/git"]),
    )
    expect(rows.find(row => row.path === "/git/repo")?.preview).toBe("Open git activity")
    expect(rows.find(row => row.path === "/git/repo")?.preview).not.toContain("/")
  })

  it("filters notification rows by selected sources and profile names", async () => {
    const {filterNotificationRows, NOTIFICATION_ROW_FILTERS} = await import("./notification-display")
    const rows = [
      {
        id: "event:chat",
        eventId: "chat",
        source: "chat",
        sourceLabel: "Chats",
        title: "Direct message",
        preview: "hello alice",
        path: "/chat/alice",
        readPath: "/chat/alice",
        createdAt: 100,
        searchText: "chat alice hello",
      },
      {
        id: "event:community",
        eventId: "community",
        source: "community",
        sourceLabel: "Communities",
        title: "New room reply",
        preview: "reply from a community member",
        path: "/c/community/rooms/root",
        readPath: "/c/community/rooms/root",
        createdAt: 50,
        actorName: "Ada Lovelace",
        searchText: "community reply",
      },
      {
        id: "route:/git/repo",
        source: "git",
        sourceLabel: "Git",
        title: "Unread git activity",
        preview: "repo issue",
        path: "/git/repo",
        readPath: "/git/repo",
        createdAt: 0,
        searchText: "git repo ada issue",
      },
    ] as const
    const filterValues = NOTIFICATION_ROW_FILTERS.map(option => option.value)

    expect(filterValues).toEqual(["chat", "git", "community", "other"])
    expect(filterValues).not.toEqual(
      expect.arrayContaining(["all", "read", "social", "unread"]),
    )
    expect(filterValues.join(" ")).not.toMatch(new RegExp(["re", "post"].join(""), "i"))
    expect(filterNotificationRows([...rows], {filters: ["git"]}).map(row => row.id)).toEqual([
      "route:/git/repo",
    ])
    expect(
      filterNotificationRows([...rows], {filters: ["git", "community"]}).map(row => row.id),
    ).toEqual(["event:community", "route:/git/repo"])
    expect(filterNotificationRows([...rows], {term: "alice"}).map(row => row.id)).toEqual([
      "event:chat",
    ])
    expect(filterNotificationRows([...rows], {term: "lovelace"}).map(row => row.id)).toEqual([
      "event:community",
    ])
    expect(filterNotificationRows([...rows], {term: "ada"}).map(row => row.id)[0]).toBe(
      "event:community",
    )
  })

  it("keeps user-specific community access and suppresses generic community rows", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const allowedMessage = makeEvent({
      id: "allowed-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 50,
      content: "hello community",
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const outsiderMessage = makeEvent({
      id: "outsider-message",
      kind: MESSAGE,
      pubkey: outsider,
      created_at: 60,
      tags: [
        ["h", communityPubkey],
        ["E", "room-two"],
      ],
    })
    const bannedMessage = makeEvent({
      id: "banned-message",
      kind: MESSAGE,
      pubkey: banned,
      created_at: 70,
      tags: [
        ["h", communityPubkey],
        ["E", "room-three"],
      ],
    })
    const mutedMessage = makeEvent({
      id: "muted-message",
      kind: MESSAGE,
      pubkey: muted,
      created_at: 80,
      tags: [
        ["h", communityPubkey],
        ["E", "room-four"],
      ],
    })
    const censoredMessage = makeEvent({
      id: "censored-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 90,
      tags: [
        ["h", communityPubkey],
        ["E", "room-five"],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [allowedMessage, outsiderMessage, bannedMessage, mutedMessage, censoredMessage],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
      reportStates: new Map([
        [
          communityPubkey,
          {
            personReports: [{targetPubkey: banned}],
            eventReports: [
              {
                targetEventId: censoredMessage.id,
                sectionName: COMMUNITY_SECTION_GENERAL,
              },
            ],
          } as any,
        ],
      ]),
      mutedPubkeys: [muted],
    })

    expect(rows.map(row => row.eventId)).toEqual(expect.arrayContaining(["profile-list-General"]))
    expect(rows.map(row => row.eventId)).not.toEqual(
      expect.arrayContaining([
        "allowed-message",
        "outsider-message",
        "banned-message",
        "muted-message",
        "censored-message",
      ]),
    )
    expect(rows.find(row => row.eventId === allowedMessage.id)).toBeUndefined()
    expect(rows.find(row => row.eventId === "profile-list-General")).toEqual(
      expect.objectContaining({
        source: "community",
        title: "Community access update",
      }),
    )
  })

  it("builds repo-watch rows with readable labels and seen paths", async () => {
    const {buildRepoWatchNotificationRows} = await import("./notification-sources")
    const issue = makeEvent({
      id: "issue-id",
      kind: GIT_ISSUE,
      pubkey: writer,
      created_at: 100,
      content: "Broken thing",
    })
    const comment = makeEvent({
      id: "comment-id",
      kind: GIT_COMMENT,
      pubkey: writer,
      created_at: 200,
      content: "I can reproduce this",
      tags: [
        ["E", issue.id],
        ["K", String(GIT_ISSUE)],
      ],
    })
    const status = makeEvent({
      id: "status-id",
      kind: GIT_STATUS_CLOSED,
      pubkey: writer,
      created_at: 300,
      tags: [
        ["e", "non-root-id"],
        ["e", issue.id, "", "root"],
      ],
    })
    const path = "/git/repo/issues"

    expect(
      buildRepoWatchNotificationRows({
        candidates: [{path, latestEvent: issue}],
      })[0],
    ).toEqual(
      expect.objectContaining({
        source: "git",
        type: "repo",
        title: "New issue",
        preview: "Broken thing",
        action: "opened an issue",
        contextLabel: "Issue",
        path: `${path}/${issue.id}`,
        readPath: path,
        repoWatchSeenPath: path,
        target: expect.objectContaining({label: "Issue", eventId: issue.id}),
      }),
    )

    expect(
      buildRepoWatchNotificationRows({
        candidates: [{path, latestEvent: comment}],
      })[0],
    ).toEqual(
      expect.objectContaining({
        title: "New git comment",
        path: `${path}/${issue.id}#comment-${comment.id}`,
      }),
    )

    expect(
      buildRepoWatchNotificationRows({
        candidates: [{path, latestEvent: status}],
      })[0]?.path,
    ).toBe(`${path}/${issue.id}`)
  })

  it("labels community room replies to the signed-in user's message", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const parentMessage = makeEvent({
      id: "parent-message",
      kind: MESSAGE,
      pubkey: viewer,
      created_at: 90,
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const replyMessage = makeEvent({
      id: "reply-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      content: "reply in room",
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
        ["q", parentMessage.id, "", viewer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [replyMessage],
      targetEvents: [parentMessage],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
    })

    expect(rows.find(row => row.eventId === replyMessage.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New room reply",
        actorPubkey: writer,
        path: expect.stringContaining("/rooms/room-one"),
        target: expect.objectContaining({label: "Your room message", eventId: parentMessage.id}),
        detail: expect.objectContaining({label: "Reply", eventId: replyMessage.id}),
      }),
    )
  })

  it("does not label room replies when the parent is outside the same room", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const parentMessage = makeEvent({
      id: "parent-message",
      kind: MESSAGE,
      pubkey: viewer,
      created_at: 90,
      tags: [
        ["h", communityPubkey],
        ["E", "room-two"],
      ],
    })
    const replyMessage = makeEvent({
      id: "reply-message",
      kind: MESSAGE,
      pubkey: writer,
      created_at: 100,
      content: "reply in another room",
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
        ["q", parentMessage.id, "", viewer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [replyMessage],
      targetEvents: [parentMessage],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
    })

    expect(rows.find(row => row.eventId === replyMessage.id)).toBeUndefined()
  })

  it("notifies only thread replies to the signed-in user's comments", async () => {
    const {buildCommunityNotificationRows} = await import("./notification-sources")
    const ref = makeCommunityRef()
    const parentComment = makeEvent({
      id: "parent-comment",
      kind: COMMENT,
      pubkey: viewer,
      created_at: 90,
      tags: [
        ["h", communityPubkey],
        ["E", "thread-one"],
        ["K", String(THREAD)],
      ],
    })
    const commentReply = makeEvent({
      id: "comment-reply",
      kind: COMMENT,
      pubkey: writer,
      created_at: 110,
      content: "reply to your comment",
      tags: [
        ["h", communityPubkey],
        ["E", "thread-one"],
        ["K", String(THREAD)],
        ["e", parentComment.id, "", viewer],
        ["k", String(COMMENT)],
        ["p", viewer],
      ],
    })
    const rootThreadReply = makeEvent({
      id: "root-thread-reply",
      kind: COMMENT,
      pubkey: writer,
      created_at: 120,
      content: "reply to thread root",
      tags: [
        ["h", communityPubkey],
        ["E", "thread-one"],
        ["K", String(THREAD)],
        ["P", viewer],
      ],
    })
    const foreignParentComment = makeEvent({
      id: "foreign-parent-comment",
      kind: COMMENT,
      pubkey: viewer,
      created_at: 90,
      tags: [
        ["h", communityPubkey],
        ["E", "thread-two"],
        ["K", String(THREAD)],
      ],
    })
    const crossThreadReply = makeEvent({
      id: "cross-thread-reply",
      kind: COMMENT,
      pubkey: writer,
      created_at: 130,
      content: "reply to a parent in another thread",
      tags: [
        ["h", communityPubkey],
        ["E", "thread-one"],
        ["K", String(THREAD)],
        ["e", foreignParentComment.id, "", viewer],
        ["k", String(COMMENT)],
        ["p", viewer],
      ],
    })

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [commentReply, rootThreadReply, crossThreadReply],
      targetEvents: [parentComment, foreignParentComment],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
    })

    expect(rows.map(row => row.eventId)).toEqual(
      expect.arrayContaining(["profile-list-General", commentReply.id]),
    )
    expect(rows.map(row => row.eventId)).not.toEqual(
      expect.arrayContaining([rootThreadReply.id, crossThreadReply.id]),
    )
    expect(rows.find(row => row.eventId === commentReply.id)).toEqual(
      expect.objectContaining({
        source: "community",
        type: "reply",
        title: "New thread comment reply",
        path: expect.stringContaining("/threads/thread-one"),
        target: expect.objectContaining({label: "Your comment", eventId: parentComment.id}),
      }),
    )
  })

  it("builds targeted engagement rows without generic p-tag noise", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const ownedNoteId = "3".repeat(64)
    const otherNoteId = "4".repeat(64)
    const replyId = "5".repeat(64)
    const mentionId = "6".repeat(64)
    const inheritedReplyTagId = "7".repeat(64)
    const ignoredBoostId = "8".repeat(64)
    const ownedNote = makeEvent({id: ownedNoteId, kind: NOTE, pubkey: viewer, content: "my note"})
    const otherNote = makeEvent({id: otherNoteId, kind: NOTE, pubkey: outsider, content: "other note"})
    const reply = makeEvent({
      id: replyId,
      kind: NOTE,
      pubkey: writer,
      created_at: 110,
      content: "replying to your note",
      tags: [
        ["e", ownedNote.id, "", "reply"],
        ["p", viewer],
      ],
    })
    const mention = makeEvent({
      id: mentionId,
      kind: NOTE,
      pubkey: outsider,
      created_at: 120,
      content: "hi #[0]",
      tags: [["p", viewer]],
    })
    const inheritedReplyTag = makeEvent({
      id: inheritedReplyTagId,
      kind: NOTE,
      pubkey: writer,
      created_at: 130,
      content: "replying elsewhere",
      tags: [
        ["e", otherNote.id, "", "reply"],
        ["p", viewer],
      ],
    })
    const ignoredBoost = makeEvent({
      id: ignoredBoostId,
      kind: 6,
      pubkey: writer,
      created_at: 140,
      tags: [
        ["e", ownedNote.id],
        ["p", viewer],
      ],
    })

    const rows = buildEngagementNotificationRows({
      events: [reply, mention, inheritedReplyTag, ignoredBoost],
      targetEvents: [ownedNote, otherNote],
      currentPubkey: viewer,
    })

    expect(rows.map(row => row.eventId)).toEqual([mentionId, replyId])
    expect(rows.find(row => row.eventId === reply.id)).toEqual(
      expect.objectContaining({
        source: "other",
        sourceLabel: "Engagement",
        type: "reply",
        title: "New reply",
        actorPubkey: writer,
        target: expect.objectContaining({label: "your note", eventId: ownedNote.id}),
        detail: expect.objectContaining({label: "Reply", eventId: reply.id}),
      }),
    )
    expect(rows.find(row => row.eventId === mention.id)).toEqual(
      expect.objectContaining({
        source: "other",
        sourceLabel: "Engagement",
        type: "mention",
        title: "New mention",
        actorPubkey: outsider,
        detail: expect.objectContaining({label: "Mention", eventId: mention.id}),
      }),
    )
    expect(rows.map(row => row.eventId)).not.toEqual(
      expect.arrayContaining([inheritedReplyTag.id, ignoredBoost.id]),
    )
  })

  it("groups reactions and verified zaps only for signed-in user's targets", async () => {
    const {buildEngagementNotificationRows} = await import("./notification-sources")
    const ownedNoteId = "3".repeat(64)
    const otherNoteId = "4".repeat(64)
    const reactionOneId = "5".repeat(64)
    const reactionTwoId = "6".repeat(64)
    const falseReactionId = "7".repeat(64)
    const validZapId = "8".repeat(64)
    const invalidZapId = "9".repeat(64)
    const falseZapId = "0".repeat(64)
    const ownedNote = makeEvent({id: ownedNoteId, kind: NOTE, pubkey: viewer, content: "my note"})
    const otherNote = makeEvent({id: otherNoteId, kind: NOTE, pubkey: outsider, content: "other note"})
    const reactionOne = makeEvent({
      id: reactionOneId,
      kind: REACTION,
      pubkey: writer,
      created_at: 100,
      content: "+",
      tags: [
        ["e", ownedNote.id],
        ["p", viewer],
      ],
    })
    const reactionTwo = makeEvent({
      id: reactionTwoId,
      kind: REACTION,
      pubkey: outsider,
      created_at: 120,
      content: "fire",
      tags: [
        ["e", ownedNote.id],
        ["p", viewer],
      ],
    })
    const falseReaction = makeEvent({
      id: falseReactionId,
      kind: REACTION,
      pubkey: writer,
      created_at: 130,
      content: "+",
      tags: [
        ["e", otherNote.id],
        ["p", viewer],
      ],
    })
    const zapRequest = {
      pubkey: writer,
      content: "nice post",
      tags: [
        ["p", viewer],
        ["e", ownedNote.id],
        ["amount", "21000"],
      ],
    }
    const validZap = makeEvent({
      id: validZapId,
      kind: ZAP_RESPONSE,
      pubkey: zapper,
      created_at: 140,
      tags: [
        ["p", viewer],
        ["e", ownedNote.id],
        ["description", JSON.stringify(zapRequest)],
      ],
    })
    const invalidZap = makeEvent({
      id: invalidZapId,
      kind: ZAP_RESPONSE,
      pubkey: zapper,
      created_at: 150,
      tags: [
        ["p", viewer],
        ["e", ownedNote.id],
        ["description", JSON.stringify(zapRequest)],
      ],
    })
    const falseZap = makeEvent({
      id: falseZapId,
      kind: ZAP_RESPONSE,
      pubkey: zapper,
      created_at: 160,
      tags: [
        ["p", viewer],
        ["e", otherNote.id],
        ["description", JSON.stringify({...zapRequest, tags: [["e", otherNote.id], ["p", viewer]]})],
      ],
    })

    const rows = buildEngagementNotificationRows({
      events: [reactionOne, reactionTwo, falseReaction, validZap, invalidZap, falseZap],
      targetEvents: [ownedNote, otherNote],
      currentPubkey: viewer,
      validZapResponseIds: new Set([validZap.id, falseZap.id]),
    })
    const reactionRow = rows.find(row => row.title === "New reactions")
    const zapRow = rows.find(row => row.title === "New zap")

    expect(reactionRow).toEqual(
      expect.objectContaining({
        source: "other",
        sourceLabel: "Engagement",
        type: "reaction",
        eventId: reactionTwo.id,
        eventIds: [reactionTwo.id, reactionOne.id],
        id: expect.stringContaining(ownedNote.id),
        target: expect.objectContaining({label: "your note", eventId: ownedNote.id}),
      }),
    )
    expect(zapRow).toEqual(
      expect.objectContaining({
        source: "other",
        sourceLabel: "Engagement",
        type: "zap",
        eventId: validZap.id,
        actorPubkey: writer,
        eventIds: [validZap.id],
        preview: expect.stringContaining("nice post"),
        target: expect.objectContaining({label: "your note", eventId: ownedNote.id}),
      }),
    )
    expect(rows.flatMap(row => row.eventIds || [row.eventId])).not.toEqual(
      expect.arrayContaining([falseReaction.id, invalidZap.id, falseZap.id]),
    )
  })
})
