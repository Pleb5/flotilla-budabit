<script lang="ts">
  import {nthEq} from "@welshman/lib"
  import {type TrustedEvent} from "@welshman/util"
  import {formatTimestamp} from "@welshman/lib"
  import Content from "@app/components/Content.svelte"
  import JobActions from "./JobActions.svelte"
  import NoteCard from "./NoteCard.svelte"

  const {
    url,
    event,
    showComment = false,
    showActivity = false,
    showExternal = false,
    showThreadAction = false,
  }: {
    url: string
    event: TrustedEvent
    showComment?: boolean
    showActivity?: boolean
    showExternal?: boolean
    showThreadAction?: boolean
  } = $props()

  const title = event.tags.find(nthEq(0, "title"))?.[1]
</script>

<NoteCard {event} class="card2 bg-alt z-feature">
  {#if title}
    <div class="flex w-full items-center justify-between gap-2">
      <p class="text-xl">{title}</p>
    </div>
  {:else}
    <p class="mb-3 h-0 text-xs opacity-75">
      {formatTimestamp(event.created_at)}
    </p>
  {/if}
  <Content {event} expandMode="inline" />
  <div class="flex w-full flex-col items-end justify-between gap-2 sm:flex-row">
    <JobActions {url} {event} {showComment} {showActivity} {showExternal} {showThreadAction} />
  </div>
</NoteCard>
