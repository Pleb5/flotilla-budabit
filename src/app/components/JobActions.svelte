<script lang="ts">
  import {Address, type EventContent, type TrustedEvent} from "@welshman/util"
  import {tracker} from "@welshman/app"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishDelete, publishReaction} from "@app/core/commands"
  import {makeJobPath} from "@lib/budabit"
  import Button from "@src/lib/components/Button.svelte"
  import Link from "@src/lib/components/Link.svelte"
  import {jobLink} from "@lib/budabit"
  import {pushModal} from "@app/util/modal"
  import ThreadCreate from "./ThreadCreate.svelte"
  import JobRequest from "./JobRequest.svelte"
  import {Router} from "@welshman/router"
  
  interface Props {
    url: any
    event: any
    showExternal: boolean
    showComment?: boolean
    showActivity?: boolean
    showThreadAction?: boolean
  }

  const {
    url,
    event,
    showComment = false,
    showExternal = false,
    showActivity = false,
    showThreadAction = false,
  }: Props = $props()

  const path = makeJobPath(url, event.id)

  const relayHint = $derived.by(() => {
    const eventRelays = Array.from(tracker.getRelays(event.id))
    const address = Address.fromEvent(event)
    const pubkeyRelays = Router.get().FromPubkey(address.pubkey).getUrls()

    if (eventRelays.length > 0) return eventRelays[0]
    if (pubkeyRelays.length > 0) return pubkeyRelays[0]
    return ""
  })

  const startThread = () =>
    pushModal(ThreadCreate, {url: url, jobOrGitIssue: event, relayHint: relayHint})

  const runJob = () =>
    pushModal(JobRequest, {url: url})

  const onPublishDelete = (event: TrustedEvent) => publishDelete({relays: [url], event, protect: false})

  const onPublishReaction = (eventContent: EventContent) => {
    publishReaction({
      event: eventContent as TrustedEvent, 
      content: eventContent.content,
      relays: [url], 
      protect: false
    })
  }
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="flex flex-grow flex-wrap justify-end gap-2">
    {#if showComment}
      <Button class="btn btn-success btn-sm">
        <Link class="w-full cursor-pointer" href={path}>
          <span class="">Comment</span>
        </Link>
      </Button>
    {/if}
    {#if showThreadAction}
      <Button class="btn btn-primary btn-sm" onclick={startThread}>
        <span class="">+Thread</span>
      </Button>
    {/if}
    <Button class="btn btn-warning btn-sm" onclick={runJob}>
      <span class="">Run Job</span>
    </Button>
    {#if showExternal}
      <Button class="btn btn-info btn-sm">
        <Link
          external
          class="w-full cursor-pointer"
          href={jobLink(Address.fromEvent(event).toNaddr())}>
          <span class="">SatShoot</span>
        </Link>
      </Button>
    {/if}
    <ReactionSummary {url} {event} createReaction={onPublishReaction} deleteReaction={onPublishDelete} reactionClass="tooltip-left" />
    <ThunkStatusOrDeleted {event} />
    {#if showActivity}
      <EventActivity {url} {path} {event} />
    {/if}
    <EventActions {url} {event} noun="Job" />
  </div>
</div>
