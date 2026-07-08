import {derived} from "svelte/store"
import {now} from "@welshman/lib"
import {synced} from "@welshman/store"
import {kv} from "@app/core/storage"

export const NOTIFICATION_HISTORY_LIMIT = 500

export type NotificationHistoryState = {
  ids: string[]
  readAt: Record<string, number>
}

export const defaultNotificationHistoryState = (): NotificationHistoryState => ({
  ids: [],
  readAt: {},
})

const normalizeId = (id: string | undefined) => String(id || "").trim()

const normalizeTimestamp = (timestamp: unknown) => {
  const value = Number(timestamp || 0)
  if (!Number.isFinite(value) || value <= 0) return 0

  return value > 10_000_000_000 ? Math.round(value / 1000) : Math.round(value)
}

export const normalizeNotificationHistoryState = (
  state: Partial<NotificationHistoryState> | undefined,
  limit = NOTIFICATION_HISTORY_LIMIT,
): NotificationHistoryState => {
  const ids: string[] = []
  const seen = new Set<string>()

  for (const id of state?.ids || []) {
    const normalized = normalizeId(id)
    if (!normalized || seen.has(normalized)) continue

    seen.add(normalized)
    ids.push(normalized)
    if (ids.length >= limit) break
  }

  const readAt: Record<string, number> = {}
  for (const id of ids) {
    const timestamp = normalizeTimestamp(state?.readAt?.[id])
    if (timestamp > 0) readAt[id] = timestamp
  }

  return {ids, readAt}
}

export const upsertNotificationHistoryIds = (
  state: Partial<NotificationHistoryState> | undefined,
  ids: Iterable<string | undefined>,
  limit = NOTIFICATION_HISTORY_LIMIT,
): NotificationHistoryState => {
  const current = normalizeNotificationHistoryState(state, limit)
  const nextIds: string[] = []
  const seen = new Set<string>()

  for (const id of ids) {
    const normalized = normalizeId(id)
    if (!normalized || seen.has(normalized)) continue

    seen.add(normalized)
    nextIds.push(normalized)
  }

  for (const id of current.ids) {
    if (seen.has(id)) continue

    seen.add(id)
    nextIds.push(id)
    if (nextIds.length >= limit) break
  }

  return normalizeNotificationHistoryState({...current, ids: nextIds}, limit)
}

export const markNotificationIdsReadState = (
  state: Partial<NotificationHistoryState> | undefined,
  ids: Iterable<string | undefined>,
  timestamp = now(),
): NotificationHistoryState => {
  const current = normalizeNotificationHistoryState(state)
  const readAt = {...current.readAt}
  const normalizedTimestamp = normalizeTimestamp(timestamp) || now()
  const knownIds = new Set(current.ids)

  for (const id of ids) {
    const normalized = normalizeId(id)
    if (normalized && knownIds.has(normalized)) readAt[normalized] = normalizedTimestamp
  }

  return normalizeNotificationHistoryState({...current, readAt})
}

export const getUnreadNotificationHistoryIds = (
  state: Partial<NotificationHistoryState> | undefined,
) => {
  const current = normalizeNotificationHistoryState(state)

  return current.ids.filter(id => !current.readAt[id])
}

export const notificationHistory = synced<NotificationHistoryState>({
  key: "notificationCenter.history",
  defaultValue: defaultNotificationHistoryState(),
  storage: kv,
})

export const notificationHistoryIds = derived(notificationHistory, $history =>
  normalizeNotificationHistoryState($history).ids,
)

export const unreadNotificationHistoryIds = derived(notificationHistory, getUnreadNotificationHistoryIds)

export const unreadNotificationHistoryCount = derived(
  unreadNotificationHistoryIds,
  $ids => $ids.length,
)

export const rememberNotificationHistoryIds = (ids: Iterable<string | undefined>) =>
  notificationHistory.update(state => upsertNotificationHistoryIds(state, ids))

export const markNotificationHistoryIdsRead = (
  ids: Iterable<string | undefined>,
  timestamp = now(),
) => notificationHistory.update(state => markNotificationIdsReadState(state, ids, timestamp))

export const clearNotificationHistory = () => notificationHistory.set(defaultNotificationHistoryState())
