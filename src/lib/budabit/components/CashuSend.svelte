<script lang="ts">
  import {cashuMints, cashuBalancesByMint, cashuBackupConfirmed, createCashuToken} from "@lib/budabit/cashu"
  import {pushModal} from "@app/util/modal"
  import Button from "@lib/components/Button.svelte"
  import CashuSeedBackup from "@lib/budabit/components/CashuSeedBackup.svelte"

  let selectedMint = $state("")
  let amount = $state(0)
  let label = $state("")
  let loading = $state(false)
  let token = $state("")
  let error = $state("")
  let copied = $state(false)

  const mints = $derived($cashuMints)
  const balances = $derived($cashuBalancesByMint)
  const backupConfirmed = $derived($cashuBackupConfirmed)

  $effect(() => {
    if (mints.length > 0 && !selectedMint) {
      selectedMint = mints[0]
    }
  })

  const selectedBalance = $derived(selectedMint ? (balances.get(selectedMint) ?? 0) : 0)

  const send = async () => {
    if (!backupConfirmed) {
      pushModal(CashuSeedBackup, {onconfirmed: send})
      return
    }
    if (!selectedMint || amount <= 0) return
    if (amount > selectedBalance) {
      error = `Insufficient balance. Available: ${selectedBalance.toLocaleString()} sats`
      return
    }
    loading = true
    error = ""
    token = ""
    try {
      token = await createCashuToken(amount, selectedMint, label || undefined)
    } catch (e: any) {
      if (e?.message === "backup_required") {
        pushModal(CashuSeedBackup, {onconfirmed: send})
      } else {
        error = e?.message || "Failed to create token"
      }
    } finally {
      loading = false
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(token)
    copied = true
    setTimeout(() => (copied = false), 2000)
  }

  const reset = () => {
    token = ""
    amount = 0
    label = ""
    error = ""
  }
</script>

<div class="flex flex-col gap-4">
  {#if token}
    <div class="flex flex-col gap-3">
      <p class="text-sm font-medium text-success">Token created! Copy and share it:</p>
      <textarea
        class="textarea textarea-bordered font-mono text-xs"
        rows={4}
        readonly
        value={token}></textarea>
      <div class="flex gap-2">
        <Button class="btn btn-primary flex-1" onclick={copy}>
          {copied ? "Copied!" : "Copy Token"}
        </Button>
        <Button class="btn btn-ghost" onclick={reset}>New</Button>
      </div>
    </div>
  {:else}
    {#if mints.length === 0}
      <p class="text-sm opacity-75">Add a mint first to send tokens.</p>
    {:else}
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="send-mint">Mint</label>
          <select id="send-mint" class="select select-bordered select-sm" bind:value={selectedMint}>
            {#each mints as mint (mint)}
              <option value={mint}>{mint} ({(balances.get(mint) ?? 0).toLocaleString()} sats)</option>
            {/each}
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="send-amount">
            Amount (sats)
            <span class="ml-2 text-xs opacity-60">Available: {selectedBalance.toLocaleString()}</span>
          </label>
          <input
            id="send-amount"
            class="input input-bordered input-sm"
            type="number"
            min="1"
            max={selectedBalance}
            bind:value={amount} />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="send-label">Label (optional)</label>
          <input
            id="send-label"
            class="input input-bordered input-sm"
            type="text"
            placeholder="e.g. payment for..."
            bind:value={label} />
        </div>
      </div>

      {#if error}
        <p class="text-sm text-error">{error}</p>
      {/if}

      <Button
        class="btn btn-primary"
        onclick={send}
        disabled={loading || !selectedMint || amount <= 0}>
        {loading ? "Creating…" : "Create Token"}
      </Button>
    {/if}
  {/if}
</div>