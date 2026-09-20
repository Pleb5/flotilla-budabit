<style>
  .timestamp-details {
    container: date-display / inline-size;
  }
  summary {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::before {
    content: "▸";
    flex-shrink: 0;
  }
  details[open] summary::before {
    content: "▾";
  }
</style>

<script lang="ts">
  import {formatExactDateTime, type DisplayDate} from "@welshman/lib"
  import DateTimeDisplay from "./DateTimeDisplay.svelte"

  const {value}: {value: DisplayDate} = $props()
</script>

<details class="timestamp-details w-full min-w-0 max-w-full">
  <summary
    class="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    aria-label={`Timestamp details: ${formatExactDateTime(value)}`}
    onclick={event => event.stopPropagation()}
    onkeydown={event => event.stopPropagation()}>
    <DateTimeDisplay {value} />
  </summary>
  <p class="mt-1 select-text text-xs leading-relaxed">
    <DateTimeDisplay {value} options={{style: "full", seconds: true, showTimeZone: true}} />
  </p>
</details>
