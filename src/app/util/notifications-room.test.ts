// @vitest-environment jsdom

import {beforeEach, describe, expect, it, vi} from "vitest"
import {get, writable} from "svelte/store"
import type {TrustedEvent} from "@welshman/util"

const mockPubkey = writable<string | undefined>("viewer")
const mockChatsById = writable(new Map())
const mockUserGroupList = writable({} as any)
const mockRelaysByUrl = writable(new Map())
const mockRoomsById = writable(new Map())
const mockChannelsById = writable(new Map())
const mockUserSettingsValues = writable({show_notifications_badge: false})
const mockCommentsByUrl = writable(new Map())
const mockMessagesByUrl = writable(new Map())

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
}))

vi.mock("@welshman/store", () => ({
  synced: ({defaultValue}: {defaultValue: unknown}) => writable(defaultValue),
  throttled: (_delay: number, store: unknown) => store,
  deriveEventsByIdByUrl: ({filters}: {filters: Array<Record<string, unknown>>}) => {
    const firstFilter = filters[0] || {}

    return firstFilter["#K"] ? mockCommentsByUrl : mockMessagesByUrl
  },
}))

vi.mock("@welshman/app", () => ({
  pubkey: mockPubkey,
  tracker: {},
  repository: {},
  relaysByUrl: mockRelaysByUrl,
}))

vi.mock("@app/util/routes", () => ({
  makeSpacePath: (url: string) => `/spaces/${encodeURIComponent(url)}`,
  makeChatPath: (id: string) => `/chat/${id}`,
  makeGoalPath: (url: string, id?: string) =>
    id
      ? `/spaces/${encodeURIComponent(url)}/goals/${id}`
      : `/spaces/${encodeURIComponent(url)}/goals`,
  makeThreadPath: (url: string, id?: string) =>
    id
      ? `/spaces/${encodeURIComponent(url)}/threads/${id}`
      : `/spaces/${encodeURIComponent(url)}/threads`,
  makeCalendarPath: (url: string, id?: string) =>
    id
      ? `/spaces/${encodeURIComponent(url)}/calendar/${id}`
      : `/spaces/${encodeURIComponent(url)}/calendar`,
  makeSpaceChatPath: (url: string) => `/spaces/${encodeURIComponent(url)}/chat`,
  makeRoomPath: (url: string, h: string) => `/spaces/${encodeURIComponent(url)}/${h}`,
}))

vi.mock("@app/core/state", () => ({
  chatsById: mockChatsById,
  hasNip29: (relay?: {supported_nips?: Array<number | string>}) =>
    relay?.supported_nips?.map(String).includes("29"),
  userSettingsValues: mockUserSettingsValues,
  userGroupList: mockUserGroupList,
  getSpaceUrlsFromGroupList: () => ["wss://space.one"],
  getSpaceRoomsFromGroupList: () => ["active-room", "archived-room"],
  encodeRelay: (url: string) => encodeURIComponent(url),
  makeRoomId: (url: string, h: string) => `${url}'${h}`,
  roomsById: mockRoomsById,
}))

vi.mock("@lib/budabit/state", () => ({
  channelsById: mockChannelsById,
  makeChannelId: (url: string, h: string) => `${url}'${h}`,
}))

vi.mock("@welshman/util", () => ({
  ZAP_GOAL: 9041,
  EVENT_TIME: 31922,
  MESSAGE: 9,
  THREAD: 11,
  COMMENT: 1111,
  getTagValue: (name: string, tags: string[][]) => tags.find(tag => tag[0] === name)?.[1] || "",
  Address: {
    fromNaddr: () => ({toString: () => "30617:pubkey:repo"}),
  },
}))

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

describe("room notifications", () => {
  beforeEach(() => {
    vi.resetModules()
    mockPubkey.set("viewer")
    mockChatsById.set(new Map())
    mockUserGroupList.set({} as any)
    mockRelaysByUrl.set(new Map([["wss://space.one", {supported_nips: [29]}]]))
    mockRoomsById.set(new Map())
    mockChannelsById.set(new Map())
    mockUserSettingsValues.set({show_notifications_badge: false})
    mockCommentsByUrl.set(new Map())
    mockMessagesByUrl.set(new Map())
  })

  it("skips archived room paths while keeping active room notifications", async () => {
    mockRoomsById.set(
      new Map([
        ["wss://space.one'active-room", {isArchived: false}],
        ["wss://space.one'archived-room", {isArchived: true}],
      ]),
    )
    mockMessagesByUrl.set(
      new Map([
        [
          "wss://space.one",
          new Map([
            ["active-1", makeMessage("active-1", "active-room", "alice", 20)],
            ["archived-1", makeMessage("archived-1", "archived-room", "bob", 30)],
          ]),
        ],
      ]),
    )

    const {notifications} = await import("./notifications")
    const paths = get(notifications)

    expect(paths.has("/spaces/wss%3A%2F%2Fspace.one/active-room")).toBe(true)
    expect(paths.has("/spaces/wss%3A%2F%2Fspace.one/archived-room")).toBe(false)
  })

  it("uses channel archive state as a fallback when room state is unavailable", async () => {
    mockChannelsById.set(new Map([["wss://space.one'archived-room", {archived: true}]]))
    mockMessagesByUrl.set(
      new Map([
        [
          "wss://space.one",
          new Map([["archived-1", makeMessage("archived-1", "archived-room", "alice", 20)]]),
        ],
      ]),
    )

    const {notifications} = await import("./notifications")
    const paths = get(notifications)

    expect(paths.has("/spaces/wss%3A%2F%2Fspace.one/archived-room")).toBe(false)
    expect(paths.has("/spaces/wss%3A%2F%2Fspace.one")).toBe(false)
  })
})
