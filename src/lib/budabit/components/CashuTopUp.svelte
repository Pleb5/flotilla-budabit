<script lang="ts">
  import {cashuMints, requestMintQuote, checkMintQuote, mintTokensFromQuote} from "@lib/budabit/cashu"
  import Button from "@lib/components/Button.svelte"
  import QRCode from "qrcode"

  const POLL_INTERVAL_MS = 3000
  const MAX_POLLS = 200 // ~10 min

  let selectedMint = $state("")
  let amount = $state(100)
  let loading = $state(false)
  let error = $state("")
  let invoice = $state("")
  let quoteId = $state("")
  let qrDataUrl = $state("")
  let pollCount = $state(0)
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let success = $state(false)
  let copied = $state(false)

  const mints = $derived($cashuMints)

  $effect(() => {
    if (mints.length > 0 && !selectedMint) {
      selectedMint = mints[0]
    }
  })

  const requestInvoice = async () => {
    if (!selectedMint || amount <= 0) return
    loading = true
    error = ""
    invoice = ""
    quoteId = ""
    qrDataUrl = ""
    pollCount = 0
    success = false
    try {
      const result = await requestMintQuote(selectedMint, amount)
      quoteId = result.quote
      invoice = result.request
      qrDataUrl = await QRCode.toDataURL(invoice, {margin: 1, width: 256})
      startPolling()
    } catch (e: any) {
      error = e?.message || "Failed to request invoice"
    } finally {
      loading = false
    }
  }

  const startPolling = () => {
    if (pollTimer) clearTimeout(pollTimer)
    poll()
  }

  const poll = async () => {
    if (!quoteId || !selectedMint) return
    pollCount++
    if (pollCount > MAX_POLLS) {
      error = "Invoice expired. Please try again."
      invoice = ""
      return
    }
    try {
      const state = await checkMintQuote(selectedMint, quoteId)
      if (state === "paid") {
        await mintTokensFromQuote(selectedMint, quoteId, amount)
        success = true
        invoice = ""
        return
      }
    } catch {
      // pass — keep polling
    }
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS)
  }

  const cancel = () => {
    if (pollTimer) clearTimeout(pollTimer)
    invoice = ""
    quoteId = ""
    qrDataUrl = ""
    error = ""
  }

  const copyInvoice = async () => {
    await navigator.clipboard.writeText(invoice)
    copied = true
    setTimeout(() => (copied = false), 2000)
  }

  $effect(() => {
    return () => {
      if (pollTimer) clearTimeout(pollTimer)
    }
  })
</script>

<div class="flex flex-col gap-4">
  {#if success}
    <div class="rounded-lg bg-success/10 p-4 text-center text-success">
      <p class="text-lg font-bold">+{amount.toLocaleString()} sats received!</p>
      <Button class="btn btn-ghost btn-sm mt-2" onclick={() => (success = false)}>
        Top up again
      </Button>
    </div>
  {:else if invoice}
    <div class="flex flex-col items-center gap-4">
      <p class="text-sm opacity-75">
        Pay this Lightning invoice to top up <strong>{amount.toLocaleString()} sats</strong>
      </p>
      {#if qrDataUrl}
        <img src={qrDataUrl} alt="Lightning invoice QR code" class="rounded-lg" width="200" height="200" />
      {/if}
      <div class="flex w-full gap-2">
        <input
          class="input input-bordered input-xs flex-1 font-mono"
          type="text"
          readonly
          value={invoice} />
        <Button class="btn btn-neutral btn-xs" onclick={copyInvoice}>
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>
      <p class="text-xs opacity-50">Waiting for payment… ({pollCount} checks)</p>
      <Button class="btn btn-ghost btn-sm" onclick={cancel}>Cancel</Button>
    </div>
  {:else}
    {#if mints.length === 0}
      <p class="text-sm opacity-75">Add a mint first to top up via Lightning.</p>
    {:else}
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="topup-mint">Mint</label>
          <select id="topup-mint" class="select select-bordered select-sm" bind:value={selectedMint}>
            {#each mints as mint (mint)}
              <option value={mint}>{mint}</option>
            {/each}
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="topup-amount">Amount (sats)</label>
          <input
            id="topup-amount"
            class="input input-bordered input-sm"
            type="number"
            min="1"
            bind:value={amount} />
        </div>
      </div>

      {#if error}
        <p class="text-sm text-error">{error}</p>
      {/if}

      <Button
        class="btn btn-primary"
        onclick={requestInvoice}
        disabled={loading || !selectedMint || amount <= 0}>
        {loading ? "Requesting…" : "Get Lightning Invoice"}
      </Button>
    {/if}
  {/if}
</div>