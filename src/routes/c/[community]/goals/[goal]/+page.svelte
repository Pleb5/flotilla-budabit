<script lang="ts">
  import {onDestroy} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {sortBy} from "@welshman/lib"
  import {COMMENT, ZAP_GOAL, getTagValue, type Filter} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import SortVertical from "@assets/icons/sort-vertical.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Content from "@app/components/Content.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import GoalSummary from "@app/components/GoalSummary.svelte"
  import GoalActions from "@app/components/GoalActions.svelte"
  import {preventDefault} from "@lib/html"
  import {publishComment} from "@app/core/commands"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {
    COMMUNITY_SECTION_GENERAL,
    COMMUNITY_SECTION_GOALS,
    normalizePubkey,
    parseTargetedPublication,
  } from "@app/core/community"
  import {makeCommunityTargetingFilter} from "@app/core/community-feeds"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {getCommunityCensorReason} from "@app/core/community-reports"
  import {setChecked} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  let loadingGoal = $state(false)
  let goalRequestDone = $state(false)
  let loadingTargeting = $state(false)
  let targetRequestDone = $state(false)
  let showReply = $state(false)
  let showAllReplies = $state(false)
  let reply = $state("")

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const goalId = $derived($page.params.goal || "")
  const goalsPath = $derived(communityPubkey ? makeCommunityPath(communityPubkey, "goals") : "")
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
          pubkey: approvedGoal.pubkey,
          sectionName: COMMUNITY_SECTION_GOALS,
        })
      : undefined,
  )
  const replyFilters = $derived<Filter[]>(
    communityBootstrapReady && approvedGoal && !approvedGoalCensorReason && interactionAuthorPubkeys.length
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
  const replies = $derived(sortBy(replyEvent => -replyEvent.created_at, $replyEventsStore))
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
      }),
    ),
  )

  const sendReply = () => {
    const trimmed = reply.trim()
    if (!approvedGoal || !trimmed) return
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
      event: approvedGoal,
      content: trimmed,
      tags: [["h", communityPubkey]],
    })
    reply = ""
    showReply = false
  }

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0 || goalFilters.length === 0) {
      loadingGoal = false
      goalRequestDone = false
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      loadingGoal = false
      goalRequestDone = true
    }, 3000)

    loadingGoal = true
    goalRequestDone = false
    request({relays: $activeCommunityRelays, autoClose: true, filters: goalFilters, signal: controller.signal})
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout)
        if (controller.signal.aborted) return

        loadingGoal = false
        goalRequestDone = true
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
    setChecked($page.url.pathname)
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
        <NoteCard event={approvedGoal} url={communityPubkey}>
          <div class="col-3 ml-12">
            <Content
              event={{
                content: getTagValue("summary", approvedGoal.tags) || "",
                tags: approvedGoal.tags,
              }}
              url={communityPubkey}
              communitySectionName={COMMUNITY_SECTION_GOALS}
              showEntire />
            <GoalSummary event={approvedGoal} url={communityPubkey} />
            <div class="flex w-full justify-end">
              <GoalActions
                showRoom={false}
                event={approvedGoal}
                url={communityPubkey}
                relays={$activeCommunityRelays}
                scopeH={communityPubkey}
                communitySectionName={COMMUNITY_SECTION_GOALS}
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

    {#if !approvedGoalCensorReason && showReply}
      <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(sendReply)}>
        <strong>Comment</strong>
        <textarea bind:value={reply} class="textarea textarea-bordered" rows="4"></textarea>
        <div class="flex justify-end gap-2">
          <button class="btn btn-link" type="button" onclick={() => (showReply = false)}
            >Cancel</button>
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="comment on goals"
            submit
            disabled={!reply.trim()}>
            <Icon icon={Reply} />
            Comment
          </PublishGate>
        </div>
      </form>
    {:else if !approvedGoalCensorReason}
      <div class="flex justify-end px-2 pb-2">
        {#if canReply}
          <button class="btn btn-primary" type="button" onclick={() => (showReply = true)}>
            <Icon icon={Reply} />
            Comment on this goal
          </button>
        {:else if communityBootstrapLoading}
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
  {:else if communityBootstrapLoading || loadingGoal || (goal && (loadingTargeting || !targetRequestDone)) || (!goal && !goalRequestDone)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading funding goal...</Spinner>
    </p>
  {:else}
    <p class="py-8 text-center opacity-70">Goal not found or not approved for this community.</p>
  {/if}
</PageContent>
