<script lang="ts">
  import {untrack} from "svelte"
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import {signer, deriveZapperForPubkey} from "@welshman/app"
  import {load} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {requestZap, makeZapRequest, getZapResponseFilter} from "@welshman/util"
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
  import {pushToast} from "@app/util/toast"

  type Props = {
    url: string
    pubkey: string
    eventId?: string
  }

  const {url, pubkey, eventId}: Props = $props()

  const minPos = 1
  const maxPos = 1000
  const minVal = 21
  const maxVal = 1000000
  const zapperStore = deriveZapperForPubkey(pubkey)

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

  const back = () => history.back()

  const onEmoji = (emoji: NativeEmoji) => {
    content = emoji.unicode
  }

  const sendZap = async () => {
    loading = true

    try {
      const zapper = $zapperStore!
      const msats = amount * 1000
      const relays = url ? [url] : Router.get().ForPubkey(pubkey).getUrls()
      const filters = [getZapResponseFilter({zapper, pubkey, eventId})]
      const params = {pubkey, content, eventId, msats, relays, zapper}
      const event = await $signer!.sign(makeZapRequest(params))
      const res = await requestZap({zapper, event})

      if (!res.invoice) {
        return pushToast({
          theme: "error",
          message: `Failed to zap: ${res.error || "no error given"}`,
        })
      }

      await payInvoice(res.invoice)
      await load({relays, filters})

      pushToast({message: "Zap successfully sent!"})
      back()
    } catch (e) {
      console.error(e)

      const message = String(e).replace(/^.*Error: /, "")

      pushToast({
        theme: "error",
        message: `Failed to zap: ${message}`,
      })
    } finally {
      loading = false
    }
  }

  let pos = $state(minPos)
  let amount = $state(minVal)
  let content = $state("⚡️")
  let loading = $state(false)

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
      <div>To <ProfileLink {pubkey} class="!text-primary" /></div>
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
    <Button class="btn btn-primary" onclick={sendZap} disabled={loading}>
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
