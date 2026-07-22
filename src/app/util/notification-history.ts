import {derived, writable} from "svelte/store"
import {now} from "@welshman/lib"

export type NotificationHistoryState = {
  openedAt: number
  pages: number
}

export const NOTIFICATION_HISTORY_LOOKBACK_SECONDS = 60 * 60 * 24 * 14
export const NOTIFICATION_HISTORY_ROW_STEP = 50
export const NOTIFICATION_HISTORY_FILTER_LIMIT_STEP = 200
export const NOTIFICATION_HISTORY_MAX_PAGES = 6

export const createNotificationHistoryState = (): NotificationHistoryState => ({
  openedAt: now(),
  pages: 1,
})

const normalizeHistoryPages = (pages: number | undefined) =>
  Math.min(NOTIFICATION_HISTORY_MAX_PAGES, Math.max(1, Math.round(Number(pages || 1))))

export const getNotificationHistorySince = ({openedAt, pages}: NotificationHistoryState) =>
  Math.max(
    0,
    Math.round(openedAt) - normalizeHistoryPages(pages) * NOTIFICATION_HISTORY_LOOKBACK_SECONDS,
  )

export const getNotificationHistoryFilterLimit = ({
  pages,
}: Pick<NotificationHistoryState, "pages">) =>
  normalizeHistoryPages(pages) * NOTIFICATION_HISTORY_FILTER_LIMIT_STEP

export const notificationHistoryState = writable<NotificationHistoryState>(
  createNotificationHistoryState(),
)

export const notificationHistorySince = derived(
  notificationHistoryState,
  getNotificationHistorySince,
)

export const notificationHistoryFilterLimit = derived(
  notificationHistoryState,
  getNotificationHistoryFilterLimit,
)

export const notificationHistoryCanLoadMore = derived(
  notificationHistoryState,
  state => normalizeHistoryPages(state.pages) < NOTIFICATION_HISTORY_MAX_PAGES,
)

export const resetNotificationHistory = () =>
  notificationHistoryState.set(createNotificationHistoryState())

export const loadMoreNotificationHistory = () =>
  notificationHistoryState.update(state => ({
    openedAt: state.openedAt,
    pages: normalizeHistoryPages(normalizeHistoryPages(state.pages) + 1),
  }))
