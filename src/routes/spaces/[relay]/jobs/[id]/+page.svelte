<script lang="ts">
  import {onDestroy, onMount} from "svelte"
  import {page} from "$app/stores"
  import {sortBy, sleep, now} from "@welshman/lib"
  import {COMMENT, type TrustedEvent} from "@welshman/util"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Content from "@app/components/Content.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import JobActions from "@app/components/JobActions.svelte"
  import EventReply from "@app/components/EventReply.svelte"
  import {deriveEvent, decodeRelay, getEventsForUrl} from "@app/state"
  import {setChecked} from "@app/notifications"
  import JobItem from "@src/app/components/JobItem.svelte"
  import Divider from "@src/lib/components/Divider.svelte"
  import {makeFeed} from "@src/app/requests"
  import {whenElementReady} from "@src/lib/html"
  import {readable, writable, type Readable} from "svelte/store"
  import PageContent from "@src/lib/components/PageContent.svelte"

  const {relay, id} = $page.params
  const url = decodeRelay(relay)
  const event = deriveEvent(id)
  const replies = writable<TrustedEvent[]>([])

  onMount(() => {
    const initialReplies = getEventsForUrl(url, [{kinds: [COMMENT], "#E": [id], limit: 20}])
    replies.set(initialReplies)
  })

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

  let events: Readable<TrustedEvent[]> = $state(readable([]))
  let cleanup: () => void
  let loadingEvents = $state(true)
  let element: HTMLElement | undefined = $state()

  onMount(() => {
    whenElementReady(
      () => element,
      (readyElement) => {
        ;({events, cleanup} = makeFeed({
          element: readyElement,
          relays: [url],
          feedFilters: [{kinds: [COMMENT], "#E": [id]}],
          subscriptionFilters: [{kinds: [COMMENT], "#E": [id], since: now()}],
          initialEvents: getEventsForUrl(url, [{kinds: [COMMENT], "#E": [id], limit: 20}]),
          onExhausted: () => {
            loadingEvents = false
          },
        }))
      }
    )

    return () => {}
  })

  onDestroy(() => {
    cleanup()
    setTimeout(() => {
      setChecked($page.url.pathname)
    }, 800)
  })
</script>

<PageBar class="mx-0">
  {#snippet icon()}
    <div>
      <Button class="btn btn-neutral btn-sm" onclick={back}>
        <Icon icon="alt-arrow-left" />
      </Button>
    </div>
  {/snippet}
  {#snippet title()}
    <h1 class="text-center text-xl sm:text-lg">Job Discussion</h1>
  {/snippet}
  {#snippet action()}
    <div>
      <MenuSpaceButton {url} />
    </div>
  {/snippet}
</PageBar>
<PageContent bind:element class="flex flex-grow flex-col overflow-auto p-3">
  <div class="relative flex flex-col-reverse gap-3 px-2">
    {#if $event}
      {#if !showReply}
        <div class="flex justify-end px-2 pb-2">
          <Button class="btn btn-primary" onclick={openReply}>
            <Icon icon="reply" />
            Comment on Job
          </Button>
        </div>
      {/if}
      {#each sortBy(e => -e.created_at, $replies).slice(0, showAll ? undefined : 4) as reply (reply.id)}
        <NoteCard event={reply} class="card2 bg-alt z-feature w-full">
          <div class="col-3 ml-12">
            <Content showEntire event={reply} />
            <JobActions event={reply} {url} showExternal={false} />
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
      <Divider />
      <JobItem
        {url}
        event={$event}
        showActivity={true}
        showExternal={true}
        showThreadAction={true} />
    {:else}
      {#await sleep(5000)}
        <Spinner loading>Loading comments...</Spinner>
      {:then}
        <p>Failed to load comments.</p>
      {/await}
    {/if}
  </div>
</PageContent>
{#if showReply}
  <EventReply {url} event={$event} onClose={closeReply} onSubmit={closeReply} />
{/if}
