<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {
    cashuMints,
    cashuBalancesByMint,
    cashuBackupConfirmed,
    createCashuToken,
  } from "@app/core/cashu"
  import {formatCashuSats} from "@app/util/cashu-format"
  import {getCashuTokenInfo} from "@app/util/cashu-token"
  import {pushModal} from "@app/util/modal"
  import Button from "@lib/components/Button.svelte"
  import CashuSeedBackup from "@app/components/CashuSeedBackup.svelte"
  import CashuSavedSends from "./CashuSavedSends.svelte"

  let selectedMint = $state("")
  let amount = $state(0)
  let loading = $state(false)
  let token = $state("")
  let error = $state("")
  let copied = $state(false)
  let tokenHeading = $state<HTMLHeadingElement>()
  let alive = true
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  onDestroy(() => {
    alive = false
    clearTimeout(copyTimer)
  })

  const mints = $derived($cashuMints)
  const balances = $derived($cashuBalancesByMint)
  const backupConfirmed = $derived($cashuBackupConfirmed)
  const tokenInfo = $derived(token ? getCashuTokenInfo(token) : undefined)

  $effect(() => {
    if (mints.length > 0 && !selectedMint) {
      selectedMint = mints[0]
    }
  })

  const selectedBalance = $derived(selectedMint ? (balances.get(selectedMint) ?? 0) : 0)

  const send = async () => {
    if (loading) return
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
      const created = await createCashuToken(amount, selectedMint)
      if (alive) openToken(created)
    } catch (e: any) {
      if (!alive) return
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
    try {
      await navigator.clipboard.writeText(token)
      copied = true
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => (copied = false), 2000)
    } catch {
      error = "Could not copy token. Select and copy the text above."
    }
  }

  const openToken = (saved: string) => {
    token = saved
    copied = false
    error = ""
    void tick().then(() => {
      if (!alive) return
      tokenHeading?.focus({preventScroll: true})
      tokenHeading?.scrollIntoView({block: "start"})
    })
  }

  const reset = () => {
    token = ""
    amount = 0
    error = ""
    copied = false
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  {#if token}
    <div class="flex flex-col gap-3">
      <h3 bind:this={tokenHeading} tabindex="-1" class="text-sm font-medium text-success">
        Token saved. Copy and share it:
      </h3>
      {#if tokenInfo}
        <p class="font-mono font-bold">{formatCashuSats(tokenInfo.amount)} sats</p>
        <p class="break-all text-xs opacity-70">{tokenInfo.mintUrl}</p>
      {/if}
      <p class="text-xs opacity-70">
        Saved in this wallet. You can reopen it from Send or History.
      </p>
      <textarea
        aria-label="Saved Cashu token"
        class="textarea textarea-bordered min-w-0 break-all font-mono text-xs"
        rows={4}
        readonly
        value={token}></textarea>
      <div class="flex flex-col gap-2 sm:flex-row">
        <Button class="btn btn-primary inline-flex flex-1 justify-center" onclick={copy}>
          {copied ? "Copied!" : "Copy Token"}
        </Button>
        <Button class="btn btn-ghost inline-flex justify-center" onclick={reset}
          >Create another token</Button>
      </div>
      {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
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
  <CashuSavedSends onopen={openToken} />
</div>
