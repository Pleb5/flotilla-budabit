<script lang="ts">
  import {nthEq} from "@welshman/lib"
  import {type TrustedEvent} from "@welshman/util"
  import NoteCard from "./NoteCard.svelte"
  import GitActions from "./GitActions.svelte"

  const {
    url,
    event,
    showActivity = true,
    showIssues = true,
    showActions = true
  }: {
    url: string
    event: TrustedEvent
    showActivity?: boolean
    showIssues?: boolean
    showActions?: boolean
  } = $props()

  const name = event.tags.find(nthEq(0, "name"))?.[1]
  const description = event.tags.find(nthEq(0, "description"))?.[1]
</script>

<NoteCard {event} class="card2 sm:card2-sm bg-alt">
  {#if name}
    <div class="flex w-full items-center justify-between gap-2">
      <p class="text-xl break-words overflow-wrap-anywhere">{name}</p>
    </div>
  {:else}
    <p class="mb-3 h-0 text-xs opacity-75">
      Name missing!
    </p>
  {/if}
  {#if description}
    <div class="flex w-full items-start">
      <p class="text-lg break-words overflow-wrap-anywhere">{description}</p>
    </div>
  {:else}
    <p class="mb-3 h-0 text-xs opacity-75">
      Description missing!
    </p>
  {/if}
  {#if showActions}
    <div class="flex w-full flex-col items-end justify-between gap-2 sm:flex-row">
      <GitActions {showActivity} {showIssues} {url} {event} />
    </div>
  {/if}
</NoteCard>

