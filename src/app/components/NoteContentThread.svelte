<script lang="ts">
  import type {ComponentProps} from "svelte"
  import DateTimeDisplay from "@lib/components/DateTimeDisplay.svelte"
  import {getTagValue} from "@welshman/util"
  import Content from "@app/components/Content.svelte"

  const props: ComponentProps<typeof Content> = $props()

  const title = getTagValue("title", props.event.tags)
</script>

<div class="flex flex-col gap-2">
  {#if title}
    <div class="flex w-full flex-wrap items-center justify-between gap-2">
      <p class="text-xl">{title}</p>
      <p class="text-sm opacity-75">
        <DateTimeDisplay value={props.event.created_at * 1000} />
      </p>
    </div>
  {:else}
    <p class="mb-3 h-0 text-xs opacity-75">
      <DateTimeDisplay value={props.event.created_at * 1000} />
    </p>
  {/if}
  {#if props.event.content}
    <Content {...props} />
  {/if}
</div>
