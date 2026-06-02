<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {hash, now, formatTimestampAsTime, formatTimestampAsDate} from "@welshman/lib"
  import {COMMENT, getTag, type TrustedEvent, type EventContent} from "@welshman/util"
  import {thunks} from "@welshman/app"
  import {isMobile} from "@lib/html"
  import TapTarget from "@lib/components/TapTarget.svelte"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Pen from "@assets/icons/pen.svg?dataurl"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Markdown from "@lib/components/Markdown.svelte"
  import ThunkFailure from "@app/components/ThunkFailure.svelte"
  import NoteContentMinimal from "@app/components/NoteContentMinimal.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
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
  import {publishSocialDelete, publishReaction} from "@app/core/commands"
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"
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
    profileRelays?: string[]
    interactionAuthorPubkeys?: string[]
    scopeH?: string
    communitySectionName?: string
    replyParent?: TrustedEvent
    onReplyParentOpen?: (event: TrustedEvent) => void
    canEdit?: (event: TrustedEvent) => boolean
    onEdit?: (event: TrustedEvent) => void
  }

  const {
    url,
    event,
    replyTo = undefined,
    showPubkey = false,
    inert = false,
    readOnly = false,
    interactionRelays = [],
    profileRelays = [],
    interactionAuthorPubkeys = undefined,
    scopeH = "",
    communitySectionName = "",
    replyParent = undefined,
    onReplyParentOpen = undefined,
    canEdit = () => false,
    onEdit = undefined,
  }: Props = $props()

  const LEADING_EVENT_URI =
    /^(?:nostr:\s*)?(n(?:event|ote)1[ac-hj-np-z02-9]{6,})[ \t]*(?:\r?\n){1,2}/i

  const getEventIdFromEntity = (entity: string) => {
    try {
      const decoded = nip19.decode(entity)

      if (decoded.type === "note") return decoded.data as string
      if (decoded.type === "nevent") return (decoded.data as {id?: string}).id || ""
    } catch {
      return ""
    }

    return ""
  }

  const stripLeadingReplyQuote = (content: string, parentId: string) => {
    const match = LEADING_EVENT_URI.exec(content)

    if (!match || getEventIdFromEntity(match[1]) !== parentId) return content

    return content.slice(match[0].length)
  }

  const thunk = $derived($thunks.find(t => t.event.id === event.id))
  const displayEvent = $derived(
    replyParent
      ? {...event, content: stripLeadingReplyQuote(event.content, replyParent.id)}
      : event,
  )
  const today = formatTimestampAsDate(now())
  const [_, colorValue] = colors[Math.abs(hash(event.pubkey)) % colors.length]
  const relayTargets = $derived.by(() =>
    (interactionRelays.length > 0 ? interactionRelays : [url]).filter(Boolean),
  )
  const profileRelayHints = $derived.by(() =>
    (profileRelays.length > 0 ? profileRelays : relayTargets).filter(Boolean),
  )
  const profileDisplay = $derived(
    deriveBudabitProfileDisplay(event.pubkey, {relays: profileRelayHints}),
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

  const reply = replyTo ? () => replyTo(event) : undefined
  const edit = !readOnly && canEdit(event) && onEdit ? () => onEdit(event) : undefined
  const openReplyParent = () => {
    if (replyParent) onReplyParentOpen?.(replyParent)
  }

  const openMobileMenu = () =>
    pushModal(ChannelMessageMenuMobile, {
      url,
      event,
      reply,
      edit,
      relays: relayTargets,
      scopeH,
      communitySectionName,
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

  const openProfile = () =>
    pushModal(ProfileDetail, {
      pubkey: event.pubkey,
      url: profileRelayHints[0],
      relays: profileRelayHints,
    })

  const deleteReaction = async (event: TrustedEvent) =>
    publishSocialDelete({
      url,
      relays: relayTargets,
      event,
    })

  const createReaction = async (template: EventContent) =>
    publishReaction({
      ...template,
      event,
      relays: relayTargets,
      tags: [...(template.tags || []), ...scopedTags],
    })
</script>

<TapTarget
  data-event={event.id}
  onTap={inert || censorReason ? null : onTap}
  class="group relative flex w-full cursor-default flex-col p-2 pb-3 text-left">
  {#if isMobile && !inert && !censorReason}
    <div
      class="z-10 join absolute right-2 top-2 rounded-full border border-solid border-neutral bg-base-100/90 shadow-sm backdrop-blur">
      {#if !readOnly}
        <ChannelMessageEmojiButton {url} {event} relays={relayTargets} {scopeH} />
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
      {#if edit}
        <Button class="btn join-item btn-xs" onclick={edit} aria-label="Edit message" data-stop-tap>
          <Icon icon={Pen} size={4} />
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
        <ProfileCircle
          pubkey={event.pubkey}
          url={profileRelayHints[0]}
          relays={profileRelayHints}
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
      {#if replyParent}
        <Button
          class="mt-2 block w-full rounded-none border-l-2 border-solid border-l-primary bg-base-300/60 py-1 pl-2 pr-3 text-left opacity-90 transition hover:bg-base-300"
          onclick={openReplyParent}
          data-stop-tap>
          <NoteContentMinimal trimParent {url} event={replyParent} />
        </Button>
      {/if}
      <div class="w-full min-w-0 pt-2 text-sm">
        {#if censorReason}
          <ModeratedContent reason={censorReason} />
        {:else if displayEvent.kind === COMMENT}
          <Markdown
            content={displayEvent.content}
            event={displayEvent}
            {url}
            {communitySectionName}
            variant="comment" />
        {:else if isKnownEventKind(displayEvent.kind)}
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
            <EventRenderer event={displayEvent as any} relay={url} />
          </div>
        {:else if isKnownUnknown(displayEvent.kind)}
          <div class="unknown-kind">
            {@html new Template(displayEvent as any).render()}
          </div>
        {:else}
          <Markdown
            content={displayEvent.content}
            event={displayEvent}
            {url}
            {communitySectionName} />
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
    <div class="z-10 absolute right-2 top-2 flex items-center gap-1 text-xs">
      <div
        class="join rounded-full border border-solid border-neutral bg-base-100/90 shadow-sm backdrop-blur">
        {#if ENABLE_ZAPS && !readOnly}
          <ChannelMessageZapButton {event} relays={relayTargets} {scopeH} />
        {/if}
        {#if !readOnly}
          <ChannelMessageEmojiButton {url} {event} relays={relayTargets} {scopeH} />
        {/if}
        {#if reply}
          <Button class="btn join-item btn-xs" onclick={reply}>
            <Icon icon={Reply} size={4} />
          </Button>
        {/if}
        {#if edit}
          <Button class="btn join-item btn-xs" onclick={edit}>
            <Icon icon={Pen} size={4} />
          </Button>
        {/if}
        <ChannelMessageMenuButton
          {url}
          {event}
          relays={relayTargets}
          {communitySectionName}
          readOnly={inert || readOnly} />
      </div>
      {#if !readOnly}
        <SlotRenderer slotId="chat:message:actions" context={{url, event}} />
      {/if}
    </div>
  {/if}
</TapTarget>
