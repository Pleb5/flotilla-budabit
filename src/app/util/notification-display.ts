import {createSearch} from "@welshman/app"

export type NotificationRowSource = "chat" | "git" | "community" | "other"

export type NotificationRowFilter = NotificationRowSource

export type NotificationRow = {
  id: string
  source: NotificationRowSource
  sourceLabel: string
  title: string
  preview: string
  path: string
  readPath: string
  createdAt: number
  searchText: string
  eventId?: string
  actorPubkey?: string
  repoWatchSeenPath?: string
}

export type NotificationRowFilterOptions = {
  filter?: NotificationRowFilter | ""
  term?: string
}

export const NOTIFICATION_ROW_FILTERS: {value: NotificationRowFilter; label: string}[] = [
  {value: "chat", label: "Chats"},
  {value: "git", label: "Git"},
  {value: "community", label: "Communities"},
  {value: "other", label: "Other"},
]

export const getNotificationSourceLabel = (source: NotificationRowSource) => {
  switch (source) {
    case "chat":
      return "Chats"
    case "git":
      return "Git"
    case "community":
      return "Communities"
    default:
      return "Other"
  }
}

export const buildNotificationSearchText = (
  ...values: Array<string | number | undefined>
) =>
  values
    .map(value => String(value || "").trim().toLowerCase())
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
      keys: ["searchText"],
      threshold: 0.35,
    },
  }).searchOptions(normalizedTerm) as NotificationRow[]
}

export const filterNotificationRows = (
  rows: NotificationRow[],
  {filter = "", term = ""}: NotificationRowFilterOptions = {},
) => {
  const filtered = rows.filter(row => {
    if (!filter) return true

    return row.source === filter
  })

  return sortNotificationRows(searchNotificationRows(filtered, term))
}
