<script lang="ts">
  import {goto} from "$app/navigation"
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import {getTag, type TrustedEvent} from "@welshman/util"
  import {ArrowUpRight} from "@lucide/svelte"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import SmileCircle from "@assets/icons/smile-circle.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import EmojiPicker from "@lib/components/EmojiPicker.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import {publishReaction} from "@app/core/commands"
  import {clearModals, pushModal} from "@app/util/modal"

  type Props = {
    url: string
    event: TrustedEvent
    openHref: string
    openLabel?: string
    reply?: () => void
    relays?: string[]
    scopeH?: string
  }

  const {
    url,
    event,
    openHref,
    openLabel = "Open",
    reply,
    relays = [],
    scopeH = "",
  }: Props = $props()

  const reactionRelays = $derived.by(() => (relays.length > 0 ? relays : [url]).filter(Boolean))

  const scopedTags = $derived.by(() => {
    if (!scopeH || getTag("h", event.tags)?.[1] === scopeH) {
      return [] as string[][]
    }

    return [["h", scopeH]]
  })

  const onEmoji = (async (event: TrustedEvent, emoji: NativeEmoji) => {
    history.back()
    publishReaction({
      event,
      relays: reactionRelays,
      content: emoji.unicode,
      tags: scopedTags,
      protect: false,
    })
  }).bind(undefined, event)

  const showEmojiPicker = () => pushModal(EmojiPicker, {onClick: onEmoji}, {replaceState: true})

  const sendReply = () => {
    if (!reply) {
      return
    }

    history.back()
    reply()
  }

  const showInfo = () => pushModal(EventInfo, {url, event}, {replaceState: true})

  const openItem = () => {
    clearModals()
    goto(openHref)
  }
</script>

<div class="flex flex-col gap-2">
  <Button class="btn btn-neutral w-full" onclick={openItem}>
    <ArrowUpRight class="h-4 w-4" />
    {openLabel}
  </Button>

  {#if reply}
    <Button class="btn btn-neutral w-full" onclick={sendReply}>
      <Icon size={4} icon={Reply} />
      Send Reply
    </Button>
  {/if}

  <Button class="btn btn-neutral w-full" onclick={showEmojiPicker}>
    <Icon size={4} icon={SmileCircle} />
    Send Reaction
  </Button>

  <Button class="btn btn-neutral" onclick={showInfo}>
    <Icon size={4} icon={Code2} />
    Message Info
  </Button>
</div>
