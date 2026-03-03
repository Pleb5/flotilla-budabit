<script lang="ts">
  // CashuWalletWidget — floating balance chip, always visible when logged in
  import {pubkey} from "@welshman/app"
  import {cashuTotalBalance, cashuInitialized} from "@lib/budabit/cashu"
  import {pushModal} from "@app/util/modal"
  import CashuWalletModal from "@lib/budabit/components/CashuWalletModal.svelte"

  const isLoggedIn = $derived(!!$pubkey)
  const balance = $derived($cashuTotalBalance)
  const initialized = $derived($cashuInitialized)

  const openWallet = () => pushModal(CashuWalletModal)
</script>

{#if isLoggedIn}
  <button
    class="fixed bottom-20 right-4 z-50 flex items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-3 py-1.5 text-xs font-semibold shadow-md transition-opacity hover:opacity-90 md:bottom-4"
    onclick={openWallet}
    title="Open Cashu Wallet">
    <span class="text-warning">₿</span>
    {#if !initialized}
      <span class="opacity-50">Set up Cashu</span>
    {:else}
      <span>{balance.toLocaleString()} sats</span>
    {/if}
  </button>
{/if}