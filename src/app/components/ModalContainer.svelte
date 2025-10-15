<script lang="ts">
  import Drawer from "@lib/components/Drawer.svelte"
  import Dialog from "@lib/components/Dialog.svelte"
  import {modal, clearModals, modals} from "@app/util/modal"
  import type {Modal} from "@app/util/modal"

  const onKeyDown = (e: any) => {
    if (e.code === "Escape" && e.target === document.body) {
      clearModals()
    }
  }

  // Use the original upstream pattern: keep the last valid modal if hash becomes invalid
  let lastValidModal: Modal | null = $state(null)
  
  $effect(() => {
    const currentModal = $modal
    if (currentModal) {
      lastValidModal = currentModal
    } else {
      // If currentModal is undefined, check if we should clear lastValidModal
      // This happens when history.back() changes the hash to something invalid
      const hash = window.location.hash.slice(1)
      if (!hash || !$modals[hash]) {
        lastValidModal = null
      }
    }
  })
  
  // Listen to modals store to detect when it's cleared
  $effect(() => {
    const modalsStore = $modals
    // If modals store is empty, clear the lastValidModal
    if (Object.keys(modalsStore).length === 0) {
      lastValidModal = null
    }
  })
</script>

<svelte:window onkeydown={onKeyDown} />

{#if lastValidModal?.options?.drawer}
  <Drawer onClose={clearModals} {...lastValidModal.options}>
    {#key lastValidModal.id}
      <lastValidModal.component {...lastValidModal.props} />
    {/key}
  </Drawer>
{:else if lastValidModal?.component}
  <Dialog onClose={clearModals} {...lastValidModal.options}>
    {#key lastValidModal.id}
      <lastValidModal.component {...lastValidModal.props} />
    {/key}
  </Dialog>
{/if}