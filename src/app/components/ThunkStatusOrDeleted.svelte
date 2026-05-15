<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {thunks, mergeThunks} from "@welshman/app"
  import ThunkStatus from "@app/components/ThunkStatus.svelte"

  const {event}: {event: TrustedEvent} = $props()

  const thunk = $derived(mergeThunks($thunks.filter(t => t.event.id === event.id)))
</script>

{#if thunk}
  <ThunkStatus {thunk} />
{/if}
