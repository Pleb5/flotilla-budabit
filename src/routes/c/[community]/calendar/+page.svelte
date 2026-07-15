<script lang="ts">
  import {onDestroy} from "svelte"
  import {readable, type Readable} from "svelte/store"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, repository, tracker} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {formatTimestampAsDate, last, now} from "@welshman/lib"
  import {type Filter, type TrustedEvent} from "@welshman/util"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import CalendarAdd from "@assets/icons/calendar-add.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import CalendarEventItem from "@app/components/CalendarEventItem.svelte"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityPermissionStatus,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    hasCommunityHydrationCompleted,
    hydrateCommunityEventsWithStatus,
    markCommunityHydrationCompleted,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {normalizePubkey, parseTargetedPublication} from "@app/core/community"
  import {
    CALENDAR_EVENT_KINDS,
    getCalendarEventRange,
    isCalendarEventKind,
  } from "@app/core/calendar-events"
  import {
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilters,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_CALENDAR_WRITE_TARGETS,
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityCalendarTargetWriterPubkeys,
    getCommunityCalendarWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {makeCalendarFeed} from "@app/core/requests"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {setChecked} from "@app/util/notifications"
  import {makeCommunityCalendarPath, parseCommunityRouteParam} from "@app/util/routes"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  type CalendarItem = {
    event: TrustedEvent
    dateDisplay?: string
    isFirstFutureEvent?: boolean
  }

  let element: HTMLElement | undefined = $state()
  let loadingTargets = $state(false)
  let targetLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingEvents = $state(false)
  let feedLoadStatus = $state<CommunityHydrationStatus>("idle")
  let emptyStateSettled = $state(false)
  let exhaustedEvents = $state(false)
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let emptyStateSettleTimer: ReturnType<typeof setTimeout> | undefined
  let lastFeedKey = ""
  let previousScrollHeight = 0
  let previousFirstEventId = ""
  let initialScrollDone = false
  let historicalLoadRetryVersion = $state(0)

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const calendarPath = $derived(
    communityPubkey ? makeCommunityCalendarPath(communityPubkey) : $page.url.pathname,
  )
  const createPath = $derived(
    communityPubkey ? makeCommunityCalendarPath(communityPubkey, "create") : "",
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
  const getCalendarEventSectionName = (_kind: number) =>
    getCommunityCalendarWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
    )
  const targetingFilters = $derived(
    communityBootstrapReady && communityPubkey
      ? [makeCommunityTargetingFilter(communityPubkey, CALENDAR_EVENT_KINDS)]
      : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
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
  const targetingIdsByKind = $derived.by(() => {
    const idsByKind = new Map<number, string[]>()
    const allowedAuthors = new Set(calendarAuthorPubkeys.map(normalizePubkey).filter(Boolean))

    for (const event of $targetingEvents) {
      const targeting = parseTargetedPublication(event)
      if (!targeting || !isCalendarEventKind(targeting.kind)) continue

      if (targeting.ref?.type === "a") {
        const [, author] = targeting.ref.value.split(":")
        if (!allowedAuthors.has(normalizePubkey(author || ""))) continue
      }

      if (!targeting.id) continue
      idsByKind.set(targeting.kind, [...(idsByKind.get(targeting.kind) || []), targeting.id])
    }

    return idsByKind
  })
  const targetedOriginalFilters = $derived.by<Filter[]>(() => {
    if (!communityBootstrapReady || calendarAuthorPubkeys.length === 0) return []

    return makeTargetedPublicationOriginalFilters(
      $targetingEvents.filter(event => {
        const targeting = parseTargetedPublication(event)

        return Boolean(targeting && isCalendarEventKind(targeting.kind))
      }),
      calendarAuthorPubkeys,
    )
  })
  const calendarFeedFilters = $derived.by<Filter[]>(() => {
    const filters: Filter[] = [...targetedOriginalFilters]

    for (const target of COMMUNITY_CALENDAR_WRITE_TARGETS) {
      const targetingIds = targetingIdsByKind.get(target.kind) || []

      if (targetingIds.length > 0 && calendarAuthorPubkeys.length > 0) {
        filters.unshift({kinds: [target.kind], authors: calendarAuthorPubkeys, "#h": targetingIds})
      }
    }

    return filters
  })
  const feedKey = $derived.by(() =>
    communityBootstrapReady &&
    communityPubkey &&
    calendarFeedFilters.length &&
    $activeCommunityRelays.length
      ? [
          communityPubkey,
          ...$activeCommunityRelays,
          ...calendarAuthorPubkeys,
          ...$targetingEvents.map(event => event.id),
        ].join("|")
      : "",
  )
  const waitingForFeed = $derived(Boolean(feedKey && !feedInitialized))
  const canReact = $derived(
    Boolean(
      $pubkey &&
      communityBootstrapReady &&
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

  const getRange = (event: TrustedEvent) => getCalendarEventRange(event)
  const isActiveOrFutureEvent = (event: TrustedEvent) => {
    const range = getRange(event)

    return Boolean(range && (range.end ?? range.start) >= now())
  }

  const items = $derived.by(() => {
    let haveSeenFutureEvent = false
    let previousDateDisplay: string | undefined

    return $events
      .filter(event => !isCommunityPersonBanned($activeCommunityReportState, event.pubkey))
      .filter(event => Boolean(getRange(event)))
      .map<CalendarItem>(event => {
        const range = getRange(event)!
        const dateDisplayValue = formatTimestampAsDate(range.start)
        const dateDisplay = previousDateDisplay === dateDisplayValue ? undefined : dateDisplayValue
        const isFutureEvent = isActiveOrFutureEvent(event)
        const isFirstFutureEvent = !haveSeenFutureEvent && isFutureEvent

        previousDateDisplay = dateDisplayValue
        if (isFutureEvent) haveSeenFutureEvent = true

        return {event, dateDisplay, isFirstFutureEvent}
      })
  })

  const clearEmptyStateSettleTimer = () => {
    if (!emptyStateSettleTimer) return

    clearTimeout(emptyStateSettleTimer)
    emptyStateSettleTimer = undefined
  }

  const startEmptyStateSettleTimer = () => {
    clearEmptyStateSettleTimer()
    emptyStateSettled = false
    emptyStateSettleTimer = setTimeout(() => {
      emptyStateSettleTimer = undefined
      emptyStateSettled = true
    }, REQUEST_HARD_TIMEOUT_MS)
  }

  const resetFeed = () => {
    feedCleanup?.()
    feedCleanup = undefined
    events = readable([])
    loadingEvents = false
    feedLoadStatus = "idle"
    emptyStateSettled = false
    exhaustedEvents = false
    feedInitialized = false
    lastFeedKey = ""
    previousScrollHeight = 0
    previousFirstEventId = ""
    initialScrollDone = false
  }

  const startFeed = (key: string) => {
    if (!element || !key || calendarFeedFilters.length === 0 || $activeCommunityRelays.length === 0)
      return

    const hydrationKey = `calendar:feed:${key}`

    loadingEvents = !hasCommunityHydrationCompleted(hydrationKey)
    feedLoadStatus = "loading"
    startEmptyStateSettleTimer()
    exhaustedEvents = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeCalendarFeed({
      element,
      relays: $activeCommunityRelays,
      filters: calendarFeedFilters,
      onInitialLoad: ({complete, timedOut}) => {
        if (complete) markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = complete ? "complete" : timedOut ? "incomplete" : "failed"
      },
      onExhausted: () => {
        markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = "complete"
        emptyStateSettled = true
        clearEmptyStateSettleTimer()
        exhaustedEvents = true
      },
    })

    events = feed.events
    feedCleanup = feed.cleanup
  }

  $effect(() => {
    void historicalLoadRetryVersion

    if (
      !communityBootstrapReady ||
      !communityPubkey ||
      $activeCommunityRelays.length === 0 ||
      targetingFilters.length === 0
    ) {
      loadingTargets = false
      targetLoadStatus = "idle"
      emptyStateSettled = false
      clearEmptyStateSettleTimer()
      return
    }

    const controller = new AbortController()
    const key = JSON.stringify({
      scope: "calendar-targets",
      relays: $activeCommunityRelays,
      filters: targetingFilters,
    })

    if (hasCommunityHydrationCompleted(key)) {
      loadingTargets = false
      targetLoadStatus = "complete"
      return
    }

    loadingTargets = true
    targetLoadStatus = "queued"
    startEmptyStateSettleTimer()
    void hydrateCommunityEventsWithStatus({
      key,
      relays: $activeCommunityRelays,
      filters: targetingFilters,
      authenticate: true,
      timeout: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      signal: controller.signal,
      onStatus: status => {
        targetLoadStatus = status
        loadingTargets = status === "queued" || status === "loading"
      },
    })

    return () => controller.abort()
  })

  $effect(() => {
    if (
      !communityBootstrapReady ||
      $activeCommunityRelays.length === 0 ||
      targetedOriginalFilters.length === 0
    )
      return

    const controller = new AbortController()
    request({
      relays: $activeCommunityRelays,
      autoClose: true,
      lifetime: "finite",
      priority: RELAY_REQUEST_PRIORITY.interactive,
      filters: targetedOriginalFilters,
      signal: controller.signal,
      onEvent: (event, relay) => {
        tracker.addRelay(event.id, relay)
        repository.publish(event)
      },
    })

    return () => controller.abort()
  })

  $effect(() => {
    const key = feedKey

    if (!key || !element) {
      resetFeed()
      return
    }

    if (!feedInitialized || key !== lastFeedKey) {
      resetFeed()
      startFeed(key)
    }
  })

  const retryHistoricalLoad = () => {
    if (communityBootstrapFailed || communityPermissionEvidenceIncomplete) {
      window.location.reload()
      return
    }

    historicalLoadRetryVersion += 1
    resetFeed()
  }

  $effect(() => {
    if (items.length === 0) return

    emptyStateSettled = true
    clearEmptyStateSettleTimer()
  })

  $effect(() => {
    if (!element || items.length === 0) return

    requestAnimationFrame(() => {
      if (!element || items.length === 0) return

      if (initialScrollDone) {
        if (previousFirstEventId && items[0].event.id !== previousFirstEventId) {
          const delta = element.scrollHeight - previousScrollHeight

          if (delta > 0) element.scrollTop += delta
        }
      } else {
        const firstFutureItem = items.find(({event}) => isActiveOrFutureEvent(event)) || last(items)
        const eventElement = firstFutureItem
          ? (document.querySelector(`.calendar-event-${firstFutureItem.event.id}`) as HTMLElement)
          : undefined

        if (eventElement) {
          element.scrollTop =
            eventElement.offsetTop - element.clientHeight / 2 + eventElement.clientHeight / 2
        }

        initialScrollDone = true
      }

      previousScrollHeight = element.scrollHeight
      previousFirstEventId = items[0].event.id
    })
  })

  onDestroy(() => {
    resetFeed()
    clearEmptyStateSettleTimer()
    setChecked(calendarPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={CalendarMinimalistic} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Calendar</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.calendar}
        alternateTargets={COMMUNITY_CALENDAR_WRITE_TARGETS}
        action="publish calendar events"
        href={createPath}
        class="btn btn-primary btn-sm">
        <Icon icon={CalendarAdd} />
        Create
      </PublishGate>
      <CommunityMenuButton community={communityPubkey} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-col gap-2 p-2 pt-4">
  {#each items as { event, dateDisplay, isFirstFutureEvent } (event.id)}
    <div class={"calendar-event-" + event.id}>
      {#if isFirstFutureEvent}
        <div class="flex items-center gap-2 p-2">
          <div class="h-px flex-grow bg-primary"></div>
          <p class="text-xs uppercase text-primary">Today</p>
          <div class="h-px flex-grow bg-primary"></div>
        </div>
      {/if}
      {#if dateDisplay}
        <Divider>{dateDisplay}</Divider>
      {/if}
      <CalendarEventItem
        url={communityPubkey}
        relays={$activeCommunityRelays}
        scopeH={communityPubkey}
        activityLiveCovered
        communitySectionName={getCalendarEventSectionName(event.kind)}
        allowedAuthors={interactionAuthorPubkeys}
        readOnly={!canReact}
        {event} />
    </div>
  {/each}
  {#if communityBootstrapLoading || communityPermissionsLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading community permissions...</Spinner>
    </p>
  {:else if items.length === 0 && (communityBootstrapFailed || communityPermissionEvidenceIncomplete)}
    <div class="flex flex-col items-center gap-3 py-20 text-center">
      <p>Community permissions are incomplete or temporarily unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else if loadingTargets || waitingForFeed || loadingEvents || (!emptyStateSettled && items.length === 0 && targetLoadStatus !== "incomplete" && targetLoadStatus !== "failed" && feedLoadStatus !== "incomplete" && feedLoadStatus !== "failed") || (targetLoadStatus === "idle" && items.length === 0)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading
        >{!emptyStateSettled && !loadingTargets && !waitingForFeed && !loadingEvents
          ? "Still looking for events..."
          : "Looking for events..."}</Spinner>
    </p>
  {:else if items.length === 0 && (targetLoadStatus === "incomplete" || targetLoadStatus === "failed" || feedLoadStatus === "incomplete" || feedLoadStatus === "failed")}
    <div class="flex flex-col items-center gap-3 py-20 text-center">
      <p>Event history is incomplete or temporarily unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else if items.length === 0}
    <p class="flex h-10 items-center justify-center py-20 text-center">No events found.</p>
  {:else if exhaustedEvents}
    <p class="flex h-10 items-center justify-center py-20 text-center">That's all!</p>
  {/if}
</PageContent>
