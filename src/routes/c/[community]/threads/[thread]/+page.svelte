<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {repository, publishThunk, pubkey} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {COMMENT, makeEvent, type EventContent} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import Content from "@app/components/Content.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import ThreadActions from "@app/components/ThreadActions.svelte"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityBlossomServers,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
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
  import {COMMUNITY_SECTION_GENERAL, COMMUNITY_SECTION_THREADS} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {getCommunityCensorReason, isCommunityPersonBanned} from "@app/core/community-reports"
  import {setChecked} from "@app/util/notifications"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const threadId = $derived($page.params.thread || "")
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
  const threadAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_THREADS,
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
          pubkey: thread?.event.pubkey,
          sectionName: COMMUNITY_SECTION_THREADS,
        })
      : undefined,
  )
  const replies = $derived(
    $replyEvents
      .map(event => readCommunityThreadReply(event, communityPubkey, threadId))
      .filter(Boolean)
      .filter(reply => !isCommunityPersonBanned($activeCommunityReportState, reply!.event.pubkey))
      .sort((a, b) => (a?.event.created_at || 0) - (b?.event.created_at || 0)),
  )

  let showAllReplies = $state(false)

  const visibleReplies = $derived(
    showAllReplies ? replies : replies.slice(Math.max(replies.length - 4, 0)),
  )
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

  const sendReply = ({content, tags}: EventContent) => {
    const trimmed = content.trim()
    if (!trimmed || !communityPubkey || !threadId) return
    if (!thread) {
      pushToast({theme: "error", message: "Thread metadata is not loaded yet."})
      return
    }
    if (!canReply) {
      pushToast({theme: "error", message: "You do not have permission to reply."})
      return
    }

    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    publishThunk({
      relays,
      event: makeEvent(
        COMMENT,
        makeCommunityThreadReply({
          communityPubkey,
          thread: {id: thread.id, creatorPubkey: thread.creatorPubkey},
          relay: relays[0],
          content: trimmed,
          tags,
        }),
      ),
    })
    showReply = false
  }

  const scrollToLatestReply = async () => {
    await tick()
    const latestReply = element?.querySelector("[data-latest-reply]")

    if (latestReply) {
      latestReply.scrollIntoView({block: "end"})
    }
  }

  let loadingThread = $state(false)
  let loadingReplies = $state(false)
  let threadRequestStarted = $state(false)
  let showReply = $state(false)
  let element: HTMLElement | undefined = $state()
  let initialScrollDone = $state(false)
  let initialScrollThreadId = ""

  $effect(() => {
    if (
      !communityBootstrapReady ||
      !communityPubkey ||
      !threadId ||
      $activeCommunityRelays.length === 0
    ) {
      loadingThread = false
      loadingReplies = false
      threadRequestStarted = false
      return
    }

    const filters = [...threadFilters, ...replyFilters]
    if (filters.length === 0) {
      loadingThread = false
      loadingReplies = false
      threadRequestStarted = false
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      loadingThread = false
      loadingReplies = false
    }, 3000)

    threadRequestStarted = true
    loadingThread = true
    loadingReplies = true
    request({relays: $activeCommunityRelays, autoClose: true, filters, signal: controller.signal})

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  $effect(() => {
    if (thread) loadingThread = false
    if (replies.length > 0) loadingReplies = false
  })

  $effect(() => {
    if (threadId !== initialScrollThreadId) {
      initialScrollDone = false
      initialScrollThreadId = threadId
    }
  })

  $effect(() => {
    if (!element || !latestReplyId || initialScrollDone) return

    const timeout = setTimeout(() => {
      initialScrollDone = true
      scrollToLatestReply()
    }, 100)

    return () => clearTimeout(timeout)
  })

  onDestroy(() => {
    setChecked($page.url.pathname)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={makeCommunityPath(communityPubkey, "threads")} class="btn btn-neutral btn-sm">
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
        <NoteCard event={thread.event} url={communityPubkey}>
          <h1 class="text-xl font-bold">{thread.title}</h1>
          <Content
            event={thread.event}
            url={communityPubkey}
            communitySectionName={COMMUNITY_SECTION_THREADS}
            expandMode="inline" />
          <div class="mt-3 flex justify-end">
            <ThreadActions
              url={communityPubkey}
              relays={$activeCommunityRelays}
              scopeH={communityPubkey}
              communitySectionName={COMMUNITY_SECTION_THREADS}
              allowedAuthors={replyAuthorPubkeys}
              readOnly={!canReact}
              floatMobileMenu
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
            <div
              class="card2 bg-alt shadow-sm"
              data-latest-reply={item.id === latestReplyId ? "true" : undefined}>
              <ChannelMessage
                url={communityPubkey}
                event={item.event}
                showPubkey
                readOnly={!canReact}
                interactionRelays={$activeCommunityRelays}
                interactionAuthorPubkeys={replyAuthorPubkeys}
                scopeH={communityPubkey}
                communitySectionName={COMMUNITY_SECTION_GENERAL}
                protectInteractions={false} />
            </div>
          {/if}
        {/each}
        {#if loadingReplies && replies.length === 0}
          <p class="flex h-10 items-center justify-center py-20 text-center">
            <Spinner loading={loadingReplies}>Looking for replies...</Spinner>
          </p>
        {:else if replies.length === 0}
          <p class="py-8 text-center opacity-70">No replies yet.</p>
        {/if}
      </div>
    {/if}

    {#if !threadCensorReason && showReply}
      <div class="card2 bg-alt col-3 p-4 shadow-md">
        <div class="flex items-center justify-between gap-2">
          <strong>Reply</strong>
          <button class="btn btn-link btn-sm" type="button" onclick={() => (showReply = false)}>
            Cancel
          </button>
        </div>
        <RoomCompose
          url={$activeCommunityRelays[0] || communityPubkey}
          h={communityPubkey}
          mirrorUrls={$activeCommunityBlossomServers}
          showMenu={false}
          onSubmit={sendReply} />
      </div>
    {:else if !threadCensorReason}
      <div class="flex justify-end">
        {#if canReply}
          <button class="btn btn-primary" type="button" onclick={() => (showReply = true)}>
            <Icon icon={Reply} />
            Reply to thread
          </button>
        {:else if communityBootstrapLoading}
          <div class="flex items-center gap-2 text-sm opacity-70">
            <Spinner loading>Checking reply access...</Spinner>
          </div>
        {:else}
          <PublishGate
            target={COMMUNITY_WRITE_TARGETS.comment}
            action="reply to threads"
            class="btn btn-primary">
            <Icon icon={Reply} />
            Reply to thread
          </PublishGate>
        {/if}
      </div>
    {/if}
  {:else if communityBootstrapLoading || loadingThread || (threadFilters.length > 0 && !threadRequestStarted)}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading thread...</Spinner>
    </p>
  {:else}
    <p class="py-8 text-center opacity-70">Thread not found or not approved for this community.</p>
  {/if}
</PageContent>
