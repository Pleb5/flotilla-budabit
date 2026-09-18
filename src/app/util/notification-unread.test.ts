// @vitest-environment jsdom

import {beforeEach, describe, expect, it, vi} from "vitest"
import {get, type Writable} from "svelte/store"
import {pubkey} from "@welshman/app"
import {notificationCenterRows} from "./notification-sources"
import {
  clearNotificationReadState,
  markNotificationRowsRead,
  notificationUnreadHints,
  setupNotificationUnreadHints,
} from "./notification-center"
import type {NotificationRow} from "./notification-display"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
}))
vi.mock("@welshman/app", async () => {
  const {writable} = await import("svelte/store")
  return {pubkey: writable<string | undefined>()}
})
vi.mock("./notification-sources", async () => {
  const {writable} = await import("svelte/store")
  return {notificationCenterRows: writable([])}
})

const rows = notificationCenterRows as Writable<NotificationRow[]>
const setRows = (...ids: string[]) => rows.set(ids.map(id => ({id}) as NotificationRow))

describe("background notification unread hints", () => {
  beforeEach(() => {
    pubkey.set("alice")
    setRows()
    clearNotificationReadState()
    notificationUnreadHints.set({})
  })

  it("discovers unread rows with the center closed and tracks reads and later arrivals", async () => {
    setRows("application")
    const stop = setupNotificationUnreadHints()
    try {
      await vi.waitFor(() => expect(get(notificationUnreadHints).alice).toBe(true))
      markNotificationRowsRead("alice", ["application"])
      expect(get(notificationUnreadHints).alice).toBe(false)
      setRows("application", "later-application")
      expect(get(notificationUnreadHints).alice).toBe(true)
      setRows("application")
      expect(get(notificationUnreadHints).alice).toBe(false)
    } finally {
      stop()
    }
  })

  it("uses each account's read state and stops updating after cleanup", async () => {
    setRows("application")
    markNotificationRowsRead("alice", ["application"])
    const stop = setupNotificationUnreadHints()
    try {
      await vi.waitFor(() => expect(get(notificationUnreadHints).alice).toBe(false))
      pubkey.set("bob")
      expect(get(notificationUnreadHints)).toEqual({alice: false, bob: true})
      markNotificationRowsRead("bob", ["application"])
      expect(get(notificationUnreadHints).bob).toBe(false)
      stop()
      setRows("unseen-after-stop")
      expect(get(notificationUnreadHints)).toEqual({alice: false, bob: false})
    } finally {
      stop()
    }
  })

  it("does not revive a background subscription cancelled during lazy startup", async () => {
    setRows("application")
    const stop = setupNotificationUnreadHints()
    stop()
    // Drain the lazy import and read-state hydration without starting a subscriber.
    await new Promise(resolve => setTimeout(resolve, 0))
    setRows("later-application")
    expect(get(notificationUnreadHints)).toEqual({})
  })
})
