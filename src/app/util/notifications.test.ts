// @vitest-environment jsdom

import {get, readable, writable} from "svelte/store"
import {readFileSync} from "node:fs"
import {getPublicKey, nip19} from "nostr-tools"
import {describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import type {CommunityDefinition} from "@app/core/community"
import {makeCommunityPointer} from "@app/core/community"
import type {CommunityPermissionStatus} from "@app/core/community-state"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/core/state", () => ({
  chatsById: readable(new Map()),
  userSettingsValues: readable({show_notifications_badge: false}),
}))

vi.mock("@app/core/community-state", () => ({
  activeExactCommunityDefinition: readable(undefined),
  activeCommunityModeratorRequestStates: readable([]),
  activeCommunityPermissionStatus: readable({
    communityAddress: "",
    key: "",
    loading: false,
    loaded: false,
    complete: false,
    hasCachedEvents: false,
  }),
  activeCommunityProfileListEvents: readable([]),
  activeExactCommunityRelays: readable([]),
  activeCommunityReportState: readable(undefined),
  activeCommunityUserModeratorRequestStates: readable([]),
}))

const makeTestCommunity = (controllerByte: number, idByte: number) =>
  makeCommunityPointer({
    ownerPubkey: getPublicKey(new Uint8Array(32).fill(controllerByte)),
    communityId: getPublicKey(new Uint8Array(32).fill(idByte)),
  })!

