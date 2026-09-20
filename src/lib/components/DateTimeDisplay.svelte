<style>
  .date-abbreviated {
    display: none;
  }
  @container date-display (max-width: 12rem) {
    .date-full {
      display: none;
    }
    .date-abbreviated {
      display: inline;
    }
  }
</style>

<script lang="ts">
  import {
    formatDate,
    formatTime,
    formatTimeZone,
    formatExactDateTime,
    type DisplayDate,
    type DateTimeDisplayOptions,
  } from "@welshman/lib"

  const {
    value,
    options = {},
    dateOnly = false,
  }: {
    value: DisplayDate
    options?: DateTimeDisplayOptions
    dateOnly?: boolean
  } = $props()
  const date = $derived(value instanceof Date ? value : new Date(value))
  const datetime = $derived(Number.isFinite(date.getTime()) ? date.toISOString() : undefined)
</script>

<time
  {datetime}
  title={formatExactDateTime(value, {timeZone: options.timeZone, seconds: options.seconds})}
  class="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
  <span class="whitespace-nowrap" class:date-full={options.style === "full" && !options.abbreviated}
    >{formatDate(value, options)}{dateOnly || options.style === "full" ? "" : ","}</span>
  {#if options.style === "full" && !options.abbreviated}
    <span class="date-abbreviated whitespace-nowrap"
      >{formatDate(value, {...options, abbreviated: true})}</span>
  {/if}
  {#if !dateOnly}<span class="whitespace-nowrap"
      >{options.style === "full" ? "at " : ""}{formatTime(value, options)}</span
    >{/if}
  {#if options.showTimeZone}
    <span class="whitespace-nowrap">· {formatTimeZone(value, options.timeZone)}</span>
  {/if}
</time>
