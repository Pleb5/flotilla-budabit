import {describe, expect, it} from "vitest"

import {
  getNotificationHistoryFilterLimit,
  getNotificationHistorySince,
  NOTIFICATION_HISTORY_FILTER_LIMIT_STEP,
  NOTIFICATION_HISTORY_LOOKBACK_SECONDS,
  NOTIFICATION_HISTORY_ROW_STEP,
} from "./notification-history"

describe("notification history window", () => {
  it("starts with a two-week since window and expands by history pages", () => {
    const openedAt = 10_000_000

    expect(getNotificationHistorySince({openedAt, pages: 1})).toBe(
      openedAt - NOTIFICATION_HISTORY_LOOKBACK_SECONDS,
    )
    expect(getNotificationHistorySince({openedAt, pages: 3})).toBe(
      openedAt - 3 * NOTIFICATION_HISTORY_LOOKBACK_SECONDS,
    )
  })

  it("clamps history since and expands filter limits step by step", () => {
    expect(getNotificationHistorySince({openedAt: 10, pages: 1})).toBe(0)
    expect(getNotificationHistoryFilterLimit({pages: 1})).toBe(
      NOTIFICATION_HISTORY_FILTER_LIMIT_STEP,
    )
    expect(getNotificationHistoryFilterLimit({pages: 4})).toBe(
      4 * NOTIFICATION_HISTORY_FILTER_LIMIT_STEP,
    )
    expect(NOTIFICATION_HISTORY_ROW_STEP).toBe(50)
  })
})
