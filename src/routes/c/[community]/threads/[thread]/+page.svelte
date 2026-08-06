<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {page} from "$app/stores"
  import {repository, publishThunk, pubkey} from "@welshman/app"
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
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityPermissionStatus,
    activeCommunityProfileListEvents,
    activeCommunityPublishRelays,
    activeCommunityReportState,
    activeCommunityRelays,
    hydrateCommunityEventsWithStatus,
    type CommunityHydrationStatus,
  } from "@app/core/community-state"
  import {
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
  import {setChecked} from "@app/util/notifications"
  import {makeCommunityThreadPath, parseCommunityRouteParam} from "@app/util/routes"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"

  const REQUEST_HARD_TIMEOUT_MS = 10_000

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const threadId = $derived($page.params.thread || "")
  const threadsPath = $derived(
    communityPubkey ? makeCommunityThreadPath(communityPubkey) : $page.url.pathname,
  )
  const threadPath = $derived(
    communityPubkey && threadId ? makeCommunityThreadPath(communityPubkey, threadId) : threadsPath,
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
  const threadSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.thread,
    ),
  )
  const commentSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityBootstrapReady ? $activeCommunityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.comment,
    ),
  )
  const commentAccessMessage = $derived(`Request ${commentSectionName} access to comment.`)
  const threadAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.thread,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const replyAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.comment,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const threadFilters = $derived(
    communityBootstrapReady && communityPubkey && threadId && threadAuthorPubkeys.length
      ? [
          makeCommunityThreadsFilter(communityPubkey, {
            ids: [threadId],
            authors: threadAuthorPubkeys,
          }),
        ]
      : [],
  )
  const replyFilters = $derived(
    communityBootstrapReady && communityPubkey && threadId && replyAuthorPubkeys.length
      ? [
          makeCommunityThreadRepliesFilter(communityPubkey, {
            "#E": [threadId],
            authors: replyAuthorPubkeys,
          }),
        ]
      : [],
  )
  const threadEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: threadFilters})),
  )
  const replyEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: replyFilters})),
  )
  const thread = $derived(
    $threadEvents[0] ? readCommunityThread($threadEvents[0], communityPubkey) : undefined,
  )
  const threadCensorReason = $derived.by(() =>
    communityPubkey && threadId
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
    filterVisibleAfterDeletesAndEdits($replyEvents, $editedTargetIds)
      .map(event => readCommunityThreadReply(event, communityPubkey, threadId))
      .filter(Boolean)
      .filter(reply => !isCommunityPersonBanned($activeCommunityReportState, reply!.event.pubkey))
      .sort((a, b) => (a?.event.created_at || 0) - (b?.event.created_at || 0)),
  )

  let showAllReplies = $state(false)

  const visibleReplies = $derived(
    showAllReplies ? replies : replies.slice(Math.max(replies.length - 4, 0)),
  )
  const repliesById = $derived.by(() => new Map(replies.map(reply => [reply!.id, reply!])))
  const latestReplyId = $derived(replies.at(-1)?.id || "")
  const canReply = $derived(
    Boolean(
      thread &&
      communityBootstrapReady &&
      !threadCensorReason &&
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
      $pubkey &&
      communityBootstrapReady &&
      !threadCensorReason &&
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

  const sendReply = ({content, tags}: EventContent) => {
    const trimmed = content.trim()
    if (!trimmed || !communityPubkey || !threadId) return false
    if (!thread) {
      pushToast({theme: "error", message: "Thread metadata is not loaded yet."})
      return false
    }
    if (!canReply) {
      pushToast({theme: "error", message: commentAccessMessage})
      return false
    }

    const relays = $activeCommunityPublishRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return false
    }

    if (eventToEdit) {
      publishEditedReply({
        event: eventToEdit,
        content: trimmed,
        tags,
        relays,
        url: communityPubkey,
      })
      closeCommentPrompt()
      return true
    }

    const template = makeCommunityThreadReply({
      communityPubkey,
      thread: {id: thread.id, creatorPubkey: thread.creatorPubkey},
      relay: relays[0],
      content: trimmed,
      tags,
      parent: parent
        ? {id: parent.id, pubkey: parent.pubkey, kind: parent.kind, relay: relays[0]}
        : undefined,
    })

    publishThunk({
      relays,
      event: makeEvent(COMMENT, template),
    })
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

  $effect(() => {
    void historicalLoadRetryVersion

    if (
      !communityBootstrapReady ||
      !communityPubkey ||
      !threadId ||
      $activeCommunityRelays.length === 0
    ) {
      loadingThread = false
      loadingReplies = false
      threadLoadStatus = "idle"
      return
    }

    const filters = [...threadFilters, ...replyFilters]
    if (filters.length === 0) {
      loadingThread = false
      loadingReplies = false
      threadLoadStatus = "idle"
      return
    }

    const controller = new AbortController()

    threadLoadStatus = "queued"
    loadingThread = true
    loadingReplies = true
    void hydrateCommunityEventsWithStatus({
      key: `thread:${threadPath}:${historicalLoadRetryVersion}:${JSON.stringify(filters)}`,
      relays: $activeCommunityRelays,
      filters,
      authenticate: true,
      timeout: REQUEST_HARD_TIMEOUT_MS,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      signal: controller.signal,
      onStatus: status => {
        threadLoadStatus = status
        loadingThread = status === "queued" || status === "loading"
        loadingReplies = status === "queued" || status === "loading"
      },
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

  const retryHistoricalLoad = () => {
    if (communityBootstrapFailed || communityPermissionEvidenceIncomplete) {
      window.location.reload()
      return
    }

    historicalLoadRetryVersion += 1
  }

  $effect(() => {
    if (!element || !latestReplyId || initialScrollDone) return

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
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-col gap-2 p-2 pt-4">
  {#if thread}
    <article class="card2 bg-alt relative p-4 shadow-md">
      {#if threadCensorReason}
        <ModeratedContent reason={threadCensorReason} />
      {:else}
        <NoteCard event={thread.event} relays={$activeCommunityRelays}>
          <h1 class="text-xl font-bold">{thread.title}</h1>
          <Content
            event={thread.event}
            url={communityPubkey}
            communitySectionName={threadSectionName}
            expandMode="inline" />
          <div class="mt-3 flex justify-end">
            <ThreadActions
              url={communityPubkey}
              relays={$activeCommunityRelays}
              publishRelays={$activeCommunityPublishRelays}
              scopeH={communityPubkey}
              communitySectionName={threadSectionName}
              allowedAuthors={replyAuthorPubkeys}
              readOnly={!canReact}
              event={thread.event} />
          </div>
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
                url={communityPubkey}
                event={item.event}
                showPubkey
                readOnly={!canReact}
                interactionRelays={$activeCommunityRelays}
                actionRelays={$activeCommunityPublishRelays}
                profileRelays={$activeCommunityRelays}
                interactionAuthorPubkeys={replyAuthorPubkeys}
                scopeH={communityPubkey}
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
        {:else if replies.length === 0 && (threadLoadStatus === "incomplete" || threadLoadStatus === "failed")}
          <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
            <p>Reply history is incomplete or temporarily unavailable.</p>
            <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
              >Retry</button>
          </div>
        {:else if communityPermissionsLoading}
          <p class="flex h-10 items-center justify-center py-20 text-center">
            <Spinner loading>Loading reply permissions...</Spinner>
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
            url={$activeCommunityRelays[0] || communityPubkey}
            h={communityPubkey}
            blossomContext={{type: "community", communityPubkey}}
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
        {:else if communityBootstrapLoading || communityPermissionsLoading}
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
  {:else if communityBootstrapLoading || communityPermissionsLoading || loadingThread || (threadFilters.length > 0 && threadLoadStatus === "idle") || threadLoadStatus === "queued" || threadLoadStatus === "loading"}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading thread...</Spinner>
    </p>
  {:else if communityBootstrapFailed || communityPermissionEvidenceIncomplete || threadLoadStatus === "incomplete" || threadLoadStatus === "failed"}
    <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
      <p>Thread lookup is incomplete or temporarily unavailable.</p>
      <button class="btn btn-neutral btn-sm" type="button" onclick={retryHistoricalLoad}
        >Retry</button>
    </div>
  {:else}
    <p class="py-8 text-center opacity-70">Thread not found or not approved for this community.</p>
  {/if}
</PageContent>
