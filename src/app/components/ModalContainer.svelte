<script lang="ts">
  import Drawer from "@lib/components/Drawer.svelte"
  import Dialog from "@lib/components/Dialog.svelte"
  import {modal, clearModals} from "@app/util/modal"

  const onKeyDown = (e: any) => {
    if (e.code === "Escape" && e.target === document.body) {
      clearModals()
    }
  }

  const m = $derived($modal)
  
  // Additional safety check to ensure modal is valid
  const isValidModal = $derived(m && m.component && m.id && typeof m.component === 'function')
</script>

<svelte:window onkeydown={onKeyDown} />

{#if isValidModal && m.options?.drawer}
  <Drawer onClose={clearModals} {...m.options}>
    {#key m.id}
      <m.component {...m.props} />
    {/key}
  </Drawer>
{:else if isValidModal}
  <Dialog onClose={clearModals} {...m.options}>
    {#key m.id}
      <m.component {...m.props} />
    {/key}
  </Dialog>
{/if}
