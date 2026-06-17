<script lang="ts">
  import {
    formatTimestamp,
    formatTimestampAsDate,
    formatTimestampAsTime,
  } from "@welshman/lib"
  import {getTagValue, type TrustedEvent} from "@welshman/util"
  import ClockCircle from "@assets/icons/clock-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import {getCalendarEventRange} from "@app/core/calendar-events"

  type Props = {
    event: TrustedEvent
  }

  const {event}: Props = $props()
  const title = $derived(getTagValue("title", event.tags) || getTagValue("name", event.tags))
  const range = $derived(getCalendarEventRange(event))
</script>

<div class="flex flex-col gap-2">
  <p class="text-xl">{title}</p>
  {#if range}
    {@const startDateDisplay = formatTimestampAsDate(range.start)}
    {@const endDateDisplay = range.end ? formatTimestampAsDate(range.end) : startDateDisplay}
    {@const isSingleDay = startDateDisplay === endDateDisplay}
    <div class="flex flex-col items-start gap-1 text-sm">
      <span>
        {#if isSingleDay}
          {startDateDisplay}
        {:else}
          {startDateDisplay} — {endDateDisplay}
        {/if}
      </span>
      {#if range.dateBased}
        <span class="opacity-75">All day</span>
      {:else}
        <div class="flex items-center gap-2">
          <Icon icon={ClockCircle} size={4} />
          {#if range.end}
            {formatTimestampAsTime(range.start)} — {isSingleDay
              ? formatTimestampAsTime(range.end)
              : formatTimestamp(range.end)}
          {:else}
            {formatTimestampAsTime(range.start)}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
