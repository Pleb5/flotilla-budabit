import {EVENT_DATE, EVENT_TIME, getTagValue, type TrustedEvent} from "@welshman/util"
import {daysBetween} from "@lib/util"

export const CALENDAR_EVENT_KINDS = [EVENT_DATE, EVENT_TIME] as const

export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number]

export type CalendarEventRange = {
  kind: CalendarEventKind
  dateBased: boolean
  start: number
  end?: number
  startDate?: string
  endDate?: string
}

export type CalendarEventTagInput = {
  kind: CalendarEventKind
  identifier: string
  title: string
  location?: string
  start?: number
  end?: number
  startDate?: string
  endDate?: string
  preservedTags?: string[][]
  extraTags?: string[][]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const pad2 = (value: number) => String(value).padStart(2, "0")

export const isCalendarEventKind = (kind: number): kind is CalendarEventKind =>
  CALENDAR_EVENT_KINDS.includes(kind as CalendarEventKind)

export const isDateBasedCalendarKind = (kind: number) => kind === EVENT_DATE

export const normalizeCalendarEventKind = (kind?: number): CalendarEventKind =>
  kind === EVENT_DATE ? EVENT_DATE : EVENT_TIME

export const formatDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

export const timestampToDateInputValue = (seconds: number | undefined) =>
  Number.isFinite(seconds) ? formatDateInputValue(new Date(seconds! * 1000)) : ""

export const parseCalendarDate = (value?: string) => {
  const trimmed = value?.trim() || ""
  if (!DATE_RE.test(trimmed)) return ""

  const [year, month, day] = trimmed.split("-").map(Number)
  const date = new Date(year, month - 1, day)

  return formatDateInputValue(date) === trimmed ? trimmed : ""
}

export const calendarDateToTimestamp = (value?: string) => {
  const dateValue = parseCalendarDate(value)
  if (!dateValue) return undefined

  const [year, month, day] = dateValue.split("-").map(Number)

  return Math.floor(new Date(year, month - 1, day).getTime() / 1000)
}

export const addCalendarDays = (value: string, days: number) => {
  const dateValue = parseCalendarDate(value)
  if (!dateValue) return ""

  const [year, month, day] = dateValue.split("-").map(Number)

  return formatDateInputValue(new Date(year, month - 1, day + days))
}

export const getDateBasedInclusiveEndDate = (startDate?: string, exclusiveEndDate?: string) => {
  const start = parseCalendarDate(startDate)
  if (!start) return ""

  const exclusiveEnd = parseCalendarDate(exclusiveEndDate)
  if (!exclusiveEnd || exclusiveEnd <= start) return start

  return addCalendarDays(exclusiveEnd, -1) || start
}

export const getDateBasedExclusiveEndDate = (startDate?: string, inclusiveEndDate?: string) => {
  const start = parseCalendarDate(startDate)
  const inclusiveEnd = parseCalendarDate(inclusiveEndDate) || start
  if (!start || !inclusiveEnd || inclusiveEnd <= start) return undefined

  return addCalendarDays(inclusiveEnd, 1) || undefined
}

export const parseCalendarTimestamp = (value: string | number | undefined) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.floor(value > 1_000_000_000_000 ? value / 1000 : value) : undefined
  }

  const trimmed = value?.trim()
  if (!trimmed) return undefined

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) return Math.floor(numeric > 1_000_000_000_000 ? numeric / 1000 : numeric)

  const timestamp = Date.parse(DATE_RE.test(trimmed) ? `${trimmed}T00:00:00` : trimmed)

  return Number.isNaN(timestamp) ? undefined : Math.floor(timestamp / 1000)
}

export const getCalendarEventRange = (
  event: Pick<TrustedEvent, "kind" | "tags">,
): CalendarEventRange | undefined => {
  const kind = normalizeCalendarEventKind(event.kind)

  if (kind === EVENT_DATE) {
    const startDate = parseCalendarDate(getTagValue("start", event.tags))
    if (!startDate) return undefined

    const endDate = getDateBasedInclusiveEndDate(startDate, getTagValue("end", event.tags))
    const start = calendarDateToTimestamp(startDate)
    const end = calendarDateToTimestamp(endDate)
    if (start === undefined) return undefined

    return {kind, dateBased: true, start, end, startDate, endDate}
  }

  const start = parseCalendarTimestamp(getTagValue("start", event.tags))
  if (start === undefined) return undefined

  const end = parseCalendarTimestamp(getTagValue("end", event.tags))

  return {kind, dateBased: false, start, end}
}

export const makeCalendarEventTags = ({
  kind,
  identifier,
  title,
  location = "",
  start,
  end,
  startDate,
  endDate,
  preservedTags = [],
  extraTags = [],
}: CalendarEventTagInput) => {
  const tags = [
    ["d", identifier],
    ["title", title],
    ["name", title],
    ["location", location],
  ]

  if (kind === EVENT_DATE) {
    const normalizedStartDate = parseCalendarDate(startDate)
    if (!normalizedStartDate) throw new Error("Date-based calendar events require a valid start date.")

    const normalizedEndDate = parseCalendarDate(endDate) || normalizedStartDate

    tags.push(["start", normalizedStartDate])

    const exclusiveEndDate = getDateBasedExclusiveEndDate(normalizedStartDate, normalizedEndDate)
    if (exclusiveEndDate) tags.push(["end", exclusiveEndDate])
  } else {
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error("Time-based calendar events require valid start and end timestamps.")
    }

    tags.push(
      ["start", String(Math.floor(start!))],
      ["end", String(Math.floor(end!))],
      ...daysBetween(start!, end!).map(day => ["D", String(day)]),
    )
  }

  return [...tags, ...preservedTags, ...extraTags]
}
