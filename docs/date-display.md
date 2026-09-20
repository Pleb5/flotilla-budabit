# Date and time display

Budabit uses English, day-first dates independently of the device's locale:

- Compact: **5 Sep 26** for feed cards, notifications, lists and activity.
- Full: **5 September 2026** for articles, day headings and expanded details.
- Narrow full dates: **Sat, 5 Sep 2026** instead of **Saturday, 5 September 2026**.
- Times: **14:07**, in the viewer's device timezone; seconds only in technical details.

The shared helpers are exported from `@welshman/lib` (`DateDisplay.ts`).
`formatDate`, `formatTime`, `formatDateTime` and `formatExactDateTime` take a `Date`,
ISO datetime string or Unix **milliseconds**. The existing `formatTimestamp*`
helpers take Unix **seconds** and use the same convention. Relative activity
labels remain useful for recency.

Use `formatCalendarDate` for literal all-day `YYYY-MM-DD` dates. These are not
instants and must not shift when viewed in another timezone. Calendar event ends
are converted from exclusive to inclusive by `getCalendarEventRange` before display.

Show the timezone for scheduled events, delivery status and exact audit details.
`formatTimeZone` computes a UTC offset for the displayed instant, including DST.
Calendar schedules show each endpoint's offset when a range spans an offset change.
Organizer-provided `start_tzid`/`end_tzid` values are available in calendar details.
Scheduling inputs identify the viewer's timezone and the selected date's offset.

Use `DateTimeDisplay.svelte` when a timestamp needs to wrap between its date, time
and timezone rather than inside those parts. `TimestampDetails.svelte` provides
tap- and keyboard-accessible full timestamps, including seconds and UTC offset.
Calendar schedules use container queries to abbreviate dates in narrow layouts,
including desktop sidebars. Retain the date, year and any essential timezone on mobile.

The separately built pipelines iframe uses its own presentation helper with the
same full-date/time convention for exact timestamps.
