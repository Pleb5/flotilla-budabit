<script lang="ts">
  import cx from "classnames"
  import {hash, now, displayList, formatTimestampAsTime, formatTimestampAsDate} from "@welshman/lib"
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {MESSAGE, COMMENT, getTag} from "@welshman/util"
  import {
    thunks,
    pubkey,
    mergeThunks,
    deriveProfileDisplay,
    displayProfileByPubkey,
  } from "@welshman/app"
  import {isMobile} from "@lib/html"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Pen from "@assets/icons/pen.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import ReplyAlt from "@assets/icons/reply.svg?dataurl"
  import TapTarget from "@lib/components/TapTarget.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import ThunkFailure from "@app/components/ThunkFailure.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import RoomItemZapButton from "@app/components/RoomItemZapButton.svelte"
  import RoomItemEmojiButton from "@app/components/RoomItemEmojiButton.svelte"
  import RoomItemMenuButton from "@app/components/RoomItemMenuButton.svelte"
  import RoomItemMenuMobile from "@app/components/RoomItemMenuMobile.svelte"
  import RoomItemContent from "@app/components/RoomItemContent.svelte"
  import {colors, ENABLE_ZAPS, deriveEventsForUrl} from "@app/core/state"
  import {publishSocialDelete, publishReaction, canEnforceNip70} from "@app/core/commands"
  import {getRoomItemPath} from "@app/util/routes"
  import {pushModal} from "@app/util/modal"
  import SlotRenderer from "@app/extensions/components/SlotRenderer.svelte"
  import {Thunk} from "@welshman/app"

  interface Props {
    url: string
    event: TrustedEvent
    replyTo?: (event: TrustedEvent) => void
    showPubkey?: boolean
    inert?: boolean
    readOnly?: boolean
    profileRelays?: string[]
    interactionRelays?: string[]
    interactionAuthorPubkeys?: string[]
    scopeH?: string
    protectInteractions?: boolean
    canEdit: (event: TrustedEvent) => boolean
    onEdit: (event: TrustedEvent) => void
  }

  const {
    url,
    event,
    replyTo = undefined,
    showPubkey = false,
    inert = false,
    readOnly = false,
    profileRelays = [],
    interactionRelays = [],
    interactionAuthorPubkeys = undefined,
    scopeH = "",
    protectInteractions = true,
    canEdit,
    onEdit,
  }: Props = $props()

  const path = getRoomItemPath(url, event)
  const shouldProtect = protectInteractions ? canEnforceNip70(url) : undefined
  const today = formatTimestampAsDate(now())
  const profileRelayHints = $derived.by(() =>
    (profileRelays.length > 0 ? profileRelays : interactionRelays.length > 0 ? interactionRelays : [url])
      .filter(Boolean),
  )
  const profileDisplay = $derived(deriveProfileDisplay(event.pubkey, profileRelayHints))
  const thunk = mergeThunks($thunks.filter((t: Thunk) => t.event.id === event.id))
  const [_, colorValue] = colors[Math.abs(hash(event.pubkey)) % colors.length]
  const comments = deriveEventsForUrl(url, [{kinds: [COMMENT], "#e": [event.id]}])
  const relayTargets = $derived.by(() =>
    (interactionRelays.length > 0 ? interactionRelays : [url]).filter(Boolean),
  )
  const scopedTags = $derived.by(() => {
    if (!scopeH || getTag("h", event.tags)?.[1] === scopeH) {
      return [] as string[][]
    }

    return [["h", scopeH]]
  })

  const reply = !readOnly && replyTo ? () => replyTo(event) : undefined
  const edit = !readOnly && canEdit(event) ? () => onEdit(event) : undefined
  const hasJoinedActions = $derived(!readOnly)
  const actionGroupClass = $derived(
    cx("z-10 absolute right-1 top-1 shadow-sm backdrop-blur", {
      "join rounded-full border border-solid border-neutral bg-base-100/90": hasJoinedActions,
      "rounded-full": !hasJoinedActions,
    }),
  )
  const menuButtonClass = $derived(
    cx("btn btn-xs", {
      "join-item": hasJoinedActions,
      "btn-circle border border-solid border-neutral bg-base-100/90": !hasJoinedActions,
    }),
  )

  const onTap = () =>
    pushModal(RoomItemMenuMobile, {
      url,
      event,
      reply,
      edit,
      readOnly,
      relays: relayTargets,
      scopeH,
      protectActions: protectInteractions,
    })

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
  class="group relative flex w-full cursor-default flex-col p-2 pb-3 text-left hover:bg-base-100/50">
  {#if isMobile && !inert}
    <div class={actionGroupClass}>
      {#if !readOnly}
        <RoomItemEmojiButton
          {url}
          {event}
          relays={relayTargets}
          {scopeH}
          protect={protectInteractions} />
      {/if}
      {#if reply}
        <Button class="btn join-item btn-xs" onclick={reply} aria-label="Reply to message">
          <Icon icon={Reply} size={4} />
        </Button>
      {/if}
      {#if edit}
        <Button class="btn join-item btn-xs" onclick={edit} aria-label="Edit message">
          <Icon icon={Pen} size={4} />
        </Button>
      {/if}
      <Button class={menuButtonClass} onclick={onTap} aria-label="Open message actions">
        <Icon icon={MenuDots} size={4} />
      </Button>
    </div>
  {/if}
  <div class="flex w-full gap-3 overflow-auto">
    {#if showPubkey}
      <Button onclick={openProfile} class="flex items-start">
        <ProfileCircle
          pubkey={event.pubkey}
          class="border border-solid border-base-content"
          relays={profileRelayHints}
          size={8} />
      </Button>
    {:else}
      <div class="w-8 min-w-8 max-w-8"></div>
    {/if}
    <div class="min-w-0 flex-grow pr-24 sm:pr-32">
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
      <div class:mt-2={showPubkey && event.kind !== MESSAGE}>
        <RoomItemContent {url} {event} />
        {#if thunk}
          <ThunkFailure showToastOnRetry {thunk} class="mt-2 text-sm" />
        {/if}
      </div>
    </div>
  </div>
  <div class="row-2 ml-10 mt-1 pl-1">
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
    {#if path && $comments.length > 0}
      {@const pubkeys = $comments.map((e: TrustedEvent) => e.pubkey)}
      {@const isOwn = $pubkey && pubkeys.includes($pubkey)}
      {@const info = displayList(pubkeys.map((pubkey: string) => displayProfileByPubkey(pubkey)))}
      {@const tooltip = `${info} commented`}
      <div data-tip={tooltip} class="tooltip tooltip-right flex">
        <Link
          href={path}
          class={cx("btn btn-xs gap-1 rounded-full", {
            "btn-neutral": !isOwn,
            "btn-primary": isOwn,
          })}>
          <Icon icon={ReplyAlt} />
          <span>{$comments.length} comment{$comments.length === 1 ? "" : "s"}</span>
        </Link>
      </div>
    {/if}
  </div>
  {#if !isMobile}
    <div class={cx(actionGroupClass, "text-xs")}>
      {#if ENABLE_ZAPS && !readOnly}
        <RoomItemZapButton {url} {event} />
      {/if}
      {#if !readOnly}
        <RoomItemEmojiButton
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
      {#if edit}
        <Button class="btn join-item btn-xs" onclick={edit}>
          <Icon icon={Pen} size={4} />
        </Button>
      {/if}
      <RoomItemMenuButton
        {url}
        {event}
        {readOnly}
        class={menuButtonClass}
        relays={relayTargets}
        protect={protectInteractions ? undefined : false} />
      {#if !readOnly}
        <SlotRenderer slotId="chat:message:actions" context={{url, event}} />
      {/if}
    </div>
  {/if}
</TapTarget>
