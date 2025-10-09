<style>
  .extension-slot-container {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
</style>

<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {renderSlot} from "../slots"
  import type {ExtensionSlotId} from "../types"

  type Props = {
    slotId: ExtensionSlotId
    context?: Record<string, unknown>
  }

  const {slotId, context = {}}: Props = $props()

  let container: HTMLElement

  // Confirmed Svelte 5 compliant — retains explicit lifecycle, no $store usage
  onMount(() => {
    renderSlot(slotId, container, context)
  })

  onDestroy(() => {
    if (container) container.innerHTML = ""
  })
</script>

<div bind:this={container} class="extension-slot-container"></div>
