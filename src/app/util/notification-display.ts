import {createSearch} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"

export type NotificationRowSource = "chat" | "git" | "community"

export type NotificationRowFilter = NotificationRowSource

export type NotificationRowType =
  | "chat"
  | "reply"
  | "mention"
  | "reaction"
  | "zap"
  | "repo"
  | "community"
  | "route"
  | "activity"

export type NotificationRowTarget = {
  label: string
  preview?: string
  path?: string
  eventId?: string
  event?: TrustedEvent
  actionLabel?: string
}

export type NotificationRowDisplaySection = NotificationRowTarget & {
  label: string
  preview: string
}

export type NotificationRowNavigation = {
  label: string
  path: string
  eventId?: string
}

export type NotificationRowDisplay = {
  type: NotificationRowType
  title: string
  action: string
  context: string
  preview: string
  sourceLabel: string
  primaryAction: NotificationRowNavigation
  sections: NotificationRowDisplaySection[]
}

export type NotificationRow = {
  id: string
  source: NotificationRowSource
  sourceLabel: string
  type?: NotificationRowType
  title: string
  preview: string
  action?: string
  actionLabel?: string
  contextLabel?: string
  path: string
  readPath: string
  createdAt: number
  searchText: string
  eventId?: string
  eventIds?: string[]
  navigationEventId?: string
  target?: NotificationRowTarget
  detail?: NotificationRowTarget
  actorPubkey?: string
  actorName?: string
  repoWatchSeenPath?: string
}

export type NotificationRowFilterOptions = {
  filters?: NotificationRowFilter[]
  term?: string
}

export const NOTIFICATION_ROW_FILTERS: {value: NotificationRowFilter; label: string}[] = [
  {value: "community", label: "Communities"},
  {value: "git", label: "Git"},
  {value: "chat", label: "DMs"},
]

export const getNotificationSourceLabel = (source: NotificationRowSource) => {
  switch (source) {
    case "chat":
      return "DMs"
    case "git":
      return "Git"
    case "community":
      return "Communities"
    default:
      return "Notifications"
  }
}

