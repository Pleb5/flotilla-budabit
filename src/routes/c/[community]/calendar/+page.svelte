<script lang="ts">
  import {onDestroy} from "svelte"
  import {readable, type Readable} from "svelte/store"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {formatTimestampAsDate, last, now} from "@welshman/lib"
  import {EVENT_TIME, getTagValue, type Filter, type TrustedEvent} from "@welshman/util"
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
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    hasCommunityHydrationCompleted,
    markCommunityHydrationCompleted,
  } from "@app/core/community-state"
  import {normalizePubkey, parseTargetedPublication} from "@app/core/community"
  import {
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilters,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {makeCalendarFeed} from "@app/core/requests"
  import {setChecked} from "@app/util/notifications"
  import {makeCommunityCalendarPath, parseCommunityRouteParam} from "@app/util/routes"

  type CalendarItem = {
    event: TrustedEvent
    dateDisplay?: string
    isFirstFutureEvent?: boolean
  }

  let element: HTMLElement | undefined = $state()
  let loadingTargets = $state(false)
  let targetRequestDone = $state(false)
  let loadingEvents = $state(false)
  let exhaustedEvents = $state(false)
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let lastFeedKey = ""
  let previousScrollHeight = 0
  let previousFirstEventId = ""
  let initialScrollDone = false

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
  const calendarSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.calendar,
    ),
  )
  const targetingFilters = $derived(
    communityBootstrapReady && communityPubkey
      ? [makeCommunityTargetingFilter(communityPubkey, [EVENT_TIME])]
      : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const calendarAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.calendar,
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
  const targetingIds = $derived.by(() => {
    const allowedAuthors = new Set(calendarAuthorPubkeys.map(normalizePubkey).filter(Boolean))

    return $targetingEvents
      .map(event => parseTargetedPublication(event))
      .filter(targeting => targeting?.kind === EVENT_TIME)
      .filter(targeting => {
        if (!targeting?.ref || targeting.ref.type !== "a") return true

        const [, author] = targeting.ref.value.split(":")
        return allowedAuthors.has(normalizePubkey(author || ""))
      })
      .map(targeting => targeting?.id || "")
      .filter(Boolean)
  })
  const targetedOriginalFilters = $derived(
    communityBootstrapReady && calendarAuthorPubkeys.length
      ? makeTargetedPublicationOriginalFilters($targetingEvents, calendarAuthorPubkeys)
      : [],
  )
  const calendarFeedFilters = $derived.by<Filter[]>(() => {
    const filters: Filter[] = [...targetedOriginalFilters]

    if (targetingIds.length > 0 && calendarAuthorPubkeys.length > 0) {
      filters.unshift({kinds: [EVENT_TIME], authors: calendarAuthorPubkeys, "#h": targetingIds})
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

  const getStart = (event: TrustedEvent) => parseInt(getTagValue("start", event.tags) || "")

  const items = $derived.by(() => {
    let haveSeenFutureEvent = false
    let previousDateDisplay: string | undefined

    return $events
      .filter(event => !isCommunityPersonBanned($activeCommunityReportState, event.pubkey))
      .filter(event => !isNaN(getStart(event)))
      .map<CalendarItem>(event => {
        const start = getStart(event)
        const dateDisplayValue = formatTimestampAsDate(start)
        const dateDisplay = previousDateDisplay === dateDisplayValue ? undefined : dateDisplayValue
        const isFutureEvent = start >= now()
        const isFirstFutureEvent = !haveSeenFutureEvent && isFutureEvent

        previousDateDisplay = dateDisplayValue
        if (isFutureEvent) haveSeenFutureEvent = true

        return {event, dateDisplay, isFirstFutureEvent}
      })
  })

  const resetFeed = () => {
    feedCleanup?.()
    feedCleanup = undefined
    events = readable([])
    loadingEvents = false
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
    exhaustedEvents = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeCalendarFeed({
      element,
      relays: $activeCommunityRelays,
      filters: calendarFeedFilters,
      onInitialLoad: () => {
        markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
      },
      onExhausted: () => {
        markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        exhaustedEvents = true
      },
    })

    events = feed.events
    feedCleanup = feed.cleanup
  }

  $effect(() => {
    if (
      !communityBootstrapReady ||
      !communityPubkey ||
      $activeCommunityRelays.length === 0 ||
      targetingFilters.length === 0
    ) {
      loadingTargets = false
      targetRequestDone = false
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
      targetRequestDone = true
      return
    }

    const timeout = setTimeout(() => {
      markCommunityHydrationCompleted(key)
      loadingTargets = false
      targetRequestDone = true
    }, 3000)

    loadingTargets = true
    targetRequestDone = false
    request({
      relays: $activeCommunityRelays,
      autoClose: true,
      filters: targetingFilters,
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout)
        if (controller.signal.aborted) return

        markCommunityHydrationCompleted(key)
        loadingTargets = false
        targetRequestDone = true
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
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
      filters: targetedOriginalFilters,
      signal: controller.signal,
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
        const firstFutureItem = items.find(({event}) => getStart(event) >= now()) || last(items)
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
        communitySectionName={calendarSectionName}
        allowedAuthors={interactionAuthorPubkeys}
        readOnly={!canReact}
        {event} />
    </div>
  {/each}
  {#if communityBootstrapLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading community permissions...</Spinner>
    </p>
  {:else if loadingTargets || waitingForFeed || loadingEvents || (!targetRequestDone && items.length === 0)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Looking for events...</Spinner>
    </p>
  {:else if items.length === 0}
    <p class="flex h-10 items-center justify-center py-20 text-center">No events found.</p>
  {:else if exhaustedEvents}
    <p class="flex h-10 items-center justify-center py-20 text-center">That's all!</p>
  {/if}
</PageContent>
