<script lang="ts">
  import type {Instance} from "tippy.js"
  import {hash, formatTimestampAsTime} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {pubkey, deriveProfileDisplay, getPlaintext} from "@welshman/app"
  import {ensureDmPlaintext} from "@lib/budabit/dm"
  import {isMobile} from "@lib/html"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import TapTarget from "@lib/components/TapTarget.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import Content from "@lib/budabit/components/Content.svelte"
  import ChatMessageMenu from "@lib/budabit/components/ChatMessageMenu.svelte"
  import ChatMessageMenuMobile from "@lib/budabit/components/ChatMessageMenuMobile.svelte"
  import {colors} from "@app/core/state"
  import {pushModal} from "@app/util/modal"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"

  interface Props {
    event: TrustedEvent
    showPubkey?: boolean
  }

  const {event, showPubkey = false}: Props = $props()

  const isOwn = event.pubkey === $pubkey
  const profileDisplay = deriveProfileDisplay(event.pubkey)
  const [_, colorValue] = colors[hash(event.pubkey) % colors.length]

  const openProfile = () => pushModal(ProfileDetail, {pubkey: event.pubkey})

  const showMobileMenu = () => pushModal(ChatMessageMenuMobile, {event, content: displayContent})

  const togglePopover = () => {
    if (popoverIsVisible) {
      popover?.hide()
    } else {
      popover?.show()
    }
  }

  let plaintext = $state<string | undefined>(getPlaintext(event))
  let decrypting = $state(false)
  let decryptFailed = $state(false)

  const displayContent = $derived(plaintext ?? "")
  const displayEvent = $derived(
    plaintext !== undefined ? {...event, content: plaintext} : event,
  )

  $effect(() => {
    let cancelled = false
    const eventId = event.id
    const existing = getPlaintext(event)

    plaintext = existing
    decrypting = false
    decryptFailed = false

    if ($pubkey && existing === undefined && event.content) {
      decrypting = true
      ensureDmPlaintext(event, $pubkey)
        .then(result => {
          if (cancelled) return
          if (event.id !== eventId) return
          if (result !== undefined) {
            plaintext = result
            decryptFailed = false
          } else {
            decryptFailed = true
          }
        })
        .catch(() => {
          if (cancelled) return
          decryptFailed = true
        })
        .finally(() => {
          if (cancelled) return
          decrypting = false
        })
    }

    return () => {
      cancelled = true
    }
  })

  let popover: Instance | undefined = $state()
  let popoverIsVisible = $state(false)
</script>

<div
  data-event={event.id}
  class="group chat flex items-center justify-end gap-1 px-2"
  class:chat-start={!isOwn}
  class:flex-row-reverse={!isOwn}
  class:chat-end={isOwn}>
  {#if !isMobile}
    <Tippy
      bind:popover
      component={ChatMessageMenu}
      props={{event, popover}}
      params={{
        interactive: true,
        trigger: "manual",
        onShow() {
          popoverIsVisible = true
        },
        onHidden() {
          popoverIsVisible = false
        },
      }}>
      <button
        type="button"
        class="opacity-0 transition-all"
        class:group-hover:opacity-100={!isMobile}
        onclick={togglePopover}>
        <Icon icon={MenuDots} size={4} />
      </button>
    </Tippy>
  {/if}
  <div class="flex min-w-0 flex-col" class:items-end={isOwn}>
    <TapTarget
      class="bg-alt chat-bubble mx-1 mb-2 flex cursor-auto flex-col gap-1 text-left lg:max-w-2xl"
      onTap={showMobileMenu}>
      {#if showPubkey}
        <div class="flex items-center gap-2">
          {#if !isOwn}
            <Button onclick={openProfile} class="flex items-center gap-1">
              <ProfileCircle
                pubkey={event.pubkey}
                class="border border-solid border-base-content"
                size={4} />
              <div class="flex items-center gap-2">
                <Button onclick={openProfile} class="text-sm font-bold" style="color: {colorValue}">
                  {$profileDisplay}
                </Button>
              </div>
            </Button>
          {/if}
          <span class="whitespace-nowrap text-xs opacity-50"
            >{formatTimestampAsTime(event.created_at)}</span>
        </div>
      {/if}
      <div class="text-sm">
        {#if decrypting}
          <div class="flex flex-col gap-2">
            <div class="h-4 w-40 animate-pulse rounded bg-base-200"></div>
            <div class="h-4 w-24 animate-pulse rounded bg-base-200"></div>
          </div>
        {:else if decryptFailed}
          <span class="text-xs opacity-60">Encrypted message</span>
        {:else}
          <Content showEntire event={displayEvent} />
        {/if}
      </div>
    </TapTarget>
  </div>
</div>
