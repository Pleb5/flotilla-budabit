<script lang="ts">
  import {onDestroy} from "svelte"
  import {readable, type Readable} from "svelte/store"
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {formatTimestampAsDate, last, now} from "@welshman/lib"
  import {matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
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
    activeCommunityDescriptor,
    activeExactCommunitySession,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeCommunityProfileListEvents,
    activeExactCommunityRelays,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
    getCommunityBootstrapKey,
    hasCommunityHydrationCompleted,
    markCommunityHydrationCompleted,
    recoverCommunityBootstrap,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {
    CALENDAR_EVENT_KINDS,
    getCalendarEventRange,
    isCalendarEventKind,
  } from "@app/core/calendar-events"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilterPlan,
    makeTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_CALENDAR_WRITE_TARGETS,
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    filterAuthorizedCommunityTargetingEvents,
    filterAuthorizedLegacyCommunityTargetingEvents,
    getCommunityCalendarTargetWriterPubkeys,
    getCommunityCalendarWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {
    makeLegacyCommunityTargetingFilter,
    makeLegacyTargetedPublicationOriginalFilterPlan,
    makeLegacyTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-targeting-legacy"
  import {loadBoundedCommunityHistory, makeCalendarFeed} from "@app/core/requests"
  import {publicationOperations} from "@app/core/publication-operations"
  import {projectAuthoredPublicationEvents} from "@app/core/authored-publication-operations"
  import {makeCommunityTargetedPublicationSemanticKey} from "@app/core/community-targeting"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {setChecked} from "@app/util/notifications"
  import {makeExactCommunityCalendarPath, parseExactCommunityRouteParam} from "@app/util/routes"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  type CalendarItem = {
    event: TrustedEvent
    dateDisplay?: string
    isFirstFutureEvent?: boolean
  }

  let element: HTMLElement | undefined = $state()
  let loadingTargets = $state(false)
  let targetLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingHintedOriginals = $state(false)
  let hintedOriginalLoadStatus = $state<CommunityHydrationStatus>("idle")
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
  let retryingCommunityAccess = $state(false)

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityOwnerPubkey = $derived(routeCommunity?.ownerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const expectedCommunityBootstrapKey = $derived.by(() => {
    const session = $activeExactCommunitySession

    return communityAddress && $activeExactCommunityPointer?.address === communityAddress && session
      ? getCommunityBootstrapKey(session, $pubkey || "")
      : ""
  })
  const calendarPath = $derived(
    routeCommunity ? makeExactCommunityCalendarPath(routeCommunity) : $page.url.pathname,
  )
  const createPath = $derived(
    routeCommunity ? makeExactCommunityCalendarPath(routeCommunity, "create") : "",
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityAddress &&
      communityDefinition &&
      expectedCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.key === expectedCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading &&
      !$activeCommunityBootstrapStatus.error,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(
      communityAddress &&
      !communityBootstrapReady &&
      ($activeCommunityBootstrapStatus.key !== expectedCommunityBootstrapKey ||
        !$activeCommunityBootstrapStatus.error),
    ),
  )
  const communityAuthorityReadiness = $derived(
    $activeExactCommunityPointer?.address === communityAddress &&
      $activeCommunityDescriptor?.community.address === communityAddress
      ? $activeCommunityDescriptor.authorityReadiness.state
      : "loading",
  )
  const communityAuthorityLoading = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "loading",
  )
  const communityAuthorityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const communityAuthorityUnavailable = $derived(communityAuthorityReadiness === "unavailable")
  const communityBootstrapFailed = $derived(
    Boolean(
      communityAddress &&
      expectedCommunityBootstrapKey &&
      $activeCommunityBootstrapStatus.key === expectedCommunityBootstrapKey &&
      !communityBootstrapReady &&
      $activeCommunityBootstrapStatus.error,
    ),
  )
  const getCalendarEventSectionName = (_kind: number) =>
    getCommunityCalendarWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
    )
  const calendarWriterPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityCalendarTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const targetingFilterPlan = $derived.by(() => {
    const relayFilters: Filter[] = []
    const localFilters: Filter[] = []
    if (!communityAuthorityReady || !routeCommunity) return {relayFilters, localFilters}

    for (const target of COMMUNITY_CALENDAR_WRITE_TARGETS) {
      const plan = makeCommunityContentFilterPlan(
        [
          makeCommunityTargetingFilter(communityId, [target.kind]),
          ...(communityOwnerPubkey === communityId
            ? [makeLegacyCommunityTargetingFilter(communityId, [target.kind])]
            : []),
        ],
        calendarWriterPubkeys,
      )
      relayFilters.push(...plan.relayFilters)
      localFilters.push(...plan.localFilters)
    }

    return {relayFilters, localFilters}
  })
  const targetingFilters = $derived(targetingFilterPlan.localFilters)
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const authorizedTargetingEvents = $derived.by(() =>
    communityAuthorityReady && communityDefinition && routeCommunity
      ? filterAuthorizedCommunityTargetingEvents({
          community: routeCommunity,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: CALENDAR_EVENT_KINDS,
        })
      : [],
  )
  const authorizedLegacyTargetingEvents = $derived.by(() =>
    communityAuthorityReady && communityDefinition && routeCommunity
      ? filterAuthorizedLegacyCommunityTargetingEvents({
          community: routeCommunity,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: CALENDAR_EVENT_KINDS,
        })
      : [],
  )
  const commentAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.comment,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reactionAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.reaction,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reportAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.report,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const targetedOriginalFilterPlan = $derived.by(() => {
    const current = makeTargetedPublicationOriginalFilterPlan(authorizedTargetingEvents)
    const legacy = makeLegacyTargetedPublicationOriginalFilterPlan(authorizedLegacyTargetingEvents)

    return {
      relayFilters: [...current.relayFilters, ...legacy.relayFilters],
      localFilters: [...current.localFilters, ...legacy.localFilters],
    }
  })
  const targetedOriginalRelayHintPlans = $derived([
    ...makeTargetedPublicationOriginalRelayHintPlans(authorizedTargetingEvents),
    ...makeLegacyTargetedPublicationOriginalRelayHintPlans(authorizedLegacyTargetingEvents),
  ])
  const targetedOriginalEvents = $derived(
    targetedOriginalFilterPlan.localFilters.length
      ? deriveEventsAsc(
          deriveEventsById({repository, filters: targetedOriginalFilterPlan.localFilters}),
        )
      : readable<TrustedEvent[]>([]),
  )
  const directCalendarFilterPlan = $derived.by(() => {
    const relayFilters: Filter[] = []
    const localFilters: Filter[] = []
    if (!communityAuthorityReady || !communityId) return {relayFilters, localFilters}

    for (const target of COMMUNITY_CALENDAR_WRITE_TARGETS) {
      const plan = makeCommunityContentFilterPlan(
        [{kinds: [target.kind], "#h": [communityId]}],
        calendarWriterPubkeys,
      )
      relayFilters.push(...plan.relayFilters)
      localFilters.push(...plan.localFilters)
    }

    return {relayFilters, localFilters}
  })
  const calendarFeedFilters = $derived([
    ...directCalendarFilterPlan.localFilters,
    ...targetedOriginalFilterPlan.localFilters,
  ] as Filter[])
  const calendarFeedRelayFilters = $derived([
    ...directCalendarFilterPlan.relayFilters,
    ...targetedOriginalFilterPlan.relayFilters,
  ] as Filter[])
  const repositoryCalendarEvents = $derived(
    calendarFeedFilters.length
      ? deriveEventsAsc(deriveEventsById({repository, filters: calendarFeedFilters}))
      : readable<TrustedEvent[]>([]),
  )
  const feedKey = $derived.by(() =>
    communityAuthorityReady &&
    communityAddress &&
    calendarFeedFilters.length &&
    $activeExactCommunityRelays.length
      ? [
          communityAddress,
          ...$activeExactCommunityRelays,
          JSON.stringify(calendarFeedFilters),
          ...authorizedTargetingEvents.map(event => event.id),
        ].join("|")
      : "",
  )
  const waitingForFeed = $derived(Boolean(feedKey && !feedInitialized))
  const canReact = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
      $activeExactCommunityRelays.length > 0 &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
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

  const calendarProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: Array.from(
        new Map(
          [...$repositoryCalendarEvents, ...$events, ...$targetedOriginalEvents].map(event => [
            event.id,
            event,
          ]),
        ).values(),
      ),
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event => isCalendarEventKind(event.kind) && matchFilters(calendarFeedFilters, event),
      matchesOperation: (event, operation) =>
        isCalendarEventKind(event.kind) &&
        operation.semanticKey ===
          makeCommunityTargetedPublicationSemanticKey(communityAddress, event.kind),
    }),
  )
  const projectedCalendarEvents = $derived.by(() =>
    calendarProjection.events.toSorted(
      (a, b) =>
        (getCalendarEventRange(a)?.start ?? Number.POSITIVE_INFINITY) -
        (getCalendarEventRange(b)?.start ?? Number.POSITIVE_INFINITY),
    ),
  )
  const items = $derived.by(() => {
    let haveSeenFutureEvent = false
    let previousDateDisplay: string | undefined

    return projectedCalendarEvents
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
    if (
      !element ||
      !key ||
      calendarFeedFilters.length === 0 ||
      calendarFeedRelayFilters.length === 0 ||
      $activeExactCommunityRelays.length === 0
    )
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
      relays: $activeExactCommunityRelays,
      filters: calendarFeedFilters,
      relayFilters: calendarFeedRelayFilters,
      onInitialLoad: ({complete}) => {
        if (complete) markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = complete ? "complete" : "incomplete"
      },
      onIncomplete: () => {
        feedLoadStatus = "incomplete"
      },
      onExhausted: () => {
        if (feedLoadStatus !== "incomplete") markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        if (feedLoadStatus !== "incomplete") feedLoadStatus = "complete"
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
    const relays = $activeExactCommunityRelays
    const relayFilters = targetingFilterPlan.relayFilters
    const localFilters = targetingFilterPlan.localFilters

    if (!communityBootstrapReady || !communityId) {
      loadingTargets = false
      targetLoadStatus = "idle"
      emptyStateSettled = false
      clearEmptyStateSettleTimer()
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      loadingTargets = false
      targetLoadStatus = "complete"
      return
    }
    if (relays.length === 0) {
      loadingTargets = false
      targetLoadStatus = "incomplete"
      return
    }

    const controller = new AbortController()

    loadingTargets = true
    targetLoadStatus = "loading"
    startEmptyStateSettleTimer()
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      timeoutMs: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-calendar-targets:${communityAddress}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        targetLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-calendar] Failed to load targeting history", error)
        targetLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingTargets = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const plans = targetedOriginalRelayHintPlans

    if (!communityBootstrapReady) {
      loadingHintedOriginals = false
      hintedOriginalLoadStatus = "idle"
      return
    }
    if (plans.length === 0) {
      loadingHintedOriginals = false
      hintedOriginalLoadStatus = "complete"
      return
    }

    const controller = new AbortController()
    loadingHintedOriginals = true
    hintedOriginalLoadStatus = "loading"
    void Promise.all(
      plans.map(plan =>
        loadBoundedCommunityHistory({
          ...plan,
          timeoutMs: REQUEST_HARD_TIMEOUT_MS,
          priority: RELAY_REQUEST_PRIORITY.interactive,
          owner: `community-calendar-target-originals:${communityAddress}`,
          signal: controller.signal,
        }),
      ),
    )
      .then(results => {
        if (controller.signal.aborted) return
        hintedOriginalLoadStatus = results.every(result => result.complete)
          ? "complete"
          : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-calendar] Failed to load hinted event originals", error)
        hintedOriginalLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingHintedOriginals = false
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

  const retryHistoricalLoad = async () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      if (!routeCommunity || retryingCommunityAccess) return

      retryingCommunityAccess = true
      try {
        const session = $activeExactCommunitySession
        if (!session || $activeExactCommunityPointer?.address !== routeCommunity.address) return
        await recoverCommunityBootstrap(session, {recoverAuth: true})
      } catch (error) {
        console.warn("[community-calendar] Failed to recover community access", error)
      } finally {
        retryingCommunityAccess = false
      }
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
      <CommunityMenuButton community={routeCommunity?.naddr} />
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
        url={communityId}
        community={routeCommunity}
        relays={$activeExactCommunityRelays}
        publishRelays={$activeExactCommunityPublishRelays}
        reactionRelays={$activeExactCommunityPublishRelays}
        scopeH={communityId}
        communitySectionName={getCalendarEventSectionName(event.kind)}
        allowedAuthors={commentAuthorPubkeys}
        reactionAllowedAuthors={reactionAuthorPubkeys}
        reportAllowedAuthors={reportAuthorPubkeys}
        readOnly={!canReact}
        operationId={calendarProjection.operationIds.get(event.id)}
        {event} />
    </div>
  {/each}
  {#if communityBootstrapLoading || communityAuthorityLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading Events</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityAuthorityUnavailable}
    <div class="flex flex-col items-center gap-3 py-20 text-center">
      <p>Calendar unavailable.</p>
      <button
        class="btn btn-neutral btn-sm"
        type="button"
        disabled={retryingCommunityAccess}
        onclick={retryHistoricalLoad}>{retryingCommunityAccess ? "Retrying..." : "Retry"}</button>
    </div>
  {:else if loadingTargets || loadingHintedOriginals || waitingForFeed || loadingEvents || (!emptyStateSettled && items.length === 0 && targetLoadStatus !== "incomplete" && targetLoadStatus !== "failed" && hintedOriginalLoadStatus !== "incomplete" && hintedOriginalLoadStatus !== "failed" && feedLoadStatus !== "incomplete" && feedLoadStatus !== "failed") || (targetLoadStatus === "idle" && items.length === 0)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading Events</Spinner>
    </p>
  {:else if items.length === 0}
    <p class="flex h-10 items-center justify-center py-20 text-center">No events found.</p>
  {:else if exhaustedEvents}
    <p class="flex h-10 items-center justify-center py-20 text-center">That's all!</p>
  {/if}
</PageContent>
