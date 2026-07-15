<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {sortBy} from "@welshman/lib"
  import {
    COMMENT,
    getTagValue,
    makeEvent,
    type EventContent,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {scrollToEvent} from "@lib/html"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import RoomComposeEdit from "@app/components/RoomComposeEdit.svelte"
  import RoomComposeParent from "@app/components/RoomComposeParent.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import CalendarEventActions from "@app/components/CalendarEventActions.svelte"
  import CalendarEventDescription from "@app/components/CalendarEventDescription.svelte"
  import CalendarEventHeader from "@app/components/CalendarEventHeader.svelte"
  import CalendarEventMeta from "@app/components/CalendarEventMeta.svelte"
  import CalendarEventDate from "@app/components/CalendarEventDate.svelte"
  import {
    makeCommunityCalendarEventReply,
    readCommunityCalendarEventReply,
  } from "@app/core/community-calendar"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityPermissionStatus,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    hydrateCommunityEventsWithStatus,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {normalizePubkey, parseTargetedPublication} from "@app/core/community"
  import {makeCommunityTargetingFilter} from "@app/core/community-feeds"
  import {
    COMMUNITY_CALENDAR_WRITE_TARGETS,
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityCalendarTargetWriterPubkeys,
    getCommunityCalendarWriteTargetSectionName,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {
    getCommunityCensorReason,
    getCommunityReportEventAddress,
    isCommunityPersonBanned,
  } from "@app/core/community-reports"
  import {
    canEditReplyEvent,
    editedTargetIds,
    filterVisibleAfterDeletesAndEdits,
  } from "@app/core/event-edits"
  import {publishEditedReply} from "@app/core/event-edit-publish"
  import {setChecked} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {makeCommunityCalendarPath, parseCommunityRouteParam} from "@app/util/routes"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const eventParam = $derived($page.params.event || "")
  const calendarPath = $derived(
    communityPubkey ? makeCommunityCalendarPath(communityPubkey) : $page.url.pathname,
  )
  const eventPath = $derived(
    communityPubkey && eventParam
      ? makeCommunityCalendarPath(communityPubkey, eventParam)
      : calendarPath,
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
      $activeCommunityDefinition?.pubkey === communityPubkey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityPermissionsLoading = $derived(
    Boolean(
      communityPubkey &&
      $activeCommunityPermissionStatus.communityPubkey === communityPubkey &&
      $activeCommunityPermissionStatus.loading &&
      !$activeCommunityPermissionStatus.loaded &&
      !$activeCommunityPermissionStatus.hasCachedEvents,
    ),
  )
  const communityPermissionEvidenceIncomplete = $derived(
    Boolean(
      communityPubkey &&
      $activeCommunityPermissionStatus.communityPubkey === communityPubkey &&
      $activeCommunityPermissionStatus.loaded &&
      !$activeCommunityPermissionStatus.complete &&
      !$activeCommunityPermissionStatus.hasCachedEvents,
    ),
  )
  const communityBootstrapFailed = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const calendarSectionName = $derived(
    getCommunityCalendarWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
    ),
  )
  const getCalendarEventSectionName = (_kind: number) =>
    getCommunityCalendarWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
    )
  const commentSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.comment,
    ),
  )
  const commentAccessMessage = $derived(`Request ${commentSectionName} access to comment.`)
  const calendarAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunityCalendarTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const interactionAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.comment,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const isEventIdParam = $derived(/^[0-9a-f]{64}$/i.test(eventParam))
  const eventFilters = $derived.by<Filter[]>(() => {
    if (!communityBootstrapReady || !eventParam) return []

    const filters: Filter[] = []

    for (const target of COMMUNITY_CALENDAR_WRITE_TARGETS) {
      if (calendarAuthorPubkeys.length === 0) continue

      if (isEventIdParam)
        filters.push({kinds: [target.kind], ids: [eventParam], authors: calendarAuthorPubkeys})
      filters.push({kinds: [target.kind], "#d": [eventParam], authors: calendarAuthorPubkeys})
    }

    return filters
  })
  const eventEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: eventFilters})),
  )
  const event = $derived.by(() => {
    const events = sortBy(candidate => -candidate.created_at, $eventEvents)

    return (
      events.find(candidate => candidate.id === eventParam) ||
      events.find(candidate => getTagValue("d", candidate.tags) === eventParam)
    )
  })
  const eventAddress = $derived.by(() => {
    const identifier = event ? getTagValue("d", event.tags) : ""

    return event && identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
  })
  const eventTargetingId = $derived(event ? getTagValue("h", event.tags) || "" : "")
  const targetingFilters = $derived<Filter[]>(
    communityBootstrapReady && communityPubkey && event
      ? [
          makeCommunityTargetingFilter(
            communityPubkey,
            [event.kind],
            eventTargetingId ? {"#d": [eventTargetingId]} : {},
          ),
        ]
      : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const isTargetedToCommunity = $derived.by(() => {
    if (!event) return false

    const allowedAuthors = new Set(calendarAuthorPubkeys.map(normalizePubkey).filter(Boolean))
    if (!allowedAuthors.has(normalizePubkey(event.pubkey))) return false

    return $targetingEvents.some(targetingEvent => {
      const targeting = parseTargetedPublication(targetingEvent)
      if (!targeting || targeting.kind !== event.kind) return false
      if (eventTargetingId && targeting.id === eventTargetingId) return true
      if (targeting.ref?.type === "e" && targeting.ref.value === event.id) return true
      if (targeting.ref?.type === "a" && targeting.ref.value === eventAddress) return true

      return false
    })
  })
  const approvedEvent = $derived(event && isTargetedToCommunity ? event : undefined)
  const approvedEventSectionName = $derived(
    approvedEvent ? getCalendarEventSectionName(approvedEvent.kind) : calendarSectionName,
  )
  const approvedEventCensorReason = $derived.by(() =>
    approvedEvent
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: approvedEvent.id,
          eventAddress: getCommunityReportEventAddress(approvedEvent),
          pubkey: approvedEvent.pubkey,
          sectionName: approvedEventSectionName,
        })
      : undefined,
  )
  const replyFilters = $derived<Filter[]>(
    communityBootstrapReady &&
      approvedEvent &&
      !approvedEventCensorReason &&
      interactionAuthorPubkeys.length
      ? [
          {
            kinds: [COMMENT],
            "#E": [approvedEvent.id],
            "#K": [String(approvedEvent.kind)],
            "#h": [communityPubkey],
            authors: interactionAuthorPubkeys,
          },
          ...(eventAddress
            ? [
                {
                  kinds: [COMMENT],
                  "#A": [eventAddress],
                  "#K": [String(approvedEvent.kind)],
                  "#h": [communityPubkey],
                  authors: interactionAuthorPubkeys,
                },
                {
                  kinds: [COMMENT],
                  "#a": [eventAddress],
                  "#K": [String(approvedEvent.kind)],
                  "#h": [communityPubkey],
                  authors: interactionAuthorPubkeys,
                },
              ]
            : []),
        ]
      : [],
  )
  const replyEventsStore = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: replyFilters})),
  )
  const replies = $derived(
    sortBy(
      reply => reply.event.created_at,
      filterVisibleAfterDeletesAndEdits($replyEventsStore, $editedTargetIds)
        .map(replyEvent =>
          readCommunityCalendarEventReply(
            replyEvent,
            communityPubkey,
            approvedEvent?.id,
            eventAddress,
          ),
        )
        .filter((reply): reply is NonNullable<ReturnType<typeof readCommunityCalendarEventReply>> =>
          Boolean(reply),
        )
        .filter(
          reply => !isCommunityPersonBanned($activeCommunityReportState, reply!.event.pubkey),
        ),
    ),
  )

  let showAllReplies = $state(false)

  const visibleReplies = $derived(
    showAllReplies ? replies : replies.slice(Math.max(replies.length - 4, 0)),
  )
  const repliesById = $derived.by(() => new Map(replies.map(reply => [reply!.id, reply!])))
  const latestReplyId = $derived(replies.at(-1)?.id || "")

  const canReply = $derived(
    Boolean(
      approvedEvent &&
      communityBootstrapReady &&
      !approvedEventCensorReason &&
      $pubkey &&
      $activeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const canReact = $derived(
    Boolean(
      approvedEvent &&
      communityBootstrapReady &&
      !approvedEventCensorReason &&
      $pubkey &&
      $activeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.reaction,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const openCommentPrompt = async (replyParent?: TrustedEvent) => {
    parent = replyParent
    eventToEdit = undefined
    showReply = true
    await tick()
    composeElement?.scrollIntoView({behavior: "smooth", block: "end"})
    compose?.focus()
  }

  const openEditPrompt = async (event: TrustedEvent) => {
    parent = undefined
    eventToEdit = event
    showReply = true
    await tick()
    composeElement?.scrollIntoView({behavior: "smooth", block: "end"})
    compose?.focus()
  }

  const closeCommentPrompt = () => {
    parent = undefined
    eventToEdit = undefined
    showReply = false
  }

  const clearParent = () => {
    parent = undefined
  }

  const sendReply = ({content, tags}: EventContent) => {
    const trimmed = content.trim()
    if (!approvedEvent || !trimmed) return
    if (!canReply) {
      pushToast({theme: "error", message: commentAccessMessage})
      return
    }
    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    if (eventToEdit) {
      publishEditedReply({
        event: eventToEdit,
        content: trimmed,
        tags,
        relays,
        url: communityPubkey,
      })
      closeCommentPrompt()
      return
    }

    const template = makeCommunityCalendarEventReply({
      communityPubkey,
      calendarEvent: approvedEvent,
      relay: relays[0],
      content: trimmed,
      tags,
      parent: parent
        ? {id: parent.id, pubkey: parent.pubkey, kind: parent.kind, relay: relays[0]}
        : undefined,
    })

    publishThunk({
      relays,
      event: makeEvent(COMMENT, template),
    })
    closeCommentPrompt()
  }

  const scrollToReplyParent = async (event: TrustedEvent) => {
    showAllReplies = true
    await tick()
    await scrollToEvent(event.id)
  }

  const openReply = () => openCommentPrompt()
  const canEditReply = (event: TrustedEvent) => canEditReplyEvent(event, $pubkey, canReply)

  let loadingEvent = $state(false)
  let eventLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingTargeting = $state(false)
  let targetLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingReplies = $state(false)
  let replyLoadStatus = $state<CommunityHydrationStatus>("idle")
  let historicalLoadRetryVersion = $state(0)
  let showReply = $state(false)
  let parent: TrustedEvent | undefined = $state()
  let eventToEdit: TrustedEvent | undefined = $state()
  let compose: RoomCompose | undefined = $state()
  let composeElement: HTMLElement | undefined = $state()

  $effect(() => {
    void historicalLoadRetryVersion

    if (!communityPubkey || !event || !isEventIdParam) return

    const identifier = getTagValue("d", event.tags)
    if (!identifier || identifier === eventParam) return

    goto(makeCommunityCalendarPath(communityPubkey, identifier), {replaceState: true})
  })

  $effect(() => {
    if (
      !communityBootstrapReady ||
      $activeCommunityRelays.length === 0 ||
      eventFilters.length === 0
    ) {
      loadingEvent = false
      eventLoadStatus = "idle"
      return
    }

    const controller = new AbortController()

    loadingEvent = true
    eventLoadStatus = "queued"
    void hydrateCommunityEventsWithStatus({
      key: `calendar-event:${eventPath}:${historicalLoadRetryVersion}:${JSON.stringify(eventFilters)}`,
      relays: $activeCommunityRelays,
      filters: eventFilters,
      authenticate: true,
      timeout: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      signal: controller.signal,
      onStatus: status => {
        eventLoadStatus = status
        loadingEvent = status === "queued" || status === "loading"
      },
    })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion

    if (
      !communityBootstrapReady ||
      $activeCommunityRelays.length === 0 ||
      targetingFilters.length === 0
    ) {
      loadingTargeting = false
      targetLoadStatus = "idle"
      return
    }

    const controller = new AbortController()

    loadingTargeting = true
    targetLoadStatus = "queued"
    void hydrateCommunityEventsWithStatus({
      key: `calendar-target:${eventPath}:${historicalLoadRetryVersion}:${JSON.stringify(targetingFilters)}`,
      relays: $activeCommunityRelays,
      filters: targetingFilters,
      authenticate: true,
      timeout: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      signal: controller.signal,
      onStatus: status => {
        targetLoadStatus = status
        loadingTargeting = status === "queued" || status === "loading"
      },
    })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion

    if (
      !communityBootstrapReady ||
      $activeCommunityRelays.length === 0 ||
      replyFilters.length === 0
    ) {
      loadingReplies = false
      replyLoadStatus = "idle"
      return
    }

    const controller = new AbortController()

    loadingReplies = true
    replyLoadStatus = "queued"
    void hydrateCommunityEventsWithStatus({
      key: `calendar-replies:${eventPath}:${historicalLoadRetryVersion}:${JSON.stringify(replyFilters)}`,
      relays: $activeCommunityRelays,
      filters: replyFilters,
      authenticate: true,
      timeout: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      signal: controller.signal,
      onStatus: status => {
        replyLoadStatus = status
        loadingReplies = status === "queued" || status === "loading"
      },
    })

    return () => controller.abort()
  })

  $effect(() => {
    if (event) {
      loadingEvent = false
    }
    if (approvedEvent) {
      loadingTargeting = false
    }
    if (replies.length > 0) {
      loadingReplies = false
    }
  })

  const retryHistoricalLoad = () => {
    if (communityBootstrapFailed || communityPermissionEvidenceIncomplete) {
      window.location.reload()
      return
    }

    historicalLoadRetryVersion += 1
  }

  onDestroy(() => {
    setChecked(eventPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={calendarPath || "#"} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
    </div>
  {/snippet}
  {#snippet title()}
    <strong
      >{approvedEventCensorReason
        ? "Moderated event"
        : approvedEvent
          ? getTagValue("title", approvedEvent.tags) ||
            getTagValue("name", approvedEvent.tags) ||
            "Calendar event"
          : "Calendar event"}</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-3 p-2 pt-4">
  {#if approvedEvent}
    <article class="card2 bg-alt col-3 z-feature">
      {#if approvedEventCensorReason}
        <ModeratedContent reason={approvedEventCensorReason} />
      {:else}
        <div class="flex items-start gap-4">
          <CalendarEventDate event={approvedEvent} />
          <div class="flex min-w-0 flex-grow flex-col gap-1">
            <CalendarEventHeader event={approvedEvent} />
            <CalendarEventMeta event={approvedEvent} url={communityPubkey} />
            <CalendarEventDescription
              event={approvedEvent}
              url={communityPubkey}
              relays={$activeCommunityRelays}
              communitySectionName={approvedEventSectionName} />
          </div>
        </div>
        <div class="flex w-full flex-col justify-end sm:flex-row">
          <CalendarEventActions
            url={communityPubkey}
            relays={$activeCommunityRelays}
            scopeH={communityPubkey}
            communitySectionName={approvedEventSectionName}
            allowedAuthors={interactionAuthorPubkeys}
            readOnly={!canReact}
            redirectOnEdit
            event={approvedEvent} />
        </div>
      {/if}
    </article>

    {#if !approvedEventCensorReason && !showAllReplies && replies.length > visibleReplies.length}
      <div class="flex justify-center py-2">
        <button class="btn btn-link" type="button" onclick={() => (showAllReplies = true)}>
          Show all {replies.length} comments
        </button>
      </div>
    {/if}

    {#if !approvedEventCensorReason}
      <div class="col-2">
        {#each visibleReplies as item (item.id)}
          {@const replyParent = item.parentReplyId
            ? repliesById.get(item.parentReplyId)?.event
            : undefined}
          <div
            class="card2 bg-alt z-feature w-full shadow-sm"
            data-latest-reply={item.id === latestReplyId ? "true" : undefined}>
            <ChannelMessage
              url={communityPubkey}
              event={item.event}
              showPubkey
              readOnly={!canReact}
              interactionRelays={$activeCommunityRelays}
              profileRelays={$activeCommunityRelays}
              {interactionAuthorPubkeys}
              scopeH={communityPubkey}
              communitySectionName={commentSectionName}
              {replyParent}
              onReplyParentOpen={scrollToReplyParent}
              canEdit={canEditReply}
              onEdit={openEditPrompt}
              replyTo={canReply ? event => openCommentPrompt(event) : undefined} />
          </div>
        {:else}
          {#if loadingReplies}
            <p class="flex h-10 items-center justify-center py-20 text-center">
              <Spinner loading>Looking for comments...</Spinner>
            </p>
          {:else if replyLoadStatus === "incomplete" || replyLoadStatus === "failed"}
            <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
              <p>Comment history is incomplete or temporarily unavailable.</p>
              <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
                >Retry</button>
            </div>
          {:else if communityPermissionsLoading}
            <p class="flex h-10 items-center justify-center py-20 text-center">
              <Spinner loading>Loading comment permissions...</Spinner>
            </p>
          {:else}
            <p class="py-8 text-center opacity-70">No comments yet.</p>
          {/if}
        {/each}
      </div>
    {/if}

    {#if !approvedEventCensorReason && showReply}
      <div bind:this={composeElement} class="card2 bg-alt col-3 p-4 shadow-md">
        <div class="flex items-center justify-between gap-2">
          <strong>{parent ? "Reply" : "Comment"}</strong>
          <button class="btn btn-link btn-sm" type="button" onclick={closeCommentPrompt}>
            Cancel
          </button>
        </div>
        {#if parent}
          <RoomComposeParent event={parent} clear={clearParent} verb="Replying to" />
        {/if}
        {#if eventToEdit}
          <RoomComposeEdit clear={() => (eventToEdit = undefined)} />
        {/if}
        {#key eventToEdit}
          <RoomCompose
            url={$activeCommunityRelays[0] || communityPubkey}
            h={communityPubkey}
            blossomContext={{type: "community", communityPubkey}}
            showMenu={false}
            onSubmit={sendReply}
            onEscape={closeCommentPrompt}
            content={eventToEdit?.content}
            bind:this={compose} />
        {/key}
      </div>
    {:else if !approvedEventCensorReason}
      <div class="flex justify-end px-2 pb-2">
        {#if canReply}
          <button class="btn btn-primary" type="button" onclick={openReply}>
            <Icon icon={Reply} />
            Comment
          </button>
        {:else if communityBootstrapLoading || communityPermissionsLoading}
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner loading>Checking comment access...</Spinner>
          </div>
        {:else}
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="comment on events"
            class="btn btn-primary">
            <Icon icon={Reply} />
            Comment
          </PublishGate>
        {/if}
      </div>
    {/if}
  {:else if communityBootstrapLoading || communityPermissionsLoading || loadingEvent || eventLoadStatus === "queued" || eventLoadStatus === "loading" || (event && (loadingTargeting || targetLoadStatus === "idle" || targetLoadStatus === "queued" || targetLoadStatus === "loading")) || (!event && eventFilters.length > 0 && eventLoadStatus === "idle")}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading event...</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityPermissionEvidenceIncomplete || (!event && (eventLoadStatus === "incomplete" || eventLoadStatus === "failed")) || (event && !approvedEvent && (targetLoadStatus === "incomplete" || targetLoadStatus === "failed"))}
    <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
      <p>Event lookup is incomplete or temporarily unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else}
    <p class="py-8 text-center opacity-70">Event not found or not approved for this community.</p>
  {/if}
</PageContent>
