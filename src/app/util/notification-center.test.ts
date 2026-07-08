// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
}))

describe("notification center read state", () => {
  it("normalizes persisted timestamps", async () => {
    const {normalizeNotificationReadState} = await import("./notification-center")

    expect(
      normalizeNotificationReadState({
        lastReadTimestamp: 20_000_000_000,
        latestNotificationTimestamp: 1000,
      }),
    ).toEqual({
      lastReadTimestamp: 20_000_000,
      latestNotificationTimestamp: 1000,
    })
  })

  it("remembers only newer notification timestamps", async () => {
    const {rememberLatestNotificationTimestampState} = await import("./notification-center")

    expect(
      rememberLatestNotificationTimestampState(
        {lastReadTimestamp: 50, latestNotificationTimestamp: 100},
        80,
      ),
    ).toEqual({lastReadTimestamp: 50, latestNotificationTimestamp: 100})

    expect(
      rememberLatestNotificationTimestampState(
        {lastReadTimestamp: 50, latestNotificationTimestamp: 100},
        120,
      ),
    ).toEqual({lastReadTimestamp: 50, latestNotificationTimestamp: 120})
  })

  it("marks the global notification timestamp read", async () => {
    const {hasUnreadNotificationsState, markNotificationsReadState} = await import(
      "./notification-center"
    )
    const unread = {lastReadTimestamp: 50, latestNotificationTimestamp: 120}
    const read = markNotificationsReadState(unread)

    expect(hasUnreadNotificationsState(unread)).toBe(true)
    expect(read).toEqual({lastReadTimestamp: 120, latestNotificationTimestamp: 120})
    expect(hasUnreadNotificationsState(read)).toBe(false)
  })
})