export const buildNotificationSearchText = (
  ...values: Array<string | number | undefined>
) =>
  values
    .map(value => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ")

const LONG_EVENT_ID_RE = /\b[0-9a-f]{32,}\b/gi
const NOSTR_EVENT_ENTITY_RE = /\b(?:nostr:)?(?:nevent1|naddr1)[0-9a-z]+\b/gi
const NOSTR_PROFILE_ENTITY_RE = /\b(?:nostr:)?(?:nprofile1|npub1)[0-9a-z]+\b/gi
const ROUTE_PATH_RE = /(^|[\s(["'])\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+(?:[?#][^\s)"']*)?/g

export const sanitizeNotificationText = (value: string | undefined, fallback = "Activity") => {
  const sanitized = String(value || "")
    .replace(NOSTR_EVENT_ENTITY_RE, "")
    .replace(NOSTR_PROFILE_ENTITY_RE, "")
    .replace(LONG_EVENT_ID_RE, "event")
    .replace(ROUTE_PATH_RE, "$1activity")
    .replace(/\s+/g, " ")
    .trim()

  return sanitized || fallback
}

export const getNotificationRowType = (row: NotificationRow): NotificationRowType => {
  if (row.type) return row.type

  const title = row.title.toLowerCase()
  if (row.source === "chat") return "chat"
  if (title.includes("reply")) return "reply"
  if (title.includes("mention")) return "mention"
  if (title.includes("reaction")) return "reaction"
  if (title.includes("zap")) return "zap"
  if (row.source === "git") return "repo"
  if (row.source === "community") return "community"
  if (row.id.startsWith("route:")) return "route"

  return "activity"
}

const getDefaultAction = (type: NotificationRowType) => {
  switch (type) {
    case "chat":
      return "messaged you"
    case "reply":
      return "replied"
    case "mention":
      return "mentioned you"
    case "reaction":
      return "reacted"
    case "zap":
      return "zapped"
    case "repo":
      return "updated"
    case "community":
      return "updated"
    case "route":
      return "needs attention"
    default:
      return "updated"
  }
}

const getDefaultContext = (row: NotificationRow, type: NotificationRowType) => {
  if (row.contextLabel) return row.contextLabel
  if (row.target?.label) return row.target.label
  if (type === "chat") return "Direct message"
  if (type === "repo") return "Git activity"
  if (type === "community") return "Community activity"
  if (type === "route") return row.sourceLabel

  return row.sourceLabel
}

const getDefaultActionLabel = (type: NotificationRowType) => {
  switch (type) {
    case "chat":
      return "Open chat"
    case "reply":
      return "Open reply"
    case "mention":
      return "Open mention"
    case "reaction":
      return "Open context"
    case "zap":
      return "Open context"
    case "repo":
      return "Open git item"
    case "community":
      return "Open community"
    default:
      return "Open notification"
  }
}

const toDisplaySection = (
  target: NotificationRowTarget | undefined,
  fallbackPreview: string,
): NotificationRowDisplaySection[] => {
  if (!target) return []

  return [
    {
      ...target,
      label: sanitizeNotificationText(target.label, "Context"),
      preview: sanitizeNotificationText(target.preview, fallbackPreview),
      actionLabel: target.actionLabel
        ? sanitizeNotificationText(target.actionLabel, "Open")
        : undefined,
    },
  ]
}

export const getNotificationRowDisplay = (row: NotificationRow): NotificationRowDisplay => {
  const type = getNotificationRowType(row)
  const title = sanitizeNotificationText(row.title, "Notification")
  const preview = sanitizeNotificationText(row.preview, title)
  const actionLabel = row.actionLabel || getDefaultActionLabel(type)
  const primaryAction = {
    label: sanitizeNotificationText(actionLabel, "Open notification"),
    path: row.path,
    eventId: row.navigationEventId || row.eventId,
  }
  const sections = [
    ...toDisplaySection(row.target, preview),
    ...toDisplaySection(row.detail, preview),
  ]

  return {
    type,
    title,
    action: sanitizeNotificationText(row.action || getDefaultAction(type), getDefaultAction(type)),
    context: sanitizeNotificationText(getDefaultContext(row, type), row.sourceLabel),
    preview,
    sourceLabel: sanitizeNotificationText(row.sourceLabel, "Notifications"),
    primaryAction,
    sections:
      sections.length > 0
        ? sections
        : [
            {
              label: title,
              preview,
              path: row.path,
              eventId: primaryAction.eventId,
              actionLabel: primaryAction.label,
            },
          ],
  }
}

export const getNotificationRowVisibleText = (display: NotificationRowDisplay) =>
  [
    display.title,
    display.action,
    display.context,
    display.preview,
    display.sourceLabel,
    display.primaryAction.label,
    ...display.sections.flatMap(section => [
      section.label,
      section.preview,
      section.actionLabel || "",
    ]),
  ]
    .filter(Boolean)
    .join(" ")

export const sortNotificationRows = (rows: NotificationRow[]) =>
  [...rows].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt

    return a.id.localeCompare(b.id)
  })

export const searchNotificationRows = (rows: NotificationRow[], term: string) => {
  const normalizedTerm = term.trim()
  if (!normalizedTerm) return rows

  return createSearch(rows, {
    getValue: (row: NotificationRow) => row.id,
    fuseOptions: {
      ignoreLocation: true,
      includeScore: true,
      isCaseSensitive: false,
      keys: [
        {name: "actorName", weight: 0.35},
        {name: "title", weight: 0.25},
        {name: "preview", weight: 0.2},
        {name: "sourceLabel", weight: 0.1},
        {name: "searchText", weight: 0.1},
      ],
      threshold: 0.3,
    },
  }).searchOptions(normalizedTerm) as NotificationRow[]
}

export const filterNotificationRows = (
  rows: NotificationRow[],
  {filters = [], term = ""}: NotificationRowFilterOptions = {},
) => {
  const filtered = rows.filter(row => {
    if (filters.length === 0) return true

    return filters.includes(row.source)
  })

  return sortNotificationRows(searchNotificationRows(filtered, term))
}
