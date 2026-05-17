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
    activeCommunityRelays,
    hasCommunityHydrationCompleted,
    markCommunityHydrationCompleted,
  } from "@app/core/community-state"
  import {
    COMMUNITY_SECTION_GENERAL,
    COMMUNITY_SECTION_GOALS,
    normalizePubkey,
    parseTargetedPublication,
  } from "@app/core/community"
  import {
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilters,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {makeFeed} from "@app/core/requests"
  import {setChecked} from "@app/util/notifications"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  let loadingTargets = $state(false)
  let targetRequestDone = $state(false)
  let loadingEvents = $state(false)
  let exhaustedEvents = $state(false)
  let element: HTMLElement | undefined = $state()
  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let feedCleanup: (() => void) | undefined = $state()
  let feedInitialized = $state(false)
  let lastFeedKey = ""

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const createPath = $derived(
    communityPubkey ? makeCommunityPath(communityPubkey, "goals", "create") : "",
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
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_GOALS,
        })
      : [],
  )
  const interactionAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_GENERAL,
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
    communityBootstrapReady && communityPubkey && goalFeedFilters.length && $activeCommunityRelays.length
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
      }),
    ),
  )

  const items = $derived.by(() => {
    const scores = new Map<string, number[]>()
    const [goals, comments] = partition(spec({kind: ZAP_GOAL}), $events)

    for (const comment of comments) {
      const id = getTagValue("E", comment.tags)

      if (id) pushToMapKey(scores, id, comment.created_at)
    }

    return sortBy(event => -max([...(scores.get(event.id) || []), event.created_at]), goals)
  })

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
    if (!element || !key || goalFeedFilters.length === 0 || $activeCommunityRelays.length === 0)
      return

    const hydrationKey = `goals:feed:${key}`

    loadingEvents = !hasCommunityHydrationCompleted(hydrationKey)
    exhaustedEvents = false
    lastFeedKey = key
    feedInitialized = true

    const feed = makeFeed({
      element,
      relays: $activeCommunityRelays,
      feedFilters: goalFeedFilters,
      subscriptionFilters: goalFeedFilters,
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
    const key = JSON.stringify({scope: "goals-targets", relays: $activeCommunityRelays, filters: targetingFilters})

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
    request({relays: $activeCommunityRelays, autoClose: true, filters: targetingFilters, signal: controller.signal})
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
    <strong>Goals</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.goal}
        action="publish goals"
        href={createPath}
        class="btn btn-primary btn-sm"
        showReason={false}>
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
      communitySectionName={COMMUNITY_SECTION_GOALS}
      allowedAuthors={interactionAuthorPubkeys}
      readOnly={!canReact}
      event={$state.snapshot(event)} />
  {/each}
  {#if communityBootstrapLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading community permissions...</Spinner>
    </p>
  {:else if loadingTargets || waitingForFeed || loadingEvents || (!targetRequestDone && items.length === 0)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Looking for goals...</Spinner>
    </p>
  {:else if items.length === 0}
    <p class="flex h-10 items-center justify-center py-20 text-center">No goals found.</p>
  {:else if exhaustedEvents}
    <p class="flex h-10 items-center justify-center py-20 text-center">That's all!</p>
  {/if}
</PageContent>
