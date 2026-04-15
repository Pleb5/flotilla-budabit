<script lang="ts">
  import {hash, now, formatTimestampAsTime, formatTimestampAsDate} from "@welshman/lib"
  import {getTag, type TrustedEvent, type EventContent} from "@welshman/util"
  import {thunks, deriveProfile, deriveProfileDisplay} from "@welshman/app"
  import {isMobile} from "@lib/html"
  import TapTarget from "@lib/components/TapTarget.svelte"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Markdown from "@lib/components/Markdown.svelte"
  import ThunkFailure from "@app/components/ThunkFailure.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ChannelMessageZapButton from "@app/components/ChannelMessageZapButton.svelte"
  import ChannelMessageEmojiButton from "@app/components/ChannelMessageEmojiButton.svelte"
  import ChannelMessageMenuButton from "@app/components/ChannelMessageMenuButton.svelte"
  import ChannelMessageMenuMobile from "@app/components/ChannelMessageMenuMobile.svelte"
  import {colors, ENABLE_ZAPS} from "@app/core/state"
  import {publishSocialDelete, publishReaction, canEnforceNip70} from "@app/core/commands"
  import {pushModal} from "@app/util/modal"
  import SlotRenderer from "@app/extensions/components/SlotRenderer.svelte"
  import {isKnownEventKind, isKnownUnknown, Template, EventRenderer} from "@nostr-git/ui"

  interface Props {
    url: string
    event: TrustedEvent
    replyTo?: (event: TrustedEvent) => void
    showPubkey?: boolean
    inert?: boolean
    interactionRelays?: string[]
    scopeH?: string
    protectInteractions?: boolean
  }

  const {
    url,
    event,
    replyTo = undefined,
    showPubkey = false,
    inert = false,
    interactionRelays = [],
    scopeH = "",
    protectInteractions = true,
  }: Props = $props()

  const thunk = $derived($thunks.find(t => t.event.id === event.id))
  const shouldProtect = protectInteractions ? canEnforceNip70(url) : undefined
  const today = formatTimestampAsDate(now())
  const profile = deriveProfile(event.pubkey, [url])
  const profileDisplay = deriveProfileDisplay(event.pubkey, [url])
  const [_, colorValue] = colors[Math.abs(hash(event.pubkey)) % colors.length]
  const relayTargets = $derived.by(() => (interactionRelays.length > 0 ? interactionRelays : [url]).filter(Boolean))
  const scopedTags = $derived.by(() => {
    if (!scopeH || getTag("h", event.tags)?.[1] === scopeH) {
      return [] as string[][]
    }

    return [["h", scopeH]]
  })

  const reply = replyTo ? () => replyTo(event) : undefined

  const openMobileMenu = () =>
    pushModal(ChannelMessageMenuMobile, {
      url,
      event,
      reply,
      relays: relayTargets,
      scopeH,
      protectActions: protectInteractions,
    })

  const onTap = () => openMobileMenu()

  const stopTapFromInteractive = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target) return
    const interactive = target.closest("button, a, [role='button'], [data-stop-tap]")
    if (interactive) {
      event.stopPropagation()
    }
  }

  const openProfile = () => pushModal(ProfileDetail, {pubkey: event.pubkey, url})

  const deleteReaction = async (event: TrustedEvent) =>
    publishSocialDelete({
      url,
      relays: relayTargets,
      event,
      protect: protectInteractions ? await shouldProtect! : false,
    })

  const createReaction = async (template: EventContent) =>
    publishReaction({
      ...template,
      event,
      relays: relayTargets,
      tags: [...(template.tags || []), ...scopedTags],
      protect: protectInteractions ? await shouldProtect! : false,
    })
</script>

<TapTarget
  data-event={event.id}
  onTap={inert ? null : onTap}
  class="group relative flex w-full cursor-default flex-col p-2 pb-3 text-left">
  <div class="flex w-full gap-3 overflow-auto">
    {#if showPubkey}
      <Button onclick={openProfile} class="flex items-start">
        <ImageIcon alt="" src={$profile?.picture || ""} class="border border-solid border-base-content rounded-full" size={8} />
      </Button>
    {:else}
      <div class="w-8 min-w-8 max-w-8"></div>
    {/if}
    <div class="min-w-0 flex-grow pr-1">
      {#if showPubkey}
        <div class="flex items-center gap-2">
          <Button onclick={openProfile} class="text-sm font-bold" style="color: {colorValue}">
            {$profileDisplay}
          </Button>
          <span class="text-xs opacity-50">
            {#if formatTimestampAsDate(event.created_at) === today}
              Today
            {:else}
              {formatTimestampAsDate(event.created_at)}
            {/if}
            at {formatTimestampAsTime(event.created_at)}
          </span>
        </div>
      {/if}
        <div class="text-sm">
          {#if isKnownEventKind(event.kind)}
            <div
              class="event-renderer"
              role="presentation"
              tabindex="-1"
              onclick={stopTapFromInteractive}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                }
              }}>
              <EventRenderer event={event as any} relay={url} />
            </div>
        {:else if isKnownUnknown(event.kind)}
          <div class="unknown-kind">
            {@html new Template(event as any).render()}
          </div>
        {:else}
          <Markdown content={event.content} {event} {url} />
        {/if}
        {#if thunk}
          <ThunkFailure showToastOnRetry {thunk} class="mt-2" />
        {/if}
      </div>
    </div>
  </div>
  <div class="row-2 ml-10 mt-1 flex items-center gap-2 pl-1">
    <ReactionSummary
      {url}
      relays={relayTargets}
      {scopeH}
      {event}
      {deleteReaction}
      {createReaction}
      reactionClass="tooltip-right" />
    {#if isMobile && !inert}
      <Button class="btn btn-ghost btn-xs gap-1" onclick={openMobileMenu} data-stop-tap>
        <Icon icon={MenuDots} size={4} />
        <span>Actions</span>
      </Button>
    {/if}
  </div>
  {#if !isMobile}
    <div
      class="join absolute right-1 top-1 border border-solid border-neutral text-xs opacity-0 transition-all"
      class:group-hover:opacity-100={!isMobile}>
      {#if ENABLE_ZAPS}
        <ChannelMessageZapButton {url} {event} />
      {/if}
      <ChannelMessageEmojiButton {url} {event} relays={relayTargets} {scopeH} protect={protectInteractions} />
      {#if reply}
        <Button class="btn join-item btn-xs" onclick={reply}>
          <Icon icon={Reply} size={4} />
        </Button>
      {/if}
      <ChannelMessageMenuButton {url} {event} />
      <SlotRenderer slotId="chat:message:actions" context={{url, event}} />
    </div>
  {/if}
</TapTarget>
