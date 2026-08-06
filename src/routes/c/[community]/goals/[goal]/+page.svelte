<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {sortBy} from "@welshman/lib"
  import {
    COMMENT,
    ZAP_GOAL,
    getTagValue,
    type EventContent,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import SortVertical from "@assets/icons/sort-vertical.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Content from "@app/components/Content.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import RoomComposeEdit from "@app/components/RoomComposeEdit.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import GoalSummary from "@app/components/GoalSummary.svelte"
  import GoalActions from "@app/components/GoalActions.svelte"
  import {publishComment} from "@app/core/commands"
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
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
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
  import {makeCommunityGoalPath, parseCommunityRouteParam} from "@app/util/routes"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  let loadingGoal = $state(false)
  let goalLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingTargeting = $state(false)
  let targetLoadStatus = $state<CommunityHydrationStatus>("idle")
  let loadingReplies = $state(false)
  let replyLoadStatus = $state<CommunityHydrationStatus>("idle")
  let historicalLoadRetryVersion = $state(0)
  let showReply = $state(false)
  let showAllReplies = $state(false)
  let eventToEdit: TrustedEvent | undefined = $state()
  let compose: RoomCompose | undefined = $state()
  let composeElement: HTMLElement | undefined = $state()

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const goalId = $derived($page.params.goal || "")
  const goalsPath = $derived(
    communityPubkey ? makeCommunityGoalPath(communityPubkey) : $page.url.pathname,
  )
  const goalPath = $derived(
    communityPubkey && goalId ? makeCommunityGoalPath(communityPubkey, goalId) : goalsPath,
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
  const goalSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.goal,
    ),
  )
  const commentSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.comment,
    ),
  )
  const commentAccessMessage = $derived(`Request ${commentSectionName} access to comment.`)
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
  const goalFilters = $derived<Filter[]>(
    communityBootstrapReady && goalId && goalAuthorPubkeys.length
      ? [{kinds: [ZAP_GOAL], ids: [goalId], authors: goalAuthorPubkeys}]
      : [],
  )
  const goalEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: goalFilters})))
  const goal = $derived($goalEvents[0])
  const goalTargetingId = $derived(goal ? getTagValue("h", goal.tags) || "" : "")
  const targetingFilters = $derived<Filter[]>(
    communityBootstrapReady && communityPubkey && goal
      ? [
          makeCommunityTargetingFilter(
            communityPubkey,
            [ZAP_GOAL],
            goalTargetingId ? {"#d": [goalTargetingId]} : {},
          ),
        ]
      : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const isTargetedToCommunity = $derived.by(() => {
    if (!goal) return false

    const allowedAuthors = new Set(goalAuthorPubkeys.map(normalizePubkey).filter(Boolean))
    if (!allowedAuthors.has(normalizePubkey(goal.pubkey))) return false

    return $targetingEvents.some(targetingEvent => {
      const targeting = parseTargetedPublication(targetingEvent)
      if (!targeting || targeting.kind !== ZAP_GOAL) return false
      if (goalTargetingId && targeting.id === goalTargetingId) return true
      if (targeting.ref?.type === "e" && targeting.ref.value === goal.id) return true

      return false
    })
  })
  const approvedGoal = $derived(goal && isTargetedToCommunity ? goal : undefined)
  const approvedGoalCensorReason = $derived.by(() =>
    approvedGoal
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: approvedGoal.id,
          eventAddress: getCommunityReportEventAddress(approvedGoal),
          pubkey: approvedGoal.pubkey,
          sectionName: goalSectionName,
        })
      : undefined,
  )
  const replyFilters = $derived<Filter[]>(
    communityBootstrapReady &&
      approvedGoal &&
      !approvedGoalCensorReason &&
      interactionAuthorPubkeys.length
      ? [
          {
            kinds: [COMMENT],
            "#E": [approvedGoal.id],
            "#K": [String(ZAP_GOAL)],
            "#h": [communityPubkey],
            authors: interactionAuthorPubkeys,
          },
        ]
      : [],
  )
  const replyEventsStore = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: replyFilters})),
  )
  const replies = $derived(
    sortBy(
      replyEvent => -replyEvent.created_at,
      filterVisibleAfterDeletesAndEdits($replyEventsStore, $editedTargetIds).filter(
        event => !isCommunityPersonBanned($activeCommunityReportState, event.pubkey),
      ),
    ),
  )
  const visibleReplies = $derived(showAllReplies ? replies : replies.slice(0, 4))
  const canReply = $derived(
    Boolean(
      approvedGoal &&
      communityBootstrapReady &&
      !approvedGoalCensorReason &&
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
      approvedGoal &&
      communityBootstrapReady &&
      !approvedGoalCensorReason &&
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
    if (!approvedGoal || !trimmed) return false
    if (!canReply) {
      pushToast({theme: "error", message: commentAccessMessage})
      return false
    }
    if ($activeCommunityRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return false
    }

    if (eventToEdit) {
      publishEditedReply({
        event: eventToEdit,
        content: trimmed,
        tags,
        relays: $activeCommunityRelays,
        url: communityPubkey,
      })
      eventToEdit = undefined
      showReply = false
      return true
    }

    publishComment({
      relays: $activeCommunityRelays,
      event: approvedGoal,
      content: trimmed,
      tags: [["h", communityPubkey], ...tags],
    })
    showReply = false
    return true
  }

  const openReply = async () => {
    eventToEdit = undefined
    showReply = true
    await tick()
    composeElement?.scrollIntoView({behavior: "smooth", block: "end"})
    compose?.focus()
  }

  const openEditPrompt = async (event: TrustedEvent) => {
    eventToEdit = event
    showReply = true
    await tick()
    composeElement?.scrollIntoView({behavior: "smooth", block: "end"})
    compose?.focus()
  }

  const closeReply = () => {
    eventToEdit = undefined
    showReply = false
  }

  const canEditReply = (event: TrustedEvent) => canEditReplyEvent(event, $pubkey, canReply)

  $effect(() => {
    void historicalLoadRetryVersion

    if (
      !communityBootstrapReady ||
      $activeCommunityRelays.length === 0 ||
      goalFilters.length === 0
    ) {
      loadingGoal = false
      goalLoadStatus = "idle"
      return
    }

    const controller = new AbortController()

    loadingGoal = true
    goalLoadStatus = "queued"
    void hydrateCommunityEventsWithStatus({
      key: `goal:${goalPath}:${historicalLoadRetryVersion}:${JSON.stringify(goalFilters)}`,
      relays: $activeCommunityRelays,
      filters: goalFilters,
      authenticate: true,
      timeout: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      signal: controller.signal,
      onStatus: status => {
        goalLoadStatus = status
        loadingGoal = status === "queued" || status === "loading"
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
      key: `goal-target:${goalPath}:${historicalLoadRetryVersion}:${JSON.stringify(targetingFilters)}`,
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
      key: `goal-replies:${goalPath}:${historicalLoadRetryVersion}:${JSON.stringify(replyFilters)}`,
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
    if (goal) {
      loadingGoal = false
    }
    if (approvedGoal) {
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
    setChecked(goalPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={goalsPath || "#"} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
    </div>
  {/snippet}
  {#snippet title()}
    <strong>{approvedGoalCensorReason ? "Moderated goal" : approvedGoal?.content || "Goal"}</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-3 p-2 pt-4">
  {#if approvedGoal}
    <article class="card2 bg-alt z-feature w-full shadow-md">
      {#if approvedGoalCensorReason}
        <ModeratedContent reason={approvedGoalCensorReason} />
      {:else}
        <NoteCard event={approvedGoal} relays={$activeCommunityRelays}>
          <div class="col-3 ml-12">
            <Content
              event={{
                content: getTagValue("summary", approvedGoal.tags) || "",
                tags: approvedGoal.tags,
              }}
              url={communityPubkey}
              communitySectionName={goalSectionName}
              showEntire />
            <GoalSummary
              event={approvedGoal}
              url={communityPubkey}
              relays={$activeCommunityRelays}
              scopeH={communityPubkey} />
            <div class="flex w-full justify-end">
              <GoalActions
                showRoom={false}
                event={approvedGoal}
                url={communityPubkey}
                relays={$activeCommunityRelays}
                scopeH={communityPubkey}
                communitySectionName={goalSectionName}
                allowedAuthors={interactionAuthorPubkeys}
                readOnly={!canReact} />
            </div>
          </div>
        </NoteCard>
      {/if}
    </article>

    {#if !approvedGoalCensorReason && !showAllReplies && replies.length > visibleReplies.length}
      <div class="flex justify-center">
        <Button class="btn btn-link" onclick={() => (showAllReplies = true)}>
          <Icon icon={SortVertical} />
          Show all {replies.length} replies
        </Button>
      </div>
    {/if}

    {#if !approvedGoalCensorReason}
      <div class="col-2">
        {#each visibleReplies as replyEvent (replyEvent.id)}
          {@const censorReason = getCommunityCensorReason({
            reportState: $activeCommunityReportState,
            eventId: replyEvent.id,
            eventAddress: getCommunityReportEventAddress(replyEvent),
            pubkey: replyEvent.pubkey,
            sectionName: commentSectionName,
          })}
          {#if censorReason}
            <div class="card2 bg-alt z-feature w-full">
              <ModeratedContent reason={censorReason} />
            </div>
          {:else}
            <div class="card2 bg-alt z-feature w-full">
              <ChannelMessage
                url={communityPubkey}
                event={replyEvent}
                showPubkey
                readOnly={!canReact}
                interactionRelays={$activeCommunityRelays}
                profileRelays={$activeCommunityRelays}
                {interactionAuthorPubkeys}
                scopeH={communityPubkey}
                communitySectionName={commentSectionName}
                canEdit={canEditReply}
                onEdit={openEditPrompt} />
            </div>
          {/if}
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

    {#if !approvedGoalCensorReason && showReply}
      <div bind:this={composeElement} class="card2 bg-alt col-3 p-4 shadow-md">
        <strong>Comment</strong>
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
            onEscape={closeReply}
            content={eventToEdit?.content}
            bind:this={compose} />
        {/key}
        <div class="flex justify-end">
          <button class="btn btn-link btn-sm" type="button" onclick={closeReply}>Cancel</button>
        </div>
      </div>
    {:else if !approvedGoalCensorReason}
      <div class="flex justify-end px-2 pb-2">
        {#if canReply}
          <button class="btn btn-primary" type="button" onclick={openReply}>
            <Icon icon={Reply} />
            Comment on this goal
          </button>
        {:else if communityBootstrapLoading || communityPermissionsLoading}
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner loading>Checking comment access...</Spinner>
          </div>
        {:else}
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="comment on goals"
            class="btn btn-primary">
            <Icon icon={Reply} />
            Comment on this goal
          </PublishGate>
        {/if}
      </div>
    {/if}
  {:else if communityBootstrapLoading || communityPermissionsLoading || loadingGoal || goalLoadStatus === "queued" || goalLoadStatus === "loading" || (goal && (loadingTargeting || targetLoadStatus === "idle" || targetLoadStatus === "queued" || targetLoadStatus === "loading")) || (!goal && goalFilters.length > 0 && goalLoadStatus === "idle")}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading funding goal...</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityPermissionEvidenceIncomplete || (!goal && (goalLoadStatus === "incomplete" || goalLoadStatus === "failed")) || (goal && !approvedGoal && (targetLoadStatus === "incomplete" || targetLoadStatus === "failed"))}
    <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
      <p>Goal lookup is incomplete or temporarily unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else}
    <p class="py-8 text-center opacity-70">Goal not found or not approved for this community.</p>
  {/if}
</PageContent>
