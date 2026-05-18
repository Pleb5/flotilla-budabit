<script lang="ts">
  import {onDestroy} from "svelte"
  import {readable, type Readable} from "svelte/store"
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
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
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    hasCommunityHydrationCompleted,
    markCommunityHydrationCompleted,
  } from "@app/core/community-state"
  import {
    makeCommunityThreadRepliesFilter,
    makeCommunityThreadsFilter,
  } from "@app/core/community-feeds"
  import {readCommunityThreadReply, readCommunityThreads} from "@app/core/community-threads"
  import {COMMUNITY_SECTION_GENERAL, COMMUNITY_SECTION_THREADS} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {makeFeed} from "@app/core/requests"
  import {setChecked} from "@app/util/notifications"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const createPath = $derived(
    communityPubkey ? makeCommunityPath(communityPubkey, "threads", "create") : "",
  )
  const threadAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_THREADS,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const replyAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_GENERAL,
          reportState: $activeCommunityReportState,
        })
      : [],
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
  const threadFilter = $derived(
    communityBootstrapReady && communityPubkey && threadAuthorPubkeys.length
      ? makeCommunityThreadsFilter(communityPubkey, {authors: threadAuthorPubkeys})
      : undefined,
  )
  const replyFilter = $derived(
    communityBootstrapReady && communityPubkey && replyAuthorPubkeys.length
      ? makeCommunityThreadRepliesFilter(communityPubkey, {authors: replyAuthorPubkeys})
      : undefined,
  )
  const feedFilters = $derived([threadFilter, replyFilter].filter(Boolean) as Filter[])
  const feedKey = $derived.by(() =>
    communityBootstrapReady &&
    communityPubkey &&
    feedFilters.length &&
    $activeCommunityRelays.length
      ? [
          communityPubkey,
          ...$activeCommunityRelays,
          ...threadAuthorPubkeys,
          ...replyAuthorPubkeys,
        ].join("|")
      : "",
  )
  let loadingEvents = $state(false)
  let exhaustedEvents = $state(false)
  let element: HTMLElement | undefined = $state()
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let lastFeedKey = ""
  const waitingForFeed = $derived(Boolean(feedKey && !feedInitialized))

  const threads = $derived.by(() => {
    const repliesByThread = new Map<string, number>()
    const roots = readCommunityThreads($events, communityPubkey).filter(
      thread => !isCommunityPersonBanned($activeCommunityReportState, thread.event.pubkey),
    )

    for (const event of $events) {
      if (isCommunityPersonBanned($activeCommunityReportState, event.pubkey)) continue

      const reply = readCommunityThreadReply(event, communityPubkey)
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

  const resetFeed = () => {
    feedCleanup?.()
    feedCleanup = undefined
    events = readable([])
    loadingEvents = false
    exhaustedEvents = false
    feedInitialized = false
    lastFeedKey = ""
  }

  const startFeed = (key: string) => {
    if (!element || !key || feedFilters.length === 0 || $activeCommunityRelays.length === 0) return

    const hydrationKey = `threads:feed:${key}`

    loadingEvents = !hasCommunityHydrationCompleted(hydrationKey)
    exhaustedEvents = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeFeed({
      element,
      relays: $activeCommunityRelays,
      feedFilters,
      subscriptionFilters: feedFilters,
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

  onDestroy(() => {
    resetFeed()
    setChecked($page.url.pathname)
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
      <CommunityMenuButton community={communityPubkey} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-col gap-2 p-2 pt-4">
  <div class="col-2">
    {#each threads as thread (thread.id)}
      <ThreadItem
        url={communityPubkey}
        relays={$activeCommunityRelays}
        scopeH={communityPubkey}
        communitySectionName={COMMUNITY_SECTION_THREADS}
        allowedAuthors={replyAuthorPubkeys}
        readOnly={!canReact}
        event={thread.event} />
    {/each}
    {#if communityBootstrapLoading}
      <p class="flex h-10 items-center justify-center py-20 text-center">
        <Spinner loading>Loading community permissions...</Spinner>
      </p>
    {:else if waitingForFeed || loadingEvents}
      <p class="flex h-10 items-center justify-center py-20 text-center">
        <Spinner loading>Looking for threads...</Spinner>
      </p>
    {:else if threads.length === 0}
      <p class="py-8 text-center opacity-70">No threads found.</p>
    {:else if exhaustedEvents}
      <p class="py-8 text-center opacity-70">That's all!</p>
    {/if}
  </div>
</PageContent>
