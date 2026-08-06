import {describe, expect, it} from "vitest"
import {EVENT_DATE, EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {
  makeCalendarEventFilename,
  makeCalendarEventIcs,
  makeGoogleCalendarEventUrl,
} from "./calendar-export"

const makeEvent = (overrides: Partial<TrustedEvent> = {}): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "a".repeat(64),
    created_at: 1718582400,
    kind: EVENT_TIME,
    tags: [
      ["d", "event-identifier"],
      ["title", "Community call"],
      ["start", "1718582400"],
      ["end", "1718586000"],
    ],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("calendar event export", () => {
  it("exports timed events as UTC iCalendar events", () => {
    const event = makeEvent({
      content: "Agenda and updates",
      tags: [
        ["d", "community-call"],
        ["title", "Community call"],
        ["location", "Online"],
        ["start", "1718582400"],
        ["end", "1718586000"],
      ],
    })

    const ics = makeCalendarEventIcs(event, {
      url: "https://budabit.example/c/community/calendar/call",
    })

    expect(ics).toContain("UID:nostr:31923:")
    expect(ics).toContain(":community-call\r\n")
    expect(ics).toContain("DTSTAMP:20240617T000000Z\r\n")
    expect(ics).toContain("DTSTART:20240617T000000Z\r\n")
    expect(ics).toContain("DTEND:20240617T010000Z\r\n")
    expect(ics).toContain("SUMMARY:Community call\r\n")
    expect(ics).toContain("DESCRIPTION:Agenda and updates\r\n")
    expect(ics).toContain("LOCATION:Online\r\n")
    expect(ics).toContain("URL:https://budabit.example/c/community/calendar/call\r\n")
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true)
  })

  it("uses exclusive end dates for single-day and multi-day events", () => {
    const singleDay = makeEvent({
      kind: EVENT_DATE,
      tags: [
        ["d", "single-day"],
        ["title", "Community day"],
        ["start", "2026-06-17"],
      ],
    })
    const multiDay = makeEvent({
      kind: EVENT_DATE,
      tags: [
        ["d", "multi-day"],
        ["title", "Conference"],
        ["start", "2026-06-17"],
        ["end", "2026-06-20"],
      ],
    })

    expect(makeCalendarEventIcs(singleDay)).toContain(
      "DTSTART;VALUE=DATE:20260617\r\nDTEND;VALUE=DATE:20260618",
    )
    expect(makeCalendarEventIcs(multiDay)).toContain(
      "DTSTART;VALUE=DATE:20260617\r\nDTEND;VALUE=DATE:20260620",
    )
    expect(new URL(makeGoogleCalendarEventUrl(singleDay)).searchParams.get("dates")).toBe(
      "20260617/20260618",
    )
    expect(new URL(makeGoogleCalendarEventUrl(multiDay)).searchParams.get("dates")).toBe(
      "20260617/20260620",
    )
  })

  it("escapes text and folds every physical line to 75 UTF-8 bytes", () => {
    const title = `${"Community planning ".repeat(8)}東京`
    const event = makeEvent({
      content: "Bring notes,\nthen discuss; plans \\ drafts",
      tags: [
        ["d", "planning"],
        ["title", title],
        ["start", "1718582400"],
        ["end", "1718586000"],
      ],
    })

    const ics = makeCalendarEventIcs(event)
    const unfolded = ics.replace(/\r\n /g, "")
    const physicalLines = ics.split("\r\n").filter(Boolean)

    expect(unfolded).toContain(`SUMMARY:${title}\r\n`)
    expect(unfolded).toContain("DESCRIPTION:Bring notes\\,\\nthen discuss\\; plans \\\\ drafts\r\n")
    expect(physicalLines.some(line => line.startsWith(" "))).toBe(true)
    expect(physicalLines.every(line => new TextEncoder().encode(line).length <= 75)).toBe(true)
  })

  it("builds Google Calendar links with event details", () => {
    const event = makeEvent({
      content: "Agenda and updates",
      tags: [
        ["d", "community-call"],
        ["title", "Community call"],
        ["location", "Online"],
        ["start", "1718582400"],
        ["end", "1718586000"],
      ],
    })
    const eventUrl = "https://budabit.example/c/community/calendar/call"
    const calendarUrl = new URL(makeGoogleCalendarEventUrl(event, {url: eventUrl}))

    expect(calendarUrl.origin).toBe("https://calendar.google.com")
    expect(calendarUrl.searchParams.get("action")).toBe("TEMPLATE")
    expect(calendarUrl.searchParams.get("text")).toBe("Community call")
    expect(calendarUrl.searchParams.get("dates")).toBe("20240617T000000Z/20240617T010000Z")
    expect(calendarUrl.searchParams.get("details")).toBe(`Agenda and updates\n\n${eventUrl}`)
    expect(calendarUrl.searchParams.get("location")).toBe("Online")
  })

  it("keeps the UID stable across addressable event updates", () => {
    const original = makeEvent({id: "original-id"})
    const update = makeEvent({id: "updated-id", created_at: 1718586000})
    const getUid = (event: TrustedEvent) =>
      makeCalendarEventIcs(event)
        .split("\r\n")
        .find(line => line.startsWith("UID:"))

    expect(getUid(original)).toBe(getUid(update))
  })

  it("does not export malformed calendar ranges", () => {
    const missingEnd = makeEvent({
      tags: [
        ["d", "missing-end"],
        ["title", "Incomplete event"],
        ["start", "1718582400"],
      ],
    })
    const backwards = makeEvent({
      tags: [
        ["d", "backwards"],
        ["title", "Backwards event"],
        ["start", "1718586000"],
        ["end", "1718582400"],
      ],
    })

    expect(makeCalendarEventIcs(missingEnd)).toBe("")
    expect(makeGoogleCalendarEventUrl(missingEnd)).toBe("")
    expect(makeCalendarEventIcs(backwards)).toBe("")
  })

  it("creates safe, readable calendar filenames", () => {
    const event = makeEvent({
      tags: [
        ["title", ' Community: call / questions? "today". '],
        ["start", "1718582400"],
        ["end", "1718586000"],
      ],
    })

    expect(makeCalendarEventFilename(event)).toBe("Community call questions today.ics")
  })
})
