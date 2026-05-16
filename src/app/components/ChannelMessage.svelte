<script lang="ts">
  import {hash, now, formatTimestampAsTime, formatTimestampAsDate} from "@welshman/lib"
  import {COMMENT, getTag, type TrustedEvent, type EventContent} from "@welshman/util"
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
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ChannelMessageZapButton from "@app/components/ChannelMessageZapButton.svelte"
  import ChannelMessageEmojiButton from "@app/components/ChannelMessageEmojiButton.svelte"
  import ChannelMessageMenuButton from "@app/components/ChannelMessageMenuButton.svelte"
  import ChannelMessageMenuMobile from "@app/components/ChannelMessageMenuMobile.svelte"
  import {colors, ENABLE_ZAPS} from "@app/core/state"
  import {activeCommunityReportState} from "@app/core/community-state"
  import {getCommunityCensorReason} from "@app/core/community-reports"
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
    readOnly?: boolean
    interactionRelays?: string[]
    interactionAuthorPubkeys?: string[]
    scopeH?: string
    communitySectionName?: string
    protectInteractions?: boolean
  }

  const {
    url,
    event,
    replyTo = undefined,
    showPubkey = false,
    inert = false,
    readOnly = false,
    interactionRelays = [],
    interactionAuthorPubkeys = undefined,
    scopeH = "",
    communitySectionName = "",
    protectInteractions = true,
  }: Props = $props()

  const thunk = $derived($thunks.find(t => t.event.id === event.id))
  const shouldProtect = protectInteractions ? canEnforceNip70(url) : undefined
  const today = formatTimestampAsDate(now())
  const profile = deriveProfile(event.pubkey, [url])
  const profileDisplay = deriveProfileDisplay(event.pubkey, [url])
  const [_, colorValue] = colors[Math.abs(hash(event.pubkey)) % colors.length]
  const relayTargets = $derived.by(() =>
    (interactionRelays.length > 0 ? interactionRelays : [url]).filter(Boolean),
  )
  const scopedTags = $derived.by(() => {
    if (!scopeH || getTag("h", event.tags)?.[1] === scopeH) {
      return [] as string[][]
    }

    return [["h", scopeH]]
  })
  const censorReason = $derived.by(() =>
    communitySectionName
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: event.id,
          pubkey: event.pubkey,
          sectionName: communitySectionName,
        })
      : undefined,
  )

  const reply = !readOnly && replyTo ? () => replyTo(event) : undefined

  const openMobileMenu = () =>
    pushModal(ChannelMessageMenuMobile, {
      url,
      event,
      reply,
      relays: relayTargets,
      scopeH,
      communitySectionName,
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
  onTap={inert || censorReason ? null : onTap}
  class="group relative flex w-full cursor-default flex-col p-2 pb-3 text-left">
  {#if isMobile && !inert && !censorReason}
    <div
      class="z-10 join absolute right-1 top-1 rounded-full border border-solid border-neutral bg-base-100/90 shadow-sm backdrop-blur">
      {#if !readOnly}
        <ChannelMessageEmojiButton
          {url}
          {event}
          relays={relayTargets}
          {scopeH}
          protect={protectInteractions} />
      {/if}
      {#if reply}
        <Button
          class="btn join-item btn-xs"
          onclick={reply}
          aria-label="Reply to message"
          data-stop-tap>
          <Icon icon={Reply} size={4} />
        </Button>
      {/if}
      <Button
        class="btn join-item btn-xs"
        onclick={openMobileMenu}
        aria-label="Open message actions"
        data-stop-tap>
        <Icon icon={MenuDots} size={4} />
      </Button>
    </div>
  {/if}
  <div class="flex w-full gap-3 overflow-hidden">
    {#if showPubkey && !censorReason}
      <Button onclick={openProfile} class="flex items-start">
        <ImageIcon
          alt=""
          src={$profile?.picture || ""}
          class="rounded-full border border-solid border-base-content"
          size={8} />
      </Button>
    {:else}
      <div class="w-8 min-w-8 max-w-8"></div>
    {/if}
    <div class="min-w-0 flex-grow">
      {#if showPubkey && !censorReason}
        <div class="flex items-center gap-2 pr-24 sm:pr-32">
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
      <div class="w-full min-w-0 pt-2 text-sm">
        {#if censorReason}
          <ModeratedContent reason={censorReason} />
        {:else if event.kind === COMMENT}
          <Markdown
            content={event.content}
            {event}
            {url}
            {communitySectionName}
            variant="comment" />
        {:else if isKnownEventKind(event.kind)}
          <div
            class="event-renderer"
            role="presentation"
            tabindex="-1"
            onclick={stopTapFromInteractive}
            onkeydown={e => {
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
          <Markdown content={event.content} {event} {url} {communitySectionName} />
        {/if}
        {#if thunk}
          <ThunkFailure showToastOnRetry {thunk} class="mt-2" />
        {/if}
      </div>
    </div>
  </div>
  {#if !censorReason}
    <div class="row-2 ml-10 mt-1 flex items-center gap-2 pl-1">
      <ReactionSummary
        {url}
        relays={relayTargets}
        allowedAuthors={interactionAuthorPubkeys}
        {scopeH}
        {event}
        {readOnly}
        {deleteReaction}
        {createReaction}
        reactionClass="tooltip-right" />
    </div>
  {/if}
  {#if !isMobile && !censorReason}
    <div
      class="z-10 join absolute right-1 top-1 rounded-full border border-solid border-neutral bg-base-100/90 text-xs shadow-sm backdrop-blur">
      {#if ENABLE_ZAPS && !readOnly}
        <ChannelMessageZapButton {url} {event} />
      {/if}
      {#if !readOnly}
        <ChannelMessageEmojiButton
          {url}
          {event}
          relays={relayTargets}
          {scopeH}
          protect={protectInteractions} />
      {/if}
      {#if reply}
        <Button class="btn join-item btn-xs" onclick={reply}>
          <Icon icon={Reply} size={4} />
        </Button>
      {/if}
      <ChannelMessageMenuButton
        {url}
        {event}
        relays={relayTargets}
        {communitySectionName}
        protect={protectInteractions ? undefined : false}
        readOnly={inert || readOnly} />
      {#if !readOnly}
        <SlotRenderer slotId="chat:message:actions" context={{url, event}} />
      {/if}
    </div>
  {/if}
</TapTarget>
