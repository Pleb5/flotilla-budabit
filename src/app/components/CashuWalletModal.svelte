<script lang="ts">
  import {
    cashuTotalBalance,
    cashuBalancesByMint,
    cashuMints,
    cashuBackupConfirmed,
    cashuSeedLocked,
  } from "@app/core/cashu"
  import CashuReceive from "@app/components/CashuReceive.svelte"
  import CashuTopUp from "@app/components/CashuTopUp.svelte"
  import CashuSend from "@app/components/CashuSend.svelte"
  import CashuHistory from "@app/components/CashuHistory.svelte"
  import CashuMintManager from "@app/components/CashuMintManager.svelte"
  import CashuSeedBackup from "@app/components/CashuSeedBackup.svelte"

  type Tab = "balance" | "receive" | "send" | "history" | "mints"

  let activeTab = $state<Tab>("balance")

  const needsBackup = $derived($cashuSeedLocked || !$cashuBackupConfirmed)
  const totalBalance = $derived($cashuTotalBalance)
  const balancesByMint = $derived($cashuBalancesByMint)
  const mints = $derived($cashuMints)

  const tabs: {id: Tab; label: string}[] = [
    {id: "balance", label: "Balance"},
    {id: "receive", label: "Receive"},
    {id: "send", label: "Send"},
    {id: "history", label: "History"},
    {id: "mints", label: "Mints"},
  ]
</script>

<div class="flex min-h-[400px] w-full min-w-0 flex-col gap-3 p-2 sm:gap-4 sm:p-4">
  {#if needsBackup}
    <CashuSeedBackup />
  {:else}
    <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-xl font-bold">Cashu Wallet</h2>
      <span class="font-mono text-base font-semibold sm:text-lg"
        >{totalBalance.toLocaleString()} sats</span>
    </div>

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
              No mints configured. Go to the Mints tab to add one.
            </p>
          {:else}
            {#each mints as mint (mint)}
              <div
                class="card2 bg-alt flex min-w-0 flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span class="max-w-full break-all font-mono text-xs sm:truncate">{mint}</span>
                <span class="font-semibold sm:shrink-0"
                  >{(balancesByMint.get(mint) ?? 0).toLocaleString()} sats</span>
              </div>
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
