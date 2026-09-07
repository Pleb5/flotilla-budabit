<script lang="ts">
  import cx from "classnames"
  import {hash, now, displayList, formatTimestampAsTime, formatTimestampAsDate} from "@welshman/lib"
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {MESSAGE, COMMENT, getTag} from "@welshman/util"
  import {pubkey, displayProfileByPubkey} from "@welshman/app"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Pen from "@assets/icons/pen.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import ReplyAlt from "@assets/icons/reply.svg?dataurl"
  import TapTarget from "@lib/components/TapTarget.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import PublicationStatus from "@app/components/PublicationStatus.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import RoomItemZapButton from "@app/components/RoomItemZapButton.svelte"
  import RoomItemEmojiButton from "@app/components/RoomItemEmojiButton.svelte"
  import RoomItemMenuButton from "@app/components/RoomItemMenuButton.svelte"
  import RoomItemMenuMobile from "@app/components/RoomItemMenuMobile.svelte"
  import RoomItemContent from "@app/components/RoomItemContent.svelte"
  import {colors, ENABLE_ZAPS, deriveEventsForUrl} from "@app/core/state"
  import {activeCommunityReportState} from "@app/core/community-state"
  import {
    getCommunityCensorReason,
    getCommunityReportEventAddress,
  } from "@app/core/community-reports"
  import {publishReactionDeleteOperation, publishReactionOperation} from "@app/core/commands"
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"
  import type {CommunityPointer} from "@app/core/community"
  import {getExactCommunityEventPath} from "@app/util/routes"
  import {pushModal} from "@app/util/modal"
  import CommunityWidgetSlotLaunchers from "@app/components/community/CommunityWidgetSlotLaunchers.svelte"

  interface Props {
    url: string
    community?: CommunityPointer
    event: TrustedEvent
    replyTo?: (event: TrustedEvent) => void
    showPubkey?: boolean
    inert?: boolean
    readOnly?: boolean
    profileRelays?: string[]
    interactionRelays?: string[]
    actionRelays?: string[]
    allowedAuthors?: string[]
    reactionAllowedAuthors?: string[]
    reportAllowedAuthors?: string[]
    scopeH?: string
    communitySectionName?: string
    operationId?: string
    canEdit: (event: TrustedEvent) => boolean
    onEdit: (event: TrustedEvent) => void
  }

  const {
    url,
    community = undefined,
    event,
    replyTo = undefined,
    showPubkey = false,
    inert = false,
    readOnly = false,
    profileRelays = [],
    interactionRelays = [],
    actionRelays = undefined,
    allowedAuthors = undefined,
    reactionAllowedAuthors = undefined,
    reportAllowedAuthors = undefined,
    scopeH = "",
    communitySectionName = "",
    operationId = undefined,
    canEdit,
    onEdit,
  }: Props = $props()

  const path = community ? getExactCommunityEventPath(event, community) : undefined
  const communityContextUrl = $derived(community?.address || url)
  const today = formatTimestampAsDate(now())
  const profileRelayHints = $derived.by(() =>
    (profileRelays.length > 0
      ? profileRelays
      : interactionRelays.length > 0
        ? interactionRelays
        : scopeH
          ? []
          : [url]
    ).filter(Boolean),
  )
  const profileDisplay = $derived(
    deriveBudabitProfileDisplay(event.pubkey, {relays: profileRelayHints}),
  )
  const [_, colorValue] = colors[Math.abs(hash(event.pubkey)) % colors.length]
  let comments = $state<TrustedEvent[]>([])

  $effect(() => {
    const relay = interactionRelays[0] || profileRelays[0]
    if (!relay) {
      comments = []
      return
    }

    return deriveEventsForUrl(relay, [{kinds: [COMMENT], "#e": [event.id]}]).subscribe(
      events => (comments = events),
    )
  })
  const relayTargets = $derived.by(() =>
    (interactionRelays.length > 0 ? interactionRelays : scopeH ? [] : [url]).filter(Boolean),
  )
  const actionRelayTargets = $derived(actionRelays ?? relayTargets)
  const censorReason = $derived.by(() =>
    communitySectionName
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: event.id,
          eventAddress: getCommunityReportEventAddress(event),
          pubkey: event.pubkey,
          sectionName: communitySectionName,
        })
      : undefined,
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
    cx("shadow-sm backdrop-blur", {
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
      url: communityContextUrl,
      community,
      event,
      reply,
      edit,
      readOnly,
      relays: actionRelayTargets,
      scopeH,
      communitySectionName,
    })

  const openProfile = () =>
    pushModal(ProfileDetail, {
      pubkey: event.pubkey,
      url: profileRelayHints[0],
      relays: profileRelayHints,
    })

  const deleteReaction = async (reaction: TrustedEvent) =>
    publishReactionDeleteOperation({
      reaction,
      relays: actionRelayTargets,
    })

  const createReaction = async (template: EventContent) =>
    publishReactionOperation({
      ...template,
      event,
      relays: actionRelayTargets,
      tags: [...(template.tags || []), ...scopedTags],
    })
