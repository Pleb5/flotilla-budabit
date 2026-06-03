// @vitest-environment jsdom

import {readable} from "svelte/store"
import {nip19} from "nostr-tools"
import {describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/core/state", () => ({
  chatsById: readable(new Map()),
  userSettingsValues: readable({show_notifications_badge: false}),
}))

vi.mock("@app/core/community-state", () => ({
  activeCommunityDefinition: readable(undefined),
  activeCommunityProfileListEvents: readable([]),
  activeCommunityRelays: readable([]),
  activeCommunityReportState: readable(undefined),
  activeCommunityUserModeratorRequestStates: readable([]),
}))

vi.mock("@app/util/routes", () => ({
  makeChatPath: (id: string) => `/chat/${id}`,
  makeCommunityPath: (community: string, ...extra: string[]) =>
    `/c/${community}${extra.length ? `/${extra.join("/")}` : ""}`,
  makeCommunityCalendarPath: (community: string, event?: string) =>
    `/c/${community}/calendar${event ? `/${event}` : ""}`,
  makeCommunityGoalPath: (community: string, goal?: string) =>
    `/c/${community}/goals${goal ? `/${goal}` : ""}`,
  makeCommunityRoomPath: (community: string, room: string) => `/c/${community}/rooms/${room}`,
  makeCommunityThreadPath: (community: string, thread?: string) =>
    `/c/${community}/threads${thread ? `/${thread}` : ""}`,
}))

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "b".repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("notifications", () => {
  it("matches repo notification helpers against canonical git routes", async () => {
    const {getRepoNotificationPaths, hasRepoNotification, setCheckedForRepoNotifications} =
      await import("./notifications")
    const pubkey = "a".repeat(64)
    const identifier = "flotilla-budabit"
    const naddr = nip19.naddrEncode({kind: 30617, pubkey, identifier})
    const repoAddress = `30617:${pubkey}:${identifier}`
    const paths = new Set([`/git/${naddr}/issues`, `/git/${naddr}/prs`, "/chat/example"])

    expect(getRepoNotificationPaths(paths, {repoAddress, kind: "issues"})).toEqual([
      `/git/${naddr}/issues`,
    ])
    expect(hasRepoNotification(paths, {repoAddress})).toBe(true)
    expect(setCheckedForRepoNotifications(new Set(), {repoAddress})).toBeUndefined()
  })

  it("setupBudabitNotifications returns cleanup", async () => {
    const {setupBudabitNotifications} = await import("./notifications")

    expect(setupBudabitNotifications()).toEqual(expect.any(Function))
  })

  it("creates room notification candidates from latest incoming room messages", async () => {
    const {getRoomMessageNotificationCandidates} = await import("./notifications")
    const communityPubkey = "a".repeat(64)
    const currentPubkey = "b".repeat(64)
    const incomingPubkey = "c".repeat(64)
    const bannedPubkey = "d".repeat(64)
    const roomOneOlder = makeEvent({
      id: "room-one-older",
      pubkey: incomingPubkey,
      created_at: 10,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const roomOneNewer = makeEvent({
      id: "room-one-newer",
      pubkey: incomingPubkey,
      created_at: 20,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const ownLatest = makeEvent({
      id: "own-latest",
      pubkey: currentPubkey,
      created_at: 30,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const roomTwo = makeEvent({
      id: "room-two-message",
      pubkey: incomingPubkey,
      created_at: 15,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-two"],
      ],
    })
    const banned = makeEvent({
      id: "banned-message",
      pubkey: bannedPubkey,
      created_at: 50,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-three"],
      ],
    })
    const otherCommunity = makeEvent({
      id: "other-community-message",
      pubkey: incomingPubkey,
      created_at: 40,
      kind: 9,
      tags: [
        ["h", "e".repeat(64)],
        ["E", "room-one"],
      ],
    })

    expect(
      getRoomMessageNotificationCandidates({
        events: [roomOneOlder, roomOneNewer, ownLatest, roomTwo, banned, otherCommunity],
        communityPubkey,
        currentPubkey,
        allowPubkey: candidatePubkey => candidatePubkey !== bannedPubkey,
      }),
    ).toEqual([
      {path: `/c/${communityPubkey}/rooms/room-one`, latestEvent: roomOneNewer},
      {path: `/c/${communityPubkey}/rooms/room-two`, latestEvent: roomTwo},
    ])
  })

  it("creates section notification candidates from latest incoming root events", async () => {
    const {getSectionRootNotificationCandidates} = await import("./notifications")
    const currentPubkey = "b".repeat(64)
    const incomingPubkey = "c".repeat(64)
    const path = "/c/community/threads"
    const olderThread = makeEvent({
      id: "older-thread",
      pubkey: incomingPubkey,
      created_at: 10,
      kind: 11,
    })
    const newerThread = makeEvent({
      id: "newer-thread",
      pubkey: incomingPubkey,
      created_at: 20,
      kind: 11,
    })
    const ownThread = makeEvent({
      id: "own-thread",
      pubkey: currentPubkey,
      created_at: 30,
      kind: 11,
    })
    const comment = makeEvent({
      id: "comment",
      pubkey: incomingPubkey,
      created_at: 40,
      kind: 1111,
    })

    expect(
      getSectionRootNotificationCandidates({
        events: [olderThread, newerThread, ownThread, comment],
        path,
        currentPubkey,
        allowEvent: event => event.kind === 11,
      }),
    ).toEqual([{path, latestEvent: newerThread}])
  })

  it("creates targeted publication notification candidates from latest incoming roots", async () => {
    const {getTargetedPublicationRootNotificationCandidates} = await import("./notifications")
    const communityPubkey = "a".repeat(64)
    const currentPubkey = "b".repeat(64)
    const incomingPubkey = "c".repeat(64)
    const bannedPubkey = "d".repeat(64)
    const path = `/c/${communityPubkey}/calendar`
    const olderTargeting = makeEvent({
      id: "older-targeting",
      pubkey: incomingPubkey,
      created_at: 10,
      kind: 30222,
      tags: [
        ["d", "target-old"],
        ["k", "31923"],
        ["p", communityPubkey],
      ],
    })
    const olderRoot = makeEvent({
      id: "older-root",
      pubkey: incomingPubkey,
      created_at: 9,
      kind: 31923,
      tags: [["h", "target-old"]],
    })
    const newerTargeting = makeEvent({
      id: "newer-targeting",
      pubkey: incomingPubkey,
      created_at: 20,
      kind: 30222,
      tags: [
        ["d", "target-new"],
        ["k", "31923"],
        ["a", `31923:${incomingPubkey}:calendar-new`],
        ["p", communityPubkey],
      ],
    })
    const newerRoot = makeEvent({
      id: "newer-root",
      pubkey: incomingPubkey,
      created_at: 19,
      kind: 31923,
      tags: [["d", "calendar-new"]],
    })
    const ownTargeting = makeEvent({
      id: "own-targeting",
      pubkey: currentPubkey,
      created_at: 30,
      kind: 30222,
      tags: [
        ["d", "target-own"],
        ["k", "31923"],
        ["p", communityPubkey],
      ],
    })
    const ownTargetedRoot = makeEvent({
      id: "own-targeted-root",
      pubkey: incomingPubkey,
      created_at: 29,
      kind: 31923,
      tags: [["h", "target-own"]],
    })
    const bannedTargeting = makeEvent({
      id: "banned-targeting",
      pubkey: incomingPubkey,
      created_at: 40,
      kind: 30222,
      tags: [
        ["d", "target-banned"],
        ["k", "31923"],
        ["p", communityPubkey],
      ],
    })
    const bannedRoot = makeEvent({
      id: "banned-root",
      pubkey: bannedPubkey,
      created_at: 39,
      kind: 31923,
      tags: [["h", "target-banned"]],
    })

    expect(
      getTargetedPublicationRootNotificationCandidates({
        targetingEvents: [olderTargeting, newerTargeting, ownTargeting, bannedTargeting],
        rootEvents: [olderRoot, newerRoot, ownTargetedRoot, bannedRoot],
        communityPubkey,
        path,
        kind: 31923,
        currentPubkey,
        allowPubkey: candidatePubkey => candidatePubkey !== bannedPubkey,
      }),
    ).toEqual([{path, latestEvent: newerTargeting}])
  })
})
