<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {repository, publishThunk, pubkey} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {COMMENT, THREAD, makeEvent} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {
    makeCommunityForumReply,
    readCommunityForumReply,
    readCommunityForumThread,
  } from "@app/core/community-forum"
  import {COMMUNITY_SECTION_FORUM, COMMUNITY_SECTION_GENERAL} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const threadId = $derived($page.params.thread || "")
  const threadAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_FORUM,
        })
      : [],
  )
  const replyAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_GENERAL,
        })
      : [],
  )
  const threadFilters = $derived(
    threadId && threadAuthorPubkeys.length ? [{kinds: [THREAD], ids: [threadId], authors: threadAuthorPubkeys}] : [],
  )
  const replyFilters = $derived(
    threadId && replyAuthorPubkeys.length ? [{kinds: [COMMENT], "#E": [threadId], authors: replyAuthorPubkeys}] : [],
  )
  const threadEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: threadFilters})))
  const replyEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: replyFilters})))
  const thread = $derived(
    $threadEvents[0] ? readCommunityForumThread($threadEvents[0], communityPubkey) : undefined,
  )
  const replies = $derived(
    $replyEvents
      .map(event => readCommunityForumReply(event, communityPubkey, threadId))
      .filter(Boolean),
  )
  const canReply = $derived(
    Boolean(
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

  const sendReply = () => {
    const trimmed = reply.trim()
    if (!trimmed || !communityPubkey || !threadId) return
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
        makeCommunityForumReply({
          communityPubkey,
          thread: {id: threadId, creatorPubkey: thread?.creatorPubkey || ""},
          relay: relays[0],
          content: trimmed,
        }),
      ),
    })
    reply = ""
  }

  let reply = $state("")

  onMount(() => {
    if (!communityPubkey || !threadId || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: [...threadFilters, ...replyFilters], signal: controller.signal})

    return () => controller.abort()
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
    <strong>{thread?.title || "Thread"}</strong>
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  {#if thread}
    <article class="card2 bg-alt p-4 shadow-md">
      <h1 class="text-xl font-bold">{thread.title}</h1>
      <p class="whitespace-pre-wrap">{thread.content}</p>
    </article>
  {/if}

  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(sendReply)}>
    <strong>Reply</strong>
    <textarea bind:value={reply} class="textarea textarea-bordered" rows="4"></textarea>
    <div class="flex justify-end">
      <PublishGate target={COMMUNITY_WRITE_TARGETS.comment} action="reply" submit disabled={!reply.trim()}>
        <Icon icon={Reply} />
        Reply
      </PublishGate>
    </div>
  </form>

  <div class="col-2">
    {#each replies as item (item?.id)}
      {#if item}
        <div class="card2 bg-alt p-4 shadow-sm">
          <p class="text-xs opacity-50">{item.event.pubkey.slice(0, 8)}</p>
          <p class="whitespace-pre-wrap">{item.event.content}</p>
        </div>
      {/if}
    {:else}
      <p class="py-8 text-center opacity-70">No replies yet.</p>
    {/each}
  </div>
</PageContent>
