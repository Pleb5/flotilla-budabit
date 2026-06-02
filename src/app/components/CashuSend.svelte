<script lang="ts">
  import {
    cashuMints,
    cashuBalancesByMint,
    cashuBackupConfirmed,
    createCashuToken,
  } from "@app/core/cashu"
  import {formatCashuSats} from "@app/util/cashu-format"
  import {pushModal} from "@app/util/modal"
  import Button from "@lib/components/Button.svelte"
  import CashuSeedBackup from "@app/components/CashuSeedBackup.svelte"

  let selectedMint = $state("")
  let amount = $state(0)
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
      pushModal(CashuSeedBackup, {mode: "backup", onconfirmed: send})
      return
    }
    if (!selectedMint || amount <= 0) return
    if (amount > selectedBalance) {
      error = `Insufficient balance. Available: ${formatCashuSats(selectedBalance)} sats`
      return
    }
    loading = true
    error = ""
    token = ""
    try {
      token = await createCashuToken(amount, selectedMint)
    } catch (e: any) {
      if (e?.message === "backup_required") {
        pushModal(CashuSeedBackup, {mode: "backup", onconfirmed: send})
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
    error = ""
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  {#if token}
    <div class="flex flex-col gap-3">
      <p class="text-sm font-medium text-success">Token created! Copy and share it:</p>
      <textarea
        class="textarea textarea-bordered min-w-0 break-all font-mono text-xs"
        rows={4}
        readonly
        value={token}></textarea>
      <div class="flex flex-col gap-2 sm:flex-row">
        <Button class="btn btn-primary inline-flex flex-1 justify-center" onclick={copy}>
          {copied ? "Copied!" : "Copy Token"}
        </Button>
        <Button class="btn btn-ghost inline-flex justify-center" onclick={reset}>New</Button>
      </div>
    </div>
  {:else if mints.length === 0}
    <p class="text-sm opacity-75">Add a mint first to send tokens.</p>
  {:else}
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="send-mint">Mint</label>
        <select
          id="send-mint"
          class="select select-bordered select-sm min-w-0"
          bind:value={selectedMint}>
          {#each mints as mint (mint)}
            <option value={mint}>{mint} ({formatCashuSats(balances.get(mint) ?? 0)} sats)</option>
          {/each}
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium" for="send-amount">
          Amount (sats)
          <span class="ml-2 text-xs opacity-60">Available: {formatCashuSats(selectedBalance)}</span>
        </label>
        <input
          id="send-amount"
          class="input input-sm input-bordered min-w-0"
          type="number"
          min="1"
          max={selectedBalance}
          bind:value={amount} />
      </div>
    </div>

    {#if error}
      <p class="text-sm text-error">{error}</p>
    {/if}

    <Button
      class="btn btn-primary inline-flex w-full justify-center"
      onclick={send}
      disabled={loading || !selectedMint || amount <= 0}>
      {loading ? "Creating…" : "Create Token"}
    </Button>
  {/if}
</div>