</script>

<TapTarget
  data-event={event.id}
  onTap={inert || censorReason ? null : onTap}
  class="group relative flex w-full cursor-default flex-col px-2 py-1 text-left hover:bg-base-100/50">
  {#if !inert && !censorReason}
    <div class="z-10 absolute right-2 top-1 sm:hidden">
      <Button
        class="btn btn-neutral btn-xs rounded-full border border-solid border-neutral bg-base-100/90 shadow-sm backdrop-blur"
        onclick={onTap}
        aria-label="Open message actions">
        <Icon icon={MenuDots} size={4} />
      </Button>
    </div>
  {/if}
  <div class="flex w-full gap-3 overflow-hidden">
    {#if showPubkey && !censorReason}
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
    <div class="min-w-0 flex-grow">
      {#if showPubkey && !censorReason}
        <div class="flex items-center gap-2 pr-12 sm:pr-32">
          <Button onclick={openProfile} class="text-sm font-bold" style="color: {colorValue}">
            {$profileDisplay}
          </Button>
          <span class="text-xs opacity-50 sm:hidden"
            >{formatTimestampAsTime(event.created_at)}</span>
          <span class="hidden text-xs opacity-50 sm:inline">
            {#if formatTimestampAsDate(event.created_at) === today}Today{:else}{formatTimestampAsDate(
                event.created_at,
              )}{/if}
            at {formatTimestampAsTime(event.created_at)}
          </span>
        </div>
      {/if}
      <div class="w-full min-w-0" class:mt-2={showPubkey && event.kind !== MESSAGE}>
        {#if censorReason}
          <ModeratedContent reason={censorReason} />
        {:else}
          <RoomItemContent {url} {event} {communitySectionName} />
        {/if}
        {#if operationId}
          <PublicationStatus {operationId} class="mt-2" />
        {/if}
      </div>
    </div>
  </div>
  {#if !censorReason}
    <div class="ml-10 mt-1 flex flex-wrap items-center gap-2 pl-1 empty:hidden">
      <ReactionSummary
        {url}
        relays={relayTargets}
        operationRelays={actionRelayTargets}
        {allowedAuthors}
        {reactionAllowedAuthors}
        {reportAllowedAuthors}
        {scopeH}
        {event}
        {readOnly}
        {deleteReaction}
        {createReaction}
        reactionClass="tooltip-right" />
      {#if path && comments.length > 0}
        {@const pubkeys = comments.map((e: TrustedEvent) => e.pubkey)}
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
            <span>{comments.length} comment{comments.length === 1 ? "" : "s"}</span>
          </Link>
        </div>
      {/if}
    </div>
  {/if}
  {#if !inert && !censorReason}
    <div
      class="z-10 pointer-events-none absolute right-2 top-1 hidden items-center gap-1 text-xs opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 sm:flex">
      <div class={actionGroupClass}>
        {#if reply}
          <Button class="btn join-item btn-xs" onclick={reply} aria-label="Reply to message">
            <Icon icon={Reply} size={4} />
          </Button>
        {/if}
        {#if ENABLE_ZAPS && !readOnly}
          <RoomItemZapButton {event} relays={actionRelayTargets} {scopeH} />
        {/if}
        {#if !readOnly}
          <RoomItemEmojiButton {url} {event} relays={actionRelayTargets} {scopeH} />
        {/if}
        {#if edit}
          <Button class="btn join-item btn-xs" onclick={edit}>
            <Icon icon={Pen} size={4} />
          </Button>
        {/if}
        <RoomItemMenuButton
          url={communityContextUrl}
          {event}
          {readOnly}
          class={menuButtonClass}
          relays={actionRelayTargets}
          {reply}
          {edit}
          {scopeH}
          {communitySectionName} />
      </div>
      {#if !readOnly && community}
        <CommunityWidgetSlotLaunchers
          {community}
          slotType="chat-message-actions"
          variant="message-actions"
          context={{
            message: event,
            communityAddress: community?.address,
            scopeH,
            communitySectionName,
          }} />
      {/if}
    </div>
  {/if}
</TapTarget>
