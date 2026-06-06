<script lang="ts">
  import type {Snippet} from "svelte"
  import type {Instance} from "tippy.js"
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import type {TrustedEvent} from "@welshman/util"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import SmileCircle from "@assets/icons/smile-circle.svg?dataurl"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import Button from "@lib/components/Button.svelte"
  import ZapButton from "@app/components/ZapButton.svelte"
  import EmojiButton from "@lib/components/EmojiButton.svelte"
  import EventMenu from "@app/components/EventMenu.svelte"
  import {ENABLE_ZAPS} from "@app/core/state"
  import {publishReaction} from "@app/core/commands"
  import {stopPropagation} from "@lib/html"

  type Props = {
    url: string
    noun: string
    event: TrustedEvent
    hideZap?: boolean
    customActions?: Snippet
    relays?: string[]
    scopeH?: string
    zapScopeH?: string
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
    relays = [],
    scopeH = "",
    zapScopeH = "",
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

  const reactionRelays = $derived.by(() => {
    const scopedRelays = (relays || []).filter(Boolean)

    if (scopedRelays.length > 0) {
      return scopedRelays
    }

    return url ? [url] : []
  })

  const showPopover = () => popover?.show()

  const hidePopover = () => popover?.hide()

  const onEmoji = async (emoji: NativeEmoji) =>
    publishReaction({
      event,
      content: emoji.unicode,
      relays: reactionRelays,
      tags: scopeH ? [["h", scopeH]] : [],
    })

  // Stop right-click from bubbling up to parent context menu handlers
  const onContextMenu = stopPropagation(() => {})
  let popover: Instance | undefined = $state()
</script>

<div
  class="{menuOnly ? 'inline-flex' : 'join'} rounded-full {className}"
  role="group"
  data-stop-link
  data-stop-tap
  oncontextmenu={onContextMenu}>
  {#if !menuOnly && ENABLE_ZAPS && !hideZap && !readOnly}
    <ZapButton
      {event}
      relayHints={relays}
      scopeH={zapScopeH || scopeH}
      class="btn join-item btn-neutral btn-xs">
      <Icon icon={Bolt} size={4} />
    </ZapButton>
  {/if}
  {#if !menuOnly && !readOnly}
    <EmojiButton {onEmoji} class="btn join-item btn-neutral btn-xs">
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
        onClick: hidePopover,
        relays,
        scopeH,
        communitySectionName,
        ownerPubkey,
        showReport,
        showModeration,
        allowAdminDelete,
      }}
      params={{trigger: "manual", interactive: true}}>
      <Button
        class="btn btn-neutral btn-xs {menuOnly ? 'rounded-full' : 'join-item'}"
        onclick={showPopover}>
        <Icon icon={MenuDots} size={4} />
      </Button>
    </Tippy>
  {/if}
</div>
