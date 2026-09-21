<style>
  .payment-card {
    container-type: inline-size;
  }
  .payment-card :global(.payment-primary) {
    flex: 1 0 100%;
  }
  .payment-card :global(.payment-secondary) {
    flex: 1 1 0;
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

  const {value}: {value: string} = $props()
  const uid = $props.id()
  let now = $state(Date.now())
  const cashu = $derived(getCashuTokenInfo(value))
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
  let received = $state<number | null>(null)
  let copyError = $state("")
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  onDestroy(() => clearTimeout(copyTimer))

  $effect(() => {
    void value
    showQR = false
    copied = false
    received = null
    copyError = ""
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
    const original = value
    pushModal(CashuTokenRedeemFlow, {
      token: cashu.token,
      onredeemed: ({amount}: {amount: number}) => {
        if (value === original) received = amount
      },
    })
  }
</script>

{#if cashu || invoice}
  <span
    role="group"
    aria-label={cashu ? "Cashu token" : "Lightning invoice"}
    data-payment-card={cashu ? "cashu" : "lightning"}
    data-stop-tap
    class="payment-card my-2 inline-flex w-full max-w-[26rem] flex-col gap-4 overflow-hidden rounded-2xl border border-base-content/10 bg-base-100 p-4 text-left align-top text-sm leading-normal shadow-sm">
    <span class="flex items-center justify-between gap-2">
      <span class="flex items-center gap-2 text-xs font-medium text-base-content/70">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
          {#if cashu}<Coins size={17} />{:else}<Zap size={17} />{/if}
        </span>
        {cashu ? "Cashu token" : "Lightning invoice"}
      </span>
      {#if received !== null || paid}
        <span
          class="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success"
          ><Check size={12} />{cashu ? "Received" : "Paid"}</span>
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
          onclick={receive}
          disabled={received !== null}>
          {#if received !== null}<Check size={15} />Received{:else}<Wallet size={15} />Receive in
            Cashu{/if}
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
      <Button
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
      </Button>
    </span>

    {#if showQR}
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