vi.mock("@app/util/routes", () => ({
  makeChatPath: (id: string) => `/chat/${id}`,
  makeExactCommunityPath: (community: {naddr: string}, ...extra: string[]) =>
    `/c/${community.naddr}${extra.length ? `/${extra.join("/")}` : ""}`,
  makeExactCommunityCalendarPath: (community: {naddr: string}, event?: string) =>
    `/c/${community.naddr}/calendar${event ? `/${event}` : ""}`,
  makeExactCommunityGoalPath: (community: {naddr: string}, goal?: string) =>
    `/c/${community.naddr}/goals${goal ? `/${goal}` : ""}`,
  makeExactCommunityRoomPath: (community: {naddr: string}, room: string) =>
    `/c/${community.naddr}/rooms/${room}`,
  makeExactCommunityThreadPath: (community: {naddr: string}, thread?: string) =>
    `/c/${community.naddr}/threads${thread ? `/${thread}` : ""}`,
}))

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "b".repeat(64),
    created_at: 1,
    kind: 1111,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("notifications", () => {
  it("fails active-community candidates closed until current permissions are authoritative", async () => {
    const {getActiveCommunityNotificationPermissionKey} = await import("./notifications")
    const viewer = "a".repeat(64)
    const community = makeTestCommunity(11, 12)
    const communityPubkey = community.ownerPubkey
    const definition = {
      event: makeEvent({id: "definition", pubkey: communityPubkey}),
      pointer: community,
      ownerPubkey: community.ownerPubkey,
    } as CommunityDefinition
    const ready: CommunityPermissionStatus = {
      communityAddress: community.address,
      key: `${viewer}:definition:wss://relay.example/:1`,
      loading: false,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    }

    expect(getActiveCommunityNotificationPermissionKey(definition, viewer, ready)).toBe(ready.key)
    const regranted = {...ready, key: `${viewer}:definition:wss://relay.example/:2`}
    expect(getActiveCommunityNotificationPermissionKey(definition, viewer, regranted)).toBe(
      regranted.key,
    )
    expect(regranted.key).not.toBe(ready.key)
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        loading: true,
      }),
    ).toBe("")
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        loaded: false,
      }),
    ).toBe("")
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        complete: false,
      }),
    ).toBe("")
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        communityAddress: makeTestCommunity(11, 13).address,
      }),
    ).toBe("")
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        key: `${"d".repeat(64)}:definition:wss://relay.example/:1`,
      }),
    ).toBe("")
  })

  it("clears and refilters candidate stores across revoke and regrant evidence", () => {
    const source = readFileSync("src/app/util/notifications.ts", "utf8")
    const roomStore = source.slice(
      source.indexOf("const roomMessageNotificationCandidates"),
      source.indexOf("const budabitNotificationCandidates"),
    )

    for (const store of [roomStore]) {
      expect(store).toContain("activeCommunityPermissionStatus")
      expect(store).toContain("$activeCommunityPermissionStatus")
      expect(store).toMatch(/if \(!permissionKey\) \{\s*set\(\[\]\)\s*return/)
      expect(store.indexOf("if (!permissionKey)")).toBeLessThan(
        store.indexOf("getCommunityTargetWriterPubkeys({"),
      )
    }

    expect(roomStore).toContain("authors: authorPubkeys")
  })

  it("uses aggregate calendar admission in global notification discovery", () => {
    const source = readFileSync("src/app/util/notification-sources.ts", "utf8")
    const targetingSources = source.slice(
      source.indexOf("const globalCommunityTargetingSources"),
      source.indexOf("const globalCommunityTargetingCandidateLoad"),
    )

    expect(source).toContain("hasCommunityCalendarGrantEvidence")
    expect(targetingSources).toContain("getCommunityCalendarTargetWriterPubkeys({")
    expect(targetingSources).toContain("calendarGrantEvidenceComplete")
    expect(targetingSources).not.toContain("calendarWriterPubkeysByKind")
  })

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

  it("advances checked paths to visible notification timestamps without moving them backward", async () => {
    const {checked, setCheckedAtMany} = await import("./notifications")
    checked.set({"/chat/alice": 15, "/git/repo/issues": 30})

    setCheckedAtMany([
      ["/chat/alice", 10],
      ["/chat/alice", 20],
      ["/git/repo/issues", 25],
      ["/c/community/threads", 40],
      ["", 50],
      ["/ignored", 0],
    ])

    expect(get(checked)).toEqual({
      "/chat/alice": 20,
      "/git/repo/issues": 30,
      "/c/community/threads": 40,
    })
    const listener = vi.fn()
    const unsubscribe = checked.subscribe(listener)
    setCheckedAtMany([])
    setCheckedAtMany([["/chat/alice", 20]])
    expect(listener).toHaveBeenCalledTimes(1)
    setCheckedAtMany([["/chat/alice", 21]])
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it.each(["threads", "calendar", "goals"])(
    "does not mark a later-arriving %s item read at the same second boundary",
    async section => {
      const {checked, setChecked, hasNotificationForPath} = await import("./notifications")
      checked.set({})
      const path = `/c/community/${section}`
      setChecked(path, [`${path}/seen`])
      const timestamp = get(checked)[path]
      const latestEvent = makeEvent({created_at: timestamp})
      const options = {path, latestEvent, checked: get(checked)}
      expect(hasNotificationForPath({...options, readPath: `${path}/seen`})).toBe(false)
      expect(hasNotificationForPath({...options, readPath: `${path}/arrived-later`})).toBe(true)
      expect(
        hasNotificationForPath({
          ...options,
          readPath: `${path}/arrived-later`,
          latestEvent: {...latestEvent, created_at: timestamp - 1},
        }),
      ).toBe(false)
      expect(
        hasNotificationForPath({
          ...options,
          readPath: `${path}/arrived-later`,
          checked: {"*": timestamp},
        }),
      ).toBe(false)
    },
  )

  it("setupBudabitNotifications returns cleanup", async () => {
    const {setupBudabitNotifications} = await import("./notifications")
    const cleanup = setupBudabitNotifications()

    expect(cleanup).toEqual(expect.any(Function))
    cleanup()
  })

  it("clears a read badge synchronously and never relights it for an own root", async () => {
    const {pubkey} = await import("@welshman/app")
    const {
      checked,
      communityNotificationBaselines,
      notifications,
      setupBudabitNotifications,
      setCheckedAtMany,
    } = await import("./notifications")
    await Promise.all([checked.ready, communityNotificationBaselines.ready])
    checked.set({})
    const originalPubkey = get(pubkey)
    pubkey.set("a".repeat(64))
    const path = "/c/community/threads"
    const first = {path, readPath: `${path}/first`, latestEvent: makeEvent({created_at: 10})}
    const candidates = writable([first])
    const stop = setupBudabitNotifications(candidates)
    const seen: boolean[] = []
    const unsubscribe = notifications.subscribe(paths => seen.push(paths.has(path)))
    try {
      await vi.waitFor(() => expect(seen.at(-1)).toBe(true))
      setCheckedAtMany([[first.readPath, 10]])
      expect(seen.at(-1)).toBe(false)
      seen.length = 0
      candidates.set([
        first,
        {
          path,
          readPath: `${path}/own`,
          latestEvent: makeEvent({created_at: 20, pubkey: get(pubkey)!}),
        },
      ])
      expect(seen).not.toContain(true)
      candidates.set([])
      expect(get(notifications).has(path)).toBe(false)
    } finally {
      unsubscribe()
      stop()
      pubkey.set(originalPubkey)
    }
  })

  it("stops and restarts notification candidate ownership without duplicates", async () => {
    const {notificationCandidates, setupBudabitNotifications} = await import("./notifications")
    let starts = 0
    let stops = 0
    const candidates = readable([], () => {
      starts += 1
      return () => {
        stops += 1
      }
    })
    const unsubscribe = notificationCandidates.subscribe(() => undefined)

    const firstCleanup = setupBudabitNotifications(candidates)
    expect(starts).toBe(1)
    firstCleanup()
    expect(stops).toBe(1)

    const secondCleanup = setupBudabitNotifications(candidates)
    expect(starts).toBe(2)
    firstCleanup()
    expect(stops).toBe(1)
    secondCleanup()
    expect(stops).toBe(2)

    unsubscribe()
  })

  it("projects root feed arrivals into badges and clears them on cleanup", async () => {
    const {notificationCandidates, setupBudabitNotifications, setupCommunityRootNotifications} =
      await import("./notifications")
    const candidate = {
      path: "/c/community/threads",
      readPath: "/c/community/threads/new",
      latestEvent: makeEvent({id: "new"}),
    }
    const roots = writable([candidate])
    const stop = setupBudabitNotifications()
    const stopFirst = setupCommunityRootNotifications(roots)
    try {
      expect(get(notificationCandidates)).toEqual([candidate])
      roots.set([])
      expect(get(notificationCandidates)).toEqual([])
      roots.set([candidate])
      const stopSecond = setupCommunityRootNotifications(readable([candidate]))
      stopFirst()
      expect(get(notificationCandidates)).toEqual([candidate])
      stopSecond()
      expect(get(notificationCandidates)).toEqual([])
    } finally {
      stopFirst()
      stop()
    }
  })

  it("owns notification sound listeners and avoids eager audio loading", () => {
    const source = readFileSync("src/app/components/NewNotificationSound.svelte", "utf8")

    expect(source).toContain('preload="none"')
    expect(source).not.toContain("audioElement.load()")
    expect(source).toContain(
      'document.addEventListener("visibilitychange", handleVisibilityChange)',
    )
    expect(source).toContain(
      'document.removeEventListener("visibilitychange", handleVisibilityChange)',
    )
    expect(source).toContain("unsubscribeNotifications()")
  })

  it("creates room notification candidates from latest incoming room messages", async () => {
    const {getRoomMessageNotificationCandidates} = await import("./notifications")
    const community = makeTestCommunity(9, 10)
    const communityPubkey = community.communityId
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
    const legacyLowercaseRoomTag = makeEvent({
      id: "legacy-lowercase-room-tag",
      pubkey: incomingPubkey,
      created_at: 18,
      kind: 9,
      tags: [
        ["h", nip19.npubEncode(communityPubkey)],
        ["e", "room-legacy"],
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
        events: [
          roomOneOlder,
          roomOneNewer,
          ownLatest,
          roomTwo,
          legacyLowercaseRoomTag,
          banned,
          otherCommunity,
        ],
        community,
        currentPubkey,
        allowPubkey: candidatePubkey => candidatePubkey !== bannedPubkey,
      }),
    ).toEqual([
      {path: `/c/${community.naddr}/rooms/room-one`, latestEvent: roomOneNewer},
      {path: `/c/${community.naddr}/rooms/room-two`, latestEvent: roomTwo},
    ])
  })

  it.each(["threads", "goals", "calendar"])(
    "acknowledges individual %s roots without clearing unread siblings",
    async section => {
      const {hasNotificationForPath} = await import("./notifications")
      const path = `/c/community/${section}`
      const first = {path, readPath: `${path}/first`, latestEvent: makeEvent({created_at: 10})}
      const second = {path, readPath: `${path}/second`, latestEvent: makeEvent({created_at: 20})}
      const checked = {[second.readPath]: 30, [`${path}-unrelated`]: 40}
      expect(hasNotificationForPath({...first, checked})).toBe(true)
      expect(hasNotificationForPath({...second, checked})).toBe(false)
      expect(hasNotificationForPath({...first, checked: {...checked, [path]: 30}})).toBe(false)
      expect(hasNotificationForPath({...first, checked: {"*": 30}})).toBe(false)
      expect(hasNotificationForPath({...first, checked: {[`${first.readPath}:seen`]: 30}})).toBe(
        true,
      )
    },
  )

  it("uses community first-encounter baselines as checked timestamps", async () => {
    const {getCommunityNotificationBaselineKey, getNotificationCheckedAt, hasNotificationForPath} =
      await import("./notifications")
    const viewerPubkey = "a".repeat(64)
    const otherViewerPubkey = "b".repeat(64)
    const community = makeTestCommunity(21, 22)
    const sibling = makeTestCommunity(21, 23)
    const authorPubkey = "e".repeat(64)
    const path = `/c/${community.naddr}/threads`
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)
    const communityBaselines = {[baselineKey]: 100}

    expect(
      getNotificationCheckedAt({
        checked: {},
        path,
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(100)
    expect(
      hasNotificationForPath({
        checked: {},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 99}),
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(false)
    expect(
      hasNotificationForPath({
        checked: {},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 101}),
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(true)
    expect(
      hasNotificationForPath({
        checked: {},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 99}),
        currentPubkey: otherViewerPubkey,
        communityBaselines,
      }),
    ).toBe(true)
    expect(
      hasNotificationForPath({
        checked: {},
        path: `/c/${sibling.naddr}/threads`,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 99}),
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(true)
  })

  it("applies community first-encounter baselines optimistically", async () => {
    const {
      effectiveCommunityNotificationBaselines,
      ensureCommunityNotificationBaseline,
      getCommunityNotificationBaselineKey,
    } = await import("./notifications")
    const viewerPubkey = "f".repeat(64)
    const community = makeTestCommunity(24, 25)
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)

    ensureCommunityNotificationBaseline({
      viewerPubkey,
      community,
      timestamp: 123,
    })

    expect(get(effectiveCommunityNotificationBaselines)[baselineKey]).toBe(123)
  })

  it("does not advance community baselines on later visits", async () => {
    const {
      communityNotificationBaselines,
      effectiveCommunityNotificationBaselines,
      ensureCommunityNotificationBaseline,
      getCommunityNotificationBaselineKey,
      hasNotificationForPath,
    } = await import("./notifications")
    const viewerPubkey = "2".repeat(64)
    const community = makeTestCommunity(26, 27)
    const authorPubkey = "4".repeat(64)
    const path = `/c/${community.naddr}/rooms/room-one`
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)

    await communityNotificationBaselines.ready
    communityNotificationBaselines.set({version: 2, byCommunityAddress: {[baselineKey]: 100}})

    expect(
      ensureCommunityNotificationBaseline({
        viewerPubkey,
        community,
        timestamp: 200,
      }),
    ).toBe(false)
    expect(get(effectiveCommunityNotificationBaselines)[baselineKey]).toBe(100)
    expect(
      hasNotificationForPath({
        checked: {},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 150}),
        currentPubkey: viewerPubkey,
        communityBaselines: get(effectiveCommunityNotificationBaselines),
      }),
    ).toBe(true)
  })

  it("uses explicit path checks instead of later community baselines", async () => {
    const {getCommunityNotificationBaselineKey, getNotificationCheckedAt, hasNotificationForPath} =
      await import("./notifications")
    const viewerPubkey = "5".repeat(64)
    const community = makeTestCommunity(28, 29)
    const authorPubkey = "7".repeat(64)
    const path = `/c/${community.naddr}/rooms/room-one`
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)
    const communityBaselines = {[baselineKey]: 200}

    expect(
      getNotificationCheckedAt({
        checked: {[path]: 100},
        path,
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(100)
    expect(
      hasNotificationForPath({
        checked: {[path]: 100},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 150}),
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(true)
  })

  it("does not apply community baselines to non-community paths", async () => {
    const {getCommunityNotificationBaselineKey, getNotificationCheckedAt} =
      await import("./notifications")
    const viewerPubkey = "a".repeat(64)
    const community = makeTestCommunity(30, 31)
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)

    expect(
      getNotificationCheckedAt({
        checked: {},
        path: "/chat/example",
        currentPubkey: viewerPubkey,
        communityBaselines: {[baselineKey]: 100},
      }),
    ).toBe(0)
  })
})
