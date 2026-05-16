// @vitest-environment jsdom

import {readable} from "svelte/store"
import {nip19} from "nostr-tools"
import {describe, expect, it, vi} from "vitest"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/core/state", () => ({
  chatsById: readable(new Map()),
  userSettingsValues: readable({show_notifications_badge: false}),
}))

vi.mock("@app/core/community-state", () => ({
  activeCommunityUserModeratorRequestStates: readable([]),
}))

vi.mock("@app/util/routes", () => ({
  makeChatPath: (id: string) => `/chat/${id}`,
  makeCommunityPath: (community: string, ...extra: string[]) =>
    `/c/${community}${extra.length ? `/${extra.join("/")}` : ""}`,
}))

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
})
