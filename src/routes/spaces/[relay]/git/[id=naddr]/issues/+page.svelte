<script lang="ts">
  import {Button, IssueCard} from "@nostr-git/ui"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {page} from "$app/stores"
  import {
    Address,
    COMMENT,
    getListTags,
    getPubkeyTagValues,
    GIT_ISSUE,
    type TrustedEvent,
  } from "@welshman/util"
  import {getContext, onMount} from "svelte"
  import {setChecked} from "@src/app/notifications"
  import {nthEq} from "@welshman/lib"
  import {deriveProfile, userMutes} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import type {Readable} from "svelte/store"
  import {makeFeed} from "@src/app/requests"

  const repo = getContext<Readable<TrustedEvent>>("repo-event")
  const [_, ...relays] = $repo.tags.find(nthEq(0, "relays")) || []
  const mutedPubkeys = getPubkeyTagValues(getListTags($userMutes))

  const issueFilter = {
    kinds: [GIT_ISSUE, COMMENT],
    "#a": [Address.fromEvent($repo).toString()],
  }

  const issues: TrustedEvent[] = $state([])
  const comments: TrustedEvent[] = $state([])

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  onMount(() => {
    const {cleanup} = makeFeed({
      element: element!,
      relays: relays,
      feedFilters: [issueFilter],
      subscriptionFilters: [issueFilter],
      initialEvents: [],
      onEvent: event => {
        if (event.kind === GIT_ISSUE && !mutedPubkeys.includes(event.pubkey)) {
          issues.push(event)
        }

        if (event.kind === COMMENT && !mutedPubkeys.includes(event.pubkey)) {
          comments.push(event)
        }
      },
      onExhausted: () => {
        loading = false
      },
    })

    return () => {
      cleanup()
      setChecked($page.url.pathname)
    }
  })
</script>

<div bind:this={element}>
  <div
    class="z-10 sticky top-0 mb-4 flex items-center justify-between py-4 backdrop-blur">
    <div>
      <h2 class="text-xl font-semibold">Issues</h2>
      <p class="text-sm text-muted-foreground">Track bugs and feature requests</p>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-2">
        <Funnel class="h-4 w-4" />
        Filter
      </Button>

      <Button size="sm" class="gap-2 bg-git hover:bg-git-hover">
        <Plus class="h-4 w-4" />
        New Issue
      </Button>
    </div>
  </div>

  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading issues….
        {:else}
          End of message history
        {/if}
      </Spinner>
    </div>
  {:else if issues.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No issues found.
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#each issues as issue (issue.id)}
        <IssueCard event={issue} author={deriveProfile(issue.pubkey, relayArray)} />
      {/each}
    </div>
  {/if}
</div>
