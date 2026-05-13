<script lang="ts">
  import ModalHeader from "@lib/components/ModalHeader.svelte"
</script>

<div class="column gap-4">
  <ModalHeader>
    {#snippet title()}
      <div>Room archiving unavailable</div>
    {/snippet}
  </ModalHeader>
  <p class="text-sm opacity-70">Room archiving is not part of the current community workflow.</p>
</div>
