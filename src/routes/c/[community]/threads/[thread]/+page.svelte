<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {page} from "$app/stores"
  import {repository, pubkey} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {COMMENT, makeEvent, type EventContent, type TrustedEvent} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {scrollToEvent} from "@lib/html"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import Content from "@app/components/Content.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import RoomComposeEdit from "@app/components/RoomComposeEdit.svelte"
  import RoomComposeParent from "@app/components/RoomComposeParent.svelte"
  import ThreadActions from "@app/components/ThreadActions.svelte"
  import PublicationStatus from "@app/components/PublicationStatus.svelte"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDescriptor,
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeExactCommunityRelays,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityThreadRepliesFilter,
    makeCommunityThreadsFilter,
  } from "@app/core/community-feeds"
  import {
    makeCommunityThreadReply,
    readCommunityThread,
    readCommunityThreadReply,
  } from "@app/core/community-threads"
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
  import {publicationOperations, startPublication} from "@app/core/publication-operations"
  import {projectAuthoredPublicationEvents} from "@app/core/authored-publication-operations"
  import {setChecked} from "@app/util/notifications"
  import {makeExactCommunityThreadPath, parseExactCommunityRouteParam} from "@app/util/routes"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {loadBoundedCommunityHistory} from "@app/core/requests"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityOwnerPubkey = $derived(routeCommunity?.ownerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const threadId = $derived($page.params.thread || "")
  const threadsPath = $derived(
    routeCommunity ? makeExactCommunityThreadPath(routeCommunity) : $page.url.pathname,
  )
  const threadPath = $derived(
    routeCommunity && threadId
      ? makeExactCommunityThreadPath(routeCommunity, threadId)
      : threadsPath,
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityAddress &&
      communityDefinition &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityAddress && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
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
    Boolean(communityAddress && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const threadSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.thread,
    ),
  )
  const commentSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.comment,
    ),
  )
  const commentAccessMessage = $derived(`Request ${commentSectionName} access to comment.`)
  const threadAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.thread,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const replyAuthorPubkeys = $derived(
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
  const threadFilterPlan = $derived(
    communityAuthorityReady && communityId && threadId
      ? makeCommunityContentFilterPlan(
          [makeCommunityThreadsFilter(communityId, {ids: [threadId]})],
          threadAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const replyFilterPlan = $derived(
    communityAuthorityReady && communityId && threadId
      ? makeCommunityContentFilterPlan(
          [makeCommunityThreadRepliesFilter(communityId, {"#E": [threadId]})],
          replyAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const threadFilters = $derived(threadFilterPlan.localFilters)
  const threadRelayFilters = $derived(threadFilterPlan.relayFilters)
  const replyFilters = $derived(replyFilterPlan.localFilters)
  const replyRelayFilters = $derived(replyFilterPlan.relayFilters)
  const threadEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: threadFilters})),
  )
  const replyEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: replyFilters})),
  )
  const threadProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: $threadEvents,
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event =>
        Boolean(
          threadAuthorPubkeys.includes(event.pubkey) &&
          readCommunityThread(event, communityId)?.id === threadId,
        ),
    }),
  )
  const replyProjection = $derived.by(() =>
    projectAuthoredPublicationEvents({
      events: $replyEvents,
      operations: $publicationOperations.values(),
      ownerPubkey: $pubkey || "",
      matches: event =>
        Boolean(
          replyAuthorPubkeys.includes(event.pubkey) &&
          readCommunityThreadReply(event, communityId, threadId),
        ),
    }),
  )
  const thread = $derived(
    communityAuthorityReady && threadProjection.events[0]
      ? readCommunityThread(threadProjection.events[0], communityId)
      : undefined,
  )
  const threadOperationId = $derived(
    thread ? threadProjection.operationIds.get(thread.id) : undefined,
  )
  const threadCensorReason = $derived.by(() =>
    communityId && threadId
      ? getCommunityCensorReason({
          reportState: $activeCommunityReportState,
          eventId: thread?.event.id || threadId,
          eventAddress: thread ? getCommunityReportEventAddress(thread.event) : "",
          pubkey: thread?.event.pubkey,
          sectionName: threadSectionName,
        })
      : undefined,
  )
  const replies = $derived(
    filterVisibleAfterDeletesAndEdits(replyProjection.events, $editedTargetIds)
      .map(event => readCommunityThreadReply(event, communityId, threadId))
      .filter(Boolean)
      .filter(reply => !isCommunityPersonBanned($activeCommunityReportState, reply!.event.pubkey))
      .sort((a, b) => (a?.event.created_at || 0) - (b?.event.created_at || 0)),
  )

  let showAllReplies = $state(false)
  let hashTargetRequest = 0
  let hashTarget = $state({id: "", request: 0})
  let revealedHashTargetKey = ""

  const visibleReplies = $derived(
    showAllReplies ? replies : replies.slice(Math.max(replies.length - 4, 0)),
  )
  const repliesById = $derived.by(() => new Map(replies.map(reply => [reply!.id, reply!])))
  const latestReplyId = $derived(replies.at(-1)?.id || "")
  const canReply = $derived(
    Boolean(
      thread &&
      !threadOperationId &&
      communityAuthorityReady &&
      !threadCensorReason &&
      $pubkey &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.comment,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const canReact = $derived(
    Boolean(
      $pubkey &&
      !threadOperationId &&
      communityAuthorityReady &&
      !threadCensorReason &&
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

  const openCommentPrompt = async (replyParent?: TrustedEvent) => {
    parent = replyParent
    eventToEdit = undefined
    showReply = true
    await tick()
    compose?.focus()
  }

  const openEditPrompt = async (event: TrustedEvent) => {
    parent = undefined
    eventToEdit = event
    showReply = true
    await tick()
    compose?.focus()
  }

  const closeCommentPrompt = () => {
    parent = undefined
    eventToEdit = undefined
    showReply = false
  }

  const clearParent = () => {
    parent = undefined
  }

  const sendReply = async ({content, tags}: EventContent) => {
    const trimmed = content.trim()
    if (!trimmed || !communityId || !threadId) return false
    if (!thread) {
      pushToast({theme: "error", message: "Thread metadata is not loaded yet."})
      return false
    }
    if (!canReply) {
      pushToast({theme: "error", message: commentAccessMessage})
      return false
    }

    const relays = $activeExactCommunityPublishRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return false
    }

    if (eventToEdit) {
      try {
        await publishEditedReply({
          event: eventToEdit,
          content: trimmed,
          tags,
          relays,
          url: communityOwnerPubkey,
        })
      } catch (error) {
        pushToast({
          theme: "error",
          message: error instanceof Error ? error.message : "Failed to publish edit.",
        })
        return false
      }
      closeCommentPrompt()
      return true
    }

    const template = makeCommunityThreadReply({
      communityPubkey: communityId,
      thread: {id: thread.id, creatorPubkey: thread.creatorPubkey},
      relay: relays[0],
      content: trimmed,
      tags,
      parent: parent
        ? {id: parent.id, pubkey: parent.pubkey, kind: parent.kind, relay: relays[0]}
        : undefined,
    })

    try {
      startPublication({
        relays,
        event: makeEvent(COMMENT, template),
        label: "Thread comment",
        href: threadPath,
        preview: "retain-on-failure",
      })
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to publish comment.",
      })
      return false
    }

    closeCommentPrompt()
    return true
  }

  const scrollToLatestReply = async () => {
    await tick()
    const latestReply = element?.querySelector("[data-latest-reply]")

    if (latestReply) {
      latestReply.scrollIntoView({block: "end"})
    }
  }

  const scrollToReplyParent = async (event: TrustedEvent) => {
    showAllReplies = true
    await tick()
    await scrollToEvent(event.id)
  }

  const canEditReply = (event: TrustedEvent) => canEditReplyEvent(event, $pubkey, canReply)

  let loadingThread = $state(false)
  let loadingReplies = $state(false)
  let threadLoadStatus = $state<CommunityHydrationStatus>("idle")
  let historicalLoadRetryVersion = $state(0)
  let showReply = $state(false)
  let parent: TrustedEvent | undefined = $state()
  let eventToEdit: TrustedEvent | undefined = $state()
  let compose: RoomCompose | undefined = $state()
  let element: HTMLElement | undefined = $state()
  let initialScrollDone = $state(false)
  let initialScrollThreadId = ""

  const syncHashTarget = () => {
    const match = window.location.hash.match(/^#event-([0-9a-f]{64})$/i)
    hashTarget = {id: match?.[1]?.toLowerCase() || "", request: ++hashTargetRequest}
  }

  $effect(() => {
    if (typeof window === "undefined") return

    syncHashTarget()
    window.addEventListener("hashchange", syncHashTarget)

    return () => window.removeEventListener("hashchange", syncHashTarget)
  })

  $effect(() => {
    void historicalLoadRetryVersion

    if (
      !communityBootstrapReady ||
      !communityAddress ||
      !threadId ||
      $activeExactCommunityRelays.length === 0
    ) {
      loadingThread = false
      loadingReplies = false
      threadLoadStatus = "idle"
      return
    }

    const localFilters = [...threadFilters, ...replyFilters]
    const relayFilters = [...threadRelayFilters, ...replyRelayFilters]
    if (localFilters.length === 0 || relayFilters.length === 0) {
      loadingThread = false
      loadingReplies = false
      threadLoadStatus = "idle"
      return
    }

    const controller = new AbortController()
    const relays = $activeExactCommunityRelays

    threadLoadStatus = "loading"
    loadingThread = true
    loadingReplies = true
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      timeoutMs: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-thread:${communityAddress}:${threadId}`,
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        threadLoadStatus = result.complete ? "complete" : "incomplete"
        loadingThread = false
        loadingReplies = false
      })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-thread] Failed to load thread history", error)
        threadLoadStatus = "failed"
        loadingThread = false
        loadingReplies = false
      })

    return () => controller.abort()
  })

  $effect(() => {
    if (thread) {
      loadingThread = false
    }
    if (replies.length > 0) {
      loadingReplies = false
    }
  })

  $effect(() => {
    if (threadId !== initialScrollThreadId) {
      initialScrollDone = false
      initialScrollThreadId = threadId
    }
  })

  $effect(() => {
    const {id, request} = hashTarget
    const targetKey = `${threadPath}:${request}:${id}`
    const targetIsLoaded = thread?.event.id === id || replies.some(reply => reply?.id === id)
    if (!id || !targetIsLoaded || revealedHashTargetKey === targetKey) return

    revealedHashTargetKey = targetKey
    showAllReplies = true
    void tick().then(() => {
      if (hashTarget.request === request) void scrollToEvent(id)
    })
  })

  const retryHistoricalLoad = () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      window.location.reload()
      return
    }

    historicalLoadRetryVersion += 1
  }

  $effect(() => {
    if (!element || !latestReplyId || initialScrollDone || hashTarget.id) return

    const timeout = setTimeout(() => {
      initialScrollDone = true
      scrollToLatestReply()
    }, 100)

    return () => clearTimeout(timeout)
  })

  onDestroy(() => {
    setChecked(threadPath)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={threadsPath} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
    </div>
  {/snippet}
  {#snippet title()}
    <strong>{threadCensorReason ? "Moderated thread" : thread?.title || "Thread"}</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={routeCommunity?.naddr} />
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-col gap-2 p-2 pt-4">
  {#if thread}
    <article class="card2 bg-alt relative p-4 shadow-md" data-event={thread.event.id}>
      {#if threadCensorReason}
        <ModeratedContent reason={threadCensorReason} />
      {:else}
        <NoteCard event={thread.event} relays={$activeExactCommunityRelays}>
          <h1 class="text-xl font-bold">{thread.title}</h1>
          <Content
            event={thread.event}
            url={communityOwnerPubkey}
            communitySectionName={threadSectionName}
            expandMode="inline" />
          {#if threadOperationId}
            <PublicationStatus operationId={threadOperationId} class="mt-3" />
          {/if}
          {#if !threadOperationId}
            <div class="mt-3 flex justify-end">
              <ThreadActions
                community={routeCommunity}
                url={communityOwnerPubkey}
                relays={$activeExactCommunityRelays}
                publishRelays={$activeExactCommunityPublishRelays}
                scopeH={communityId}
                communitySectionName={threadSectionName}
                allowedAuthors={replyAuthorPubkeys}
                reactionAllowedAuthors={reactionAuthorPubkeys}
                reportAllowedAuthors={reportAuthorPubkeys}
                readOnly={!canReact}
                event={thread.event} />
            </div>
          {/if}
        </NoteCard>
      {/if}
    </article>

    {#if !threadCensorReason && !showAllReplies && replies.length > visibleReplies.length}
      <div class="flex justify-center py-2">
        <button class="btn btn-link" type="button" onclick={() => (showAllReplies = true)}>
          Show all {replies.length} replies
        </button>
      </div>
    {/if}

    {#if !threadCensorReason}
      <div class="col-2">
        {#each visibleReplies as item (item?.id)}
          {#if item}
            {@const replyParent = item.parentReplyId
              ? repliesById.get(item.parentReplyId)?.event
              : undefined}
            <div
              class="card2 bg-alt shadow-sm"
              data-latest-reply={item.id === latestReplyId ? "true" : undefined}>
              <ChannelMessage
                url={communityOwnerPubkey}
                community={routeCommunity}
                event={item.event}
                operationId={replyProjection.operationIds.get(item.id)}
                showPubkey
                readOnly={!canReact}
                interactionRelays={$activeExactCommunityRelays}
                actionRelays={$activeExactCommunityPublishRelays}
                profileRelays={$activeExactCommunityRelays}
                allowedAuthors={replyAuthorPubkeys}
                reactionAllowedAuthors={reactionAuthorPubkeys}
                reportAllowedAuthors={reportAuthorPubkeys}
                scopeH={communityId}
                communitySectionName={commentSectionName}
                {replyParent}
                onReplyParentOpen={scrollToReplyParent}
                canEdit={canEditReply}
                onEdit={openEditPrompt}
                replyTo={canReply ? event => openCommentPrompt(event) : undefined} />
            </div>
          {/if}
        {/each}
        {#if loadingReplies && replies.length === 0}
          <p class="flex h-10 items-center justify-center py-20 text-center">
            <Spinner loading={loadingReplies}>Looking for replies...</Spinner>
          </p>
        {:else if communityAuthorityLoading}
          <p class="flex h-10 items-center justify-center py-20 text-center">
            <Spinner loading>Loading replies...</Spinner>
          </p>
        {:else if replies.length === 0}
          <p class="py-8 text-center opacity-70">No replies yet.</p>
        {/if}
      </div>
    {/if}

    {#if !threadCensorReason && showReply}
      <div class="card2 bg-alt col-3 p-4 shadow-md">
        <div class="flex items-center justify-between gap-2">
          <strong>{parent ? "Reply" : "Comment"}</strong>
          <button class="btn btn-link btn-sm" type="button" onclick={closeCommentPrompt}>
            Cancel
          </button>
        </div>
        {#if parent}
          <RoomComposeParent event={parent} clear={clearParent} verb="Replying to" />
        {/if}
        {#if eventToEdit}
          <RoomComposeEdit clear={() => (eventToEdit = undefined)} />
        {/if}
        {#key eventToEdit}
          <RoomCompose
            url={$activeExactCommunityRelays[0] || communityOwnerPubkey}
            h={communityId}
            blossomContext={communityDefinition
              ? {
                  type: "community",
                  communityAddress: communityDefinition.pointer.address,
                }
              : undefined}
            showMenu={false}
            onSubmit={sendReply}
            onEscape={closeCommentPrompt}
            content={eventToEdit?.content}
            bind:this={compose} />
        {/key}
      </div>
    {:else if !threadCensorReason}
      <div class="flex justify-end">
        {#if canReply}
          <button class="btn btn-primary" type="button" onclick={() => openCommentPrompt()}>
            <Icon icon={Reply} />
            Comment
          </button>
        {:else if communityBootstrapLoading || communityAuthorityLoading}
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner loading>Checking reply access...</Spinner>
          </div>
        {:else}
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="comment on threads"
            class="btn btn-primary">
            <Icon icon={Reply} />
            Comment
          </PublishGate>
        {/if}
      </div>
    {/if}
  {:else if communityBootstrapLoading || communityAuthorityLoading || loadingThread || (threadFilters.length > 0 && threadLoadStatus === "idle") || threadLoadStatus === "queued" || threadLoadStatus === "loading"}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading thread...</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityAuthorityUnavailable}
    <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
      <p>Thread unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else}
    <p class="py-8 text-center opacity-70">Thread not found or not approved for this community.</p>
  {/if}
</PageContent>
