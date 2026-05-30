<script lang="ts">
  import {cashuMints, cashuBalancesByMint, addCashuMint, removeCashuMint} from "@app/core/cashu"
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

<div class="flex min-w-0 flex-col gap-4">
  {#if mints.length === 0}
    <div
      class="flex flex-col gap-2 rounded-lg border border-base-300 p-3 text-sm opacity-75 sm:p-4">
      <p>No mints added yet.</p>
      <button class="btn btn-ghost btn-xs self-start" onclick={addSuggested}>
        + Add Minibits (suggested)
      </button>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      {#each mints as mint (mint)}
        <div
          class="card2 bg-alt flex min-w-0 flex-col items-start gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 flex-col gap-0.5 overflow-hidden">
            <span class="max-w-full break-all font-mono text-xs sm:truncate">{mint}</span>
            <span class="text-xs opacity-60">
              {(balances.get(mint) ?? 0).toLocaleString()} sats
            </span>
          </div>
          <Button
            class="btn btn-ghost btn-xs inline-flex w-full justify-center text-error sm:w-auto"
            onclick={() => remove(mint)}>✕</Button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="flex flex-col gap-2 sm:flex-row">
    <input
      class="input input-sm input-bordered min-w-0 flex-1 font-mono text-xs"
      type="url"
      placeholder="https://mint.example.com"
      bind:value={newMintUrl}
      onkeydown={e => e.key === "Enter" && add()} />
    <Button
      class="btn btn-primary btn-sm inline-flex w-full justify-center sm:w-auto"
      onclick={add}
      disabled={adding || !newMintUrl.trim()}>
      {adding ? "Adding…" : "+ Add"}
    </Button>
  </div>

  {#if error}
    <p class="text-xs text-error">{error}</p>
  {/if}

  {#if mints.length === 0}
    <p class="break-all text-xs opacity-50">
      Suggested: <button class="link" onclick={addSuggested}>{SUGGESTED_MINT}</button>
    </p>
  {/if}
</div>
