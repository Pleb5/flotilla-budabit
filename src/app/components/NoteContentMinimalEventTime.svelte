<script lang="ts">
  import type {ComponentProps} from "svelte"
  import {
    formatTimestamp,
    formatTimestampAsDate,
    formatTimestampAsTime,
  } from "@welshman/lib"
  import {getTagValue} from "@welshman/util"
  import ClockCircle from "@assets/icons/clock-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ContentMinimal from "@app/components/ContentMinimal.svelte"
  import {getCalendarEventRange} from "@app/core/calendar-events"

  const props: ComponentProps<typeof ContentMinimal> = $props()
  const title = $derived(getTagValue("title", props.event.tags) || getTagValue("name", props.event.tags))
  const range = $derived(getCalendarEventRange(props.event))
</script>

<div class="flex flex-col">
  <div class="flex flex-grow flex-wrap justify-between gap-2">
    <p class="text-sm">{title}</p>
    {#if range}
      {@const startDateDisplay = formatTimestampAsDate(range.start)}
      {@const endDateDisplay = range.end ? formatTimestampAsDate(range.end) : startDateDisplay}
      {@const isSingleDay = startDateDisplay === endDateDisplay}
      <div class="flex items-center gap-2">
        {#if !range.dateBased}<Icon icon={ClockCircle} size={4} />{/if}
        <span class="hidden sm:block">{formatTimestampAsDate(range.start)}</span>
        {#if range.dateBased}
          {#if isSingleDay}
            All day
          {:else}
            All day through {endDateDisplay}
          {/if}
        {:else if range.end}
          {formatTimestampAsTime(range.start)} — {isSingleDay
            ? formatTimestampAsTime(range.end)
            : formatTimestamp(range.end)}
        {:else}
          {formatTimestampAsTime(range.start)}
        {/if}
      </div>
    {/if}
  </div>
  <ContentMinimal {...props} />
</div>
