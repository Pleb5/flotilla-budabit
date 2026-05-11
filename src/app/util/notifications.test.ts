// @vitest-environment jsdom

import {readable} from "svelte/store"
import {describe, expect, it, vi} from "vitest"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/core/state", () => ({
  chatsById: readable(new Map()),
  userSettingsValues: readable({show_notifications_badge: false}),
}))

vi.mock("@app/util/routes", () => ({
  makeChatPath: (id: string) => `/chat/${id}`,
}))

describe("notifications", () => {
  it("keeps repo notification helpers disabled after spaces removal", async () => {
    const {getRepoNotificationPaths, hasRepoNotification, setCheckedForRepoNotifications} = await import(
      "./notifications"
    )

    expect(getRepoNotificationPaths()).toEqual([])
    expect(hasRepoNotification()).toBe(false)
    expect(setCheckedForRepoNotifications()).toBeUndefined()
  })

  it("setupBudabitNotifications returns cleanup", async () => {
    const {setupBudabitNotifications} = await import("./notifications")

    expect(setupBudabitNotifications()).toEqual(expect.any(Function))
  })
})
