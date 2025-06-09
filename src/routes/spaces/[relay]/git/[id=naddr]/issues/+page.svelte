<script lang="ts">
  import {Button, IssueCard, NewIssueForm} from "@nostr-git/ui"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {Address, COMMENT, GIT_ISSUE, type TrustedEvent} from "@welshman/util"
  import {getContext} from "svelte"
  import {deriveProfile, publishThunk, repository} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import type {Readable} from "svelte/store"
  import {type IssueEvent, type RepoStateEvent} from "@nostr-git/shared-types"
  import {fly} from "@lib/transition"
  import {pushModal} from "@src/app/modal"
  import {load} from "@welshman/net"
  import {deriveEvents} from "@welshman/store"
  import {page} from "$app/stores"
  import {decodeRelay} from "@src/app/state"

  const repoEvent = getContext<Readable<TrustedEvent>>("repo-event")

  const repo = getContext<{
    repo: Readable<TrustedEvent>
    repoId: string
    state: () => Readable<RepoStateEvent>
    issues: () => Readable<TrustedEvent[]>
    relays: () => string[]
  }>("repo")

  const issues = repo.issues()

  const comments = $derived.by(() => {
    if ($issues) {
      const filters = $issues.map(issue => issue.id)
      load({relays: repo.relays(), filters: [{kinds: [COMMENT], "#E": filters}]})
      return deriveEvents(repository, {filters: [{kinds: [COMMENT], "#E": filters}]})
    }
  })

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  $effect(() => {
    if (issues) {
      loading = false
    }

    const issueFilter = {
      kinds: [GIT_ISSUE],
      "#a": [repo.repoId],
    }

    const {cleanup} = makeFeed({
      element: element!,
      relays: repo.relays(),
      feedFilters: [issueFilter],
      subscriptionFilters: [issueFilter],
      initialEvents: $issues,
      onExhausted: () => {
        loading = false
      },
    })
  })

  const url = decodeRelay($page.params.relay)

  const postIssue = (issue: IssueEvent) => {
    publishThunk({
      relays: [url],
      event: issue,
    })
  }

  const onNewIssue = () => {
    pushModal(NewIssueForm, {
      repoId: repo.repoId,
      repoOwnerPubkey: $repoEvent.pubkey,
      postIssue,
    })
  }
</script>

<div bind:this={element}>
  <div class="z-10 sticky top-0 mb-4 flex items-center justify-between py-4 backdrop-blur">
    <div>
      <h2 class="text-xl font-semibold">Issues</h2>
      <p class="text-sm text-muted-foreground">Track bugs and feature requests</p>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-2">
        <Funnel class="h-4 w-4" />
        Filter
      </Button>

      <Button size="sm" class="gap-2 bg-git hover:bg-git-hover" onclick={onNewIssue}>
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
  {:else if $issues.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No issues found.
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#each $issues as issue (issue.id)}
        <div in:fly>
          <IssueCard event={issue} author={deriveProfile(issue.pubkey)} comments={$comments} />
        </div>
      {/each}
    </div>
  {/if}
</div>
