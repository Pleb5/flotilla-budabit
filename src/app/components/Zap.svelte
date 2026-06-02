<script lang="ts">
  import {untrack} from "svelte"
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import {signer, deriveZapperForPubkey, repository, tracker} from "@welshman/app"
  import {request} from "@welshman/net"
  import {requestZap, type Filter, type TrustedEvent} from "@welshman/util"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import EmojiButton from "@lib/components/EmojiButton.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {payInvoice} from "@app/core/commands"
  import {clearModals} from "@app/util/modal"
  import {getRecentZapReceiptFilters, getZapRelays, makeZapRequestForEvent} from "@app/util/zaps"
  import {pushToast} from "@app/util/toast"

  type Props = {
    event: TrustedEvent
    relayHints?: string[]
    scopeH?: string
  }

  const {event, relayHints = [], scopeH = ""}: Props = $props()

  const minPos = 1
  const maxPos = 1000
  const minVal = 21
  const maxVal = 1000000
  const zapperStore = deriveZapperForPubkey(event.pubkey, relayHints)
  const PAYMENT_TIMEOUT = 120_000
  const RECEIPT_FOREGROUND_TIMEOUT = 10_000
  const RECEIPT_BACKGROUND_TIMEOUT = 45_000

  const posToAmount = (pos: number) => {
    const normalizedPos = (pos - minPos) / (maxPos - minPos)
    const logMin = Math.log(minVal)
    const logMax = Math.log(maxVal)
    const logValue = logMin + normalizedPos * (logMax - logMin)
    return Math.round(Math.exp(logValue))
  }

  const amountToPos = (amount: number) => {
    const clampedAmount = Math.max(minVal, Math.min(maxVal, amount))
    const logMin = Math.log(minVal)
    const logMax = Math.log(maxVal)
    const logValue = Math.log(clampedAmount)
    const normalizedPos = (logValue - logMin) / (logMax - logMin)
    return Math.round(minPos + normalizedPos * (maxPos - minPos))
  }

  const back = () => {
    closing = true
    clearModals()
  }

  const onEmoji = (emoji: NativeEmoji) => {
    content = emoji.unicode
  }

  async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  const waitForZapReceipts = async (relays: string[], filters: Filter[], timeoutMs: number) => {
    if (relays.length === 0 || filters.length === 0) return []

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const receipts: TrustedEvent[] = []

    try {
      await request({
        relays,
        filters,
        autoClose: false,
        signal: controller.signal,
        onEvent: (event, url) => {
          const receipt = event as TrustedEvent

          if (url) tracker.track(receipt.id, url)
          repository.publish(receipt)
          receipts.push(receipt)
          controller.abort()
        },
      })

      return receipts
    } catch {
      return receipts
    } finally {
      clearTimeout(timeout)
    }
  }

  const waitForZapReceiptsInBackground = async (relays: string[], filters: Filter[]) => {
    const receipts = await waitForZapReceipts(relays, filters, RECEIPT_BACKGROUND_TIMEOUT)

    if (receipts.length > 0) {
      pushToast({message: "Zap receipt received."})
    }
  }

  const sendZap = async () => {
    loading = true

    try {
      const zapper = $zapperStore!
      const msats = amount * 1000
      const relays = getZapRelays({event, relayHints, scopeH})

      if (relays.length === 0) {
        throw new Error("No relay hints available for the zap receipt")
      }

      const filters = getRecentZapReceiptFilters({zapper, event})
      const zapRequest = await $signer!.sign(
        makeZapRequestForEvent({event, content, msats, relays, scopeH, zapper}),
      )
      const res = await requestZap({zapper, event: zapRequest})

      if (!res.invoice) {
        return pushToast({
          theme: "error",
          message: `Failed to zap: ${res.error || "no error given"}`,
        })
      }

      await withTimeout(
        payInvoice(res.invoice),
        PAYMENT_TIMEOUT,
        "Payment confirmation timed out. Check your wallet; the zap receipt may still appear shortly.",
      )
      const receipts = await waitForZapReceipts(relays, filters, RECEIPT_FOREGROUND_TIMEOUT)

      if (receipts.length === 0) {
        void waitForZapReceiptsInBackground(relays, filters)
      }

      pushToast({
        message:
          receipts.length > 0
            ? "Zap successfully sent!"
            : "Zap sent. The receipt may take a moment to appear.",
      })
      back()
    } catch (e) {
      console.error(e)

      const message = String(e).replace(/^.*Error: /, "")

      pushToast({
        theme: "error",
        message: `Failed to zap: ${message}`,
      })
    } finally {
      if (!closing) loading = false
    }
  }

  let pos = $state(minPos)
  let amount = $state(minVal)
  let content = $state("⚡️")
  let loading = $state(false)
  let closing = $state(false)

  // When slider (pos) changes, update amount.
  // Use untrack on amount to prevent this effect from re-running when amount changes.
  $effect(() => {
    const newAmount = posToAmount(pos)
    // Only update if significantly different to avoid jitter
    if (untrack(() => Math.abs(amount - newAmount) > 0)) {
      amount = newAmount
    }
  })

  // When user types an amount, update pos to match.
  // Use untrack on pos to prevent this effect from re-running when pos changes.
  $effect(() => {
    const newPos = amountToPos(amount)
    // Only update if different to avoid jitter
    if (untrack(() => newPos !== pos)) {
      pos = newPos
    }
  })
</script>

<div class="column gap-4">
  <ModalHeader>
    {#snippet title()}
      <div>Send a Zap</div>
    {/snippet}
    {#snippet info()}
      <div>To <ProfileLink pubkey={event.pubkey} relays={relayHints} class="!text-primary" /></div>
    {/snippet}
  </ModalHeader>
  <FieldInline class="!grid-cols-3">
    {#snippet label()}
      Emoji Reaction
    {/snippet}
    {#snippet input()}
      <div class="flex flex-grow items-center justify-end gap-4">
        <EmojiButton {onEmoji} class="btn btn-neutral">
          {content}
        </EmojiButton>
      </div>
    {/snippet}
  </FieldInline>
  <FieldInline class="!grid-cols-3">
    {#snippet label()}
      Amount
    {/snippet}
    {#snippet input()}
      <div class="flex flex-grow justify-end">
        <label class="input input-bordered flex items-center gap-2">
          <Icon icon={Bolt} />
          <input bind:value={amount} type="number" class="w-24" />
        </label>
      </div>
    {/snippet}
  </FieldInline>
  <input
    class="range range-primary -mt-2"
    type="range"
    min={minPos}
    max={maxPos}
    bind:value={pos} />
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button class="btn btn-primary" onclick={sendZap} disabled={loading || closing}>
      <Spinner {loading}>
        <div class="flex items-center gap-2">
          {#if !loading}
            <Icon icon={Bolt} />
          {/if}
          Send Zap
        </div>
      </Spinner>
    </Button>
  </ModalFooter>
</div>
