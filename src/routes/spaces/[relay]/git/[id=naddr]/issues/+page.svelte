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
    getTag,
  } from "@welshman/util"
  import {createSearch, pubkey, repository} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
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
  import { effectiveLabelsFor } from "@nostr-git/core"
  import { onMount, onDestroy } from "svelte"

  let {data} = $props()
  const {repoClass, issueFilter, statusEventFilter} = data

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

  const statuses: Record<string, StatusEvent> = $state({})

  $effect(() => {
    // Create a new object to trigger reactivity
    const newStatuses: Record<string, StatusEvent> = {}
    
    repoClass.issues.forEach((issue: IssueEvent) => {
      const status = $statusEvents
        ?.filter((s: any) => {
          let [_, eventId] = s.tags.find(nthEq(0, "e")) || []
          return eventId === issue.id
        })
        .sort((a: any, b: any) => b.created_at - a.created_at)[0]

      if (status) {
        newStatuses[issue.id] = status as StatusEvent
      }
    })
    
    // Replace the entire statuses object to trigger reactivity
    Object.assign(statuses, newStatuses)
    
    // Clear any removed statuses
    for (const key in statuses) {
      if (!(key in newStatuses)) {
        delete statuses[key]
      }
    }
  })

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortByOrder = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let showFilters = $state(true)
  // Label filters (NIP-32 normalized labels)
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)
  const labelEvents = deriveEvents(repository, { filters: [{ kinds: [1985] }] })
  const labelsByIssue = $derived.by(() => {
    const map = new Map<string, string[]>()
    for (const issue of issues) {
      const extern = ($labelEvents || []).filter((e: any) => (e.tags as string[][])?.some?.(t => t[0] === 'e' && t[1] === issue.id))
      try {
        const merged = effectiveLabelsFor({ self: issue as any, external: extern as any })
        map.set(issue.id, merged.normalized || [])
      } catch (e) {
        map.set(issue.id, [])
      }
    }
    return map
  })
  const allNormalizedLabels = $derived.by(() => Array.from(new Set(Array.from(labelsByIssue.values()).flat())))

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

  // Load label events for current issues
  $effect(() => {
    if (repoClass.issues && repoClass.issues.length > 0) {
      const ids = repoClass.issues.map((i: any) => i.id)
      request({
        relays: [...$repoRelays],
        filters: [{ kinds: [1985], "#e": ids, since: 0 }],
        onEvent: () => {},
      })
    }
  })

  // Persist filters per repo
  let storageKey = ""
  onMount(() => {
    try {
      storageKey = repoClass.repoEvent ? `issuesFilters:${Address.fromEvent(repoClass.repoEvent!).toString()}` : ""
    } catch (e) {
      storageKey = ""
    }
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const data = JSON.parse(raw)
        if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
        if (typeof data.sortByOrder === "string") sortByOrder = data.sortByOrder
        if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
        if (typeof data.showFilters === "boolean") showFilters = data.showFilters
        if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
        if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
        if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
      }
    } catch (e) {
      // ignore
    }
  })

  const persist = () => {
    if (!storageKey) return
    try {
      const data = {
        statusFilter,
        sortByOrder,
        authorFilter,
        showFilters,
        searchTerm,
        selectedLabels,
        matchAllLabels,
      }
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch (e) {
      // ignore
    }
  }

  const applyFromData = (data: any) => {
    if (!data) return
    if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
    if (typeof data.sortByOrder === "string") sortByOrder = data.sortByOrder
    if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
    if (typeof data.showFilters === "boolean") showFilters = data.showFilters
    if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
    if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
    if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
  }

  const resetFilters = () => {
    statusFilter = "open"
    sortByOrder = "newest"
    authorFilter = ""
    showFilters = true
    searchTerm = ""
    selectedLabels = []
    matchAllLabels = false
    if (storageKey) localStorage.removeItem(storageKey)
  }

  let storageListener: ((e: StorageEvent) => void) | null = null
  onMount(() => {
    storageListener = (e: StorageEvent) => {
      if (!storageKey) return
      if (e.key === storageKey) {
        try {
          const data = e.newValue ? JSON.parse(e.newValue) : null
          if (data) applyFromData(data)
        } catch {}
      }
    }
    window.addEventListener('storage', storageListener)
  })
  onDestroy(() => {
    if (storageListener) window.removeEventListener('storage', storageListener)
  })

  // Persist on changes
  $effect(() => { statusFilter; persist() })
  $effect(() => { sortByOrder; persist() })
  $effect(() => { authorFilter; persist() })
  $effect(() => { showFilters; persist() })
  $effect(() => { searchTerm; persist() })
  $effect(() => { selectedLabels; persist() })
  $effect(() => { matchAllLabels; persist() })

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
        if (selectedLabels.length === 0) return true
        const labs = labelsByIssue.get(issue.id) || []
        return matchAllLabels
          ? selectedLabels.every(l => labs.includes(l))
          : selectedLabels.some(l => labs.includes(l))
      })
      .filter(issue => {
        if (statusFilter !== "all") {
          const status = statuses[issue.id]
          if (!status) return true // NO status = OPEN!
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
      relays: repoClass.relays,
      filters: [{kinds: [COMMENT], "#E": [issue.id], since: issue.created_at}],
      onEvent: e => {
        if (!comments[issue.id].some(c => c.id === e.id)) {
          // Create a new array to trigger reactivity
          comments[issue.id] = [...comments[issue.id], e as CommentEvent]
        }
      },
    })
  }

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  let initialized = $state(false)
  $effect(() => {
    if (repoClass.issues && element && !initialized) {
      initialized = true
      console.log('init. repo relays:', repoClass.relays)
      makeFeed({
        element: element,
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

  const onIssueCreated = async (issue: IssueEvent) => {
    console.log('repo relays', repoClass.relays)
    const relaysToUse = repoClass.relays
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
      repoAddr: getTag('a', issue.tags),
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
    // try {
    //   if (postIssueEvent) {
    //     repoClass.issues = [postIssueEvent as IssueEvent, ...repoClass.issues]
    //   }
    // } catch (e) {
    //   console.warn("Failed to optimistically add new issue to UI:", e)
    // }
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
    const aTag = getTag("d", repoClass.repoEvent!.tags) as string[]
    const repoDtag = aTag[1]

    pushModal(NewIssueForm, {
      repoId: repoDtag,
      repoOwnerPubkey: repoClass.repoEvent?.pubkey,
      onIssueCreated,
    })
  }

  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, repoClass.relays).result
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

        <!-- Label Filter -->
        {#if allNormalizedLabels.length > 0}
          <div class="md:col-span-2">
            <h3 class="mb-2 text-sm font-medium">Labels</h3>
            <div class="flex flex-wrap gap-2">
              {#each allNormalizedLabels as lbl (lbl)}
                <Button
                  variant={selectedLabels.includes(lbl) ? "default" : "outline"}
                  size="sm"
                  onclick={() => {
                    selectedLabels = selectedLabels.includes(lbl)
                      ? selectedLabels.filter(l => l !== lbl)
                      : [...selectedLabels, lbl]
                  }}>
                  {lbl}
                </Button>
              {/each}
              <Button variant={matchAllLabels ? "default" : "outline"} size="sm" onclick={() => (matchAllLabels = !matchAllLabels)}>
                Match all
              </Button>
              {#if selectedLabels.length > 0}
                <Button variant="ghost" size="sm" onclick={() => (selectedLabels = [])}>
                  Clear labels
                </Button>
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <div class="mt-4 flex items-center justify-end">
        <Button variant="ghost" size="sm" onclick={resetFilters}>Reset Filters</Button>
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
          <div in:slideAndFade={{duration: 200}} class="space-y-1">
            <IssueCard
              event={issue}
              comments={commentsOrdered[issue.id]}
              currentCommenter={$pubkey!}
              {onCommentCreated}
              status={statuses[issue.id] || undefined}
              extraLabels={labelsByIssue.get(issue.id) || []} />
          </div>
        {/each}
      {/key}
    </div>
  {/if}
</div>
