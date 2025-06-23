<script lang="ts">
  import {Button, IssueCard, NewIssueForm, Repo} from "@nostr-git/ui"
  import {isCommentEvent, type CommentEvent} from "@nostr-git/shared-types"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {Address, COMMENT, GIT_ISSUE} from "@welshman/util"
  import {getContext} from "svelte"
  import { pubkey, repository } from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {fly} from "@lib/transition"
  import {pushModal} from "@src/app/modal"
  import {deriveEvents} from "@welshman/store"
  import type {IssueEvent} from "@nostr-git/shared-types"
  import {load} from "@welshman/net"
  import { REPO_KEY, REPO_RELAYS_KEY } from "@src/app/state"
  import { postComment, postIssue } from "@src/app/commands"

  const repoClass = getContext<Repo>(REPO_KEY)

  const commentFilter = {
    kinds: [COMMENT],
    "#E": [...repoClass.issues.map(i => i.id)],
  }

  const comments = deriveEvents(repository, {
    filters: [commentFilter],
  })

  const commentEvents = $derived.by(() => {
    if (!$comments) return undefined
    return $comments.filter(isCommentEvent) as CommentEvent[]
  })

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  const issueFilter = {
    kinds: [GIT_ISSUE],
    "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
  }

  $effect(() => {
    if (repoClass.issues) {
      load({relays: repoClass.relays, filters: [commentFilter, issueFilter]})

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
      loading = false
    }
  })

  const repoRelays = getContext<string[]>(REPO_RELAYS_KEY)
  const onIssueCreated = async (issue: IssueEvent) => {
    await postIssue(issue, repoClass.relays || repoRelays).result
  }

  const onNewIssue = () => {
    pushModal(NewIssueForm, {
      repoId: repoClass.repoId,
      repoOwnerPubkey: repoClass.repoEvent?.pubkey,
      onIssueCreated
    })
  }

  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, repoClass.relays || repoRelays).result
  }

  $inspect(commentEvents).with((type, comments) => {
    console.log('comments for all issues on the repo in budabit:')
  })

</script>

<div bind:this={element}>
  <div class="sticky -top-8 z-nav mb-4 flex items-center justify-between py-4 backdrop-blur">
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
          <IssueCard
            event={issue}
            comments={commentEvents}
            currentCommenter={$pubkey!}
            onCommentCreated={onCommentCreated}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>
