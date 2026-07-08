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
  actorName?: string
  repoWatchSeenPath?: string
}

export type NotificationRowFilterOptions = {
  filters?: NotificationRowFilter[]
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
