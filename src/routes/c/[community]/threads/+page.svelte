<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {repository, publishThunk, pubkey} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, THREAD} from "@welshman/util"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Field from "@lib/components/Field.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import ThreadItem from "@app/components/ThreadItem.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {makeCommunityForumThreadsFilter} from "@app/core/community-feeds"
  import {makeCommunityForumThread, readCommunityForumThreads} from "@app/core/community-forum"
  import {COMMUNITY_SECTION_FORUM} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {makeCommunityThreadPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const forumAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_FORUM,
        })
      : [],
  )
  const filters = $derived(
    communityPubkey && forumAuthorPubkeys.length
      ? [makeCommunityForumThreadsFilter(communityPubkey, {authors: forumAuthorPubkeys})]
      : [],
  )
  const events = $derived(deriveEventsAsc(deriveEventsById({repository, filters})))
  const threads = $derived(readCommunityForumThreads($events, communityPubkey))
  const canCreateThread = $derived(
    Boolean(
      $pubkey &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target: COMMUNITY_WRITE_TARGETS.forumThread,
        }),
    ),
  )
  const canReact = $derived(
    Boolean(
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

  const createThread = () => {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!communityPubkey || !trimmedTitle || !trimmedContent) return
    if (!canCreateThread) {
      pushToast({theme: "error", message: "You do not have permission to create forum threads."})
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
        THREAD,
        makeCommunityForumThread({communityPubkey, title: trimmedTitle, content: trimmedContent}),
      ),
    })
    title = ""
    content = ""
    pushToast({message: "Thread published."})
  }

  let title = $state("")
  let content = $state("")

  $effect(() => {
    if (!communityPubkey || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters, signal: controller.signal})

    return () => controller.abort()
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
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createThread)}>
    <strong>Create thread</strong>
    <Field>
      {#snippet label()}
        <p>Title</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={NotesMinimalistic} />
          <input bind:value={title} class="grow" type="text" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Message</p>
      {/snippet}
      {#snippet input()}
        <textarea bind:value={content} class="textarea textarea-bordered" rows="4"></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end">
      <PublishGate target={COMMUNITY_WRITE_TARGETS.forumThread} action="create forum threads" submit disabled={!title.trim() || !content.trim()}>
        Create thread
      </PublishGate>
    </div>
  </form>

  <div class="col-2">
    {#each threads as thread (thread.id)}
      <ThreadItem
        url={communityPubkey}
        relays={$activeCommunityRelays}
        scopeH={communityPubkey}
        readOnly={!canReact}
        event={thread.event} />
    {:else}
      <p class="py-8 text-center opacity-70">No threads found.</p>
    {/each}
  </div>
</PageContent>
