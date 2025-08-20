<script lang="ts">
  import {IssueCard, NewIssueForm, Button, toast} from "@nostr-git/ui"
  import {
    CalendarDays,
    Check,
    Clock,
    Eye,
    GitCommit,
    Plus,
    SearchX,
    User,
    X,
  } from "@lucide/svelte"
  import {
    Address,
    COMMENT,
    getTagValue,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    GIT_STATUS_CLOSED,
  } from "@welshman/util"
  import {createSearch, pubkey, repository} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {whenElementReady} from "@src/lib/html"
  import {slide, slideAndFade} from "@lib/transition"
  import {pushModal} from "@app/modal"
  import {
    createStatusEvent,
    type CommentEvent,
    type IssueEvent,
    type StatusEvent,
    type TrustedEvent,
  } from "@nostr-git/shared-types"
  import {PublishStatus, request} from "@welshman/net"
  import {postComment, postIssue, postStatus} from "@src/app/commands"
  import {nthEq, sortBy} from "@welshman/lib"
  import Icon from "@src/lib/components/Icon.svelte"
  import {isMobile} from "@src/lib/html"
  import {debounce} from "throttle-debounce"
  import {deriveEvents} from "@welshman/store"
  import ProfileName from "@src/app/components/ProfileName.svelte"

  let {data} = $props()
  const {repoClass, repoRelays, issueFilter, statusEventFilter} = data

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

  const statusEvents = deriveEvents(repository, {filters: [statusEventFilter]})

  const statusMap = new Map<string, StatusEvent>()

  $effect(() => {
    if ($statusEvents) {
      repoClass.issues.forEach((issue: IssueEvent) => {
        const status = $statusEvents
          ?.filter((s: any) => {
            let [_, eventId] = s.tags.find(nthEq(0, "e")) || []
            return eventId === issue.id
          })
          .sort((a: any, b: any) => b.created_at - a.created_at)[0]

        if (status) {
          statusMap.set(issue.id, status as StatusEvent)
        }
      })
    }
  })

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortByOrder = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let showFilters = $state(true)

  const uniqueAuthors = $derived.by(() => {
    if (!repoClass.patches) return []

    const authors = new Set<string>()
    repoClass.issues.forEach((issue: IssueEvent) => {
      const pubkey = issue.pubkey
      if (pubkey) authors.add(pubkey)
    })

    return Array.from(authors)
  })

  let searchTerm = $state("")
  let debouncedTerm = $state("")

  // Set up the debounced update
  const updateDebouncedTerm = debounce(500, (term: string) => {
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
    const result = issues
      .filter(r => searchResults.find(res => res.id === r.id))
      .filter(issue => {
        if (authorFilter) {
          return issue.pubkey === authorFilter
        }
        return true
      })
      .filter(issue => {
        if (statusFilter !== "all") {
          const status = statusMap.get(issue.id)
          if (!status) return false
          switch (statusFilter) {
            case "open":
              return status.kind === GIT_STATUS_OPEN
            case "resolved":
              return status.kind === GIT_STATUS_COMPLETE
            case "closed":
              return status.kind === GIT_STATUS_CLOSED
            case "draft":
              return status.kind === GIT_STATUS_DRAFT
            default:
              return true
          }
        }
        return true
      })
      .sort((a, b) =>
        sortByOrder === "newest" ? b.created_at - a.created_at : a.created_at - b.created_at,
      )
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

  const requestComments = async (issue: TrustedEvent) => {
    request({
      relays: $repoRelays,
      filters: [{kinds: [COMMENT], "#E": [issue.id], since: issue.created_at}],
      onEvent: e => {
        const issueComments = comments[issue.id]
        if (!issueComments.some(c => c.id === e.id)) {
          issueComments.push(e as CommentEvent)
        }
      },
    })
  }

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  $effect(() => {
    if (repoClass.issues) {
      whenElementReady(
        () => element,
        (readyElement) => {
          makeFeed({
            element: readyElement,
            relays: [...$repoRelays],
            feedFilters: [issueFilter],
            subscriptionFilters: [issueFilter],
            initialEvents: repoClass.issues,
            onExhausted: () => {
              loading = false
            },
          })
        }
      )
      loading = false
    }
  })

  const onIssueCreated = async (issue: IssueEvent) => {
    const relaysToUse = repoClass.relays || $repoRelays
    if (!relaysToUse || relaysToUse.length === 0) {
      console.warn("onIssueCreated: no relays available", {relaysToUse})
      toast.push({
        message: "No relays available to publish issue.",
        variant: "destructive",
      })
      return
    }
    console.debug("onIssueCreated: publishing issue", {
      relays: relaysToUse,
      repoAddr: Address.fromEvent(repoClass.repoEvent!).toString(),
    })
    const thunk = postIssue(issue, relaysToUse)
    const postIssueEvent = thunk.event
    const result = await thunk.result
    console.debug("onIssueCreated: publish result", result)
    if (result.error === PublishStatus.Failure) {
      console.error(result.error)
      toast.push({
        message: `Failed to publish issue${result.reason ? `: ${result.reason}` : ". Please try again."}`,
        variant: "destructive",
      })
      return
    }
    toast.push({ message: "Issue created", variant: "default" })
    // Optimistically add the new issue to the local list so it appears immediately
    try {
      if (postIssueEvent) {
        repoClass.issues = [postIssueEvent as IssueEvent, ...repoClass.issues]
      }
    } catch (e) {
      console.warn("Failed to optimistically add new issue to UI:", e)
    }
    const statusEvent = createStatusEvent({
      kind: GIT_STATUS_OPEN,
      content: "",
      rootId: postIssueEvent.id,
      recipients: [$pubkey!, repoClass.repoEvent!.pubkey!],
      repoAddr: Address.fromEvent(repoClass.repoEvent!).toString(),
      relays: relaysToUse,
    })
    await postStatus(statusEvent, relaysToUse).result
  }

  const onNewIssue = () => {
    pushModal(NewIssueForm, {
      repoId: repoClass.name,
      repoOwnerPubkey: repoClass.repoEvent?.pubkey,
      onIssueCreated,
    })
  }

  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, $repoRelays).result
  }
