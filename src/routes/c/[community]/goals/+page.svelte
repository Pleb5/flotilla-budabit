<script lang="ts">
  import {onDestroy} from "svelte"
  import {readable, type Readable} from "svelte/store"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {max, partition, pushToMapKey, sortBy, spec} from "@welshman/lib"
  import {COMMENT, ZAP_GOAL, getTagValue, type Filter, type TrustedEvent} from "@welshman/util"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import GoalItem from "@app/components/GoalItem.svelte"
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
  import {makeFeed} from "@app/core/requests"
  import {setChecked} from "@app/util/notifications"
  import {makeCommunityGoalPath, parseCommunityRouteParam} from "@app/util/routes"

  const REQUEST_SOFT_TIMEOUT_MS = 3_000
  const REQUEST_HARD_TIMEOUT_MS = 10_000

  let loadingTargets = $state(false)
  let targetSoftTimedOut = $state(false)
  let targetRequestDone = $state(false)
  let loadingEvents = $state(false)
  let feedSoftTimedOut = $state(false)
  let emptyStateSettled = $state(false)
  let exhaustedEvents = $state(false)
  let element: HTMLElement | undefined = $state()
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let emptyStateSettleTimer: ReturnType<typeof setTimeout> | undefined
  let lastFeedKey = ""

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const goalsPath = $derived(
    communityPubkey ? makeCommunityGoalPath(communityPubkey) : $page.url.pathname,
  )
  const createPath = $derived(
    communityPubkey ? makeCommunityGoalPath(communityPubkey, "create") : "",
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
  const goalSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.goal,
    ),
  )
  const targetingFilters = $derived(
    communityBootstrapReady && communityPubkey
      ? [makeCommunityTargetingFilter(communityPubkey, [ZAP_GOAL])]
      : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const goalAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.goal,
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
    const allowedAuthors = new Set(goalAuthorPubkeys.map(normalizePubkey).filter(Boolean))

    return $targetingEvents
      .map(event => parseTargetedPublication(event))
      .filter(targeting => targeting?.kind === ZAP_GOAL)
      .filter(targeting => {
        if (!targeting?.ref || targeting.ref.type !== "a") return true

        const [, author] = targeting.ref.value.split(":")
        return allowedAuthors.has(normalizePubkey(author || ""))
      })
      .map(targeting => targeting?.id || "")
      .filter(Boolean)
  })
  const goalFilters = $derived(
    communityBootstrapReady && goalAuthorPubkeys.length
      ? makeTargetedPublicationOriginalFilters($targetingEvents, goalAuthorPubkeys)
      : [],
  )
  const goalFeedFilters = $derived.by<Filter[]>(() => {
    const filters: Filter[] = [...goalFilters]

    if (targetingIds.length > 0 && goalAuthorPubkeys.length > 0) {
      filters.unshift({kinds: [ZAP_GOAL], authors: goalAuthorPubkeys, "#h": targetingIds})
    }

    if (filters.length > 0 && interactionAuthorPubkeys.length > 0) {
      filters.push({
        kinds: [COMMENT],
        "#K": [String(ZAP_GOAL)],
        "#h": [communityPubkey],
        authors: interactionAuthorPubkeys,
      })
    }

    return filters
  })
  const feedKey = $derived.by(() =>
    communityBootstrapReady &&
    communityPubkey &&
    goalFeedFilters.length &&
    $activeCommunityRelays.length
      ? [
          communityPubkey,
          ...$activeCommunityRelays,
          ...goalAuthorPubkeys,
          ...interactionAuthorPubkeys,
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

  const items = $derived.by(() => {
    const scores = new Map<string, number[]>()
    const [goals, comments] = partition(
      spec({kind: ZAP_GOAL}),
      $events.filter(event => !isCommunityPersonBanned($activeCommunityReportState, event.pubkey)),
    )

    for (const comment of comments) {
      const id = getTagValue("E", comment.tags)

      if (id) pushToMapKey(scores, id, comment.created_at)
    }

    return sortBy(event => -max([...(scores.get(event.id) || []), event.created_at]), goals)
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
    feedSoftTimedOut = false
    emptyStateSettled = false
    exhaustedEvents = false
    feedInitialized = false
    lastFeedKey = ""
  }

  const startFeed = (key: string) => {
    if (!element || !key || goalFeedFilters.length === 0 || $activeCommunityRelays.length === 0)
      return

    const hydrationKey = `goals:feed:${key}`

    loadingEvents = !hasCommunityHydrationCompleted(hydrationKey)
    feedSoftTimedOut = false
    startEmptyStateSettleTimer()
    exhaustedEvents = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeFeed({
      element,
      relays: $activeCommunityRelays,
      feedFilters: goalFeedFilters,
      subscriptionFilters: goalFeedFilters,
      onInitialLoad: ({timedOut}) => {
        if (!timedOut) markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedSoftTimedOut = timedOut
      },
      onExhausted: () => {
        markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedSoftTimedOut = false
        emptyStateSettled = true
        clearEmptyStateSettleTimer()
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
      targetSoftTimedOut = false
      targetRequestDone = false
      emptyStateSettled = false
      clearEmptyStateSettleTimer()
      return
    }

    const controller = new AbortController()
    const key = JSON.stringify({
      scope: "goals-targets",
      relays: $activeCommunityRelays,
      filters: targetingFilters,
    })

    if (hasCommunityHydrationCompleted(key)) {
      loadingTargets = false
      targetSoftTimedOut = false
      targetRequestDone = true
      return
    }

    const softTimeout = setTimeout(() => {
      targetSoftTimedOut = true
    }, REQUEST_SOFT_TIMEOUT_MS)
    const hardTimeout = setTimeout(() => {
      markCommunityHydrationCompleted(key)
      loadingTargets = false
      targetSoftTimedOut = false
      targetRequestDone = true
      emptyStateSettled = true
      clearEmptyStateSettleTimer()
      controller.abort()
    }, REQUEST_HARD_TIMEOUT_MS)

    loadingTargets = true
    targetSoftTimedOut = false
    targetRequestDone = false
    startEmptyStateSettleTimer()
    request({
      relays: $activeCommunityRelays,
      autoClose: true,
      filters: targetingFilters,
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(softTimeout)
        clearTimeout(hardTimeout)
        if (controller.signal.aborted) return

        markCommunityHydrationCompleted(key)
        loadingTargets = false
        targetSoftTimedOut = false
        targetRequestDone = true
      })

    return () => {
      clearTimeout(softTimeout)
      clearTimeout(hardTimeout)
      controller.abort()
    }
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
    if (items.length === 0) return

    feedSoftTimedOut = false
    emptyStateSettled = true
    clearEmptyStateSettleTimer()
  })

  onDestroy(() => {
    resetFeed()
    clearEmptyStateSettleTimer()
    setChecked(goalsPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={NotesMinimalistic} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Goals</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.goal}
        action="publish goals"
        href={createPath}
        class="btn btn-primary btn-sm">
        <Icon icon={NotesMinimalistic} />
        Create
      </PublishGate>
      <CommunityMenuButton community={communityPubkey} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-col gap-2 p-2 pt-4">
  {#each items as event (event.id)}
    <GoalItem
      url={communityPubkey}
      relays={$activeCommunityRelays}
      scopeH={communityPubkey}
      communitySectionName={goalSectionName}
      allowedAuthors={interactionAuthorPubkeys}
      readOnly={!canReact}
      event={$state.snapshot(event)} />
  {/each}
  {#if communityBootstrapLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading community permissions...</Spinner>
    </p>
  {:else if loadingTargets || targetSoftTimedOut || waitingForFeed || loadingEvents || (!emptyStateSettled && items.length === 0) || (!targetRequestDone && items.length === 0)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading
        >{targetSoftTimedOut ||
        feedSoftTimedOut ||
        (!emptyStateSettled && !loadingTargets && !waitingForFeed && !loadingEvents)
          ? "Still looking for goals..."
          : "Looking for goals..."}</Spinner>
    </p>
  {:else if items.length === 0}
    <p class="flex h-10 items-center justify-center py-20 text-center">No goals found.</p>
  {:else if exhaustedEvents}
    <p class="flex h-10 items-center justify-center py-20 text-center">That's all!</p>
  {/if}
</PageContent>
