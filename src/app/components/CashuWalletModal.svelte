<script lang="ts">
  import {
    cashuTotalBalance,
    cashuBalancesByMint,
    cashuMints,
    cashuBackupConfirmed,
    cashuRecoveryInProgress,
    cashuSetupResolved,
    cashuSetupRequired,
    cashuSeedLocked,
  } from "@app/core/cashu"
  import CashuReceive from "@app/components/CashuReceive.svelte"
  import CashuTopUp from "@app/components/CashuTopUp.svelte"
  import CashuSend from "@app/components/CashuSend.svelte"
  import CashuHistory from "@app/components/CashuHistory.svelte"
  import CashuMintManager from "@app/components/CashuMintManager.svelte"
  import CashuRecoveryLoader from "@app/components/CashuRecoveryLoader.svelte"
  import CashuSeedBackup from "@app/components/CashuSeedBackup.svelte"
  import CashuMintCard from "@app/components/CashuMintCard.svelte"
  import {formatCashuSats} from "@app/util/cashu-format"

  type Props = {
    showHeader?: boolean
    showMintsTab?: boolean
  }
  type Tab = "balance" | "receive" | "send" | "history" | "mints"

  const {showHeader = true, showMintsTab = true}: Props = $props()

  let activeTab = $state<Tab>("balance")

  const setupResolved = $derived($cashuSetupResolved)
  const recoveryInProgress = $derived($cashuRecoveryInProgress)
  const needsSetup = $derived($cashuSetupRequired || $cashuSeedLocked || !$cashuBackupConfirmed)
  const totalBalance = $derived($cashuTotalBalance)
  const balancesByMint = $derived($cashuBalancesByMint)
  const mints = $derived($cashuMints)

  const tabs = $derived([
    {id: "balance", label: "Balance"},
    {id: "receive", label: "Receive"},
    {id: "send", label: "Send"},
    {id: "history", label: "History"},
    ...(showMintsTab ? [{id: "mints", label: "Mints"}] : []),
  ] as {id: Tab; label: string}[])
</script>

<div class="flex min-h-[400px] w-full min-w-0 flex-col gap-3 p-2 sm:gap-4 sm:p-4">
  {#if recoveryInProgress}
    <CashuRecoveryLoader />
  {:else if !setupResolved}
    <div class="flex min-h-[320px] items-center justify-center text-sm opacity-70">
      Loading Cashu wallet…
    </div>
  {:else if needsSetup}
    <CashuSeedBackup />
  {:else}
    {#if showHeader}
      <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-xl font-bold">Cashu Wallet</h2>
          <span class="rounded-full bg-warning/15 px-2 py-1 text-xs font-semibold text-warning">
            Warning! Experimental, use at own risk!
          </span>
        </div>
        <span class="font-mono text-base font-semibold sm:text-lg"
          >{formatCashuSats(totalBalance)} sats</span>
      </div>
    {/if}

    <!-- Tab bar -->
    <div class="scroll-container -mx-2 overflow-x-auto px-2 pb-1 sm:mx-0 sm:px-0">
      <div class="tabs tabs-bordered flex-nowrap whitespace-nowrap">
        {#each tabs as tab}
          <button
            class="tab shrink-0 {activeTab === tab.id ? 'tab-active' : ''}"
            onclick={() => (activeTab = tab.id)}>
            {tab.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Tab content -->
    <div class="min-w-0 flex-1">
      {#if activeTab === "balance"}
        <div class="flex flex-col gap-3">
          {#if mints.length === 0}
            <p class="py-4 text-center text-sm opacity-50">
              {showMintsTab
                ? "No mints configured. Go to the Mints tab to add one."
                : "No mints configured. Go to Wallet Settings to add one."}
            </p>
          {:else}
            {#each mints as mint (mint)}
              <CashuMintCard mintUrl={mint} balance={balancesByMint.get(mint) ?? 0} />
            {/each}
          {/if}
          <div class="mt-2">
            <p class="mb-1 text-xs font-medium opacity-60">Recent activity</p>
            <CashuHistory limit={3} />
          </div>
        </div>
      {:else if activeTab === "receive"}
        <div class="flex flex-col gap-4">
          <CashuReceive />
          <div class="divider text-xs opacity-50">or top up via Lightning</div>
          <CashuTopUp />
        </div>
      {:else if activeTab === "send"}
        <CashuSend />
      {:else if activeTab === "history"}
        <CashuHistory />
      {:else if activeTab === "mints"}
        <CashuMintManager />
      {/if}
    </div>
  {/if}
</div>
