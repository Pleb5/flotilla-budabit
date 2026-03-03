<script lang="ts">
  import {cashuMints, cashuBalancesByMint, addCashuMint, removeCashuMint} from "@lib/budabit/cashu"
  import Button from "@lib/components/Button.svelte"

  const SUGGESTED_MINT = "https://mint.minibits.cash/Bitcoin"

  let newMintUrl = $state("")
  let adding = $state(false)
  let error = $state("")

  const mints = $derived($cashuMints)
  const balances = $derived($cashuBalancesByMint)

  const add = async () => {
    const url = newMintUrl.trim()
    if (!url) return
    try {
      new URL(url)
    } catch {
      error = "Invalid URL"
      return
    }
    adding = true
    error = ""
    try {
      await addCashuMint(url)
      newMintUrl = ""
    } catch (e: any) {
      error = e?.message || "Failed to add mint"
    } finally {
      adding = false
    }
  }

  const remove = async (url: string) => {
    try {
      await removeCashuMint(url)
    } catch (e: any) {
      error = e?.message || "Failed to remove mint"
    }
  }

  const addSuggested = () => {
    newMintUrl = SUGGESTED_MINT
  }
</script>

<div class="flex flex-col gap-4">
  {#if mints.length === 0}
    <div class="flex flex-col gap-2 rounded-lg border border-base-300 p-4 text-sm opacity-75">
      <p>No mints added yet.</p>
      <button class="btn btn-ghost btn-xs self-start" onclick={addSuggested}>
        + Add Minibits (suggested)
      </button>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      {#each mints as mint (mint)}
        <div class="card2 bg-alt flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <div class="flex flex-col gap-0.5 overflow-hidden">
            <span class="truncate font-mono text-xs">{mint}</span>
            <span class="text-xs opacity-60">
              {(balances.get(mint) ?? 0).toLocaleString()} sats
            </span>
          </div>
          <Button class="btn btn-ghost btn-xs text-error" onclick={() => remove(mint)}>✕</Button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="flex gap-2">
    <input
      class="input input-bordered input-sm flex-1 font-mono text-xs"
      type="url"
      placeholder="https://mint.example.com"
      bind:value={newMintUrl}
      onkeydown={e => e.key === "Enter" && add()} />
    <Button class="btn btn-primary btn-sm" onclick={add} disabled={adding || !newMintUrl.trim()}>
      {adding ? "Adding…" : "+ Add"}
    </Button>
  </div>

  {#if error}
    <p class="text-xs text-error">{error}</p>
  {/if}

  {#if mints.length === 0}
    <p class="text-xs opacity-50">
      Suggested: <button class="link" onclick={addSuggested}>{SUGGESTED_MINT}</button>
    </p>
  {/if}
</div>