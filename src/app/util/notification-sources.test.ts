// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {readable} from "svelte/store"
import {GIT_COMMENT, GIT_ISSUE} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {MESSAGE, NOTE, REACTION, THREAD, ZAP_RESPONSE} from "@welshman/util"
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
        kinds: [{kind: MESSAGE, subtype: "room-message"}],
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
        checked: {},
        currentPubkey: "viewer",
        getPlaintext: () => "hello from alice",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "event:event-a",
        eventId: "event-a",
        actorPubkey: "alice",
        source: "chat",
        title: "Direct message",
        preview: "hello from alice",
        path: "/chat/alice",
        readPath: "/chat/alice",
        createdAt: 100,
        read: false,
      }),
    ])
  })

  it("marks chat rows read when path or event history is read", async () => {
    const {buildChatNotificationRows} = await import("./notification-sources")
    const event = makeEvent()

    expect(
      buildChatNotificationRows({
        chats: [makeChat(event)],
        checked: {"/chat/alice": 101},
        currentPubkey: "viewer",
      })[0].read,
    ).toBe(true)

    expect(
      buildChatNotificationRows({
        chats: [makeChat(event)],
        checked: {},
        currentPubkey: "viewer",
        history: {ids: ["event-a"], readAt: {"event-a": 101}},
      })[0].read,
    ).toBe(true)
  })

  it("builds route fallback rows with source labels and read paths", async () => {
    const {buildRouteNotificationRows} = await import("./notification-sources")

    const rows = buildRouteNotificationRows({
      paths: ["/chat", "/chat/alice", "/git/repo", "/c/community/rooms/root", "/settings"],
      excludedPaths: new Set(["/chat/alice"]),
    })

    expect(rows).toHaveLength(4)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: "chat", path: "/chat", readPath: "/chat/*"}),
        expect.objectContaining({source: "community", path: "/c/community/rooms/root"}),
        expect.objectContaining({source: "git", path: "/git/repo"}),
        expect.objectContaining({source: "other", path: "/settings"}),
      ]),
    )
  })

  it("filters notification rows by read state, source, and search text", async () => {
    const {filterNotificationRows} = await import("./notification-display")
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
        read: false,
        searchText: "chat alice hello",
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
        read: true,
        searchText: "git repo issue",
      },
    ] as const

    expect(filterNotificationRows([...rows], {filter: "unread"}).map(row => row.id)).toEqual([
      "event:chat",
    ])
    expect(filterNotificationRows([...rows], {filter: "git"}).map(row => row.id)).toEqual([
      "route:/git/repo",
    ])
    expect(filterNotificationRows([...rows], {term: "alice"}).map(row => row.id)).toEqual([
      "event:chat",
    ])
  })

  it("builds global community rows with permission and moderation filters", async () => {
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

    expect(rows.map(row => row.eventId)).toEqual(
      expect.arrayContaining(["profile-list-General", "allowed-message"]),
    )
    expect(rows.map(row => row.eventId)).not.toEqual(
      expect.arrayContaining([
        "outsider-message",
        "banned-message",
        "muted-message",
        "censored-message",
      ]),
    )
    expect(rows.find(row => row.eventId === allowedMessage.id)).toEqual(
      expect.objectContaining({
        source: "community",
        title: "New room message",
        preview: "hello community",
        read: false,
      }),
    )
    expect(rows.find(row => row.eventId === allowedMessage.id)?.path).toContain("/rooms/room-one")
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
    const path = "/git/repo/issues"

    expect(
      buildRepoWatchNotificationRows({
        candidates: [{path, latestEvent: issue}],
        currentPubkey: viewer,
      })[0],
    ).toEqual(
      expect.objectContaining({
        source: "git",
        title: "New issue",
        preview: "Broken thing",
        path: `${path}/${issue.id}`,
        readPath: path,
        repoWatchSeenPath: path,
        read: false,
      }),
    )

    expect(
      buildRepoWatchNotificationRows({
        candidates: [{path, latestEvent: comment}],
        currentPubkey: viewer,
        notificationSeen: {[path]: 250},
      })[0],
    ).toEqual(
      expect.objectContaining({
        title: "New git comment",
        path: `${path}/${issue.id}#comment-${comment.id}`,
        read: true,
      }),
    )
  })

  it("classifies social mentions and replies without inherited reply mentions", async () => {
    const {buildSocialNotificationRows} = await import("./notification-sources")
    const ownedNoteId = "3".repeat(64)
    const otherNoteId = "4".repeat(64)
    const replyId = "5".repeat(64)
    const mentionId = "6".repeat(64)
    const inheritedReplyTagId = "7".repeat(64)
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

    const rows = buildSocialNotificationRows({
      events: [reply, mention, inheritedReplyTag],
      targetEvents: [ownedNote, otherNote],
      currentPubkey: viewer,
    })

    expect(rows.map(row => row.eventId)).toEqual([mentionId, replyId])
    expect(rows.find(row => row.eventId === reply.id)).toEqual(
      expect.objectContaining({source: "social", title: "New reply", actorPubkey: writer}),
    )
    expect(rows.find(row => row.eventId === mention.id)).toEqual(
      expect.objectContaining({source: "social", title: "New mention", actorPubkey: outsider}),
    )
  })

  it("suppresses social reaction and zap false positives while collapsing owned targets", async () => {
    const {buildSocialNotificationRows} = await import("./notification-sources")
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

    const rows = buildSocialNotificationRows({
      events: [reactionOne, reactionTwo, falseReaction, validZap, invalidZap, falseZap],
      targetEvents: [ownedNote, otherNote],
      currentPubkey: viewer,
      validZapResponseIds: new Set([validZap.id, falseZap.id]),
    })
    const reactionRow = rows.find(row => row.title === "New reactions")
    const zapRow = rows.find(row => row.title === "New zap")

    expect(reactionRow).toEqual(
      expect.objectContaining({
        source: "social",
        eventId: reactionTwo.id,
        eventIds: [reactionTwo.id, reactionOne.id],
        id: expect.stringContaining(ownedNote.id),
        path: expect.stringMatching(/^\/nevent/),
      }),
    )
    expect(zapRow).toEqual(
      expect.objectContaining({
        source: "social",
        eventId: validZap.id,
        actorPubkey: writer,
        eventIds: [validZap.id],
        preview: expect.stringContaining("nice post"),
      }),
    )
    expect(rows.flatMap(row => row.eventIds || [row.eventId])).not.toEqual(
      expect.arrayContaining([falseReaction.id, invalidZap.id, falseZap.id]),
    )
  })
})
