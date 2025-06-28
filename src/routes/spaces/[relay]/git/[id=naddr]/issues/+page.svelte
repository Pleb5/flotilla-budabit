<script lang="ts">
  import {Button, IssueCard, NewIssueForm} from "@nostr-git/ui"
  import {type CommentEvent} from "@nostr-git/shared-types"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {Address, COMMENT, getTagValue, GIT_ISSUE, type TrustedEvent} from "@welshman/util"
  import { createSearch, pubkey } from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {fly} from "@lib/transition"
  import {pushModal} from "@src/app/modal"
  import type {IssueEvent} from "@nostr-git/shared-types"
  import {request} from "@welshman/net"
  import { postComment, postIssue } from "@src/app/commands"
  import { sortBy } from "@welshman/lib"
  import type { LayoutProps } from "../$types"
  import Icon from "@src/lib/components/Icon.svelte"
  import { isMobile } from "@src/lib/html"
    import { debounce } from "throttle-debounce"

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

  let searchTerm = $state("")
  let debouncedTerm = $state("")

  // Set up the debounced update
  const updateDebouncedTerm = debounce(500, term => {
    debouncedTerm = term
  })

  // Watch searchTerm changes
  $effect(() => {
    updateDebouncedTerm(searchTerm)
  })

  const searchedIssues = $derived.by(() => {
    const issuesToSearch = issues.map(issue => {
      return {
        id: issue.id,
        subject: getTagValue("subject", issue.tags) ?? "",
        desc: issue.content,
      }
    })
    const issueSearch = createSearch(issuesToSearch, {
      getValue: (issue: {id: string; subject: string; desc: string}) => issue.id,
      fuseOptions: {
        keys: [
          {name: "subject", weight: 0.8},
          {name: "desc", weight: 0.2},
        ],
        includeScore: true,
        threshold: 0.3,
        isCaseSensitive: false,
        // When true, search will ignore location and distance, so it won't
        // matter where in the string the pattern appears
        ignoreLocation: true, 
      },
      sortFn: ({score, item}) => {
        if (score && score > 0.3) return -score!
        return item.subject
      },
    })
    const searchResults = issueSearch.searchOptions(searchTerm)
    const result = issues.filter(r => searchResults.find(res => res.id === r.id))
    return result
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

</script>

<div bind:this={element}>
  <div class="max-w-full sticky -top-8 z-nav my-4 space-y-2 backdrop-blur">
    <div class=" flex justify-between items-center">
      <div>
        <h2 class="text-xl font-semibold">Issues</h2>
        <p class="max-sm:hidden text-sm text-muted-foreground">Track bugs and feature requests</p>
      </div>
      <div class="flex items-center gap-2">
        <Button class="gap-2" variant="git" size="sm" onclick={onNewIssue}>
          <Plus class="h-4 w-4" />
          <span class="">New Issue</span>
        </Button>
      </div>
    </div>
    <label class="row-2 input grow overflow-x-hidden mt-1">
      <Icon icon="magnifer" />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus={!isMobile}
        class="w-full"
        bind:value={searchTerm}
        type="text"
        placeholder="Search issues..." />
    </label>
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
      {#each searchedIssues as issue (issue.id)}
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
