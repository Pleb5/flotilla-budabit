<style>
  .calendar-schedule {
    container-type: inline-size;
  }
  .calendar-date-short {
    display: none;
  }
  @container (max-width: 28rem) {
    .calendar-date-full {
      display: none;
    }
    .calendar-date-short {
      display: flex;
    }
  }
</style>

<script lang="ts">
  import {
    formatCalendarDate,
    formatDate,
    formatTime,
    formatTimeZone,
    formatExactDateTime,
  } from "@welshman/lib"
  import {getTagValue, type TrustedEvent} from "@welshman/util"
  import {getCalendarEventRange} from "@app/core/calendar-events"

  const {event, compact = false}: {event: TrustedEvent; compact?: boolean} = $props()
  const range = $derived(getCalendarEventRange(event))
  const dateLabel = (seconds: number, calendarDate?: string, abbreviated = false) => {
    const options = {
      style: compact ? ("compact" as const) : ("full" as const),
      weekday: !compact,
      abbreviated,
    }
    return calendarDate
      ? formatCalendarDate(calendarDate, options)
      : formatDate(seconds * 1000, options)
  }
  const validZone = (value?: string) => {
    if (!value) return undefined
    try {
      new Intl.DateTimeFormat("en-GB", {timeZone: value})
      return value
    } catch {
      return undefined
    }
  }
  const startZone = $derived(validZone(getTagValue("start_tzid", event.tags)))
  const endZone = $derived(validZone(getTagValue("end_tzid", event.tags)) || startZone)
</script>

{#if range}
  {@const startDate = dateLabel(range.start, range.startDate)}
  {@const endDate = range.end !== undefined ? dateLabel(range.end, range.endDate) : startDate}
  {@const singleDay = startDate === endDate}
  <div class="calendar-schedule w-full min-w-0 text-sm">
    <div class="calendar-date-full flex flex-wrap items-baseline gap-x-1">
      <span class="whitespace-nowrap">{startDate}</span>
      {#if !singleDay}<span>—</span><span class="whitespace-nowrap">{endDate}</span>{/if}
    </div>
    <div class="calendar-date-short flex flex-wrap items-baseline gap-x-1">
      <span class="whitespace-nowrap">{dateLabel(range.start, range.startDate, true)}</span>
      {#if !singleDay && range.end !== undefined}
        <span>—</span><span class="whitespace-nowrap"
          >{dateLabel(range.end, range.endDate, true)}</span>
      {/if}
    </div>
    {#if range.dateBased}
      <p class="opacity-75">All day</p>
    {:else}
      {@const startOffset = formatTimeZone(range.start * 1000)}
      {@const endOffset = range.end !== undefined ? formatTimeZone(range.end * 1000) : startOffset}
      <div class="mt-1 flex flex-wrap items-baseline gap-x-1 opacity-75">
        <span class="whitespace-nowrap"
          >{formatTime(range.start * 1000)}{startOffset !== endOffset
            ? ` ${startOffset}`
            : ""}</span>
        {#if range.end !== undefined}
          <span>—</span><span class="whitespace-nowrap">{formatTime(range.end * 1000)}</span>
        {/if}
        <span class="whitespace-nowrap">· {endOffset}</span>
      </div>
      {#if !compact && startZone}
        <details class="mt-1 text-xs opacity-75">
          <summary class="cursor-pointer">Event timezone: {startZone}</summary>
          <p class="mt-1">
            Starts {formatExactDateTime(range.start * 1000, {timeZone: startZone})}
          </p>
          {#if range.end !== undefined}
            <p>
              Ends {formatExactDateTime(range.end * 1000, {timeZone: endZone})}{endZone !==
              startZone
                ? ` (${endZone})`
                : ""}
            </p>
          {/if}
        </details>
      {/if}
    {/if}
  </div>
{/if}
