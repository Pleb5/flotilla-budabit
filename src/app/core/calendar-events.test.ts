import {describe, expect, it} from "vitest"
import {EVENT_DATE, EVENT_TIME, type TrustedEvent} from "@welshman/util"
import {
  addCalendarDays,
  calendarDateToTimestamp,
  getCalendarEventRange,
  getDateBasedExclusiveEndDate,
  getDateBasedInclusiveEndDate,
  isCalendarEventKind,
  makeCalendarEventTags,
  normalizeCalendarEventKind,
  parseCalendarDate,
  parseCalendarTimestamp,
} from "./calendar-events"

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "a".repeat(64),
    created_at: 1,
    kind: EVENT_TIME,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("calendar event helpers", () => {
  it("identifies and normalizes supported calendar kinds", () => {
    expect(isCalendarEventKind(EVENT_DATE)).toBe(true)
    expect(isCalendarEventKind(EVENT_TIME)).toBe(true)
    expect(isCalendarEventKind(1)).toBe(false)
    expect(normalizeCalendarEventKind(EVENT_DATE)).toBe(EVENT_DATE)
    expect(normalizeCalendarEventKind(EVENT_TIME)).toBe(EVENT_TIME)
    expect(normalizeCalendarEventKind(1)).toBe(EVENT_TIME)
  })

  it("parses strict date strings and local midnight timestamps", () => {
    expect(parseCalendarDate("2026-06-17")).toBe("2026-06-17")
    expect(parseCalendarDate("2026-02-31")).toBe("")
    expect(parseCalendarDate("2026-6-7")).toBe("")

    const timestamp = calendarDateToTimestamp("2026-06-17")

    expect(timestamp).toBeTypeOf("number")
    expect(new Date(timestamp! * 1000).getFullYear()).toBe(2026)
    expect(new Date(timestamp! * 1000).getMonth()).toBe(5)
    expect(new Date(timestamp! * 1000).getDate()).toBe(17)
  })

  it("converts date-based inclusive and exclusive end dates", () => {
    expect(addCalendarDays("2026-06-17", 1)).toBe("2026-06-18")
    expect(getDateBasedExclusiveEndDate("2026-06-17", "2026-06-17")).toBeUndefined()
    expect(getDateBasedExclusiveEndDate("2026-06-17", "2026-06-19")).toBe("2026-06-20")
    expect(getDateBasedInclusiveEndDate("2026-06-17", undefined)).toBe("2026-06-17")
    expect(getDateBasedInclusiveEndDate("2026-06-17", "2026-06-20")).toBe("2026-06-19")
  })

  it("parses numeric timestamps and date-like fallback values", () => {
    expect(parseCalendarTimestamp("1718582400")).toBe(1718582400)
    expect(parseCalendarTimestamp(1_718_582_400_000)).toBe(1718582400)
    expect(parseCalendarTimestamp("not-a-date")).toBeUndefined()
    expect(parseCalendarTimestamp("2026-06-17")).toBeTypeOf("number")
  })

  it("builds spec-correct date-based calendar tags", () => {
    expect(
      makeCalendarEventTags({
        kind: EVENT_DATE,
        identifier: "all-day-1",
        title: "Conference",
        location: "Berlin",
        startDate: "2026-06-17",
        endDate: "2026-06-19",
        preservedTags: [["t", "nostr"]],
      }),
    ).toEqual([
      ["d", "all-day-1"],
      ["title", "Conference"],
      ["name", "Conference"],
      ["location", "Berlin"],
      ["start", "2026-06-17"],
      ["end", "2026-06-20"],
      ["t", "nostr"],
    ])

    expect(
      makeCalendarEventTags({
        kind: EVENT_DATE,
        identifier: "single-day",
        title: "Holiday",
        startDate: "2026-06-17",
        endDate: "2026-06-17",
      }),
    ).not.toContainEqual(["end", "2026-06-18"])
  })

  it("builds spec-correct time-based calendar tags", () => {
    expect(
      makeCalendarEventTags({
        kind: EVENT_TIME,
        identifier: "timed-1",
        title: "Call",
        start: 1718582400,
        end: 1718586000,
        extraTags: [["h", "target-id"]],
      }),
    ).toEqual([
      ["d", "timed-1"],
      ["title", "Call"],
      ["name", "Call"],
      ["location", ""],
      ["start", "1718582400"],
      ["end", "1718586000"],
      ["D", "19891"],
      ["h", "target-id"],
    ])
  })

  it("derives display and sorting ranges for both calendar kinds", () => {
    const dateEvent = makeEvent({
      kind: EVENT_DATE,
      tags: [
        ["start", "2026-06-17"],
        ["end", "2026-06-20"],
      ],
    })
    const timeEvent = makeEvent({
      kind: EVENT_TIME,
      tags: [
        ["start", "1718582400"],
        ["end", "1718586000"],
      ],
    })

    expect(getCalendarEventRange(dateEvent)).toMatchObject({
      kind: EVENT_DATE,
      dateBased: true,
      startDate: "2026-06-17",
      endDate: "2026-06-19",
    })
    expect(getCalendarEventRange(timeEvent)).toMatchObject({
      kind: EVENT_TIME,
      dateBased: false,
      start: 1718582400,
      end: 1718586000,
    })
  })
})
