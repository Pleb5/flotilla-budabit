<style>
  .extension-slot-container {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }

  .extension-slot-container:empty {
    display: none;
  }
</style>

<script lang="ts">
  import {getSlotHandlers, renderSlot} from "../slots"
  import type {ExtensionSlotId} from "../types"

  type Props = {
    slotId: ExtensionSlotId
    context?: Record<string, unknown>
  }

  const {slotId, context = {}}: Props = $props()

  const hasHandlers = $derived(getSlotHandlers(slotId).length > 0)

  let container: HTMLElement | undefined = $state()

  // Render slot when container is available; cleanup on destroy
  $effect(() => {
    if (container && hasHandlers) {
      renderSlot(slotId, container, context)
      return () => {
        if (container) container.innerHTML = ""
      }
    }
  })
</script>

{#if hasHandlers}
  <div bind:this={container} class="extension-slot-container"></div>
{/if}
