<script lang="ts">
  import {onDestroy} from "svelte"
  import {readable, type Readable} from "svelte/store"
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {type Filter, type TrustedEvent} from "@welshman/util"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import ThreadItem from "@app/components/ThreadItem.svelte"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDescriptor,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeCommunityProfileListEvents,
    activeExactCommunityRelays,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
    activeExactCommunitySession,
    getCommunityBootstrapKey,
    hasCommunityHydrationCompleted,
    markCommunityHydrationCompleted,
    recoverCommunityBootstrap,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityThreadRepliesFilter,
    makeCommunityThreadsFilter,
  } from "@app/core/community-feeds"
  import {readCommunityThreadReply, readCommunityThreads} from "@app/core/community-threads"
  import {publicationOperations} from "@app/core/publication-operations"
  import {projectAuthoredPublicationEvents} from "@app/core/authored-publication-operations"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {makeFeed} from "@app/core/requests"
  import {setChecked} from "@app/util/notifications"
  import {makeExactCommunityThreadPath, parseExactCommunityRouteParam} from "@app/util/routes"

  const FEED_EMPTY_SETTLE_TIMEOUT_MS = 10_000

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
  const threadsPath = $derived(
    routeCommunity ? makeExactCommunityThreadPath(routeCommunity) : $page.url.pathname,
  )
  const createPath = $derived(
    routeCommunity ? makeExactCommunityThreadPath(routeCommunity, "create") : "",
  )
  const threadAuthorPubkeys = $derived(
    communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.thread,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const replyAuthorPubkeys = $derived(
    communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.comment,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reactionAuthorPubkeys = $derived(
    communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.reaction,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const reportAuthorPubkeys = $derived(
    communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.report,
          reportState: $activeCommunityReportState,
        })
      : [],
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
  const threadSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.thread,
    ),
  )
  const threadFilterPlan = $derived(
    communityAuthorityReady && communityId
      ? makeCommunityContentFilterPlan(
          [makeCommunityThreadsFilter(communityId)],
          threadAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const replyFilterPlan = $derived(
    communityAuthorityReady && communityId
      ? makeCommunityContentFilterPlan(
          [makeCommunityThreadRepliesFilter(communityId)],
          replyAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const feedFilters = $derived([
    ...threadFilterPlan.localFilters,
    ...replyFilterPlan.localFilters,
  ] as Filter[])
  const feedRelayFilters = $derived([
    ...threadFilterPlan.relayFilters,
    ...replyFilterPlan.relayFilters,
  ] as Filter[])
  const repositoryEvents = $derived(
    feedFilters.length
      ? deriveEventsAsc(deriveEventsById({repository, filters: feedFilters}))
      : readable<TrustedEvent[]>([]),
  )
  const feedKey = $derived.by(() =>
    communityAuthorityReady &&
    communityAddress &&
    feedFilters.length &&
    $activeExactCommunityRelays.length
      ? [
          communityAddress,
          ...$activeExactCommunityRelays,
          ...threadAuthorPubkeys,
          ...replyAuthorPubkeys,
        ].join("|")
      : "",
  )
  let loadingEvents = $state(false)
  let feedLoadStatus = $state<CommunityHydrationStatus>("idle")
  let feedEmptySettled = $state(false)
  let exhaustedEvents = $state(false)
  let element: HTMLElement | undefined = $state()
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let feedEmptySettleTimer: ReturnType<typeof setTimeout> | undefined
  let lastFeedKey = ""
  let retryingCommunityAccess = $state(false)
  const waitingForFeed = $derived(Boolean(feedKey && !feedInitialized))

  const threadProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: Array.from(
        new Map([...$repositoryEvents, ...$events].map(event => [event.id, event])).values(),
      ),
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event =>
        Boolean(
          (threadAuthorPubkeys.includes(event.pubkey) &&
            readCommunityThreads([event], communityId).length) ||
          (replyAuthorPubkeys.includes(event.pubkey) &&
            readCommunityThreadReply(event, communityId)),
        ),
    }),
  )
  const threads = $derived.by(() => {
    const repliesByThread = new Map<string, number>()
    const roots = readCommunityThreads(threadProjection.events, communityId).filter(
      thread => !isCommunityPersonBanned($activeCommunityReportState, thread.event.pubkey),
    )

    for (const event of threadProjection.events) {
      if (isCommunityPersonBanned($activeCommunityReportState, event.pubkey)) continue

      const reply = readCommunityThreadReply(event, communityId)
      if (!reply) continue

      repliesByThread.set(
        reply.threadId,
        Math.max(repliesByThread.get(reply.threadId) || 0, event.created_at),
      )
    }

    return [...roots].sort(
      (a, b) =>
        Math.max(repliesByThread.get(b.id) || 0, b.event.created_at) -
        Math.max(repliesByThread.get(a.id) || 0, a.event.created_at),
    )
  })
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

  const clearFeedEmptySettleTimer = () => {
    if (!feedEmptySettleTimer) return

    clearTimeout(feedEmptySettleTimer)
    feedEmptySettleTimer = undefined
  }

  const startFeedEmptySettleTimer = () => {
    clearFeedEmptySettleTimer()
    feedEmptySettled = false
    feedEmptySettleTimer = setTimeout(() => {
      feedEmptySettleTimer = undefined
      feedEmptySettled = true
    }, FEED_EMPTY_SETTLE_TIMEOUT_MS)
  }

  const resetFeed = () => {
    feedCleanup?.()
    feedCleanup = undefined
    clearFeedEmptySettleTimer()
    events = readable([])
    loadingEvents = false
    feedLoadStatus = "idle"
    feedEmptySettled = false
    exhaustedEvents = false
    feedInitialized = false
    lastFeedKey = ""
  }

  const startFeed = (key: string) => {
    if (
      !element ||
      !key ||
      feedFilters.length === 0 ||
      feedRelayFilters.length === 0 ||
      $activeExactCommunityRelays.length === 0
    )
      return

    const hydrationKey = `threads:feed:${communityAddress}:${key}`

    loadingEvents = !hasCommunityHydrationCompleted(hydrationKey)
    feedLoadStatus = "loading"
    startFeedEmptySettleTimer()
    exhaustedEvents = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeFeed({
      element,
      relays: $activeExactCommunityRelays,
      feedFilters,
      relayFilters: feedRelayFilters,
      subscriptionFilters: feedFilters,
      onInitialLoad: ({complete}) => {
        if (complete) markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = complete ? "complete" : "incomplete"
      },
      onExhausted: () => {
        markCommunityHydrationCompleted(hydrationKey)
        loadingEvents = false
        feedLoadStatus = "complete"
        feedEmptySettled = true
        clearFeedEmptySettleTimer()
        exhaustedEvents = true
      },
    })

    events = feed.events
    feedCleanup = feed.cleanup
  }

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

  const retryFeed = async () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      if (!routeCommunity || retryingCommunityAccess) return

      retryingCommunityAccess = true
      try {
        const session = $activeExactCommunitySession
        if (!session || $activeExactCommunityPointer?.address !== routeCommunity.address) return
        await recoverCommunityBootstrap(session, {recoverAuth: true})
      } catch (error) {
        console.warn("[community-threads] Failed to recover community access", error)
      } finally {
        retryingCommunityAccess = false
      }
      return
    }

    resetFeed()
  }

  $effect(() => {
    if (threads.length === 0) return

    feedEmptySettled = true
    clearFeedEmptySettleTimer()
  })

  onDestroy(() => {
    resetFeed()
    setChecked(threadsPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={NotesMinimalistic} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Threads</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.thread}
        action="create threads"
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
  <div class="col-2">
    {#each threads as thread (thread.id)}
      <ThreadItem
        community={routeCommunity}
        url={communityOwnerPubkey}
        relays={$activeExactCommunityRelays}
        publishRelays={$activeExactCommunityPublishRelays}
        scopeH={communityId}
        activityLiveCovered
        communitySectionName={threadSectionName}
        allowedAuthors={replyAuthorPubkeys}
        reactionAllowedAuthors={reactionAuthorPubkeys}
        reportAllowedAuthors={reportAuthorPubkeys}
        readOnly={!canReact}
        operationId={threadProjection.operationIds.get(thread.event.id)}
        event={thread.event} />
    {/each}
    {#if communityBootstrapLoading || communityAuthorityLoading}
      <p class="flex h-10 items-center justify-center py-20 text-center">
        <Spinner loading>Loading Threads</Spinner>
      </p>
    {:else if communityBootstrapFailed || communityAuthorityUnavailable}
      <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
        <p>Threads unavailable.</p>
        <button
          class="btn btn-neutral btn-sm"
          type="button"
          disabled={retryingCommunityAccess}
          onclick={retryFeed}>{retryingCommunityAccess ? "Retrying..." : "Retry"}</button>
      </div>
    {:else if waitingForFeed || loadingEvents || (!feedEmptySettled && threads.length === 0 && feedLoadStatus !== "incomplete" && feedLoadStatus !== "failed")}
      <p class="flex h-10 items-center justify-center py-20 text-center">
        <Spinner loading>Loading Threads</Spinner>
      </p>
    {:else if threads.length === 0}
      <p class="py-8 text-center opacity-70">No threads found.</p>
    {:else if exhaustedEvents}
      <p class="py-8 text-center opacity-70">That's all!</p>
    {/if}
  </div>
</PageContent>
