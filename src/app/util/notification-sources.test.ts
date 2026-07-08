// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import type {Chat} from "@app/core/state"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
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
})
