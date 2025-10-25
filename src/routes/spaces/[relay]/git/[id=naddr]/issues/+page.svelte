<script lang="ts">
  import {IssueCard, NewIssueForm, Button, toast, pushRepoAlert} from "@nostr-git/ui"
  import {
    createStatusEvent,
    GIT_ISSUE,
    type CommentEvent,
    type IssueEvent,
    type TrustedEvent,
  } from "@nostr-git/shared-types"
  import {CalendarDays, Check, Clock, Eye, GitCommit, Plus, SearchX, X} from "@lucide/svelte"
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
  import {sortBy} from "@welshman/lib"
  import {request} from "@welshman/net"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {slideAndFade} from "@lib/transition"
  import {makeFeed} from "@app/core/requests"
  import {pushModal} from "@app/util/modal"
  import {postComment, postIssue, publishEvent} from "@lib/budabit/commands.js"
  import {deriveEffectiveLabels, deriveAssignmentsFor} from "@lib/budabit/state.js"
  import FilterPanel from "@app/components/FilterPanel.svelte"
  import {isMobile} from "@lib/html"
  import {onMount, onDestroy} from "svelte"
  import {pushToast} from "@src/app/util/toast.js"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import {normalizeEffectiveLabels, toNaturalArray, groupLabels} from "@lib/budabit/labels"
  import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/shared-types"
  const {data} = $props()
  const {repoClass, statusEventsByRoot, repoRelays} = data

  const issues = repoClass.issues

  const comments = $state<Record<string, CommentEvent[]>>({})

  const commentsOrdered = $derived.by(() => {
    const ret: Record<string, CommentEvent[]> = {}
    for (const [key, value] of Object.entries(comments)) {
      ret[key] = sortBy(e => -e.created_at, value)
    }
    return ret
  })

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortByOrder = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let showFilters = $state(true)
  // Label filters (NIP-32 normalized labels)
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)

  const labelsData = $derived.by(() => {
    const byId = new Map<string, string[]>()
    const groupsById = new Map<string, Record<string, string[]>>()
    for (const issue of issues) {
      // Use deriveEffectiveLabels to get proper NIP-32 labels
      const effStore = deriveEffectiveLabels(issue.id)
      const effValue = effStore.get()
      const eff = normalizeEffectiveLabels(effValue)
      const naturals = toNaturalArray(eff?.flat)

      // Debug logging
      console.debug(`[IssuesList] Issue ${issue.id}:`, {
        effValue,
        eff,
        naturals,
        issueLabels: issue.tags?.filter(t => t[0] === "t").map(t => t[1]) || [],
      })

      byId.set(issue.id, naturals)
      const groups = eff ? groupLabels(eff) : {Status: [], Type: [], Area: [], Tags: [], Other: []}
      groupsById.set(issue.id, groups)
    }
    const res = {byId, groupsById}
    console.debug("[IssuesList] labelsData recomputed", {count: byId.size})
    return res
  })

  const labelsByIssue = $derived.by(() => {
    const result = labelsData.byId
    console.debug("[IssuesList] labelsByIssue computed:", result)
    return result
  })

  const allNormalizedLabels = $derived.by(() =>
    Array.from(new Set(Array.from(labelsByIssue.values()).flat())),
  )

  const uniqueAuthors = $derived.by(() => {
    if (!repoClass.issues) return []

    const authors = new Set<string>()
    repoClass.issues.forEach((issue: IssueEvent) => {
      const pubkey = issue.pubkey
      if (pubkey) authors.add(pubkey)
    })

    return Array.from(authors)
  })

  // Compute current status state using Status.svelte semantics
  const maintainerSet = $derived.by(() => {
    try {
      const maintainers = repoClass.maintainers || []
      const owner = (repoClass as any).repoEvent?.pubkey
      return new Set([...(maintainers || []), owner].filter(Boolean))
    } catch {
      return new Set<string>()
    }
  })

  let searchTerm = $state("")

  // NIP-32 labels are derived centrally via deriveEffectiveLabels(); proactively load 1985 for all issues
  $effect(() => {
    try {
      const ids = (repoClass.issues || []).map((i: any) => i.id).filter(Boolean)
      if (ids.length) {
        request({
          relays: repoRelays,
          filters: [{kinds: [1985], "#e": ids}],
          onEvent: () => {},
        })
      }
    } catch {}
  })

  // Persist filters per repo
  let storageKey = ""
  onMount(() => {
    try {
      storageKey = repoClass ? `issuesFilters:${repoClass.key}` : ""
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
    window.addEventListener("storage", storageListener)
  })
  onDestroy(() => {
    if (storageListener) window.removeEventListener("storage", storageListener)
  })

  // Persist on changes (single watcher)
  $effect(() => {
    statusFilter
    sortByOrder
    authorFilter
    showFilters
    searchTerm
    selectedLabels
    matchAllLabels
    persist()
  })

  // Create a reactive status map that depends on statusEventsByRoot
  const statusMap = $derived.by(() => {
    console.log("[StatusMap] Recalculating statusMap, statusEventsByRoot:", $statusEventsByRoot)
    const map: Record<string, string> = {}
    
    // First, set default "open" status for all issues
    if (repoClass.issues) {
      for (const issue of repoClass.issues) {
        map[issue.id] = "open"
      }
    }
    
    // Then override with actual status events
    if ($statusEventsByRoot) {
      for (const [rootId, events] of $statusEventsByRoot) {
        const statusResult = repoClass.resolveStatusFor(rootId)
        map[rootId] = statusResult?.state || "open"
      }
    }
    return map
  })

  const issueList = $derived.by(() => {
    console.log("[IssueList] Recalculating issueList")
    if (repoClass.issues) {
      return repoClass.issues.map((issue: IssueEvent) => {
        const commentEvents = comments[issue.id] || []
        const currentState = statusMap[issue.id] || "open"
        
        return {
          ...issue,
          comments: commentEvents,
          status: { kind: currentState },
          currentState,
        }
      })
    }
    return []
  })

  const searchedIssues = $derived.by(() => {
    const issuesToSearch = issueList.map(issue => {
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
    const result = issueList
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
        if (statusFilter === "all") return true
        const state = statusMap[issue.id] || "open"
        if (statusFilter === "open") return state === "open"
        if (statusFilter === "draft") return state === "draft"
        if (statusFilter === "closed") return state === "closed"
        if (statusFilter === "resolved") return state === "resolved"
        return true
      })
      .sort((a, b) =>
        sortByOrder === "newest" ? b.created_at - a.created_at : a.created_at - b.created_at,
      )
    return result
  })

  const roleAssignments = $derived.by(() => {
    const ids = repoClass.issues?.map((i: any) => i.id) || []
    return deriveAssignmentsFor(ids)
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
      relays: repoRelays,
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

  // Create combined filter for issues and status events
  const combinedFilter = {
    kinds: [GIT_ISSUE, GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
    "#a": repoClass.maintainers?.map(m => `${GIT_REPO_ANNOUNCEMENT}:${m}:${repoClass.name}`) || [],
  }

  onMount(() => {
    console.log("[Effect] makeFeed effect running, repoClass.issues length:", repoClass.issues?.length, "statusEventsByRoot size:", $statusEventsByRoot?.size)
    if (repoClass.issues) {
      const tryStart = () => {
        if (element) {
          makeFeed({
            element,
            relays: repoClass.relays,
            feedFilters: [combinedFilter],
            subscriptionFilters: [combinedFilter],
            initialEvents: issueList,
            onExhausted: () => {
              loading = false
            },
          })
        } else {
          requestAnimationFrame(tryStart)
        }
      }
      tryStart()
      loading = false
    }
  })

  const onIssueCreated = async (issue: IssueEvent) => {
    console.log("repo relays", repoRelays)
    const relaysToUse = repoRelays
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
      repoAddr: getTag("a", issue.tags),
    })
    const postIssueEvent = postIssue(issue, relaysToUse)
    console.debug("onIssueCreated: publish result", postIssueEvent)
    pushToast({message: "Issue created"})
    try {
      pushRepoAlert({
        repoKey: repoClass.key,
        kind: "new-patch",
        title: "New issue",
        body: getTagValue("subject", issue.tags) || "",
      })
    } catch {}
    const evt: any = (repoClass as any).repoEvent

    const statusEvent = createStatusEvent({
      kind: GIT_STATUS_OPEN,
      content: "",
      rootId: postIssueEvent.event.id,
      recipients: [$pubkey!, evt?.pubkey].filter(Boolean) as string[],
      repoAddr: evt ? Address.fromEvent(evt as any).toString() : "",
      relays: relaysToUse,
    })
    console.log("publishing status event", statusEvent)
    publishEvent(statusEvent, relaysToUse)
  }

  const onNewIssue = () => {
    const evt: any = (repoClass as any).repoEvent
    const aTag = evt ? (getTag("d", evt.tags) as string[]) : undefined
    const repoDtag = aTag ? aTag[1] : ""

    pushModal(NewIssueForm, {
      repoId: repoDtag,
      repoOwnerPubkey: evt?.pubkey,
      onIssueCreated,
    })
  }

  const onCommentCreated = async (comment: CommentEvent) => {
    postComment(comment, repoRelays)
  }
</script>

<svelte:head>
  <title>{repoClass.name} - Issues</title>
</svelte:head>

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
      <Icon icon={Magnifer} />
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
    <FilterPanel
      statusOptions={[
        {value: "open", label: "Open", icon: GitCommit},
        {value: "resolved", label: "Resolved", icon: Check},
        {value: "closed", label: "Closed", icon: X},
        {value: "draft", label: "Draft", icon: Clock},
      ]}
      selectedStatus={statusFilter}
      onStatusChange={(v: string) => (statusFilter = v)}
      on:statusChange={(e: CustomEvent<string>) => (statusFilter = e.detail)}
      sortOptions={[
        {value: "newest", label: "Newest", icon: CalendarDays},
        {value: "oldest", label: "Oldest", icon: CalendarDays},
        {value: "status", label: "Status", icon: Check},
      ]}
      sortBy={sortByOrder}
      onSortChange={v => (sortByOrder = v)}
      authors={uniqueAuthors}
      {authorFilter}
      onAuthorChange={v => (authorFilter = v)}
      allLabels={allNormalizedLabels}
      {selectedLabels}
      onToggleLabel={lbl =>
        (selectedLabels = selectedLabels.includes(lbl)
          ? selectedLabels.filter(l => l !== lbl)
          : [...selectedLabels, lbl])}
      onClearLabels={() => (selectedLabels = [])}
      {matchAllLabels}
      onMatchAllToggle={() => (matchAllLabels = !matchAllLabels)}
      labelSearchEnabled={false}
      showReset={true}
      onReset={resetFilters}
      showReviewIndicator={true} />
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
            <div class="relative">
              <IssueCard
                event={issue}
                comments={commentsOrdered[issue.id]}
                currentCommenter={$pubkey!}
                {onCommentCreated}
                extraLabels={labelsByIssue.get(issue.id) || []}
                repo={repoClass}
                statusEvents={$statusEventsByRoot?.get(issue.id) || []}
                actorPubkey={$pubkey}
                assigneeCount={$roleAssignments.get(issue.id)?.assignees?.size || 0}
                relays={repoRelays} />
            </div>
          </div>
        {/each}
      {/key}
    </div>
  {/if}
</div>
