<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {
    cashuMints,
    cashuTopUps,
    requestMintQuote,
    checkMintQuote,
    mintTokensFromQuote,
    getCashuTopUp,
    refreshCashuTopUps,
    type CashuTopUpQuote,
  } from "@app/core/cashu"
  import {formatCashuSats} from "@app/util/cashu-format"
  import Button from "@lib/components/Button.svelte"
  import QRCode from "qrcode"

  const POLL_INTERVAL_MS = 3000
  const MAX_POLLS = 200
  let selectedMint = $state("")
  let amount = $state(100)
  let loading = $state(false)
  let error = $state("")
  let active = $state<CashuTopUpQuote | null>(null)
  let qrDataUrl = $state("")
  let pollCount = $state(0)
  let paused = $state(false)
  let copied = $state(false)
  let generation = 0
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  const mints = $derived($cashuMints)

  $effect(() => {
    if (!mints.includes(selectedMint)) selectedMint = mints[0] ?? ""
  })

  const stopPolling = () => {
    generation++
    clearTimeout(pollTimer)
    clearTimeout(copyTimer)
  }
  onMount(() => {
    void refreshCashuTopUps()
  })
  onDestroy(stopPolling)

  const poll = async (quote: CashuTopUpQuote, current: number) => {
    if (current !== generation) return
    if (++pollCount > MAX_POLLS) {
      paused = true
      return
    }
    try {
      let latest = await getCashuTopUp(quote.mintUrl, quote.quote)
      if (current !== generation) return
      if (latest.state !== "complete" && latest.state !== "failed") {
        const remote = await checkMintQuote(quote.mintUrl, quote.quote)
        if (current !== generation) return
        if (remote === "paid") {
          active = {...latest, state: "pending"}
          await mintTokensFromQuote(quote.mintUrl, quote.quote, quote.amount)
        }
        latest = await getCashuTopUp(quote.mintUrl, quote.quote)
        if (remote === "expired" && latest.state === "unpaid") latest.state = "expired"
      }
      if (current !== generation) return
      active = latest
      error = latest.error || ""
      if (["complete", "expired", "failed"].includes(latest.state)) {
        void refreshCashuTopUps()
        return
      }
    } catch (e) {
      if (current !== generation) return
      error = e instanceof Error ? e.message : "Could not check payment. Your invoice is saved."
    }
    if (current === generation)
      pollTimer = setTimeout(() => void poll(quote, current), POLL_INTERVAL_MS)
  }

  const showQuote = async (quote: CashuTopUpQuote) => {
    stopPolling()
    const current = generation
    active = quote
    error = ""
    qrDataUrl = ""
    copied = false
    paused = false
    pollCount = 0
    void poll(quote, current)
    try {
      const image = await QRCode.toDataURL(quote.request, {margin: 1, width: 256})
      if (current === generation) qrDataUrl = image
    } catch {
      // The copyable invoice remains available if QR rendering fails.
    }
  }

  const requestInvoice = async () => {
    if (!selectedMint || !Number.isSafeInteger(amount) || amount <= 0) return
    loading = true
    error = ""
    const current = generation
    try {
      const quote = await requestMintQuote(selectedMint, amount)
      if (current === generation) await showQuote(quote)
    } catch (e) {
      if (current === generation)
        error = e instanceof Error ? e.message : "Failed to request invoice"
    } finally {
      loading = false
    }
  }

  const closeInvoice = () => {
    stopPolling()
    active = null
    error = ""
    paused = false
    void refreshCashuTopUps()
  }
  const copyInvoice = async () => {
    if (!active) return
    try {
      await navigator.clipboard.writeText(active.request)
      copied = true
      copyTimer = setTimeout(() => (copied = false), 2000)
    } catch {
      error = "Could not copy invoice. Select and copy the text below."
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  {#if active?.state === "complete"}
    <div role="status" class="rounded-lg bg-success/10 p-4 text-center text-success">
      <p class="text-lg font-bold">+{formatCashuSats(active.amount)} sats received!</p>
      <Button class="btn btn-ghost btn-sm mt-2" onclick={closeInvoice}>Top up again</Button>
    </div>
  {:else if active}
    <div class="flex min-w-0 flex-col items-center gap-4">
      <p class="text-sm opacity-75">
        {active.state === "unpaid" ? "Pay this Lightning invoice to top up" : "Lightning top-up:"}
        <strong>{formatCashuSats(active.amount)} sats</strong>
      </p>
      <p class="w-full break-all text-center text-xs opacity-60">{active.mintUrl}</p>
      {#if active.state === "unpaid"}
        {#if qrDataUrl}
          <img
            src={qrDataUrl}
            alt="Lightning invoice QR code"
            class="h-auto w-full max-w-[200px] rounded-lg"
            width="200"
            height="200" />
        {/if}
        <div class="flex w-full min-w-0 flex-col gap-2 sm:flex-row">
          <input
            aria-label="Lightning invoice"
            class="input input-xs input-bordered min-w-0 flex-1 font-mono"
            type="text"
            readonly
            value={active.request} />
          <Button class="btn btn-neutral btn-xs inline-flex justify-center" onclick={copyInvoice}
            >{copied ? "Copied!" : "Copy"}</Button>
        </div>
      {/if}
      <p role="status" class="text-center text-sm">
        {#if active.state === "expired"}This unpaid invoice has expired.
        {:else if active.state === "failed"}This top-up needs attention. Its recovery data is saved.
        {:else if paused}Automatic checking is paused. Your invoice is saved; you can check again.
        {:else if active.state === "pending"}Payment detected. Recovering your ecash—do not pay
          again.
        {:else}Waiting for payment…{/if}
      </p>
      {#if paused}
        <Button class="btn btn-sm" onclick={() => active && showQuote(active)}>Check again</Button>
      {/if}
      <p class="text-center text-xs opacity-60">
        You can close this view and resume saved invoices later.
      </p>
      <Button class="btn btn-ghost btn-sm" onclick={closeInvoice}>Close invoice</Button>
    </div>
  {:else}
    {#if $cashuTopUps.length}
      <div class="flex min-w-0 flex-col gap-2">
        <h4 class="text-sm font-semibold">Saved Lightning invoices</h4>
        {#each $cashuTopUps as quote (`${quote.mintUrl}:${quote.quote}`)}
          <div
            class="flex min-w-0 flex-col gap-2 rounded-lg bg-base-200 p-3 sm:flex-row sm:items-center">
            <div class="min-w-0 flex-1 text-sm">
              <span class="font-semibold">{formatCashuSats(quote.amount)} sats</span>
              <span class="text-xs opacity-70">
                · {quote.state === "pending"
                  ? "Recovering"
                  : quote.state === "failed"
                    ? "Needs attention"
                    : quote.state === "expired"
                      ? "Expired · check payment status"
                      : "Awaiting payment"}</span>
              <p class="break-all text-xs opacity-60">{quote.mintUrl}</p>
            </div>
            <Button class="btn btn-sm" onclick={() => showQuote(quote)}>Resume invoice</Button>
          </div>
        {/each}
      </div>
    {/if}
    {#if mints.length === 0}
      <p class="text-sm opacity-75">Add a mint first to top up via Lightning.</p>
    {:else}
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="topup-mint">Mint</label>
          <select
            id="topup-mint"
            class="select select-bordered select-sm min-w-0"
            bind:value={selectedMint}
            disabled={loading}>
            {#each mints as mint (mint)}<option value={mint}>{mint}</option>{/each}
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="topup-amount">Amount (sats)</label>
          <input
            id="topup-amount"
            class="input input-sm input-bordered min-w-0"
            type="number"
            min="1"
            step="1"
            bind:value={amount}
            disabled={loading} />
        </div>
      </div>
      <Button
        class="btn btn-primary inline-flex w-full justify-center"
        onclick={requestInvoice}
        disabled={loading || !selectedMint || !Number.isSafeInteger(amount) || amount <= 0}>
        {loading ? "Requesting…" : "Get Lightning Invoice"}
      </Button>
    {/if}
  {/if}
  {#if error}<p role="alert" class="break-words text-sm text-error">{error}</p>{/if}
</div>
