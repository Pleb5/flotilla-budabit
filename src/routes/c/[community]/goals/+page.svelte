<script lang="ts">
  import {onDestroy} from "svelte"
  import {readable, type Readable} from "svelte/store"
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {max, partition, pushToMapKey, sortBy, spec} from "@welshman/lib"
  import {
    COMMENT,
    ZAP_GOAL,
    getTagValue,
    matchFilters,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
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
    makeCommunityContentFilterPlan,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilterPlan,
    makeTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    filterAuthorizedCommunityTargetingEvents,
    filterAuthorizedLegacyCommunityTargetingEvents,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {
    makeLegacyCommunityTargetingFilter,
    makeLegacyTargetedPublicationOriginalFilterPlan,
    makeLegacyTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-targeting-legacy"
  import {loadBoundedCommunityHistory, makeFeed} from "@app/core/requests"
  import {publicationOperations} from "@app/core/publication-operations"
  import {projectAuthoredPublicationEvents} from "@app/core/authored-publication-operations"
  import {makeCommunityTargetedPublicationSemanticKey} from "@app/core/community-targeting"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {setChecked} from "@app/util/notifications"
  import {makeExactCommunityGoalPath, parseExactCommunityRouteParam} from "@app/util/routes"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  let loadingTargets = $state(false)
  let targetLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingHintedOriginals = $state(false)
  let hintedOriginalLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingEvents = $state(false)
  let feedLoadStatus = $state<CommunityHydrationStatus>("idle")
  let emptyStateSettled = $state(false)
  let exhaustedEvents = $state(false)
  let element: HTMLElement | undefined = $state()
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let emptyStateSettleTimer: ReturnType<typeof setTimeout> | undefined
  let emptyStateCompletionTimer: ReturnType<typeof setTimeout> | undefined
  let lastFeedKey = ""
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
  const goalsPath = $derived(
    routeCommunity ? makeExactCommunityGoalPath(routeCommunity) : $page.url.pathname,
  )
  const createPath = $derived(
    routeCommunity ? makeExactCommunityGoalPath(routeCommunity, "create") : "",
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
  const goalSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.goal,
    ),
  )
  const targetingFilters = $derived(
    communityAuthorityReady && routeCommunity
      ? [
          makeCommunityTargetingFilter(communityId, [ZAP_GOAL]),
          ...(communityOwnerPubkey === communityId
            ? [makeLegacyCommunityTargetingFilter(communityId, [ZAP_GOAL])]
            : []),
        ]
      : [],
  )
  const goalAuthorPubkeys = $derived(
    communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.goal,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const targetingFilterPlan = $derived(
    communityAuthorityReady
      ? makeCommunityContentFilterPlan(targetingFilters, goalAuthorPubkeys)
      : {relayFilters: [], localFilters: []},
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilterPlan.localFilters})),
  )
  const authorizedTargetingEvents = $derived.by(() =>
    communityAuthorityReady && communityDefinition && routeCommunity
      ? filterAuthorizedCommunityTargetingEvents({
          community: routeCommunity,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: [ZAP_GOAL],
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
  const authorizedLegacyTargetingEvents = $derived.by(() =>
    communityAuthorityReady && communityDefinition && routeCommunity
      ? filterAuthorizedLegacyCommunityTargetingEvents({
          community: routeCommunity,
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: [ZAP_GOAL],
        })
      : [],
  )
  const targetedGoalFilterPlan = $derived.by(() => {
    const current = makeTargetedPublicationOriginalFilterPlan(authorizedTargetingEvents)
    const legacy = makeLegacyTargetedPublicationOriginalFilterPlan(authorizedLegacyTargetingEvents)

    return {
      relayFilters: [...current.relayFilters, ...legacy.relayFilters],
      localFilters: [...current.localFilters, ...legacy.localFilters],
    }
  })
  const targetedGoalRelayHintPlans = $derived([
    ...makeTargetedPublicationOriginalRelayHintPlans(authorizedTargetingEvents),
    ...makeLegacyTargetedPublicationOriginalRelayHintPlans(authorizedLegacyTargetingEvents),
  ])
  const targetedGoalEvents = $derived(
    targetedGoalFilterPlan.localFilters.length
      ? deriveEventsAsc(
          deriveEventsById({repository, filters: targetedGoalFilterPlan.localFilters}),
        )
      : readable<TrustedEvent[]>([]),
  )
  const directGoalFilterPlan = $derived(
    communityAuthorityReady && communityId
      ? makeCommunityContentFilterPlan(
          [{kinds: [ZAP_GOAL], "#h": [communityId]}],
          goalAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const goalFilterPlan = $derived({
    relayFilters: [...directGoalFilterPlan.relayFilters, ...targetedGoalFilterPlan.relayFilters],
    localFilters: [...directGoalFilterPlan.localFilters, ...targetedGoalFilterPlan.localFilters],
  })
  const commentFilterPlan = $derived(
    communityAuthorityReady && communityId
      ? makeCommunityContentFilterPlan(
          [{kinds: [COMMENT], "#K": [String(ZAP_GOAL)], "#h": [communityId]}],
          commentAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const goalFeedFilters = $derived.by<Filter[]>(() => {
    return [...goalFilterPlan.localFilters, ...commentFilterPlan.localFilters]
  })
  const goalFeedRelayFilters = $derived([
    ...goalFilterPlan.relayFilters,
    ...commentFilterPlan.relayFilters,
  ] as Filter[])
  const repositoryGoalEvents = $derived(
    goalFeedFilters.length
      ? deriveEventsAsc(deriveEventsById({repository, filters: goalFeedFilters}))
      : readable<TrustedEvent[]>([]),
  )
  const feedKey = $derived.by(() =>
    communityAuthorityReady &&
    communityAddress &&
    goalFeedFilters.length &&
    $activeExactCommunityRelays.length
      ? [
          communityAddress,
          ...$activeExactCommunityRelays,
          JSON.stringify(goalFeedFilters),
          ...authorizedTargetingEvents.map(event => event.id),
        ].join("|")
      : "",
  )
  const waitingForFeed = $derived(Boolean(feedKey && !feedInitialized))
  const canReact = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
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

  const goalProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: Array.from(
        new Map(
          [...$repositoryGoalEvents, ...$events, ...$targetedGoalEvents].map(event => [
            event.id,
            event,
          ]),
        ).values(),
      ),
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event => matchFilters(goalFeedFilters, event),
      matchesOperation: (event, operation) =>
        event.kind === ZAP_GOAL &&
        operation.semanticKey ===
          makeCommunityTargetedPublicationSemanticKey(communityAddress, ZAP_GOAL),
    }),
  )
  const items = $derived.by(() => {
    const scores = new Map<string, number[]>()
    const [goals, comments] = partition(
      spec({kind: ZAP_GOAL}),
      goalProjection.events.filter(
        event => !isCommunityPersonBanned($activeCommunityReportState, event.pubkey),
      ),
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

  const clearEmptyStateCompletionTimer = () => {
    if (!emptyStateCompletionTimer) return

    clearTimeout(emptyStateCompletionTimer)
    emptyStateCompletionTimer = undefined
  }

  const startEmptyStateSettleTimer = () => {
    clearEmptyStateSettleTimer()
    clearEmptyStateCompletionTimer()
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
    clearEmptyStateCompletionTimer()
    exhaustedEvents = false
    feedInitialized = false
    lastFeedKey = ""
  }

  const startFeed = (key: string) => {
    if (
      !element ||
      !key ||
      goalFeedFilters.length === 0 ||
      goalFeedRelayFilters.length === 0 ||
      $activeExactCommunityRelays.length === 0
    )
      return

    const hydrationKey = `goals:feed:${key}`

    loadingEvents = !hasCommunityHydrationCompleted(hydrationKey)
    feedLoadStatus = "loading"
    startEmptyStateSettleTimer()
    exhaustedEvents = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeFeed({
      element,
      relays: $activeExactCommunityRelays,
      feedFilters: goalFeedFilters,
      relayFilters: goalFeedRelayFilters,
      subscriptionFilters: goalFeedFilters,
      onInitialLoad: ({complete}) => {
        if (complete) markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = complete ? "complete" : "incomplete"
      },
      onExhausted: () => {
        markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = "complete"
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
      owner: `community-goal-targets:${communityAddress}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        targetLoadStatus = result.complete ? "complete" : "incomplete"
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-goals] Failed to load targeting history", error)
        targetLoadStatus = "failed"
      })
      .finally(() => {
        if (!controller.signal.aborted) loadingTargets = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    void historicalLoadRetryVersion
    const plans = targetedGoalRelayHintPlans

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
          owner: `community-goal-target-originals:${communityAddress}`,
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
        console.warn("[community-goals] Failed to load hinted goal originals", error)
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
        console.warn("[community-goals] Failed to recover community access", error)
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
    clearEmptyStateCompletionTimer()
  })

  $effect(() => {
    const discoveryComplete =
      feedInitialized &&
      items.length === 0 &&
      !loadingTargets &&
      !loadingHintedOriginals &&
      !waitingForFeed &&
      !loadingEvents &&
      targetLoadStatus === "complete" &&
      hintedOriginalLoadStatus === "complete" &&
      feedLoadStatus === "complete"

    clearEmptyStateCompletionTimer()
    if (!discoveryComplete) return

    // Let targeting events update the hinted-original plan before declaring the feed empty.
    emptyStateCompletionTimer = setTimeout(() => {
      emptyStateCompletionTimer = undefined
      emptyStateSettled = true
      clearEmptyStateSettleTimer()
    }, 0)
  })

  onDestroy(() => {
    resetFeed()
    clearEmptyStateSettleTimer()
    clearEmptyStateCompletionTimer()
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
      <CommunityMenuButton community={routeCommunity?.naddr} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-col gap-2 p-2 pt-4">
  {#each items as event (event.id)}
    <GoalItem
      url={communityId}
      community={routeCommunity}
      relays={$activeExactCommunityRelays}
      publishRelays={$activeExactCommunityPublishRelays}
      scopeH={communityId}
      activityLiveCovered
      communitySectionName={goalSectionName}
      allowedAuthors={commentAuthorPubkeys}
      reactionAllowedAuthors={reactionAuthorPubkeys}
      reportAllowedAuthors={reportAuthorPubkeys}
      readOnly={!canReact}
      operationId={goalProjection.operationIds.get(event.id)}
      event={$state.snapshot(event)} />
  {/each}
  {#if communityBootstrapLoading || communityAuthorityLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading Goals</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityAuthorityUnavailable}
    <div class="flex flex-col items-center gap-3 py-20 text-center">
      <p>Goals unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else if loadingTargets || loadingHintedOriginals || waitingForFeed || loadingEvents || (!emptyStateSettled && items.length === 0) || (targetLoadStatus === "idle" && items.length === 0)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading Goals</Spinner>
    </p>
  {:else if items.length === 0}
    <p class="flex h-10 items-center justify-center py-20 text-center">No goals found.</p>
  {:else if exhaustedEvents}
    <p class="flex h-10 items-center justify-center py-20 text-center">That's all!</p>
  {/if}
</PageContent>
