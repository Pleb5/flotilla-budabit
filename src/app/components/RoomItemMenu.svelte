<script lang="ts">
  import {onMount} from "svelte"
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import {getTag, type TrustedEvent} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import SmileCircle from "@assets/icons/smile-circle.svg?dataurl"
  import Pen from "@assets/icons/pen.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import EmojiPicker from "@lib/components/EmojiPicker.svelte"
  import ZapButton from "@app/components/ZapButton.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import EventShareButton from "@app/components/EventShareButton.svelte"
  import ModerationAction from "@app/components/community/ModerationAction.svelte"
  import EventDeleteConfirm from "@app/components/EventDeleteConfirm.svelte"
  import {pushModal} from "@app/util/modal"
  import {ENABLE_ZAPS} from "@app/core/state"
  import {publishReactionOperation} from "@app/core/commands"

  type Props = {
    url: string
    event: TrustedEvent
    onClick: () => void
    reply?: () => void
    edit?: () => void
    scopeH?: string
    readOnly?: boolean
    relays?: string[]
    communitySectionName?: string
  }

  const {
    url,
    event,
    onClick,
    reply,
    edit,
    scopeH = "",
    readOnly = false,
    relays = [],
    communitySectionName = "",
  }: Props = $props()

  const actionRelays = $derived.by(() =>
    (scopeH || relays.length > 0 ? relays : [url]).filter(Boolean),
  )

  const onEmoji = (emoji: NativeEmoji) => {
    history.back()
    return publishReactionOperation({
      event,
      relays: actionRelays,
      content: emoji.unicode,
      tags: scopeH && getTag("h", event.tags)?.[1] !== scopeH ? [["h", scopeH]] : [],
    })
  }

  const showEmojiPicker = () => pushModal(EmojiPicker, {onClick: onEmoji})

  const showInfo = () => {
    pushModal(EventInfo, {url, event})
  }

  const showDelete = () => {
    pushModal(EventDeleteConfirm, {
      url,
      relays,
      event,
      noun: "Message",
    })
  }

  let element: HTMLUListElement
  onMount(() => {
    element.addEventListener("click", onClick)
    return () => element.removeEventListener("click", onClick)
  })
</script>

<ul
  class="menu whitespace-nowrap rounded-box bg-base-100 p-2 shadow-md"
  aria-label="Message actions"
  bind:this={element}>
  {#if reply && !readOnly}
    <li>
      <Button onclick={reply}>
        <Icon size={4} icon={Reply} />
        Send Reply
      </Button>
    </li>
  {/if}
  <li>
    <EventShareButton
      {url}
      {event}
      {relays}
      noun="message"
      label="Share Message"
      class="w-full text-left"
      onComplete={onClick} />
  </li>
  {#if ENABLE_ZAPS && !readOnly}
    <li>
      <ZapButton {event} relayHints={relays} {scopeH}>
        <Icon size={4} icon={Bolt} />
        Send Zap
      </ZapButton>
    </li>
  {/if}
  {#if !readOnly}
    <li>
      <Button onclick={showEmojiPicker}>
        <Icon size={4} icon={SmileCircle} />
        Send Reaction
      </Button>
    </li>
  {/if}
  <li>
    <Button onclick={showInfo}>
      <Icon size={4} icon={Code2} />
      Message Info
    </Button>
  </li>
  {#if edit && !readOnly}
    <li>
      <Button onclick={edit}>
        <Icon size={4} icon={Pen} />
        Edit Message
      </Button>
    </li>
  {/if}
  <ModerationAction {event} sectionName={communitySectionName} {onClick} />
  {#if event.pubkey === $pubkey && !readOnly}
    <li>
      <Button onclick={showDelete} class="text-error">
        <Icon size={4} icon={TrashBin2} />
        Delete Message
      </Button>
    </li>
  {/if}
</ul>
