<script lang="ts">
  import type {Snippet} from "svelte"
  import type {Instance} from "tippy.js"
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import type {TrustedEvent} from "@welshman/util"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import SmileCircle from "@assets/icons/smile-circle.svg?dataurl"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import Button from "@lib/components/Button.svelte"
  import ZapButton from "@app/components/ZapButton.svelte"
  import EmojiButton from "@lib/components/EmojiButton.svelte"
  import EmojiPicker from "@lib/components/EmojiPicker.svelte"
  import EventMenu from "@app/components/EventMenu.svelte"
  import EventShareButton from "@app/components/EventShareButton.svelte"
  import {ENABLE_ZAPS} from "@app/core/state"
  import {publishReactionOperation} from "@app/core/commands"
  import {stopPropagation} from "@lib/html"
  import {pushModal} from "@app/util/modal"

  type Props = {
    url: string
    noun: string
    event: TrustedEvent
    hideZap?: boolean
    customActions?: Snippet
    onShare?: () => void | Promise<void>
    reply?: () => void
    edit?: () => void
    infoLabel?: string
    relays?: string[]
    reactionRelays?: string[]
    scopeH?: string
    zapScopeH?: string
    strictZapRelays?: boolean
    repoAddress?: string
    communitySectionName?: string
    ownerPubkey?: string
    readOnly?: boolean
    showReport?: boolean
    showModeration?: boolean
    allowAdminDelete?: boolean
    hideMenu?: boolean
    menuOnly?: boolean
    class?: string
  }

  const {
    url,
    noun,
    event,
    hideZap,
    customActions,
    onShare,
    reply,
    edit,
    infoLabel,
    relays = [],
    reactionRelays = undefined,
    scopeH = "",
    zapScopeH = "",
    strictZapRelays = false,
    repoAddress = "",
    communitySectionName = "",
    ownerPubkey = "",
    readOnly = false,
    showReport = true,
    showModeration = true,
    allowAdminDelete = true,
    hideMenu = false,
    menuOnly = false,
    class: className = "",
  }: Props = $props()

  const actionButtonClass = "btn join-item btn-neutral btn-xs"

  const reactionRelayTargets = $derived.by(() => {
    const scopedRelays = (reactionRelays ?? relays).filter(Boolean)

    if (reactionRelays !== undefined) return scopedRelays

    if (scopeH || repoAddress || scopedRelays.length > 0) {
      return scopedRelays
    }

    return url ? [url] : []
  })

  const showPopover = () => popover?.show()

  const hidePopover = () => popover?.hide()

  const onEmoji = async (emoji: NativeEmoji) =>
    publishReactionOperation({
      event,
      content: emoji.unicode,
      relays: reactionRelayTargets,
      repoAddress: repoAddress || undefined,
      tags: scopeH ? [["h", scopeH]] : [],
    })

  const showEmojiPicker = () =>
    pushModal(EmojiPicker, {
      onClick: (emoji: NativeEmoji) => {
        history.back()
        return onEmoji(emoji)
      },
    })

  // Stop right-click from bubbling up to parent context menu handlers
  const onContextMenu = stopPropagation(() => {})
  let popover: Instance | undefined = $state()
</script>

{#snippet primaryMenuActions()}
  {#if reply && !readOnly}
    <li>
      <Button onclick={reply}>
        <Icon icon={Reply} size={4} />
        Send Reply
      </Button>
    </li>
  {/if}
  {#if menuOnly && !readOnly}
    {#if ENABLE_ZAPS && !hideZap}
      <li>
        <ZapButton
          {event}
          relayHints={relays}
          scopeH={zapScopeH || scopeH}
          strict={strictZapRelays}>
          <Icon icon={Bolt} size={4} />
          Send Zap
        </ZapButton>
      </li>
    {/if}
    <li>
      <Button onclick={showEmojiPicker}>
        <Icon icon={SmileCircle} size={4} />
        Send Reaction
      </Button>
    </li>
  {/if}
{/snippet}

<div
  class="join rounded-full {className}"
  role="group"
  data-stop-link
  data-stop-tap
  oncontextmenu={onContextMenu}>
  {#if reply && !readOnly}
    <Button
      class={actionButtonClass}
      onclick={reply}
      aria-label={`Reply to ${noun.toLowerCase()}`}
      title="Reply">
      <Icon icon={Reply} size={4} />
    </Button>
  {/if}
  <EventShareButton {url} {event} {noun} {relays} {onShare} class={actionButtonClass} />
  {#if !menuOnly && ENABLE_ZAPS && !hideZap && !readOnly}
    <ZapButton
      {event}
      relayHints={relays}
      scopeH={zapScopeH || scopeH}
      strict={strictZapRelays}
      class={actionButtonClass}>
      <Icon icon={Bolt} size={4} />
    </ZapButton>
  {/if}
  {#if !menuOnly && !readOnly}
    <EmojiButton {onEmoji} class={actionButtonClass} aria-label="Add reaction">
      <Icon icon={SmileCircle} size={4} />
    </EmojiButton>
  {/if}
  {#if !hideMenu}
    <Tippy
      bind:popover
      component={EventMenu}
      props={{
        url,
        noun,
        event,
        customActions,
        primaryActions: primaryMenuActions,
        edit: readOnly ? undefined : edit,
        infoLabel,
        onClick: hidePopover,
        relays,
        repoAddress,
        scopeH,
        communitySectionName,
        ownerPubkey,
        showReport,
        showModeration,
        allowAdminDelete,
      }}
      params={{trigger: "manual", interactive: true}}>
      <Button
        class={actionButtonClass}
        onclick={showPopover}
        aria-label={`Open ${noun.toLowerCase()} actions`}>
        <Icon icon={MenuDots} size={4} />
      </Button>
    </Tippy>
  {/if}
</div>
