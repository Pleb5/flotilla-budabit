<script lang="ts">
  import {cashuWalletError, reloadCashuWallet} from "@app/core/cashu"
  import Button from "@lib/components/Button.svelte"
</script>

<div role="alert" class="flex min-w-0 flex-col gap-3 rounded-box bg-error/10 p-4">
  <p class="font-semibold">Cashu wallet could not be loaded</p>
  <p class="break-words text-sm">{$cashuWalletError}</p>
  <p class="text-sm opacity-75">
    Your saved wallet has been retained. Close other Budabit tabs and retry.
  </p>
  <Button class="btn btn-sm self-start" onclick={() => reloadCashuWallet()}>Retry wallet</Button>
</div>
