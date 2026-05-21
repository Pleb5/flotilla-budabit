<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {sortBy} from "@welshman/lib"
  import {COMMENT, EVENT_TIME, getTagValue, type EventContent, type Filter} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Content from "@app/components/Content.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import CalendarEventActions from "@app/components/CalendarEventActions.svelte"
  import CalendarEventDescription from "@app/components/CalendarEventDescription.svelte"
  import CalendarEventHeader from "@app/components/CalendarEventHeader.svelte"
  import CalendarEventMeta from "@app/components/CalendarEventMeta.svelte"
  import CalendarEventDate from "@app/components/CalendarEventDate.svelte"
  import {publishComment} from "@app/core/commands"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {
    COMMUNITY_SECTION_CALENDAR,
    COMMUNITY_SECTION_GENERAL,
    normalizePubkey,
    parseTargetedPublication,
  } from "@app/core/community"
  import {makeCommunityTargetingFilter} from "@app/core/community-feeds"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {getCommunityCensorReason, isCommunityPersonBanned} from "@app/core/community-reports"
  import {
    getCommunityDeleteSeenKey,
    getCommunityDeleteSince,
    hydrateCommunityDeleteEvents,
    normalizeDeleteCheckpoint,
  } from "@app/core/community-deletes"
  import {checked, setChecked, setCheckedAt} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const eventParam = $derived($page.params.event || "")
  const calendarPath = $derived(
    communityPubkey ? makeCommunityPath(communityPubkey, "calendar") : "",
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
  const calendarAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_CALENDAR,
        })
      : [],
  )
  const interactionAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_GENERAL,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const isEventIdParam = $derived(/^[0-9a-f]{64}$/i.test(eventParam))
  const eventFilters = $derived<Filter[]>(
    communityBootstrapReady && eventParam && calendarAuthorPubkeys.length
      ? [
          ...(isEventIdParam
            ? [{kinds: [EVENT_TIME], ids: [eventParam], authors: calendarAuthorPubkeys}]
            : []),
          {kinds: [EVENT_TIME], "#d": [eventParam], authors: calendarAuthorPubkeys},
        ]
      : [],
  )
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
            [EVENT_TIME],
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
      if (!targeting || targeting.kind !== EVENT_TIME) return false
      if (eventTargetingId && targeting.id === eventTargetingId) return true
      if (targeting.ref?.type === "e" && targeting.ref.value === event.id) return true
      if (targeting.ref?.type === "a" && targeting.ref.value === eventAddress) return true

      return false
    })
  })
  const approvedEvent = $derived(event && isTargetedToCommunity ? event : undefined)
  const approvedEventCensorReason = $derived.by(() =>
    approvedEvent
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: approvedEvent.id,
          pubkey: approvedEvent.pubkey,
          sectionName: COMMUNITY_SECTION_CALENDAR,
        })
      : undefined,
  )
  const replyFilters = $derived<Filter[]>(
    communityBootstrapReady && approvedEvent && !approvedEventCensorReason && interactionAuthorPubkeys.length
      ? [
          {
            kinds: [COMMENT],
            "#E": [approvedEvent.id],
            "#K": [String(EVENT_TIME)],
            "#h": [communityPubkey],
            authors: interactionAuthorPubkeys,
          },
          ...(eventAddress
            ? [
                {
                  kinds: [COMMENT],
                  "#A": [eventAddress],
                  "#K": [String(EVENT_TIME)],
                  "#h": [communityPubkey],
                  authors: interactionAuthorPubkeys,
                },
                {
                  kinds: [COMMENT],
                  "#a": [eventAddress],
                  "#K": [String(EVENT_TIME)],
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
  const replyEvents = $derived(
    sortBy(
      replyEvent => replyEvent.created_at,
      $replyEventsStore.filter(
        event => !isCommunityPersonBanned($activeCommunityReportState, event.pubkey),
      ),
    ),
  )

  let showAllReplies = $state(false)

  const visibleReplyEvents = $derived(
    showAllReplies ? replyEvents : replyEvents.slice(Math.max(replyEvents.length - 4, 0)),
  )

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

  const sendReply = ({content, tags}: EventContent) => {
    const trimmed = content.trim()
    if (!approvedEvent || !trimmed) return
    if (!canReply) {
      pushToast({theme: "error", message: "You do not have permission to comment."})
      return
    }
    if ($activeCommunityRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    publishComment({
      relays: $activeCommunityRelays,
      event: approvedEvent,
      content: trimmed,
      tags: [["h", communityPubkey], ...(tags || [])],
    })
    showReply = false
  }

  const openReply = async () => {
    showReply = true
    await tick()
    composeElement?.scrollIntoView({behavior: "smooth", block: "end"})
  }

  let loadingEvent = $state(false)
  let eventRequestDone = $state(false)
  let loadingTargeting = $state(false)
  let targetRequestDone = $state(false)
  let showReply = $state(false)
  let composeElement: HTMLElement | undefined = $state()
  let deleteLoadKey = ""
  let latestDeleteSeen = 0
  const deleteSeenKey = $derived(getCommunityDeleteSeenKey(communityPubkey))
  const lastDeleteSeen = $derived(
    deleteSeenKey ? normalizeDeleteCheckpoint($checked[deleteSeenKey] || 0) : 0,
  )

  $effect(() => {
    if (!communityPubkey || !event || !isEventIdParam) return

    const identifier = getTagValue("d", event.tags)
    if (!identifier || identifier === eventParam) return

    goto(makeCommunityPath(communityPubkey, "calendar", identifier), {replaceState: true})
  })

  $effect(() => {
    const relays = $activeCommunityRelays
    if (!communityBootstrapReady || !communityPubkey || relays.length === 0) return

    const since = getCommunityDeleteSince(lastDeleteSeen)
    const key = `${communityPubkey}::${relays.slice().sort().join("|")}::${since}`
    if (deleteLoadKey === key) return
    deleteLoadKey = key

    const controller = new AbortController()
    void hydrateCommunityDeleteEvents({
      relays,
      kinds: [EVENT_TIME, COMMENT],
      since,
      signal: controller.signal,
    }).then(latest => {
      if (latest > latestDeleteSeen) latestDeleteSeen = latest
    })

    return () => controller.abort()
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0 || eventFilters.length === 0) {
      loadingEvent = false
      eventRequestDone = false
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      loadingEvent = false
      eventRequestDone = true
    }, 3000)

    loadingEvent = true
    eventRequestDone = false
    request({relays: $activeCommunityRelays, autoClose: true, filters: eventFilters, signal: controller.signal})
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout)
        if (controller.signal.aborted) return

        loadingEvent = false
        eventRequestDone = true
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0 || targetingFilters.length === 0) {
      loadingTargeting = false
      targetRequestDone = false
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      loadingTargeting = false
      targetRequestDone = true
    }, 3000)

    loadingTargeting = true
    targetRequestDone = false
    request({relays: $activeCommunityRelays, autoClose: true, filters: targetingFilters, signal: controller.signal})
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout)
        if (controller.signal.aborted) return

        loadingTargeting = false
        targetRequestDone = true
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0 || replyFilters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, autoClose: true, filters: replyFilters, signal: controller.signal})

    return () => controller.abort()
  })

  onDestroy(() => {
    if (deleteSeenKey) {
      setCheckedAt(deleteSeenKey, Math.max(lastDeleteSeen, latestDeleteSeen))
    }
    setChecked($page.url.pathname)
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
              communitySectionName={COMMUNITY_SECTION_CALENDAR} />
          </div>
        </div>
        <div class="flex w-full flex-col justify-end sm:flex-row">
          <CalendarEventActions
            url={communityPubkey}
            relays={$activeCommunityRelays}
            scopeH={communityPubkey}
            communitySectionName={COMMUNITY_SECTION_CALENDAR}
            allowedAuthors={interactionAuthorPubkeys}
            readOnly={!canReact}
            redirectOnEdit
            event={approvedEvent} />
        </div>
      {/if}
    </article>

    {#if !approvedEventCensorReason && !showAllReplies && replyEvents.length > visibleReplyEvents.length}
      <div class="flex justify-center py-2">
        <button class="btn btn-link" type="button" onclick={() => (showAllReplies = true)}>
          Show all {replyEvents.length} comments
        </button>
      </div>
    {/if}

    {#if !approvedEventCensorReason}
      <div class="col-2">
        {#each visibleReplyEvents as replyEvent (replyEvent.id)}
          {@const censorReason = getCommunityCensorReason({
            reportState: $activeCommunityReportState,
            eventId: replyEvent.id,
            pubkey: replyEvent.pubkey,
            sectionName: COMMUNITY_SECTION_GENERAL,
          })}
          {#if censorReason}
            <div class="card2 bg-alt z-feature w-full">
              <ModeratedContent reason={censorReason} />
            </div>
          {:else}
            <NoteCard
              event={replyEvent}
              url={communityPubkey}
              class="card2 bg-alt z-feature w-full">
              <div class="col-3 ml-12">
                <Content
                  showEntire
                  event={replyEvent}
                  url={communityPubkey}
                  communitySectionName={COMMUNITY_SECTION_GENERAL} />
              </div>
            </NoteCard>
          {/if}
        {:else}
          <p class="py-8 text-center opacity-70">No comments yet.</p>
        {/each}
      </div>
    {/if}

    {#if !approvedEventCensorReason && showReply}
      <div bind:this={composeElement} class="card2 bg-alt col-3 p-4 shadow-md">
        <div class="flex items-center justify-between gap-2">
          <strong>Comment</strong>
          <button class="btn btn-link btn-sm" type="button" onclick={() => (showReply = false)}>
            Cancel
          </button>
        </div>
        <RoomCompose
          url={$activeCommunityRelays[0] || communityPubkey}
          h={communityPubkey}
          blossomContext={{type: "community", communityPubkey}}
          showMenu={false}
          onSubmit={sendReply} />
      </div>
    {:else if !approvedEventCensorReason}
      <div class="flex justify-end px-2 pb-2">
        {#if canReply}
          <button class="btn btn-primary" type="button" onclick={openReply}>
            <Icon icon={Reply} />
            Leave comment
          </button>
        {:else if communityBootstrapLoading}
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner loading>Checking comment access...</Spinner>
          </div>
        {:else}
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="comment on events"
            class="btn btn-primary">
            <Icon icon={Reply} />
            Leave comment
          </PublishGate>
        {/if}
      </div>
    {/if}
  {:else if communityBootstrapLoading || loadingEvent || (event && (loadingTargeting || !targetRequestDone)) || (!event && !eventRequestDone)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading event...</Spinner>
    </p>
  {:else}
    <p class="py-8 text-center opacity-70">Event not found or not approved for this community.</p>
  {/if}
</PageContent>
