<script lang="ts">
  // CashuWalletWidget — floating balance chip, visible after Cashu setup is complete
  import {pubkey} from "@welshman/app"
  import {
    cashuTotalBalance,
    cashuBackupConfirmed,
    cashuSeedLocked,
    cashuSetupRequired,
    cashuSetupResolved,
  } from "@app/core/cashu"
  import {pushModal} from "@app/util/modal"
  import CashuWalletModal from "@app/components/CashuWalletModal.svelte"
  import {formatCashuSats} from "@app/util/cashu-format"

  const isLoggedIn = $derived(!!$pubkey)
  const balance = $derived($cashuTotalBalance)
  const cashuReady = $derived(
    $cashuSetupResolved && $cashuBackupConfirmed && !$cashuSetupRequired && !$cashuSeedLocked,
  )

  const openWallet = () => pushModal(CashuWalletModal)
</script>

{#if isLoggedIn && cashuReady}
  <button
    class="z-50 fixed bottom-20 right-4 flex items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-3 py-1.5 text-xs font-semibold shadow-md transition-opacity hover:opacity-90 md:bottom-4"
    onclick={openWallet}
    title="Open Cashu Wallet">
    <span class="text-warning">₿</span>
    <span>{formatCashuSats(balance)} sats</span>
  </button>
{/if}
