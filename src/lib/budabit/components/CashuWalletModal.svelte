<script lang="ts">
  import {cashuTotalBalance, cashuBalancesByMint, cashuMints} from "@lib/budabit/cashu"
  import CashuReceive from "@lib/budabit/components/CashuReceive.svelte"
  import CashuTopUp from "@lib/budabit/components/CashuTopUp.svelte"
  import CashuSend from "@lib/budabit/components/CashuSend.svelte"
  import CashuHistory from "@lib/budabit/components/CashuHistory.svelte"
  import CashuMintManager from "@lib/budabit/components/CashuMintManager.svelte"

  type Tab = "balance" | "receive" | "send" | "history" | "mints"

  let activeTab = $state<Tab>("balance")

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

<div class="flex min-h-[400px] w-full flex-col gap-4 p-4">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-bold">Cashu Wallet</h2>
    <span class="text-lg font-mono font-semibold">{totalBalance.toLocaleString()} sats</span>
  </div>

  <!-- Tab bar -->
  <div class="tabs tabs-bordered">
    {#each tabs as tab}
      <button
        class="tab {activeTab === tab.id ? 'tab-active' : ''}"
        onclick={() => (activeTab = tab.id)}>
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab content -->
  <div class="flex-1">
    {#if activeTab === "balance"}
      <div class="flex flex-col gap-3">
        {#if mints.length === 0}
          <p class="py-4 text-center text-sm opacity-50">
            No mints configured. Go to the Mints tab to add one.
          </p>
        {:else}
          {#each mints as mint (mint)}
            <div class="card2 bg-alt flex items-center justify-between px-3 py-2 text-sm">
              <span class="truncate font-mono text-xs">{mint}</span>
              <span class="font-semibold">{(balancesByMint.get(mint) ?? 0).toLocaleString()} sats</span>
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
</div>