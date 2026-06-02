<script lang="ts">
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import CashuTokenRedeemFlow from "@app/components/CashuTokenRedeemFlow.svelte"
  import {formatCashuSats} from "@app/util/cashu-format"
  import {
    getCashuMintDisplayName,
    getCashuTokenInfo,
    shortenCashuToken,
  } from "@app/util/cashu-token"
  import {pushModal} from "@app/util/modal"
  import {clip} from "@app/util/toast"

  interface Props {
    value: string
  }

  const {value}: Props = $props()

  const cashu = $derived(getCashuTokenInfo(value))
  const amountLabel = $derived.by(() => {
    if (!cashu) return ""
    if (cashu.amount <= 0) return "Cashu token"
    return `${formatCashuSats(cashu.amount)} ${cashu.unit === "sat" ? "sats" : cashu.unit}`
  })
  const mintLabel = $derived(cashu ? getCashuMintDisplayName(cashu.mintUrl) : "")
  const tokenLabel = $derived(cashu ? shortenCashuToken(cashu.token) : value.slice(0, 16) + "...")

  let received = $state<number | null>(null)

  const stop = (event?: Event) => {
    event?.preventDefault()
    event?.stopPropagation()
  }

  const copy = (event?: Event) => {
    stop(event)
    clip(value)
  }

  const redeem = (event?: Event) => {
    stop(event)
    if (!cashu) return

    pushModal(CashuTokenRedeemFlow, {
      token: cashu.token,
      onredeemed: ({amount}: {amount: number; mintUrl: string}) => {
        received = amount
      },
    })
  }
</script>

{#if cashu}
  <span
    class="my-1 inline-flex w-full max-w-full flex-col gap-2 rounded-box border border-base-300 bg-base-100/90 p-2 align-middle text-sm shadow-sm sm:w-auto sm:min-w-80"
    data-stop-tap>
    <span class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <span class="flex min-w-0 items-center gap-2">
        <Icon icon={Bolt} size={4} class="shrink-0 text-warning" />
        <span class="min-w-0">
          <span class="block font-semibold leading-tight">{amountLabel}</span>
          <span class="block max-w-full truncate text-[11px] opacity-60" title={cashu.mintUrl}>
            {mintLabel} - {tokenLabel}
          </span>
        </span>
      </span>
      <span class="flex w-full flex-col gap-1 sm:w-auto sm:flex-row sm:justify-end">
        <Button class="btn btn-ghost btn-xs inline-flex justify-center" onclick={copy}>Copy</Button>
        <Button
          class="btn btn-primary btn-xs inline-flex justify-center"
          onclick={redeem}
          disabled={received !== null}>
          {received === null ? "Redeem" : "Received"}
        </Button>
      </span>
    </span>

    {#if received !== null}
      <span class="rounded-lg bg-success/10 px-2 py-1 text-xs text-success">
        +{formatCashuSats(received)} sats received.
      </span>
    {/if}
  </span>
{:else}
  <Button onclick={copy} class="link-content">
    <Icon icon={Bolt} size={3} class="inline-block translate-y-px" />
    {tokenLabel}
  </Button>
{/if}
