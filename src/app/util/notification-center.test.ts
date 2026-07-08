// @vitest-environment jsdom

import {describe, expect, it, vi} from "vitest"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
}))

describe("notification center history", () => {
  it("normalizes, deduplicates, and caps history ids", async () => {
    const {normalizeNotificationHistoryState} = await import("./notification-center")

    expect(
      normalizeNotificationHistoryState(
        {
          ids: ["a", "", "b", "a", "c"],
          readAt: {a: 1000, b: 20_000_000_000, stale: 10},
        },
        2,
      ),
    ).toEqual({
      ids: ["a", "b"],
      readAt: {a: 1000, b: 20_000_000},
    })
  })

  it("prepends new event ids without duplicating existing ids", async () => {
    const {upsertNotificationHistoryIds} = await import("./notification-center")

    expect(
      upsertNotificationHistoryIds(
        {ids: ["old", "existing"], readAt: {existing: 123}},
        ["new", "existing", "new"],
        4,
      ),
    ).toEqual({
      ids: ["new", "existing", "old"],
      readAt: {existing: 123},
    })
  })

  it("marks only known notification ids as read", async () => {
    const {markNotificationIdsReadState, getUnreadNotificationHistoryIds} = await import(
      "./notification-center"
    )
    const state = markNotificationIdsReadState(
      {ids: ["a", "b"], readAt: {}},
      ["a", "unknown"],
      55,
    )

    expect(state).toEqual({ids: ["a", "b"], readAt: {a: 55}})
    expect(getUnreadNotificationHistoryIds(state)).toEqual(["b"])
  })
})
