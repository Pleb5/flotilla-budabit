// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest"
import {CommunityMediaCoordinator, type MediaContextIdentity} from "./community-media-state"

const context = (overrides: Partial<MediaContextIdentity> = {}): MediaContextIdentity => ({
  definitionAddress: `32222:${"a".repeat(64)}:community`,
  contextSessionId: "page",
  contextVersion: 1,
  viewer: {pubkey: "b".repeat(64), isOwner: false, isBanned: false},
  ...overrides,
})

beforeEach(() => sessionStorage.clear())

describe("local community media coordination", () => {
  it("starts viewers with no call or broadcast activity, independently of moderator status", () => {
    const registry = new CommunityMediaCoordinator()
    const ctx = context({viewer: {pubkey: "b".repeat(64), isOwner: true, isBanned: false}})
    expect(registry.watch({}, ctx, vi.fn())).toMatchObject({
      callActive: false,
      broadcastPrepared: false,
    })
  })

  it("shares call activity across sibling widget sessions, with the subscriber's context identity", () => {
    const registry = new CommunityMediaCoordinator()
    const notify = vi.fn()
    const caller = {}
    registry.watch({}, context({contextSessionId: "stream-frame"}), notify)
    registry.set(caller, context({contextSessionId: "call-frame"}), "call", true)
    expect(notify.mock.lastCall?.[0]).toMatchObject({
      callActive: true,
      contextSessionId: "stream-frame",
      contextVersion: 1,
    })
    registry.remove(caller)
    expect(notify.mock.lastCall?.[0].callActive).toBe(false)
  })

  it("does not clear another call instance when one iframe detaches", () => {
    const registry = new CommunityMediaCoordinator()
    const first = {},
      second = {},
      viewer = {}
    registry.set(first, context(), "call", true)
    registry.set(second, context(), "call", true)
    registry.remove(first)
    expect(registry.watch(viewer, context(), undefined).callActive).toBe(true)
    registry.remove(second)
    expect(registry.watch(viewer, context(), undefined).callActive).toBe(false)
  })

  it("does not leak activity across communities or viewer accounts", () => {
    const registry = new CommunityMediaCoordinator()
    registry.set({}, context(), "call", true)
    registry.set({}, context(), "broadcast", true)
    const otherCommunity = context({definitionAddress: "32222:other:community"})
    const otherViewer = context({viewer: {pubkey: "c".repeat(64), isOwner: true, isBanned: false}})
    for (const ctx of [otherCommunity, otherViewer]) {
      expect(registry.watch({}, ctx, undefined)).toMatchObject({
        callActive: false,
        broadcastPrepared: false,
      })
    }
  })

  it("removes old call activity when an iframe changes community", () => {
    const registry = new CommunityMediaCoordinator()
    const caller = {}
    registry.set(caller, context(), "call", true)
    registry.set(caller, context({definitionAddress: "32222:other:community"}), "call", true)
    expect(registry.watch({}, context(), undefined).callActive).toBe(false)
  })

  it("remembers broadcast preparation through refresh, but never persists call participation", () => {
    const registry = new CommunityMediaCoordinator()
    const owner = {}
    registry.set(owner, context(), "call", true)
    registry.set(owner, context(), "broadcast", true)
    registry.remove(owner)
    const reloaded = new CommunityMediaCoordinator()
    expect(reloaded.watch({}, context(), undefined)).toMatchObject({
      callActive: false,
      broadcastPrepared: true,
    })
    reloaded.set({}, context(), "broadcast", false)
    expect(new CommunityMediaCoordinator().watch({}, context(), undefined).broadcastPrepared).toBe(
      false,
    )
  })

  it("unsubscribes detached widgets and monotonically orders state updates", () => {
    const registry = new CommunityMediaCoordinator()
    const viewer = {},
      caller = {}
    const notify = vi.fn()
    const first = registry.watch(viewer, context(), notify)
    registry.set(caller, context(), "call", true)
    expect(notify.mock.lastCall?.[0].revision).toBeGreaterThan(first.revision)
    registry.remove(viewer)
    registry.set(caller, context(), "call", false)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