</script>

<div bind:this={element}>
  <div class="sticky -top-8 z-nav my-4 max-w-full space-y-2 backdrop-blur">
    <div class=" flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Issues</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Track bugs and feature requests</p>
      </div>
      <div class="flex items-center gap-2">
        <Button class="gap-2" variant="git" size="sm" onclick={onNewIssue}>
          <Plus class="h-4 w-4" />
          <span class="">New Issue</span>
        </Button>
      </div>
    </div>
    <div class="row-2 input mt-4 grow overflow-x-hidden">
      <Icon icon="magnifer" />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus={!isMobile}
        class="w-full"
        bind:value={searchTerm}
        type="text"
        placeholder="Search issues..." />
      <Button size="sm" class="gap-2" onclick={() => (showFilters = !showFilters)}>
        <Eye class="h-4 w-4" />
        {showFilters ? "Hide Filters" : "Filter"}
      </Button>
    </div>
  </div>

  {#if showFilters}
    <div class="mb-6 rounded-md border border-border bg-card p-4" transition:slide>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <!-- Status Filter -->
        <div>
          <h3 class="mb-2 text-sm font-medium">Status</h3>
          <div class="flex flex-wrap gap-2">
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "all")}>
              All
            </Button>
            <Button
              variant={statusFilter === "open" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "open")}
              class="gap-1">
              <GitCommit class="h-3 w-3" /> Open
            </Button>
            <Button
              variant={statusFilter === "resolved" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "resolved")}
              class="gap-1">
              <Check class="h-3 w-3" /> Resolved
            </Button>
            <Button
              variant={statusFilter === "closed" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "closed")}
              class="gap-1">
              <X class="h-3 w-3" /> Closed
            </Button>
            <Button
              variant={statusFilter === "draft" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "draft")}
              class="gap-1">
              <Clock class="h-3 w-3" /> Draft
            </Button>
          </div>
        </div>

        <!-- Sort Options -->
        <div>
          <h3 class="mb-2 text-sm font-medium">Sort By</h3>
          <div class="flex flex-wrap gap-2">
            <Button
              variant={sortByOrder === "newest" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortByOrder = "newest")}
              class="gap-1">
              <CalendarDays class="h-3 w-3" /> Newest
            </Button>
            <Button
              variant={sortByOrder === "oldest" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortByOrder = "oldest")}
              class="gap-1">
              <CalendarDays class="h-3 w-3" /> Oldest
            </Button>
            <Button
              variant={sortByOrder === "status" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortByOrder = "status")}
              class="gap-1">
              <Check class="h-3 w-3" /> Status
            </Button>
          </div>
        </div>

        <!-- Author Filter -->
        {#if uniqueAuthors.length > 1}
          <div class="md:col-span-2">
            <h3 class="mb-2 text-sm font-medium">Author</h3>
            <div class="flex flex-wrap gap-2">
              <Button
                variant={authorFilter === "" ? "default" : "outline"}
                size="sm"
                onclick={() => (authorFilter = "")}>
                All Authors
              </Button>

              {#each uniqueAuthors as author}
                <Button
                  variant={authorFilter === author ? "default" : "outline"}
                  size="sm"
                  onclick={() => (authorFilter = author)}
                  class="gap-1">
                  <User class="h-3 w-3" />
                  <span class="text-sm"><ProfileName pubkey={author} /></span>
                </Button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

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
      {#key repoClass.issues}
        {#each searchedIssues as issue (issue.id)}
          <div in:slideAndFade={{duration: 200}}>
            <IssueCard
              event={issue}
              comments={commentsOrdered[issue.id]}
              currentCommenter={$pubkey!}
              {onCommentCreated}
              status={statusMap.get(issue.id) || undefined} />
          </div>
        {/each}
      {/key}
    </div>
  {/if}
</div>
