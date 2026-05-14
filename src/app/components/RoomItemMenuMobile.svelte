<script lang="ts">
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import type {TrustedEvent} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import {getTag} from "@welshman/util"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import Pen from "@assets/icons/pen.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Code2 from "@assets/icons/code-2.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"
  import SmileCircle from "@assets/icons/smile-circle.svg?dataurl"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Link from "@lib/components/Link.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import EmojiPicker from "@lib/components/EmojiPicker.svelte"
  import ZapButton from "@app/components/ZapButton.svelte"
  import EventInfo from "@app/components/EventInfo.svelte"
  import EventDeleteConfirm from "@app/components/EventDeleteConfirm.svelte"
  import {ENABLE_ZAPS} from "@app/core/state"
  import {publishReaction, canEnforceNip70} from "@app/core/commands"
  import {getRoomItemPath} from "@app/util/routes"
  import {pushModal} from "@app/util/modal"

  type Props = {
    url: string
    event: TrustedEvent
    reply?: () => void
    edit?: () => void
    readOnly?: boolean
    relays?: string[]
    scopeH?: string
    protectActions?: boolean
  }

  const {
    url,
    event,
    reply,
    edit,
    readOnly = false,
    relays = [],
    scopeH = "",
    protectActions = true,
  }: Props = $props()

  const path = getRoomItemPath(url, event)
  const actionRelays = $derived.by(() => (relays.length > 0 ? relays : [url]).filter(Boolean))
  const shouldProtect = protectActions ? canEnforceNip70(url) : undefined
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
      relays: actionRelays,
      content: emoji.unicode,
      tags: scopedTags,
      protect: protectActions ? await shouldProtect! : false,
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

  const editMessage = () => {
    if (!edit) {
      return
    }

    history.back()
    edit()
  }

  const showInfo = () => pushModal(EventInfo, {url, event}, {replaceState: true})

  const showDelete = () =>
    pushModal(EventDeleteConfirm, {
      url,
      relays: actionRelays,
      event,
      noun: "Message",
      ...(protectActions ? {} : {protect: false}),
    })
</script>

<div class="flex flex-col gap-2">
  {#if event.pubkey === $pubkey && !readOnly}
    <Button class="btn btn-neutral text-error" onclick={showDelete}>
      <Icon size={4} icon={TrashBin2} />
      Delete Message
    </Button>
  {/if}
  <Button class="btn btn-neutral" onclick={showInfo}>
    <Icon size={4} icon={Code2} />
    Message Info
  </Button>
  {#if path}
    <Link class="btn btn-neutral" href={path}>
      <Icon size={4} icon={MenuDots} />
      View Details
    </Link>
  {/if}
  {#if ENABLE_ZAPS && !readOnly}
    <ZapButton replaceState {url} {event} class="btn btn-neutral w-full">
      <Icon size={4} icon={Bolt} />
      Send Zap
    </ZapButton>
  {/if}
  {#if reply && !readOnly}
    <Button class="btn btn-neutral w-full" onclick={sendReply}>
      <Icon size={4} icon={Reply} />
      Send Reply
    </Button>
  {/if}
  {#if edit && !readOnly}
    <Button class="btn btn-neutral w-full" onclick={editMessage}>
      <Icon size={4} icon={Pen} />
      Edit Message
    </Button>
  {/if}
  {#if !readOnly}
    <Button class="btn btn-neutral w-full" onclick={showEmojiPicker}>
      <Icon size={4} icon={SmileCircle} />
      Send Reaction
    </Button>
  {/if}
</div>
