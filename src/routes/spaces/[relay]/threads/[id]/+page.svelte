<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {sleep, sortBy, type MakeNonOptional} from "@welshman/lib"
  import {
    COMMENT,
    getTag,
    getTagValue,
    GIT_ISSUE,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {repository} from "@welshman/app"
  import {load, request} from "@welshman/net"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import SortVertical from "@assets/icons/sort-vertical.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import CommentActions from "@app/components/CommentActions.svelte"
  import SpaceMenuButton from "@app/components/SpaceMenuButton.svelte"
  import ThreadActions from "@app/components/ThreadActions.svelte"
  import EventReply from "@app/components/EventReply.svelte"
  import {deriveEvent, decodeRelay} from "@app/core/state"
  import {setChecked} from "@app/util/notifications"
  import GitIssueItem from "@src/app/components/GitIssueItem.svelte"
  import ChannelContent from "@app/components/ChannelMessage.svelte"
  import Reply from "@assets/icons/reply-2.svg?dataurl"
  import {deriveEventsById, deriveEventsDesc} from "@welshman/store"

  const {relay, id} = $page.params as MakeNonOptional<typeof $page.params>
  const url = decodeRelay(relay)
  const event = deriveEvent(id, [url])
  const filters = [{kinds: [COMMENT], "#E": [id]}]
  const replies = deriveEventsDesc(deriveEventsById({filters, repository}))

  let element: HTMLElement | undefined = $state()

  const back = () => history.back()

  const openReply = () => {
    showReply = true
  }

  const closeReply = () => {
    showReply = false
  }

  const expand = () => {
    showAll = true
  }

  let showAll = $state(false)
  let showReply = $state(false)

  let gitIssue: TrustedEvent | undefined = $state(undefined)

  const loadGitIssue = async (issueId: string, relayHint: string | undefined) => {
    const issueFilter: Filter = {
      ids: [issueId],
      kinds: [GIT_ISSUE],
    }
    const request = {filters: [issueFilter], relays: [url]}
    if (relayHint) request.relays = [relayHint]

    const issues = await load(request)
    if (issues.length > 0) gitIssue = issues[0]
  }

  $effect(() => {
    if ($event) {
      const gitIssueId = getTagValue("gitissue", $event.tags)
      if (gitIssueId) {
        loadGitIssue(gitIssueId, getTag("gitissue", $event.tags)?.[2])
      }
    }
  })

  onMount(() => {
    const controller = new AbortController()

    request({relays: [url], filters, signal: controller.signal})

    return () => {
      controller.abort()
      setChecked($page.url.pathname)
    }
  })
</script>

{#snippet gitIssueElem()}
  {#if gitIssue?.kind === GIT_ISSUE}
    <GitIssueItem issue={gitIssue} fetchRepoAndStatus={true} />
  {/if}
{/snippet}

<PageBar class="!mx-0">
  {#snippet icon()}
    <div>
      <Button class="btn btn-neutral btn-sm flex-nowrap whitespace-nowrap" onclick={back}>
        <Icon icon={AltArrowLeft} />
        <span class="hidden sm:inline">Go back</span>
      </Button>
    </div>
  {/snippet}
  {#snippet title()}
    <h1 class="text-xl">{getTagValue("title", $event?.tags || []) || ""}</h1>
  {/snippet}
  {#snippet action()}
    <div>
      <SpaceMenuButton {url} />
    </div>
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-2 p-2 pt-4">
  <div class="relative flex flex-col-reverse gap-3 px-2">
    <div class="absolute left-[51px] top-32 h-[calc(100%-248px)] w-[2px] bg-neutral"></div>
    {#if $event}
      {#if !showReply}
        <div class="flex justify-end px-2 pb-2">
          <Button class="btn btn-primary" onclick={openReply}>
            <Icon icon={Reply} />
            Reply to thread
          </Button>
        </div>
      {/if}
      {#each sortBy((e: TrustedEvent) => -e.created_at, $replies).slice(0, showAll ? undefined : 4) as reply (reply.id)}
        <NoteCard event={reply} class="card2 bg-alt z-feature w-full">
          <div class="col-3 ml-12">
            <ChannelContent {url} event={reply} />
            <CommentActions event={reply} {url} />
          </div>
        </NoteCard>
      {/each}
      {#if !showAll && $replies.length > 4}
        <div class="flex justify-center">
          <Button class="btn btn-link" onclick={expand}>
            <Icon icon={SortVertical} />
            Show all {$replies.length} replies
          </Button>
        </div>
      {/if}
      {@render gitIssueElem()}
      <NoteCard event={$event} class="card2 bg-alt z-feature w-full">
        <div class="col-3 ml-12">
          <ChannelContent {url} event={$event} />
          <ThreadActions event={$event} {url} />
        </div>
      </NoteCard>
    {:else}
      {#await sleep(5000)}
        <Spinner loading>Loading thread...</Spinner>
      {:then}
        <p>Failed to load thread.</p>
      {/await}
    {/if}
  </div>
  {#if showReply}
    <EventReply {url} event={$event} onClose={closeReply} onSubmit={closeReply} />
  {/if}
</PageContent>
