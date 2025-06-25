<script lang="ts">
  import {Button, IssueCard, NewIssueForm} from "@nostr-git/ui"
  import {type CommentEvent} from "@nostr-git/shared-types"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {Address, COMMENT, GIT_ISSUE, type TrustedEvent} from "@welshman/util"
  import { pubkey } from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {fly} from "@lib/transition"
  import {pushModal} from "@src/app/modal"
  import type {IssueEvent} from "@nostr-git/shared-types"
  import {request} from "@welshman/net"
  import { postComment, postIssue } from "@src/app/commands"
  import { sortBy } from "@welshman/lib"
  import type { LayoutProps } from "../$types"

  let {data}:LayoutProps = $props()
  const {repoClass, repoRelays} = data


  const issues = $derived.by(() => {
    return sortBy(e => -e.created_at, repoClass.issues)
  })

  const comments = $state<Record<string, CommentEvent[]>>({})
  
  const commentsOrdered = $derived.by(() => {
    const ret: Record<string, CommentEvent[]> = {}
    for (const [key, value] of Object.entries(comments)) {
      ret[key] = sortBy(e => -e.created_at, value)
    }
    return ret
  })

  $effect(() => {
    for (const issue of issues) {
      if (!comments[issue.id]) {
        comments[issue.id] = []
        requestComments(issue)
      }
    }
  })

  const requestComments = async (issue:TrustedEvent) => {
    request({
      relays: $repoRelays,
      filters: [{kinds: [COMMENT], '#E': [issue.id], since: issue.created_at}],
      onEvent: (e) => {
        const issueComments = comments[issue.id]
        if (!issueComments.some(c => c.id === e.id)) {
          issueComments.push(e as CommentEvent)
        }
      }
    })
  }

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  const issueFilter = {
    kinds: [GIT_ISSUE],
    "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
  }

  $effect(() => {
    if (repoClass.issues) {
      makeFeed({
        element: element!,
        relays: [...$repoRelays],
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

  const onIssueCreated = async (issue: IssueEvent) => {
    await postIssue(issue, $repoRelays).result
  }

  const onNewIssue = () => {
    pushModal(NewIssueForm, {
      repoId: repoClass.repoId,
      repoOwnerPubkey: repoClass.repoEvent?.pubkey,
      onIssueCreated
    })
  }

  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, $repoRelays).result
  }

  $inspect(comments).with((type, comments) => {
    console.log('comments for all issues on the repo in budabit:',comments)
  })
  // $inspect(repoClass.issues).with((type, issues) => {
  //   console.log('all issues on the repo in budabit:', issues)
  // })

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
      {#each issues as issue (issue.id)}
        <div in:fly>
          <IssueCard
            event={issue}
            comments={commentsOrdered[issue.id]}
            currentCommenter={$pubkey!}
            onCommentCreated={onCommentCreated}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>
