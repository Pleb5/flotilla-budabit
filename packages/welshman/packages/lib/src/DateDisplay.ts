/** Display dates use day-first English month names; numbers are Unix milliseconds.
 * Timezone defaults to the viewer's device setting, independently of the date style.
 */
export type DisplayDate = Date | number | string

export type DateDisplayOptions = {
  style?: "compact" | "full"
  /** Abbreviate a full date's month/weekday without losing its four-digit year. */
  abbreviated?: boolean
  weekday?: boolean
  timeZone?: string
}

export type TimeDisplayOptions = {
  seconds?: boolean
  timeZone?: string
}

export type DateTimeDisplayOptions = DateDisplayOptions &
  TimeDisplayOptions & {
    showTimeZone?: boolean
  }

export const getLocalTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const formatters = new Map<string, Intl.DateTimeFormat>()
const formatter = (options: Intl.DateTimeFormatOptions) => {
  const key = JSON.stringify(options)
  let result = formatters.get(key)
  if (!result) {
    result = new Intl.DateTimeFormat("en-GB", options)
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!)
    formatters.set(key, result)
  }
  return result
}

const toDate = (value: DisplayDate) => (value instanceof Date ? value : new Date(value))
const valid = (date: Date) => Number.isFinite(date.getTime())

export const formatDate = (value: DisplayDate, options: DateDisplayOptions = {}) => {
  const date = toDate(value)
  if (!valid(date)) return "—"
  const {style = "compact", abbreviated = false, weekday = false, timeZone} = options
  const parts = formatter({
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(weekday ? {weekday: "long" as const} : {}),
    timeZone,
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || ""
  const short = style === "compact" || abbreviated
  const month = short ? part("month").slice(0, 3) : part("month")
  const year = style === "compact" ? part("year").slice(-2).padStart(2, "0") : part("year")
  const prefix = weekday ? `${short ? part("weekday").slice(0, 3) : part("weekday")}, ` : ""
  return `${prefix}${part("day")} ${month} ${year}`
}

export const formatTime = (
  value: DisplayDate,
  {seconds = false, timeZone}: TimeDisplayOptions = {},
) => {
  const date = toDate(value)
  if (!valid(date)) return "—"
  return formatter({
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(seconds ? {second: "2-digit" as const} : {}),
    timeZone,
  }).format(date)
}

/** Offset at the displayed instant, including daylight-saving and fractional-hour offsets. */
export const formatTimeZone = (value: DisplayDate, timeZone?: string) => {
  const date = toDate(value)
  if (!valid(date)) return "—"
  return formatter({timeZone, timeZoneName: "longOffset"})
    .formatToParts(date)
    .find(part => part.type === "timeZoneName")!
    .value.replace("GMT", "UTC")
}

export const formatDateTime = (value: DisplayDate, options: DateTimeDisplayOptions = {}) => {
  const date = toDate(value)
  if (!valid(date)) return "—"
  const separator = options.style === "full" ? " at " : ", "
  const zone = options.showTimeZone ? ` · ${formatTimeZone(date, options.timeZone)}` : ""
  return `${formatDate(date, options)}${separator}${formatTime(date, options)}${zone}`
}

/** Full, timezone-qualified timestamp for details and tooltips. */
export const formatExactDateTime = (value: DisplayDate, options: TimeDisplayOptions = {}) =>
  formatDateTime(value, {...options, style: "full", showTimeZone: true})

/** All-day dates are literal calendar dates, never converted to the viewer's timezone. */
export const formatCalendarDate = (
  value: string,
  options: Omit<DateDisplayOptions, "timeZone"> = {},
) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "—"
  const date = new Date(`${value}T00:00:00Z`)
  if (!valid(date) || date.toISOString().slice(0, 10) !== value) return "—"
  return formatDate(date, {...options, timeZone: "UTC"})
}
