<style>
  .extension-slot-container {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
</style>

<script lang="ts">
  import {renderSlot} from "../slots"
  import type {ExtensionSlotId} from "../types"

  type Props = {
    slotId: ExtensionSlotId
    context?: Record<string, unknown>
  }

  const {slotId, context = {}}: Props = $props()

  let container: HTMLElement | undefined = $state()

  // Render slot when container is available; cleanup on destroy
  $effect(() => {
    if (container) {
      renderSlot(slotId, container, context)
      return () => {
        if (container) container.innerHTML = ""
      }
    }
  })
</script>

<div bind:this={container} class="extension-slot-container"></div>
