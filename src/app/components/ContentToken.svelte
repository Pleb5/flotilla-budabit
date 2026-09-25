<style>
  .payment-card {
    /* An explicit preferred width keeps size containment from collapsing DM bubbles. */
    container-type: inline-size;
  }
  .payment-card :global(.payment-primary) {
    flex: 1 0 100%;
  }
  .payment-card :global(.payment-secondary) {
    flex: 1 0 auto;
  }
  @container (min-width: 350px) {
    .payment-card :global(.payment-primary) {
      flex: 1 1 auto;
    }
    .payment-card :global(.payment-secondary) {
      flex: 0 0 auto;
    }
  }
</style>

<script lang="ts">
  import {onDestroy} from "svelte"
  import {Check, Copy, ExternalLink, QrCode, Wallet, Zap, Coins} from "@lucide/svelte"
  import Button from "@lib/components/Button.svelte"
  import PaymentQRCode from "@app/components/PaymentQRCode.svelte"
  import WalletPay from "@app/components/WalletPay.svelte"
  import CashuTokenRedeemFlow from "@app/components/CashuTokenRedeemFlow.svelte"
  import CashuTokenStatus from "@app/components/CashuTokenStatus.svelte"
  import ClickHelp from "@lib/components/ClickHelp.svelte"
  import {
    cashuInitialized,
    cashuTokenStatuses,
    cashuTokenDisplayKey,
    loadCashuTokenStatus,
    checkCashuTokenStatus,
  } from "@app/core/cashu"
  import {
    getCashuMintDisplayName,
    getCashuTokenInfo,
    shortenCashuToken,
  } from "@app/util/cashu-token"
  import {getLightningInvoiceInfo, formatInvoiceSats} from "@app/util/lightning-invoice"
  import {invoicePayments, loadInvoicePayment} from "@app/core/invoice-payments"
  import {pushModal} from "@app/util/modal"
  import {copyToClipboard} from "@lib/html"
  import {CASHU_WALLET_ENABLED} from "@app/core/feature-flags"
  import type {CashuTokenStatus as TokenStatus} from "@app/core/cashu-token-status"

  const {value}: {value: string} = $props()
  const uid = $props.id()
  let now = $state(Date.now())
  const cashu = $derived(getCashuTokenInfo(value))
  let lastStatus: {key: string; status: TokenStatus} | undefined = $state()
  const statusKey = $derived(cashu ? cashuTokenDisplayKey(cashu.token) : "")
  const tokenStatus = $derived(
    $cashuInitialized
      ? $cashuTokenStatuses[statusKey] ||
          (lastStatus?.key === statusKey ? lastStatus.status : undefined)
      : undefined,
  )
  $effect(() => {
    if (!$cashuInitialized) lastStatus = undefined
    else if ($cashuTokenStatuses[statusKey])
      lastStatus = {key: statusKey, status: $cashuTokenStatuses[statusKey]}
  })
  const received = $derived(tokenStatus?.received?.amount ?? null)
  const unavailable = $derived(
    tokenStatus?.check?.state === "spent" ||
      tokenStatus?.outgoing?.state === "spent" ||
      tokenStatus?.outgoing?.state === "reclaimed",
  )
  const hideTokenActions = $derived(received !== null || unavailable)
  const invoice = $derived(getLightningInvoiceInfo(value))
  const payload = $derived(cashu ? cashu.token.replace(/^cashu:/i, "") : invoice?.invoice || value)
  const payment = $derived(invoice ? $invoicePayments[invoice.paymentHash] : undefined)
  const paid = $derived(payment?.state === "paid")
  const pending = $derived(payment?.state === "pending")
  const expired = $derived(Boolean(invoice && invoice.expiresAt <= now))
  const expiryLabel = $derived.by(() => {
    if (!invoice) return ""
    const minutes = Math.ceil((invoice.expiresAt - now) / 60000)
    return minutes <= 0
      ? "Expired"
      : minutes < 60
        ? `Expires in ${minutes}m`
        : minutes < 1440
          ? `Expires in ${Math.ceil(minutes / 60)}h`
          : `Expires ${new Date(invoice.expiresAt).toLocaleDateString()}`
  })

  let showQR = $state(false)
  let copied = $state(false)
  let statusError = $state("")
  let copyError = $state("")
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  onDestroy(() => clearTimeout(copyTimer))

  $effect(() => {
    void value
    showQR = false
    copied = false
    statusError = ""
    copyError = ""
  })
  $effect(() => {
    if (!cashu || !$cashuInitialized) return
    const token = cashu.token
    let controller = new AbortController()
    const refresh = () => {
      controller.abort()
      if (document.hidden) return
      controller = new AbortController()
      void loadCashuTokenStatus(token, {signal: controller.signal})?.catch(() => {})
    }
    refresh()
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      controller.abort()
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  })
  $effect(() => {
    if (!invoice) return
    try {
      loadInvoicePayment(invoice.paymentHash)
    } catch {
      /* The payment sheet surfaces storage errors. */
    }
    now = Date.now()
    const timer = setInterval(() => {
      now = Date.now()
    }, 15000)
    return () => clearInterval(timer)
  })

  const stop = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const copy = async (event: Event) => {
    stop(event)
    copyError = ""
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(payload)
      else if (!copyToClipboard(payload)) throw new Error("Copy failed")
      copied = true
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => {
        copied = false
      }, 2000)
    } catch {
      copyError = "Could not copy automatically. Select and copy the text below."
    }
  }
  const pay = (event: Event) => {
    stop(event)
    if (invoice) pushModal(WalletPay, {paymentRequest: invoice.invoice})
  }
  const receive = (event: Event) => {
    stop(event)
    if (!cashu) return
    pushModal(CashuTokenRedeemFlow, {token: cashu.token})
  }
  const checkToken = async (event: Event) => {
    stop(event)
    if (!cashu) return
    statusError = ""
    try {
      await checkCashuTokenStatus(cashu.token)
    } catch {
      statusError = "Unlock your wallet, then try checking again."
    }
  }
