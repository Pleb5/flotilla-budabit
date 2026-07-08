import {derived} from "svelte/store"
import {getPlaintext, pubkey} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"
import {chatsById, type Chat} from "@app/core/state"
import {
  checked,
  effectiveCommunityNotificationBaselines,
  getNotificationCheckedAt,
  hasNotificationForPath,
  notifications,
} from "@app/util/notifications"
import {
  notificationHistory,
  normalizeNotificationHistoryState,
  type NotificationHistoryState,
} from "@app/util/notification-center"
import {makeChatPath} from "@app/util/routes"
import {
  buildNotificationSearchText,
  getNotificationSourceLabel,
  sortNotificationRows,
  type NotificationRow,
  type NotificationRowSource,
} from "@app/util/notification-display"

export type BuildChatNotificationRowsOptions = {
  chats: Iterable<Chat>
  checked?: Record<string, number>
  currentPubkey?: string
  communityBaselines?: Record<string, number>
  history?: Partial<NotificationHistoryState>
  getPlaintext?: (event: TrustedEvent) => string | undefined
}

export type BuildRouteNotificationRowsOptions = {
  paths: Iterable<string>
  excludedPaths?: Set<string>
}

const getEventPreview = (
  event: TrustedEvent,
  plaintext: string | undefined,
) => {
  if (plaintext?.trim()) return plaintext.trim()
  if (event.content) return "Encrypted direct message"

  return "Direct message"
}

export const buildChatNotificationRows = ({
  chats,
  checked: checkedState = {},
  currentPubkey,
  communityBaselines = {},
  history,
  getPlaintext: getPlaintextForEvent = () => undefined,
}: BuildChatNotificationRowsOptions): NotificationRow[] => {
  const normalizedHistory = normalizeNotificationHistoryState(history)
  const rows: NotificationRow[] = []

  for (const chat of chats) {
    const event = chat.latestIncomingMessage
    if (!event) continue

    const path = makeChatPath(chat.id)
    const checkedAt = getNotificationCheckedAt({
      checked: checkedState,
      path,
      currentPubkey,
      communityBaselines,
    })
    const pathUnread = hasNotificationForPath({
      checked: checkedState,
      path,
      latestEvent: event,
      currentPubkey,
      communityBaselines,
    })
    const historyRead = Boolean(normalizedHistory.readAt[event.id])
    const read = historyRead || !pathUnread
    const preview = getEventPreview(event, getPlaintextForEvent(event))

    rows.push({
      id: `event:${event.id}`,
      eventId: event.id,
      actorPubkey: event.pubkey,
      source: "chat",
      sourceLabel: getNotificationSourceLabel("chat"),
      title: "Direct message",
      preview,
      path,
      readPath: path,
      createdAt: event.created_at,
      read,
      searchText: buildNotificationSearchText(
        "chat",
        "direct message",
        event.pubkey,
        chat.id,
        path,
        preview,
        checkedAt,
      ),
    })
  }

  return sortNotificationRows(rows)
}

export const getRouteNotificationSource = (path: string): NotificationRowSource => {
  if (path === "/chat" || path.startsWith("/chat/")) return "chat"
  if (path === "/git" || path.startsWith("/git/") || path.includes("/git")) return "git"
  if (path === "/c" || path.startsWith("/c/")) return "community"

  return "other"
}

export const getRouteNotificationTitle = (source: NotificationRowSource) => {
  switch (source) {
    case "chat":
      return "Unread chat activity"
    case "git":
      return "Unread git activity"
    case "community":
      return "Unread community activity"
    default:
      return "Unread activity"
  }
}

const getRouteNotificationPreview = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .join(" / ") || path

export const buildRouteNotificationRows = ({
  paths,
  excludedPaths = new Set<string>(),
}: BuildRouteNotificationRowsOptions): NotificationRow[] => {
  const rows: NotificationRow[] = []

  for (const path of Array.from(paths).sort()) {
    if (!path || excludedPaths.has(path)) continue

    const source = getRouteNotificationSource(path)
    const title = getRouteNotificationTitle(source)
    const preview = getRouteNotificationPreview(path)

    rows.push({
      id: `route:${path}`,
      source,
      sourceLabel: getNotificationSourceLabel(source),
      title,
      preview,
      path,
      readPath: path === "/chat" ? "/chat/*" : path,
      createdAt: 0,
      read: false,
      searchText: buildNotificationSearchText(source, title, preview, path),
    })
  }

  return sortNotificationRows(rows)
}

export const notificationCenterRows = derived(
  [
    pubkey,
    chatsById,
    checked,
    effectiveCommunityNotificationBaselines,
    notificationHistory,
    notifications,
  ],
  ([
    $pubkey,
    $chatsById,
    $checked,
    $effectiveCommunityNotificationBaselines,
    $notificationHistory,
    $notifications,
  ]) => {
    const chatRows = buildChatNotificationRows({
      chats: $chatsById.values(),
      checked: $checked,
      currentPubkey: $pubkey || undefined,
      communityBaselines: $effectiveCommunityNotificationBaselines,
      history: $notificationHistory,
      getPlaintext: getPlaintext,
    })
    const excludedPaths = new Set(chatRows.map(row => row.path))

    if (chatRows.length > 0) excludedPaths.add("/chat")

    return sortNotificationRows([
      ...chatRows,
      ...buildRouteNotificationRows({paths: $notifications, excludedPaths}),
    ])
  },
)

export const unreadNotificationCenterRows = derived(notificationCenterRows, rows =>
  rows.filter(row => !row.read),
)

export const unreadNotificationCenterCount = derived(
  unreadNotificationCenterRows,
  rows => rows.length,
)

export const hasNotificationCenterUnread = derived(
  unreadNotificationCenterCount,
  count => count > 0,
)
