import {EVENT_DATE, getTagValue, type TrustedEvent} from "@welshman/util"
import {getCalendarEventAddress} from "@app/core/community-calendar"
import {
  addCalendarDays,
  getCalendarEventRange,
  isCalendarEventKind,
} from "@app/core/calendar-events"

type CalendarExportOptions = {
  url?: string
}

type CalendarExportData = {
  title: string
  description: string
  location: string
  uid: string
  url: string
  dateBased: boolean
  start: string
  end: string
  timestamp: string
}

const textEncoder = new TextEncoder()
const invalidFilenameCharacters = '<>:"/\\|?*'

const formatUtcTimestamp = (seconds: number) =>
  new Date(seconds * 1000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")

const formatCalendarDate = (value: string) => value.replaceAll("-", "")

const escapeIcalendarText = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")

const foldIcalendarLine = (line: string) => {
  const lines: string[] = []
  let current = ""
  let currentBytes = 0

  for (const character of line) {
    const characterBytes = textEncoder.encode(character).length

    if (current && currentBytes + characterBytes > 75) {
      lines.push(current)
      current = ` ${character}`
      currentBytes = 1 + characterBytes
    } else {
      current += character
      currentBytes += characterBytes
    }
  }

  lines.push(current)

  return lines.join("\r\n")
}

const getCalendarExportData = (
  event: TrustedEvent,
  {url = ""}: CalendarExportOptions = {},
): CalendarExportData | undefined => {
  if (!isCalendarEventKind(event.kind)) return undefined

  const range = getCalendarEventRange(event)
  if (!range) return undefined

  let start: string
  let end: string

  if (event.kind === EVENT_DATE) {
    if (!range.startDate || !range.endDate) return undefined

    const exclusiveEndDate = addCalendarDays(range.endDate, 1)
    if (!exclusiveEndDate) return undefined

    start = formatCalendarDate(range.startDate)
    end = formatCalendarDate(exclusiveEndDate)
  } else {
    if (range.end === undefined || range.end <= range.start) return undefined

    start = formatUtcTimestamp(range.start)
    end = formatUtcTimestamp(range.end)
  }

  const address = getCalendarEventAddress(event)
  const createdAt = Number.isFinite(event.created_at) ? Math.max(0, event.created_at) : 0

  return {
    title:
      getTagValue("title", event.tags)?.trim() ||
      getTagValue("name", event.tags)?.trim() ||
      "Calendar event",
    description: (
      event.content ||
      getTagValue("description", event.tags) ||
      getTagValue("summary", event.tags) ||
      ""
    ).trim(),
    location: (getTagValue("location", event.tags) || "").trim(),
    uid: `nostr:${address || event.id}`,
    url: url.trim().replace(/[\r\n]/g, ""),
    dateBased: range.dateBased,
    start,
    end,
    timestamp: formatUtcTimestamp(createdAt),
  }
}

export const makeCalendarEventIcs = (event: TrustedEvent, options: CalendarExportOptions = {}) => {
  const data = getCalendarExportData(event, options)
  if (!data) return ""

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Budabit//Calendar Event//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcalendarText(data.uid)}`,
    `DTSTAMP:${data.timestamp}`,
    data.dateBased ? `DTSTART;VALUE=DATE:${data.start}` : `DTSTART:${data.start}`,
    data.dateBased ? `DTEND;VALUE=DATE:${data.end}` : `DTEND:${data.end}`,
    `SUMMARY:${escapeIcalendarText(data.title)}`,
  ]

  if (data.description) lines.push(`DESCRIPTION:${escapeIcalendarText(data.description)}`)
  if (data.location) lines.push(`LOCATION:${escapeIcalendarText(data.location)}`)
  if (data.url) lines.push(`URL:${data.url}`)

  lines.push("END:VEVENT", "END:VCALENDAR")

  return `${lines.map(foldIcalendarLine).join("\r\n")}\r\n`
}

export const makeGoogleCalendarEventUrl = (
  event: TrustedEvent,
  options: CalendarExportOptions = {},
) => {
  const data = getCalendarExportData(event, options)
  if (!data) return ""

  const calendarUrl = new URL("https://calendar.google.com/calendar/render")
  const details = [data.description, data.url].filter(Boolean).join("\n\n")

  calendarUrl.searchParams.set("action", "TEMPLATE")
  calendarUrl.searchParams.set("text", data.title)
  calendarUrl.searchParams.set("dates", `${data.start}/${data.end}`)
  if (details) calendarUrl.searchParams.set("details", details)
  if (data.location) calendarUrl.searchParams.set("location", data.location)

  return calendarUrl.toString()
}

export const makeCalendarEventFilename = (event: TrustedEvent) => {
  const title =
    getTagValue("title", event.tags)?.trim() ||
    getTagValue("name", event.tags)?.trim() ||
    "calendar-event"
  const safeTitle = Array.from(title)
    .map(character =>
      character.charCodeAt(0) <= 31 || invalidFilenameCharacters.includes(character)
        ? " "
        : character,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "")
  const truncatedTitle = Array.from(safeTitle || "calendar-event")
    .slice(0, 100)
    .join("")

  return `${truncatedTitle}.ics`
}
