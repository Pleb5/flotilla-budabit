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
  import {publishReaction, canEnforceNip70} from "@app/core/commands"
  import {stopPropagation} from "@lib/html"

  type Props = {
    url: string
    noun: string
    event: TrustedEvent
    hideZap?: boolean
    customActions?: Snippet
    relays?: string[]
    showReport?: boolean
    allowAdminDelete?: boolean
  }

  const {
    url,
    noun,
    event,
    hideZap,
    customActions,
    relays = [],
    showReport = true,
    allowAdminDelete = true,
  }: Props = $props()

  const reactionRelays = $derived.by(() => {
    const scopedRelays = (relays || []).filter(Boolean)

    if (scopedRelays.length > 0) {
      return scopedRelays
    }

    return url ? [url] : []
  })

  const getShouldProtect = async () => {
    const relay = reactionRelays[0] || url
    if (!relay) return false

    try {
      return await canEnforceNip70(relay)
    } catch {
      return false
    }
  }

  const showPopover = () => popover?.show()

  const hidePopover = () => popover?.hide()

  const onEmoji = async (emoji: NativeEmoji) =>
    publishReaction({
      event,
      content: emoji.unicode,
      relays: reactionRelays,
      protect: await getShouldProtect(),
    })

  // Stop right-click from bubbling up to parent context menu handlers
  const onContextMenu = stopPropagation(() => {})
  let popover: Instance | undefined = $state()
</script>

<div
  class="join rounded-full"
  role="group"
  data-stop-link
  data-stop-tap
  oncontextmenu={onContextMenu}>
  {#if ENABLE_ZAPS && !hideZap}
    <ZapButton {url} {event} class="btn join-item btn-neutral btn-xs">
      <Icon icon={Bolt} size={4} />
    </ZapButton>
  {/if}
  <EmojiButton {onEmoji} class="btn join-item btn-neutral btn-xs">
    <Icon icon={SmileCircle} size={4} />
  </EmojiButton>
  <Tippy
    bind:popover
    component={EventMenu}
    props={{url, noun, event, customActions, onClick: hidePopover, relays, showReport, allowAdminDelete}}
    params={{trigger: "manual", interactive: true}}>
    <Button class="btn join-item btn-neutral btn-xs" onclick={showPopover}>
      <Icon icon={MenuDots} size={4} />
    </Button>
  </Tippy>
</div>
