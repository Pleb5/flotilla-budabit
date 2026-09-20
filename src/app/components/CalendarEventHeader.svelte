<script lang="ts">
  import {getTagValue, type TrustedEvent} from "@welshman/util"
  import CalendarEventSchedule from "./CalendarEventSchedule.svelte"

  type Props = {
    event: TrustedEvent
  }

  const {event}: Props = $props()
  const title = $derived(getTagValue("title", event.tags) || getTagValue("name", event.tags))
</script>

<div class="flex flex-col gap-2">
  <p class="text-xl">{title}</p>
  <CalendarEventSchedule {event} />
</div>
