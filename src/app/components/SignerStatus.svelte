<script lang="ts">
  import {avg} from "@welshman/lib"
  import {signer} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import LogOut from "@app/components/LogOut.svelte"
  import {pushModal} from "@app/util/modal"

  // Simplified: treat absence of signer as disconnected
  const isDisconnected = $derived(!$signer)

  const logout = () => pushModal(LogOut)
</script>

<div class="card2 bg-alt flex flex-col gap-4">
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span class="text-xl font-bold">Signer Status</span>
      <span class="flex items-center gap-2">
        {#if isDisconnected}
          <Icon icon="close-circle" class="text-error" size={4} /> Disconnected
        {:else}
          <Icon icon="check-circle" class="text-success" size={4} /> Ok
        {/if}
      </span>
    </div>
    <p class="text-sm opacity-75">{isDisconnected ? "No signer connected" : "Signer connected"}</p>
  </div>
  {#if isDisconnected}
    <Button class="btn btn-outline btn-error" onclick={logout}>Logout to Reconnect</Button>
  {/if}
</div>
