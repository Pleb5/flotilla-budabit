<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {sortBy, min, nthEq} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {FREELANCE_JOB} from "@lib/budabit"
  import {COMMENT, getListTags, getPubkeyTagValues} from "@welshman/util"
  import {userMutes} from "@welshman/app"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import JobItem from "@app/components/JobItem.svelte"
  import Link from "@lib/components/Link.svelte"
  import {decodeRelay, getEventsForUrl, INDEXER_RELAYS} from "@app/core/state"
  import {setChecked} from "@app/util/notifications"
  import {makeFeed} from "@app/core/requests"

  const url = decodeRelay($page.params.relay)
  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))
  const jobs: TrustedEvent[] = $state([])
  const comments: TrustedEvent[] = $state([])
  const jobFilter = {kinds: [FREELANCE_JOB], "#s": ["0"]}
  const commentFilter = {kinds: [COMMENT], "#K": [String(FREELANCE_JOB)]}

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  const events = $derived.by(() => {
    const scores = new Map<string, number>()
    for (const comment of comments) {
      const id = comment.tags.find(nthEq(0, "E"))?.[1]
      if (id) {
        scores.set(id, min([scores.get(id), -comment.created_at]))
      }
    }
    return sortBy(
      (e: TrustedEvent) => min([scores.get(e.id), -e.created_at]),
      jobs.filter((e: TrustedEvent) => !mutedPubkeys.includes(e.pubkey)),
    )
  })

  onMount(() => {
    const {cleanup} = makeFeed({
      element: element!,
      relays: INDEXER_RELAYS,
      feedFilters: [jobFilter, commentFilter],
      subscriptionFilters: [jobFilter, commentFilter],
      initialEvents: getEventsForUrl(url, [
        {kinds: [FREELANCE_JOB, COMMENT], "#s": ["0"], limit: 10},
      ]),
      onEvent: (event: TrustedEvent) => {
        if (event.kind === FREELANCE_JOB && !mutedPubkeys.includes(event.pubkey)) {
          jobs.push(event)
        }
        if (event.kind === COMMENT) {
          comments.push(event)
        }
      },
      onExhausted: () => {
        loading = false
      },
    })
    return () => {
      cleanup?.()
      setChecked($page.url.pathname)
    }
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon="jobs" />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Jobs</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <Button class="btn btn-primary btn-sm">
        <Link
          external
          href="https://test.satshoot.com/post-job"
          class="flex items-center gap-x-2 bg-primary">
          <Icon icon="jobs" />
          <span class="">Create Job</span>
        </Link>
      </Button>
      <MenuSpaceButton {url} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element class="flex flex-grow flex-col overflow-auto p-3">
  {#if loading}
    <div class="flex h-32 items-center justify-center">
      <Spinner {loading}>Looking for jobs...</Spinner>
    </div>
  {:else if events.length === 0}
    <div class="flex h-32 items-center justify-center text-gray-400">
      <Icon icon="jobs" class="mr-2" /> No Jobs found.
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      {#each events as event: TrustedEvent (event.id)}
        <div in:fly>
          <JobItem
            {url}
            {event}
            showComment={true}
            showExternal={true}
            showThreadAction={true}
            showActivity={true} />
        </div>
      {/each}
    </div>
  {/if}
</PageContent>
