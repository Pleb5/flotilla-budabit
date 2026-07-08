// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import {readable} from "svelte/store"
import {GIT_COMMENT, GIT_ISSUE} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"
import {COMMENT, MESSAGE, THREAD} from "@welshman/util"
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
        title: "Direct message",
        preview: "hello from alice",
        path: "/chat/alice",
        readPath: "/chat/alice",
        createdAt: 100,
      }),
    ])
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
    expect(filterValues).not.toEqual(expect.arrayContaining(["all", "read", "social", "unread"]))
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
      })[0],
    ).toEqual(
      expect.objectContaining({
        source: "git",
        title: "New issue",
        preview: "Broken thing",
        path: `${path}/${issue.id}`,
        readPath: path,
        repoWatchSeenPath: path,
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
        title: "New room reply",
        actorPubkey: writer,
        path: expect.stringContaining("/rooms/room-one"),
      }),
    )
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

    const rows = buildCommunityNotificationRows({
      refs: [ref],
      events: [commentReply, rootThreadReply],
      targetEvents: [parentComment],
      profileListEvents: [makeProfileList()],
      currentPubkey: viewer,
    })

    expect(rows.map(row => row.eventId)).toEqual(
      expect.arrayContaining(["profile-list-General", commentReply.id]),
    )
    expect(rows.map(row => row.eventId)).not.toEqual(expect.arrayContaining([rootThreadReply.id]))
    expect(rows.find(row => row.eventId === commentReply.id)).toEqual(
      expect.objectContaining({
        source: "community",
        title: "New thread comment reply",
        path: expect.stringContaining("/threads/thread-one"),
      }),
    )
  })
})
