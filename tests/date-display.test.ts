import {describe, expect, it} from "vitest"
import {
  formatDate,
  formatDateTime,
  formatTime,
  formatTimeZone,
  formatExactDateTime,
  formatCalendarDate,
  formatTimestamp,
  formatTimestampAsDate,
  formatTimestampAsTime,
} from "@welshman/lib"

describe("date display convention", () => {
  const instant = "2026-09-05T14:07:09Z"

  it("uses unambiguous compact and full dates, with a three-letter September", () => {
    expect(formatDate(instant, {timeZone: "UTC"})).toBe("5 Sep 26")
    expect(formatDate(instant, {style: "full", timeZone: "UTC"})).toBe("5 September 2026")
    expect(formatDate(instant, {style: "full", weekday: true, timeZone: "UTC"})).toBe(
      "Saturday, 5 September 2026",
    )
    expect(
      formatDate(instant, {style: "full", weekday: true, abbreviated: true, timeZone: "UTC"}),
    ).toBe("Sat, 5 Sep 2026")
  })

  it("uses the viewer's local time and keeps Unix seconds and milliseconds explicit", () => {
    const local = new Date(2026, 8, 5, 14, 7)
    expect(formatDateTime(local.getTime())).toBe("5 Sep 26, 14:07")
    expect(formatTimestamp(local.getTime() / 1000)).toBe("5 Sep 26, 14:07")
    expect(formatTimestampAsDate(local.getTime() / 1000)).toBe("5 September 2026")
    expect(formatTimestampAsTime(local.getTime() / 1000)).toBe("14:07")
    expect(formatTime(new Date(2026, 8, 5, 0, 0))).toBe("00:00")
  })

  it("converts both the date and time across midnight/year boundaries", () => {
    const newYear = "2026-01-01T00:30:00Z"
    expect(formatDateTime(newYear, {timeZone: "America/Los_Angeles", showTimeZone: true})).toBe(
      "31 Dec 25, 16:30 · UTC-08:00",
    )
    expect(formatDateTime(newYear, {timeZone: "Asia/Kathmandu", showTimeZone: true})).toBe(
      "1 Jan 26, 06:15 · UTC+05:45",
    )
  })

  it("disambiguates the repeated hour when daylight-saving time ends", () => {
    const options = {timeZone: "Europe/Berlin", showTimeZone: true}
    expect(formatDateTime("2026-10-25T00:30:00Z", options)).toBe("25 Oct 26, 02:30 · UTC+02:00")
    expect(formatDateTime("2026-10-25T01:30:00Z", options)).toBe("25 Oct 26, 02:30 · UTC+01:00")
    expect(formatTimeZone("2026-01-05T14:00:00Z", "Europe/Berlin")).toBe("UTC+01:00")
    expect(formatTimeZone(instant, "Europe/Berlin")).toBe("UTC+02:00")
  })

  it("provides full timezone-qualified details, with seconds when requested", () => {
    expect(formatExactDateTime(instant, {timeZone: "UTC", seconds: true})).toBe(
      "5 September 2026 at 14:07:09 · UTC",
    )
  })

  it("preserves all-day calendar dates and validates leap days", () => {
    expect(formatCalendarDate("2026-09-05", {style: "full"})).toBe("5 September 2026")
    expect(formatCalendarDate("2024-02-29")).toBe("29 Feb 24")
    expect(formatCalendarDate("2026-02-29")).toBe("—")
    expect(formatCalendarDate("2026-9-5")).toBe("—")
  })

  it("handles missing/invalid display values without throwing and accepts the Unix epoch", () => {
    expect(formatDateTime("")).toBe("—")
    expect(formatDateTime(NaN)).toBe("—")
    expect(formatTime(new Date(NaN))).toBe("—")
    expect(formatDate(0, {timeZone: "UTC"})).toBe("1 Jan 70")
  })
})
