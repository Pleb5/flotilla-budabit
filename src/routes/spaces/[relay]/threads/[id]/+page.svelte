<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {sortBy, sleep} from "@welshman/lib"
  import {COMMENT, getTag, getTagValue, GIT_ISSUE, type Filter, type TrustedEvent} from "@welshman/util"
  import { repository} from "@welshman/app"
  import {load, request} from "@welshman/net"
  import {deriveEvents} from "@welshman/store"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Content from "@app/components/Content.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import ThreadActions from "@app/components/ThreadActions.svelte"
  import EventReply from "@app/components/EventReply.svelte"
  import {deriveEvent, decodeRelay} from "@app/state"
  import {setChecked} from "@app/notifications"
  import { FREELANCE_JOB } from "@src/lib/util"
  import JobItem from "@src/app/components/JobItem.svelte"
  import GitIssueItem from "@src/app/components/GitIssueItem.svelte"

  const {relay, id} = $page.params
  const url = decodeRelay(relay)
  const event = deriveEvent(id)
  const filters = [{kinds: [COMMENT], "#E": [id]}]
  const replies = deriveEvents(repository, {filters})

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

  let jobOrGitIssue: TrustedEvent | undefined = $state(undefined)
  const loadJob = async(jobAddress: string, relayHint: string | undefined) => {
    const jobPubkey = jobAddress.split(":")[1]
    const jobDTag = jobAddress.split(":")[2]
    const jobFilter: Filter = {
      kinds: [FREELANCE_JOB],
      authors: [jobPubkey],
      '#d': [jobDTag]
    }
    const request = {filters: [jobFilter], relays: [url]}
    if (relayHint) request.relays = [relayHint]

    const jobs = await load(request)
    if (jobs.length > 0) jobOrGitIssue = jobs[0]
  }

  const loadGitIssue = async(issueId: string, relayHint: string | undefined) => {
    const issueFilter: Filter = {
      ids: [issueId],
      kinds: [GIT_ISSUE],
    }
    const request = {filters: [issueFilter], relays: [url]}
    if (relayHint) request.relays = [relayHint]

    const issues = await load(request)
    if (issues.length > 0) jobOrGitIssue = issues[0]
  }

  $effect( () => {
    if ($event) {
      const gitIssueId = getTagValue('gitissue', $event.tags)
      const jobAddress = getTagValue('job', $event.tags)
      if (gitIssueId) {
        loadGitIssue(gitIssueId, getTag('gitissue', $event.tags)?.[2])
      } else if (jobAddress) {
        loadJob(jobAddress, getTag('job', $event.tags)?.[2])
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

{#snippet jobOrGitIssueElem()}
  {#if jobOrGitIssue}
    {#if jobOrGitIssue.kind === FREELANCE_JOB}
      <JobItem {url} showExternal={true} event={jobOrGitIssue} />
    {:else if jobOrGitIssue.kind === GIT_ISSUE}
      <GitIssueItem issue={jobOrGitIssue} fetchRepoAndStatus={true}/>
    {/if}
  {/if}  
{/snippet}

<div class="relative flex flex-col-reverse gap-3 px-2">
  <div class="absolute left-[51px] top-32 h-[calc(100%-248px)] w-[2px] bg-neutral"></div>
  {#if $event}
    {#if !showReply}
      <div class="flex justify-end px-2 pb-2">
        <Button class="btn btn-primary" onclick={openReply}>
          <Icon icon="reply" />
          Reply to thread
        </Button>
      </div>
    {/if}
    {#each sortBy(e => -e.created_at, $replies).slice(0, showAll ? undefined : 4) as reply (reply.id)}
      <NoteCard event={reply} class="card2 bg-alt z-feature w-full">
        <div class="col-3 ml-12">
          <Content showEntire event={reply} />
          <ThreadActions event={reply} {url} />
        </div>
      </NoteCard>
    {/each}
    {#if !showAll && $replies.length > 4}
      <div class="flex justify-center">
        <Button class="btn btn-link" onclick={expand}>
          <Icon icon="sort-vertical" />
          Show all {$replies.length} replies
        </Button>
      </div>
    {/if}
    {@render jobOrGitIssueElem()}
    <NoteCard event={$event} class="card2 bg-alt z-feature w-full">
      <div class="col-3 ml-12">
        <Content showEntire event={$event} />
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
  <PageBar class="!mx-0">
    {#snippet icon()}
      <div>
        <Button class="btn btn-neutral btn-sm flex-nowrap whitespace-nowrap" onclick={back}>
          <Icon icon="alt-arrow-left" />
          <span class="hidden sm:inline">Go back</span>
        </Button>
      </div>
    {/snippet}
    {#snippet title()}
      <h1 class="text-xl">{getTagValue("title", $event?.tags || []) || ""}</h1>
    {/snippet}
    {#snippet action()}
      <div>
        <MenuSpaceButton {url} />
      </div>
    {/snippet}
  </PageBar>
</div>
{#if showReply}
  <EventReply {url} event={$event} onClose={closeReply} onSubmit={closeReply} />
{/if}
