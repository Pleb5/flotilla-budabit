<script lang="ts">
  import {untrack} from "svelte"
  import {session} from "@welshman/app"
  import {Check, Coins, ScanLine, Wallet, Zap} from "@lucide/svelte"
  import Button from "@lib/components/Button.svelte"
  import Scanner from "@lib/components/Scanner.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import WalletConnect from "@app/components/WalletConnect.svelte"
  import CashuSeedBackup from "@app/components/CashuSeedBackup.svelte"
  import {CASHU_WALLET_ENABLED} from "@app/core/feature-flags"
  import {
    cashuInitialized,
    cashuBackupConfirmed,
    cashuMints,
    cashuSpendableByMint,
    cashuSetupResolved,
    cashuSetupRequired,
    cashuSeedLocked,
    cashuRecoveryInProgress,
    cashuWalletError,
    initializeCashuWallet,
    prepareCashuInvoicePayment,
    cancelCashuInvoicePayment,
    type CashuInvoicePayment,
  } from "@app/core/cashu"
  import {
    invoicePayments,
    loadInvoicePayment,
    payLightningInvoice,
    checkInvoicePayment,
    getPreferredPaymentMethod,
    type InvoicePaymentMethod,
  } from "@app/core/invoice-payments"
  import {getLightningInvoiceInfo, formatInvoiceSats} from "@app/util/lightning-invoice"
  import {getCashuMintDisplayName} from "@app/util/cashu-token"
  import {pushModal} from "@app/util/modal"

  const {paymentRequest = ""}: {paymentRequest?: string} = $props()
  const uid = $props.id()
  let input = $state(paymentRequest)
  let amount = $state(0)
  let method = $state<InvoicePaymentMethod | "">("")
  let mintUrl = $state("")
  let scanning = $state(false)
  let busy = $state(false)
  let quoting = $state(false)
  let error = $state("")
  let quoteError = $state("")
  let quote = $state<CashuInvoicePayment | null>(null)
  let quoteRetry = $state(0)
  let now = $state(Date.now())
  const submitted = new Set<string>()
  let quoteWork: Promise<void> = Promise.resolve()
  const invoice = $derived(getLightningInvoiceInfo(input))
  const sats = $derived(invoice?.amount || amount)
  const payment = $derived(invoice ? $invoicePayments[invoice.paymentHash] : undefined)
  const locked = $derived(payment?.state === "pending" || payment?.state === "paid")
  const expired = $derived(Boolean(invoice && invoice.expiresAt <= now))
  const connected = $derived($session?.wallet?.type)
  const cashuReady = $derived(
    $cashuInitialized &&
      $cashuBackupConfirmed &&
      !$cashuSeedLocked &&
      !$cashuSetupRequired &&
      !$cashuRecoveryInProgress &&
      !$cashuWalletError,
  )
  const amountValid = $derived(
    Number.isFinite(sats) && sats > 0 && Number.isSafeInteger(Math.round(sats * 1000)),
  )
  const methodLabel = (value: string) =>
    value === "cashu" ? "Cashu" : value === "nwc" ? "NWC" : "WebLN"

  $effect(() => {
    if (CASHU_WALLET_ENABLED) void initializeCashuWallet()
    const timer = setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => clearInterval(timer)
  })
  $effect(() => {
    if (!invoice) return
    error = ""
    try {
      loadInvoicePayment(invoice.paymentHash)
    } catch (e) {
      error = (e as Error).message
    }
  })
  $effect(() => {
    if (method === connected || (method === "cashu" && CASHU_WALLET_ENABLED)) return
    if (CASHU_WALLET_ENABLED && !$cashuSetupResolved) return
    const available: InvoicePaymentMethod[] = [
      ...(connected ? [connected] : []),
      ...(CASHU_WALLET_ENABLED && !$cashuSetupRequired ? ["cashu" as const] : []),
    ]
    if (method && available.includes(method)) return
    const preferred = untrack(getPreferredPaymentMethod)
    method =
      preferred && available.includes(preferred)
        ? preferred
        : available.length === 1
          ? available[0]
          : ""
  })
  $effect(() => {
    if (!$cashuMints.includes(mintUrl)) {
      mintUrl =
        $cashuMints.find(mint => ($cashuSpendableByMint.get(mint) || 0) >= sats) ||
        $cashuMints[0] ||
        ""
    }
  })
  $effect(() => {
    const currentInvoice = invoice
    const currentMethod = method
    const currentMint = mintUrl
    const currentAmount = sats
    const ready = cashuReady
    const isLocked = locked
    void quoteRetry
    let cancelled = false
    let prepared: CashuInvoicePayment | null = null
    quote = null
    quoteError = ""
    quoting = false
    if (
      currentInvoice &&
      currentMethod === "cashu" &&
      currentMint &&
      ready &&
      !isLocked &&
      currentAmount > 0
    ) {
      quoting = true
      // A changing amount/mint must release the previous reservation before
      // preparing another quote, even when the first request is still in flight.
      quoteWork = quoteWork
        .catch(() => {})
        .then(async () => {
          if (cancelled) return
          try {
            prepared = await prepareCashuInvoicePayment(
              currentMint,
              currentInvoice.invoice,
              currentAmount,
            )
            if (cancelled) await cancelCashuInvoicePayment(prepared.operationId)
            else quote = prepared
          } catch (e) {
            if (!cancelled)
              quoteError = e instanceof Error ? e.message : "Could not get a fee quote."
          } finally {
            if (!cancelled) quoting = false
          }
        })
    }
    return () => {
      cancelled = true
      quoteWork = quoteWork
        .catch(() => {})
        .then(async () => {
          if (prepared && !submitted.has(prepared.operationId)) {
            await cancelCashuInvoicePayment(prepared.operationId)
          }
        })
        .catch(() => {
          // Prepared reservations remain visible and releasable in wallet history.
        })
    }
  })

  const confirm = async () => {
    if (busy || !invoice || !method || locked) return
    const prepared = quote
    busy = true
    error = ""
    if (prepared) submitted.add(prepared.operationId)
    try {
      const result = await payLightningInvoice(invoice.invoice, method, sats, prepared || undefined)
      if (prepared && result.operationId !== prepared.operationId) {
        submitted.delete(prepared.operationId)
        await cancelCashuInvoicePayment(prepared.operationId)
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not start payment."
      if (prepared) {
        submitted.delete(prepared.operationId)
        await cancelCashuInvoicePayment(prepared.operationId).catch(() => {})
        quoteRetry++
      }
    } finally {
      busy = false
    }
  }
  const check = async () => {
    if (!invoice || busy) return
    busy = true
    error = ""
    try {
      await checkInvoicePayment(invoice.paymentHash)
    } catch (e) {
      error = e instanceof Error ? e.message : "Could not check payment."
    } finally {
      busy = false
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-5 p-2 sm:p-4" data-invoice-payment>
  <ModalHeader>
    {#snippet title()}<span class="flex items-center gap-2"
        ><Zap size={21} class="text-warning" />Pay Lightning invoice</span
      >{/snippet}
    {#snippet info()}Choose the wallet to fund this payment.{/snippet}
  </ModalHeader>

  {#if !paymentRequest && !locked}
    <label class="flex flex-col gap-2 text-sm font-medium" for={uid + "-invoice"}
      >Lightning invoice
      <textarea
        id={uid + "-invoice"}
        class="textarea textarea-bordered w-full break-all font-mono text-xs"
        rows={3}
        placeholder="Paste a BOLT11 invoice or lightning: link"
        bind:value={input}
        disabled={busy}></textarea>
    </label>
    <Button class="btn btn-ghost btn-sm self-start" onclick={() => (scanning = !scanning)}
      ><ScanLine size={16} />{scanning ? "Close scanner" : "Scan QR code"}</Button>
    {#if scanning}<Scanner
        onscan={(value: string) => {
          input = value
          scanning = false
        }} />{/if}
    {#if input.trim() && !invoice}<p class="text-sm text-error" role="status">
        This is not a valid BOLT11 invoice.
      </p>{/if}
  {/if}

  {#if invoice}
    <div class="rounded-2xl border border-base-content/10 bg-base-200/40 p-4">
      {#if invoice.amount || locked}
        <div class="text-3xl font-semibold tabular-nums tracking-tight">
          {formatInvoiceSats(invoice.amount || payment?.amount || sats)}
          <span class="text-base font-normal text-base-content/55">sats</span>
        </div>
      {:else}
        <label for={uid + "-amount"} class="mb-2 block text-sm">Amount (sats)</label>
        <input
          id={uid + "-amount"}
          class="input input-bordered w-full text-xl"
          type="number"
          min="0.001"
          step={method === "cashu" ? "1" : "0.001"}
          bind:value={amount}
          disabled={busy} />
      {/if}
      {#if invoice.description}<p class="mt-2 break-words text-sm text-base-content/65">
          {invoice.description}
        </p>{/if}
      {#if invoice.network !== "bitcoin"}<p class="mt-2 text-xs text-warning">
          {invoice.network} invoice
        </p>{/if}
    </div>

    {#if payment?.state === "paid"}
      <div
        role="status"
        class="flex flex-col items-center gap-2 rounded-xl bg-success/10 p-5 text-success">
        <Check size={28} /><strong>Payment sent</strong><span class="text-sm"
          >Paid with {methodLabel(payment.method)}</span>
      </div>
    {:else if payment?.state === "pending"}
      <div role="status" class="flex flex-col gap-2 rounded-xl bg-warning/10 p-4 text-sm">
        <strong>Payment pending · {methodLabel(payment.method)}</strong>
        {#if payment.mintUrl}<span class="break-all"
            >{getCashuMintDisplayName(payment.mintUrl)}</span
          >{/if}
        <span
          >Waiting for a confirmed result. This invoice stays locked to this payment attempt.</span>
        {#if payment.error}<span class="text-xs opacity-70">{payment.error}</span>{/if}
      </div>
      <Button class="btn btn-primary w-full justify-center" onclick={check} disabled={busy}
        >{busy ? "Checking payment…" : "Check payment status"}</Button>
    {:else}
      {#if payment?.state === "failed"}<p role="status" class="text-sm text-error">
          {payment.error || "Payment failed. You can try again."}
        </p>{/if}
      {#if expired}<p role="status" class="text-sm text-error">This invoice has expired.</p>{/if}
      <fieldset class="flex min-w-0 flex-col gap-2" disabled={busy}>
        <legend class="mb-2 text-sm font-semibold">Pay using</legend>
        {#if connected}
          <label
            class={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${method === connected ? "border-primary bg-primary/5" : "border-base-content/10"}`}>
            <input
              type="radio"
              name={uid + "-wallet"}
              class="radio-primary radio radio-sm"
              value={connected}
              bind:group={method} />
            <Wallet size={20} class="shrink-0 text-base-content/60" />
            <span class="min-w-0"
              ><span class="block text-sm font-medium"
                >Lightning wallet · {methodLabel(connected)}</span
              ><span class="block text-xs text-base-content/60">Your connected wallet</span></span>
          </label>
        {:else}
          <Button
            class="btn btn-outline min-h-14 w-full justify-start rounded-xl"
            onclick={() => pushModal(WalletConnect)}
            ><Wallet size={18} />Connect Lightning wallet</Button>
        {/if}
        {#if CASHU_WALLET_ENABLED}
          <label
            class={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${method === "cashu" ? "border-primary bg-primary/5" : "border-base-content/10"}`}>
            <input
              type="radio"
              name={uid + "-wallet"}
              class="radio-primary radio radio-sm"
              value="cashu"
              bind:group={method} />
            <Coins size={20} class="shrink-0 text-base-content/60" />
            <span
              ><span class="block text-sm font-medium">Cashu wallet</span><span
                class="block text-xs text-base-content/60">Pay from your ecash balance</span
              ></span>
          </label>
        {/if}
      </fieldset>

      {#if method === "cashu"}
        {#if $cashuWalletError}<p class="text-sm text-error">{$cashuWalletError}</p>
        {:else if !$cashuSetupResolved}<p class="text-sm opacity-60">Loading Cashu wallet…</p>
        {:else if $cashuSetupRequired}<CashuSeedBackup mode="setup" />
        {:else if $cashuSeedLocked}<CashuSeedBackup mode="unlock" />
        {:else if !$cashuBackupConfirmed}<CashuSeedBackup mode="backup" />
        {:else if $cashuRecoveryInProgress}<p class="text-sm opacity-60">
            Recovering Cashu wallet…
          </p>
        {:else if !$cashuMints.length}<p class="text-sm">
            Add a mint in <a href="/settings/wallet" class="link">wallet settings</a> to pay with Cashu.
          </p>
        {:else}
          <label for={uid + "-mint"} class="flex min-w-0 flex-col gap-2 text-sm"
            >Mint
            <select
              id={uid + "-mint"}
              class="select select-bordered w-full min-w-0"
              bind:value={mintUrl}
              disabled={busy}>
              {#each $cashuMints as mint}<option value={mint}
                  >{getCashuMintDisplayName(mint)} · {quote?.mintUrl === mint
                    ? "quote ready"
                    : `${formatInvoiceSats($cashuSpendableByMint.get(mint) || 0)} sats available`}</option
                >{/each}
            </select>
          </label>
          {#if quoting}<p
              class="flex items-center gap-2 text-sm text-base-content/60"
              role="status">
              <span class="loading loading-spinner loading-xs"></span>Getting mint fee quote…
            </p>
          {:else if quote}
            <dl
              class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-xl bg-base-200/50 p-4 text-sm tabular-nums">
              <dt>Invoice</dt>
              <dd class="text-right">{formatInvoiceSats(quote.amount)} sats</dd>
              <dt class="text-base-content/65">Lightning fee reserve</dt>
              <dd class="text-right">{formatInvoiceSats(quote.feeReserve)} sats</dd>
              <dt class="text-base-content/65">Mint fees</dt>
              <dd class="text-right">{formatInvoiceSats(quote.mintFees)} sats</dd>
              <dt class="border-t border-base-content/10 pt-2 font-semibold">Maximum total</dt>
              <dd class="border-t border-base-content/10 pt-2 text-right font-semibold">
                {formatInvoiceSats(quote.maxTotal)} sats
              </dd>
            </dl>
            <p class="text-xs text-base-content/55">Unused fees return to your Cashu balance.</p>
            {#if quote.expiresAt <= now}<p class="text-sm text-error">Fee quote expired.</p>
              <Button class="btn btn-ghost btn-sm" onclick={() => quoteRetry++}
                >Refresh fee quote</Button
              >{/if}
          {:else if quoteError}<p class="text-sm text-error" role="status">{quoteError}</p>
            <Button class="btn btn-ghost btn-sm" onclick={() => quoteRetry++}
              >Retry fee quote</Button
            >{/if}
        {/if}
      {:else if method === "webln" && !invoice.amount}
        <p class="text-sm text-error">
          This WebLN wallet needs a fixed-amount invoice. Choose another wallet.
        </p>
      {/if}

      <Button
        class="btn btn-primary w-full justify-center gap-2"
        onclick={confirm}
        disabled={busy ||
          expired ||
          !amountValid ||
          !method ||
          (method === "cashu" && (!quote || quote.expiresAt <= now || quoting)) ||
          (method === "webln" && !invoice.amount)}>
        {#if busy}<span class="loading loading-spinner loading-sm"></span>Paying…{:else}<Zap
            size={17} />{method
            ? `Pay ${amountValid ? formatInvoiceSats(sats) + " sats " : ""}with ${methodLabel(method)}`
            : "Choose a wallet"}{/if}
      </Button>
    {/if}
  {/if}
  {#if error}<p role="alert" class="break-words text-sm text-error">{error}</p>{/if}
  <Button class="btn btn-ghost w-full justify-center" onclick={() => history.back()}
    >{locked ? "Close" : "Cancel"}</Button>
</div>
