<script lang="ts">
  import type {ComponentProps} from "svelte"
  import {getTagValue} from "@welshman/util"
  import ContentMinimal from "@app/components/ContentMinimal.svelte"
  import CalendarEventSchedule from "./CalendarEventSchedule.svelte"

  const props: ComponentProps<typeof ContentMinimal> = $props()
  const title = $derived(getTagValue("title", props.event.tags) || getTagValue("name", props.event.tags))
</script>

<div class="flex flex-col">
  <div class="flex flex-grow flex-wrap justify-between gap-2">
    <p class="text-sm">{title}</p>
    <CalendarEventSchedule event={props.event} compact />
  </div>
  <ContentMinimal {...props} />
</div>