</script>

{#if cashu || invoice}
  <span
    role="group"
    aria-label={cashu ? "Cashu token" : "Lightning invoice"}
    data-payment-card={cashu ? "cashu" : "lightning"}
    data-stop-tap
    class="payment-card my-2 inline-flex w-[26rem] max-w-full flex-col gap-4 overflow-hidden rounded-2xl border border-base-content/10 bg-base-100 p-4 text-left align-top text-sm leading-normal shadow-sm">
    <span class="flex flex-wrap items-center justify-between gap-2">
      <span class="flex items-center gap-2 text-xs font-medium text-base-content/70">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
          {#if cashu}<Coins size={17} />{:else}<Zap size={17} />{/if}
        </span>
        {cashu ? "Cashu token" : "Lightning invoice"}
      </span>
      {#if cashu && tokenStatus && (tokenStatus.received || tokenStatus.receiving || tokenStatus.outgoing || tokenStatus.check)}
        <CashuTokenStatus status={tokenStatus} />
      {:else if paid}
        <span
          class="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success"
          ><Check size={12} />Paid</span>
      {:else if pending}
        <span class="rounded-full bg-warning/10 px-2 py-1 text-xs text-warning">Pending</span>
      {:else if invoice}
        <span
          class={`text-right text-[11px] ${expired ? "text-error" : "text-base-content/50"}`}
          title={new Date(invoice.expiresAt).toLocaleString()}>{expiryLabel}</span>
      {/if}
    </span>

    <span class="flex min-w-0 flex-col gap-1">
      <span
        class="inline-flex items-baseline gap-1 text-2xl font-semibold tabular-nums tracking-tight">
        {#if cashu || invoice?.amount}
          {formatInvoiceSats(cashu?.amount ?? invoice!.amount)}
          <span class="text-sm font-normal tracking-normal text-base-content/55"
            >{cashu && cashu.unit !== "sat" ? cashu.unit : "sats"}</span>
        {:else}Choose amount{/if}
      </span>
      {#if cashu}
        <span class="truncate text-xs text-base-content/60" title={cashu.mintUrl}
          >{getCashuMintDisplayName(cashu.mintUrl)}</span>
        {#if cashu.memo}<span class="line-clamp-2 break-words text-sm text-base-content/75"
            >{cashu.memo}</span
          >{/if}
      {:else if invoice?.description}
        <span
          class="line-clamp-2 break-words text-sm text-base-content/75"
          title={invoice.description}>{invoice.description}</span>
      {/if}
      {#if invoice && invoice.network !== "bitcoin"}<span class="text-xs text-warning"
          >{invoice.network} invoice</span
        >{/if}
    </span>

    <span class="flex flex-wrap items-center gap-2">
      {#if cashu && CASHU_WALLET_ENABLED && cashu.unit === "sat"}
        <Button
          class="payment-primary btn btn-primary btn-sm min-h-10 grow justify-center gap-2"
          onclick={tokenStatus?.outgoing && received === null && !tokenStatus.receiving
            ? checkToken
            : receive}
          disabled={received === null && (unavailable || tokenStatus?.checking)}>
          {#if received !== null}<Check size={15} />View receipt
          {:else if tokenStatus?.outgoing?.state === "reclaimed"}Returned to wallet
          {:else if unavailable}Already redeemed
          {:else if tokenStatus?.receiving}Check receipt
          {:else if tokenStatus?.outgoing}{tokenStatus.checking ? "Checking…" : "Check status"}
          {:else}<Wallet size={15} />Receive in Cashu{/if}
        </Button>
      {:else if invoice}
        <Button
          class="payment-primary btn btn-primary btn-sm min-h-10 grow justify-center gap-2"
          onclick={pay}
          disabled={paid || (expired && !pending)}>
          {#if paid}<Check size={15} />Paid{:else}<Wallet size={15} />{pending
              ? "Check payment"
              : "Pay with wallet"}{/if}
        </Button>
      {/if}
      {#if !hideTokenActions}<Button
          class="payment-secondary btn btn-ghost btn-sm min-h-10 justify-center gap-1.5"
          onclick={copy}
          aria-label={cashu ? "Copy Cashu token" : "Copy Lightning invoice"}>
          {#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}{copied ? "Copied" : "Copy"}
        </Button>
        <Button
          class="payment-secondary btn btn-ghost btn-sm min-h-10 justify-center gap-1.5"
          aria-expanded={showQR}
          aria-controls={uid + "-qr"}
          onclick={event => {
            stop(event)
            showQR = !showQR
          }}>
          <QrCode size={14} />{showQR ? "Hide QR" : "Show QR"}
        </Button>{/if}
    </span>

    {#if tokenStatus?.checkError || statusError}
      <span class="text-warning"
        ><ClickHelp
          label="Couldn't check status"
          text={statusError ||
            "The mint couldn't be reached. Any status shown is from the last successful check. Try again shortly."} /></span>
    {/if}

    {#if showQR && !hideTokenActions}
      <span id={uid + "-qr"}>
        {#key payload}<PaymentQRCode
            value={invoice ? payload.toUpperCase() : payload}
            label={cashu ? "Cashu token QR code" : "Lightning invoice QR code"} />{/key}
      </span>
    {/if}
    {#if received !== null}<span class="text-xs text-success" role="status"
        >+{formatInvoiceSats(received)} sats received</span
      >{/if}
    {#if copyError}
      <span role="status" class="text-xs text-error">{copyError}</span>
      <span class="max-h-28 select-all overflow-auto break-all font-mono text-xs">{payload}</span>
    {/if}
    <span
      class="flex min-w-0 items-center justify-between gap-3 border-t border-base-content/5 pt-2 text-[11px] text-base-content/45">
      <span class="min-w-0 truncate font-mono"
        >{cashu
          ? shortenCashuToken(payload)
          : `${payload.slice(0, 12)}…${payload.slice(-8)}`}</span>
      {#if invoice && !paid && !pending && !expired}
        <a
          class="inline-flex shrink-0 items-center gap-1 text-base-content/65 hover:text-primary"
          href={`lightning:${invoice.invoice}`}
          onclick={event => event.stopPropagation()}><ExternalLink size={12} />Open in wallet</a>
      {:else if cashu}<span class="shrink-0">Ecash</span>{/if}
    </span>
  </span>
{:else}
  <Button onclick={copy} class="link-content inline-flex items-center gap-1"
    ><Zap size={13} />{copied ? "Copied" : value.slice(0, 16) + "…"}</Button>
{/if}
