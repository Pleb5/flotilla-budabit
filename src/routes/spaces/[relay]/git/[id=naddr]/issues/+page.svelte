<script lang="ts">
  import {IssueCard, NewIssueForm, Button, toast, pushRepoAlert} from "@nostr-git/ui"
  import {
    createStatusEvent,
    GIT_ISSUE,
    GIT_REPO_ANNOUNCEMENT,
    type CommentEvent,
    type IssueEvent,
    type TrustedEvent,
  } from "@nostr-git/shared-types"
  import {Eye, Plus, SearchX} from "@lucide/svelte"
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
  import {createSearch, pubkey} from "@welshman/app"
  import {sortBy} from "@welshman/lib"
  import {request} from "@welshman/net"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import {slideAndFade} from "@lib/transition"
  import {makeFeed} from "@app/core/requests"
  import {pushModal} from "@app/util/modal"
  import {postComment, postIssue, publishEvent} from "@lib/budabit/commands.js"
  import {deriveEffectiveLabels, deriveAssignmentsFor} from "@lib/budabit/state.js"
  import FilterPanel from "@src/lib/budabit/components/FilterPanel.svelte"
  import {isMobile} from "@lib/html"
  import {onMount, onDestroy} from "svelte"
  import {pushToast} from "@src/app/util/toast"
  import {normalizeEffectiveLabels, toNaturalArray, groupLabels} from "@lib/budabit/labels"
  
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY, STATUS_EVENTS_BY_ROOT_KEY} from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import type {StatusEvent} from "@nostr-git/shared-types"
  
  const repoClass = getContext<Repo>(REPO_KEY)
  const statusEventsByRootStore = getContext<Readable<Map<string, StatusEvent[]>>>(STATUS_EVENTS_BY_ROOT_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  
  if (!repoClass) {
    throw new Error("Repo context not available")
  }
  
  // Get current values from stores reactively using $ rune
  const statusEventsByRoot = $derived.by(() => statusEventsByRootStore ? $statusEventsByRootStore : new Map<string, StatusEvent[]>())
  const repoRelays = $derived.by(() => repoRelaysStore ? $repoRelaysStore : [])

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

  // Optimize labelsData: compute lazily and cache results to avoid blocking render
  // Use a Map to track subscriptions and clean them up properly
  let labelsDataCache = $state<{byId: Map<string, string[]>, groupsById: Map<string, Record<string, string[]>>}>({
    byId: new Map<string, string[]>(),
    groupsById: new Map<string, Record<string, string[]>>()
  })
  let labelsDataCacheKey = $state<string>("")
  
  // Compute labelsData asynchronously to avoid blocking render
  $effect(() => {
    // Create cache key from issue IDs to detect changes
    const currentKey = issues.map(i => i.id).sort().join(",")
    
    // Skip if already computed for this set of issues
    if (labelsDataCacheKey === currentKey) return
    
    // Defer heavy computation to avoid blocking initial render
    const timeout = setTimeout(() => {
      // Double-check key hasn't changed during deferral
      const checkKey = issues.map(i => i.id).sort().join(",")
      if (checkKey !== currentKey) return
      
    const byId = new Map<string, string[]>()
    const groupsById = new Map<string, Record<string, string[]>>()
      
    for (const issue of issues) {
        try {
      // Use deriveEffectiveLabels to get proper NIP-32 labels
          // Only get value once - don't subscribe to avoid memory leaks
      const effStore = deriveEffectiveLabels(issue.id)
      const effValue = effStore.get()
      const eff = normalizeEffectiveLabels(effValue)
      const naturals = toNaturalArray(eff?.flat)

      byId.set(issue.id, naturals)
      const groups = eff ? groupLabels(eff) : {Status: [], Type: [], Area: [], Tags: [], Other: []}
      groupsById.set(issue.id, groups)
        } catch (e) {
          // Fallback to empty labels if computation fails
          byId.set(issue.id, [])
          groupsById.set(issue.id, {Status: [], Type: [], Area: [], Tags: [], Other: []})
        }
      }
      
      labelsDataCache = {byId, groupsById}
      labelsDataCacheKey = currentKey
    }, 100)
    
    // Cleanup function to cancel RAF
    return () => {
      clearTimeout(timeout)
    }
  })
  
  // Return cached labelsData synchronously
  const labelsData = $derived(labelsDataCache)

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



  let searchTerm = $state("")

  // NIP-32 labels are derived centrally via deriveEffectiveLabels(); proactively load 1985 for all issues
  // Defer to avoid blocking initial render
  $effect(() => {
    // Defer label loading to avoid blocking initial render
    const controller = new AbortController()
    abortControllers.push(controller)
    
    const timeout = setTimeout(() => {
      try {
        const ids = (repoClass.issues || []).map((i: any) => i.id).filter(Boolean)
        if (ids.length) {
          request({
            relays: repoRelays,
            signal: controller.signal,
            filters: [{kinds: [1985], "#e": ids}],
            onEvent: () => {},
          })
        }
      } catch {}
    }, 100)
    
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  // Persist filters per repo (delegated to FilterPanel)
  let storageKey = repoClass ? `issuesFilters:${repoClass.key}` : ""

  // Compute statusMap asynchronously to avoid blocking UI rendering
  let statusMap = $state<Record<string, string>>({})
  let statusMapCacheKey = $state<string>("")

  $effect(() => {
    const timeout = setTimeout(() => {
      if (!repoClass || !repoClass.issues) {
        statusMap = {}
        return
      }

      // Create cache key from issue IDs and statusEventsByRoot to detect changes
      const issueIds = repoClass.issues.map(i => i.id).sort().join(",")
      const statusEventIds = statusEventsByRoot 
        ? Array.from(statusEventsByRoot.keys()).sort().join(",")
        : ""
      const currentKey = `${issueIds}|${statusEventIds}`

      if (statusMapCacheKey === currentKey) return

      const map: Record<string, string> = {}

      // First, set default "open" status for all issues
      for (const issue of repoClass.issues) {
        map[issue.id] = "open"
      }

      // Then override with actual status events
      if (statusEventsByRoot) {
        for (const [rootId, events] of statusEventsByRoot) {
          const statusResult = repoClass.resolveStatusFor(rootId)
          map[rootId] = statusResult?.state || "open"
        }
      }

      statusMap = map
      statusMapCacheKey = currentKey
    })

    return () => {
      clearTimeout(timeout)
    }
  })

  // Compute issueList asynchronously to avoid blocking UI rendering
  let issueList = $state<any[]>([])
  let issueListCacheKey = $state<string>("")

  $effect(() => {
    const timeout = setTimeout(() => {
      if (!repoClass || !repoClass.issues) {
        issueList = []
        return
      }

      // Create cache key from issues, comments, and statusMap to detect changes
      const issueIds = repoClass.issues.map(i => i.id).sort().join(",")
      const commentIds = Object.keys(comments)
        .flatMap(id => comments[id].map(c => c.id))
        .sort()
        .join(",")
      const statusMapKeys = Object.keys(statusMap).sort().join(",")
      const currentKey = `${issueIds}|${commentIds}|${statusMapKeys}`

      if (issueListCacheKey === currentKey) return

      const processed = repoClass.issues.map((issue: IssueEvent) => {
        const commentEvents = comments[issue.id] || []
        const currentState = statusMap[issue.id] || "open"

        return {
          ...issue,
          comments: commentEvents,
          status: {kind: currentState},
          currentState,
        }
      })

      issueList = processed
      issueListCacheKey = currentKey
    }, 100)

    return () => {
      clearTimeout(timeout)
    }
  })

  // Compute searchedIssues asynchronously to avoid blocking UI rendering
  // This is the most critical optimization as it includes search, filtering, and sorting
  let searchedIssues = $state<any[]>([])
  let searchedIssuesCacheKey = $state<string>("")

  $effect(() => {
    const timeout = setTimeout(() => {
      if (!issueList || issueList.length === 0) {
        searchedIssues = []
        return
      }

      // Create cache key from issueList, searchTerm, filters, and sort options
      const issueIds = issueList.map(i => i.id).sort().join(",")
      const labelsKey = Array.from(labelsByIssue.values())
        .flat()
        .sort()
        .join(",")
      const currentKey = [
        issueIds,
        searchTerm,
        statusFilter,
        authorFilter,
        selectedLabels.sort().join(","),
        matchAllLabels.toString(),
        sortByOrder,
        labelsKey,
      ].join("|")

      if (searchedIssuesCacheKey === currentKey) return

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

      searchedIssues = result
      searchedIssuesCacheKey = currentKey
    }, 100)

    return () => {
      clearTimeout(timeout)
    }
  })

  const roleAssignments = $derived.by(() => {
    const ids = repoClass.issues?.map((i: any) => i.id) || []
    return deriveAssignmentsFor(ids)
  })

  $effect(() => {
    // Defer comment loading to avoid blocking initial render
    requestAnimationFrame(() => {
    for (const issue of issues) {
      if (!comments[issue.id]) {
        comments[issue.id] = []
        requestComments(issue)
      }
    }
    })
  })

  const requestComments = async (issue: TrustedEvent) => {
    const controller = new AbortController()
    abortControllers.push(controller)
    
    request({
      relays: repoRelays,
      signal: controller.signal,
      filters: [{kinds: [COMMENT], "#E": [issue.id], since: issue.created_at}],
      onEvent: e => {
        if (!comments[issue.id].some(c => c.id === e.id)) {
          // Create a new array to trigger reactivity
          comments[issue.id] = [...comments[issue.id], e as CommentEvent]
        }
      },
    })
  }

  // Set loading to false immediately if we have data - don't wait for makeFeed
  let loading = $state(false)
  let element: HTMLElement | undefined = $state()
  let feedInitialized = $state(false)
  let feedCleanup: (() => void) | undefined = $state(undefined)
  // Use non-reactive array to avoid infinite loops when pushing in effects
  const abortControllers: AbortController[] = []

  // Create combined filter for issues and status events
  const combinedFilter = $derived.by(() => ({
    kinds: [
      GIT_ISSUE,
      GIT_STATUS_OPEN,
      GIT_STATUS_DRAFT,
      GIT_STATUS_CLOSED,
      GIT_STATUS_COMPLETE,
    ],
    "#a": repoClass?.maintainers?.map(m => `${GIT_REPO_ANNOUNCEMENT}:${m}:${repoClass.name}`) || [],
  }))

  // Initialize feed asynchronously - don't block render
  onMount(() => {
    if (repoClass && repoClass.issues && !feedInitialized) {
      // Defer makeFeed to avoid blocking initial render
      const timeout = setTimeout(() => {
        const tryStart = () => {
          if (element && !feedInitialized) {
            feedInitialized = true
            const feed = makeFeed({
              element,
              relays: repoClass.relays,
              feedFilters: [combinedFilter],
              subscriptionFilters: [combinedFilter],
              initialEvents: issueList,
              onExhausted: () => {
                // Feed exhausted, but we already showed content
              },
            })
            feedCleanup = feed.cleanup
          } else if (!element) {
            requestAnimationFrame(tryStart)
          }
        }
        tryStart()
      }, 100)
      
      return () => {
        clearTimeout(timeout)
      }
    }
  })

  // CRITICAL: Cleanup on destroy to prevent memory leaks and blocking navigation
  onDestroy(() => {
    // Cleanup makeFeed (aborts network requests, stops scroll observers, unsubscribes)
    feedCleanup?.()
    
    // Abort all network requests
    abortControllers.forEach(controller => controller.abort())
    abortControllers.length = 0 // Clear array without reassignment
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
  <title>{repoClass?.name || 'Repository'} - Issues</title>
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
      {storageKey}
      authors={uniqueAuthors}
      authorFilter={authorFilter}
      allLabels={allNormalizedLabels}
      labelSearchEnabled={false}
      on:statusChange={(e) => (statusFilter = e.detail)}
      on:sortChange={(e) => (sortByOrder = e.detail)}
      on:authorChange={(e) => (authorFilter = e.detail)}
      on:labelsChange={(e) => (selectedLabels = e.detail)}
      on:matchAllChange={(e) => (matchAllLabels = e.detail)}
      showReset={true}
    />
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
                statusEvents={statusEventsByRoot?.get(issue.id) || []}
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
