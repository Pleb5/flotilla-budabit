<script lang="ts">
  import {Button, IssueCard, NewIssueForm, Repo} from "@nostr-git/ui"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {Address, COMMENT, GIT_ISSUE} from "@welshman/util"
  import {getContext} from "svelte"
  import {deriveProfile, repository} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {fly} from "@lib/transition"
  import {pushModal} from "@src/app/modal"
  import {load} from "@welshman/net"
  import {deriveEvents} from "@welshman/store"
  import type { IssueEvent } from "@nostr-git/shared-types"

  const repoClass = getContext<Repo>("repoClass")

  const comments = $derived.by(() => {
    if (repoClass.issues) {
      const filters = repoClass.issues.map(issue => issue.id)
      load({relays: repoClass.relays, filters: [{kinds: [COMMENT], "#E": filters}]})
      return deriveEvents(repository, {filters: [{kinds: [COMMENT], "#E": filters}]})
    }
  })

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  $effect(() => {
    if (repoClass.issues) {
      loading = false
    }

    const issueFilter = {
      kinds: [GIT_ISSUE],
      "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
    }

    makeFeed({
      element: element!,
      relays: repoClass.relays,
      feedFilters: [issueFilter],
      subscriptionFilters: [issueFilter],
      initialEvents: repoClass.issues,
      onExhausted: () => {
        loading = false
      },
    })
  })

  const postIssue: (issue: IssueEvent) => Promise<void> = getContext("postIssue");

  const onNewIssue = () => {
    pushModal(NewIssueForm, {
      repoId: repoClass.repoId,
      repoOwnerPubkey: repoClass.repoEvent?.pubkey,
      postIssue,
    })
  }
</script>

<div bind:this={element}>
  <div class="z-nav sticky -top-8 mb-4 flex items-center justify-between py-4 backdrop-blur">
    <div>
      <h2 class="text-xl font-semibold">Issues</h2>
      <p class="text-sm text-muted-foreground">Track bugs and feature requests</p>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-2">
        <Funnel class="h-4 w-4" />
        Filter
      </Button>

      <Button class="gap-2" variant="git" size="sm" onclick={onNewIssue}>
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
  {:else if repoClass.issues.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No issues found.
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#each repoClass.issues as issue (issue.id)}
        <div in:fly>
          <IssueCard event={issue} author={deriveProfile(issue.pubkey)} comments={$comments} />
        </div>
      {/each}
    </div>
  {/if}
</div>
