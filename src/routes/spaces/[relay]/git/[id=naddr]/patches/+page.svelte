<script lang="ts">
  import {Button, PatchCard} from "@nostr-git/ui"
  import {Eye, SearchX} from "@lucide/svelte"
  import {createSearch, pubkey} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/core/requests"
  import {
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
  } from "@welshman/util"
  import {fly, slideAndFade} from "@lib/transition"
  import {deriveEffectiveLabels, deriveAssignmentsFor} from "@lib/budabit/state.js"
  import {normalizeEffectiveLabels, toNaturalArray, groupLabels} from "@lib/budabit/labels"
  import {
    getTags,
    type CommentEvent,
    type PatchEvent,
    type PullRequestEvent,
    type StatusEvent,
  } from "@nostr-git/core/events"
  import {Address, COMMENT} from "@welshman/util"
  import {parseGitPatchFromEvent} from "@nostr-git/core/git"
  import {request} from "@welshman/net"
  import {parsePullRequestEvent} from "@nostr-git/core/events"
  import Icon from "@src/lib/components/Icon.svelte"
  import {isMobile} from "@src/lib/html.js"
  import {postComment} from "@lib/budabit/commands.js"
  import FilterPanel from "@src/lib/budabit/components/FilterPanel.svelte"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"

  import {getContext} from "svelte"
  import {onDestroy} from "svelte"
  import {
    REPO_KEY,
    REPO_RELAYS_KEY,
    STATUS_EVENTS_BY_ROOT_KEY,
    PULL_REQUESTS_KEY,
  } from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  const repoClass = getContext<Repo>(REPO_KEY)
  const statusEventsByRootStore =
    getContext<Readable<Map<string, StatusEvent[]>>>(STATUS_EVENTS_BY_ROOT_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Get current values from stores reactively using $ rune
  const statusEventsByRoot = $derived.by(() =>
    statusEventsByRootStore ? $statusEventsByRootStore : new Map<string, StatusEvent[]>(),
  )
  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []))
  const pullRequests = $derived.by(() => (pullRequestsStore ? $pullRequestsStore : []))

  $effect(() => {
    console.log("pullRequests", pullRequests)
  })

  // Comments are managed locally, similar to issues page
  let comments = $state<CommentEvent[]>([])

  // Load comments for patches and PRs - defer to avoid blocking render
  $effect(() => {
    if (!repoClass) return

    // Access reactive dependencies synchronously to ensure they're tracked
    const currentPatches = repoClass.patches
    const currentPullRequests = pullRequests
    const currentRepoRelays = repoRelays

    const controller = new AbortController()
    abortControllers.push(controller)

    // Defer comment loading to avoid blocking initial render
    const timeout = setTimeout(() => {
      const allRootIds = [
        ...currentPatches.map((p: PatchEvent) => p.id),
        ...currentPullRequests.map((pr: PullRequestEvent) => pr.id),
      ]

      if (allRootIds.length > 0) {
        request({
          relays: currentRepoRelays,
          signal: controller.signal,
          filters: [{kinds: [COMMENT], "#E": allRootIds}],
          onEvent: e => {
            if (!comments.some(c => c.id === e.id)) {
              comments = [...comments, e as CommentEvent]
            }
          },
        })
      }
    }, 100)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  // Create filters for makeFeed (needed for incremental loading)
  const patchFilter = $derived.by(() => {
    if (!repoClass.repoEvent) return {kinds: [1617], "#a": []}
    return {
      kinds: [1617],
      "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
    }
  })

  const pullRequestFilter = $derived.by(() => {
    if (!repoClass.repoEvent) return {kinds: [1618], "#a": []}
    return {
      kinds: [1618],
      "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
    }
  })

  const uniqueAuthors = $derived.by(() => {
    if (!repoClass) return []
    const authors = new Set(repoClass.patches.map((patch: PatchEvent) => patch.pubkey))
    return Array.from(authors)
  })

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortBy = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let showFilters = $state(true)
  let searchTerm = $state("")
  // Label filters (NIP-32)
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)
  let labelSearch = $state("")
  // Centralized labels via app state

  // Optimize labelsData: compute lazily and cache results to avoid blocking render
  // Use a Map to track subscriptions and clean them up properly
  let labelsDataCache = $state<{
    byId: Map<string, string[]>
    groupsById: Map<string, Record<string, string[]>>
    allLabels: string[]
  }>({
    byId: new Map<string, string[]>(),
    groupsById: new Map<string, Record<string, string[]>>(),
    allLabels: [],
  })
  let labelsDataCacheKey = $state<string>("")

  // Compute labelsData asynchronously to avoid blocking render
  $effect(() => {
    if (!repoClass) return

    // Access reactive dependency synchronously to ensure it's tracked
    const currentPatches = repoClass.patches

    // Create cache key from patch IDs to detect changes
    const currentKey = currentPatches
      .map(p => p.id)
      .sort()
      .join(",")

    // Skip if already computed for this set of patches
    if (labelsDataCacheKey === currentKey) return

    // Defer heavy computation to avoid blocking initial render
    const timeout = setTimeout(() => {
      const byId = new Map<string, string[]>()
      const groupsById = new Map<string, Record<string, string[]>>()

      for (const patch of currentPatches) {
        try {
          // Use deriveEffectiveLabels to get proper NIP-32 labels
          // Only get value once - don't subscribe to avoid memory leaks
          const effStore = deriveEffectiveLabels(patch.id)
          const effValue = effStore.get()
          const eff = normalizeEffectiveLabels(effValue)
          const naturals = toNaturalArray(eff?.flat)
          byId.set(patch.id, naturals)
          const groups = eff
            ? groupLabels(eff)
            : {Status: [], Type: [], Area: [], Tags: [], Other: []}
          groupsById.set(patch.id, groups)
        } catch (e) {
          // Fallback to empty labels if computation fails
          byId.set(patch.id, [])
          groupsById.set(patch.id, {Status: [], Type: [], Area: [], Tags: [], Other: []})
        }
      }

      const allLabels = Array.from(new Set(Array.from(byId.values()).flat()))
      labelsDataCache = {byId, groupsById, allLabels}
      labelsDataCacheKey = currentKey
    })

    // Cleanup function to cancel timeout
    return () => {
      clearTimeout(timeout)
    }
  })

  // Return cached labelsData synchronously
  const labelsData = $derived(labelsDataCache)

  const roleAssignments = $derived.by(() => {
    const ids = repoClass.patches?.map((p: any) => p.id) || []
    return deriveAssignmentsFor(ids)
  })

  const labelsByPatch = $derived.by(() => labelsData.byId)
  const labelGroupsFor = (id: string) =>
    labelsData.groupsById.get(id) || {Status: [], Type: [], Area: [], Tags: [], Other: []}

  // Persist filters per repo (delegated to FilterPanel)
  let storageKey = repoClass?.key ? `patchesFilters:${repoClass.key}` : ""
  const allNormalizedLabels = $derived.by(() =>
    Array.from(new Set(Array.from(labelsByPatch.values()).flat())),
  )

  // Precompute status via PatchManager; map state -> kind where needed (fallback)
  const statusData = $derived.by(() =>
    repoClass
      ? repoClass.patchManager.getStatusData(repoClass)
      : {stateById: {}, commentsByPatch: {}},
  )
  const kindFromState = (s?: string) =>
    s === "open"
      ? GIT_STATUS_OPEN
      : s === "draft"
        ? GIT_STATUS_DRAFT
        : s === "closed"
          ? GIT_STATUS_CLOSED
          : GIT_STATUS_COMPLETE // merged/resolved

  // Compute current status state using Status.svelte rules (authorized events)
  const patchMaintainerSet = $derived.by(() => {
    if (!repoClass) return new Set<string>()
    try {
      const maintainers = repoClass.maintainers || []
      const owner = (repoClass as any).repoEvent?.pubkey
      return new Set([...(maintainers || []), owner].filter(Boolean))
    } catch {
      return new Set<string>()
    }
  })
  const currentPatchStateFor = (rootId: string): "open" | "draft" | "closed" | "applied" => {
    if (!repoClass) return "open"
    try {
      const events = (statusEventsByRoot?.get(rootId) || []) as StatusEvent[]
      const rootAuthor =
        repoClass.patches.find((p: any) => p.id === rootId)?.pubkey ||
        (pullRequests || []).find((pr: any) => pr.id === rootId)?.pubkey
      const auth = events.filter(e => e.pubkey === rootAuthor || patchMaintainerSet.has(e.pubkey))
      if (auth.length === 0) return "open"
      const latest = [...auth].sort((a, b) => b.created_at - a.created_at)[0]
      switch (latest.kind) {
        case GIT_STATUS_OPEN:
          return "open"
        case GIT_STATUS_DRAFT:
          return "draft"
        case GIT_STATUS_CLOSED:
          return "closed"
        case GIT_STATUS_COMPLETE:
          return "applied"
        default:
          return "open"
      }
    } catch {
      return "open"
    }
  }

  // Compute patchList asynchronously to avoid blocking UI rendering
  let patchList = $state<any[]>([])
  let patchListCacheKey = $state<string>("")

  $effect(() => {
    // Access all reactive dependencies synchronously to ensure they're tracked
    if (!repoClass) return

    const currentPatches = repoClass.patches
    const currentComments = comments
    const currentStatusData = statusData
    const currentPullRequests = pullRequests
    const currentStatusFilter = statusFilter
    const currentAuthorFilter = authorFilter
    const currentSortBy = sortBy
    const currentPatchListCacheKey = patchListCacheKey

    const timeout = setTimeout(() => {
      if (!currentPatches || currentPatches.length === 0) {
        patchList = []
        return
      }

      // Create cache key from patch IDs, comments, status, filters, and sort to detect changes
      const currentKey = [
        currentPatches
          .map(p => p.id)
          .sort()
          .join(","),
        currentComments
          .map(c => c.id)
          .sort()
          .join(","),
        currentStatusData.stateById
          ? Object.keys(currentStatusData.stateById).sort().join(",")
          : "",
        currentPullRequests
          .map(pr => pr.id)
          .sort()
          .join(","),
        currentStatusFilter,
        currentAuthorFilter,
        currentSortBy,
      ].join("|")

      if (currentPatchListCacheKey === currentKey) return

      // Pre-build indexes for O(1) lookups instead of O(n) filtering per patch
      // Map of root ID -> child patches
      const childPatchesByRoot = new Map<string, PatchEvent[]>()
      for (const patch of currentPatches) {
        const rootTag = getTags(patch, "e").find((tag: string[]) => tag[1])
        if (rootTag && rootTag[1]) {
          const rootId = rootTag[1]
          if (!childPatchesByRoot.has(rootId)) {
            childPatchesByRoot.set(rootId, [])
          }
          childPatchesByRoot.get(rootId)!.push(patch)
        }
      }

      // Map of patch ID -> comments (reuse for PRs too)
      const commentsByPatch = new Map<string, CommentEvent[]>()
      for (const comment of currentComments) {
        const patchTag = getTags(comment, "E").find((tag: string[]) => tag[1])
        if (patchTag && patchTag[1]) {
          const patchId = patchTag[1]
          if (!commentsByPatch.has(patchId)) {
            commentsByPatch.set(patchId, [])
          }
          commentsByPatch.get(patchId)!.push(comment)
        }
      }

      // Get all root patches first
      const rootPatches = currentPatches.filter((patch: PatchEvent) => {
        return getTags(patch, "t").find((tag: string[]) => tag[1] === "root")
      })

      // Process all patches at once
      const processed: any[] = []
      for (const patch of rootPatches) {
        // Use manager-provided state and derive kind for UI
        const status = {kind: kindFromState((currentStatusData.stateById as any)[patch.id])} as any

        // O(1) lookup instead of O(n) filter
        const patches = childPatchesByRoot.get(patch.id) || []
        const parsedPatch = parseGitPatchFromEvent(patch)

        // O(1) lookup instead of O(c) filter
        const commentEvents = commentsByPatch.get(patch.id) || []

        processed.push({
          ...patch,
          type: "patch" as const,
          patches,
          status,
          parsedPatch,
          comments: commentEvents,
          // Add commit count directly for easier sorting
          commitCount: parsedPatch?.commitCount || 0,
          groups: labelGroupsFor(patch.id),
        })
      }

      // All patches processed, now merge PRs, filter, and sort
      const applyFiltersAndSort = (
        allPatches: any[],
        commentsByPatch: Map<string, CommentEvent[]>,
      ) => {
        // Merge in PR roots
        const prEvents = currentPullRequests || []
        const prItems = prEvents.map((pr: PullRequestEvent) => {
          const parsedPR: any = parsePullRequestEvent(pr)
          // O(1) lookup instead of O(c) filter
          const commentEvents = commentsByPatch.get(pr.id) || []
          const status = {kind: kindFromState((currentStatusData.stateById as any)[pr.id])} as any
          return {
            ...pr,
            type: "pr" as const,
            patches: [],
            status,
            parsedPatch: {
              title: parsedPR.subject || parsedPR.title || "(no title)",
              description: parsedPR.description || parsedPR.content || "",
              baseBranch: parsedPR.branchName || parsedPR.baseBranch,
              commitCount: 0,
              createdAt: pr.created_at * 1000,
              commitHash: parsedPR.tipCommit || parsedPR.commitId,
            },
            comments: commentEvents,
            commitCount: 0,
            groups: {Status: [], Type: [], Area: [], Tags: [], Other: []},
          }
        })

        // Merge PR items into the unified list
        let filteredPatches = [...allPatches, ...(prItems as any[])]

        // Apply status filter
        if (currentStatusFilter !== "all") {
          filteredPatches = filteredPatches.filter(patch => {
            const state = currentPatchStateFor(patch.id)
            if (currentStatusFilter === "open") return state === "open"
            if (currentStatusFilter === "applied") return state === "applied"
            if (currentStatusFilter === "closed") return state === "closed"
            if (currentStatusFilter === "draft") return state === "draft"
            return true
          })
        }

        // Apply author filter
        if (currentAuthorFilter) {
          filteredPatches = filteredPatches.filter(patch => patch.pubkey === currentAuthorFilter)
        }

        // Apply sorting
        const sortedPatches = [...filteredPatches]
        if (currentSortBy === "newest") {
          sortedPatches.sort((a, b) => b.created_at - a.created_at)
        } else if (currentSortBy === "oldest") {
          sortedPatches.sort((a, b) => a.created_at - b.created_at)
        } else if (currentSortBy === "status") {
          // Sort by current state priority using Status.svelte semantics
          const prio = (id: string) => {
            const s = currentPatchStateFor(id)
            return s === "open" ? 0 : s === "draft" ? 1 : s === "applied" ? 2 : 3
          }
          sortedPatches.sort((a, b) => prio(a.id) - prio(b.id))
        } else if (currentSortBy === "commits") {
          // Sort by commit count (highest first)
          sortedPatches.sort((a, b) => b.commitCount - a.commitCount)
        }

        // Update patchList with final filtered and sorted result
        patchList = sortedPatches
        patchListCacheKey = currentKey
      }

      // Apply filters and sort
      applyFiltersAndSort(processed, commentsByPatch)
    }, 100)

    return () => {
      clearTimeout(timeout)
    }
  })

  // Set loading to false immediately - show content right away
  let loading = $state(false)
  let element: HTMLElement | undefined = $state()
  let feedInitialized = $state(false)
  let feedCleanup: (() => void) | undefined = $state(undefined)
  // Use non-reactive array to avoid infinite loops when pushing in effects
  const abortControllers: AbortController[] = []

  const onCommentCreated = async (comment: CommentEvent) => {
    postComment(comment, repoRelays)
  }

  // Initialize feed asynchronously - don't block render
  $effect(() => {
    // Access reactive dependencies synchronously to ensure they're tracked
    const currentRepoClass = repoClass
    const currentPatchFilter = patchFilter
    const currentPullRequestFilter = pullRequestFilter
    const currentRepoRelays = repoRelays
    const currentPatchList = patchList
    const currentElement = element
    const currentFeedInitialized = feedInitialized

    // Defer makeFeed to avoid blocking initial render
    const timeout = setTimeout(() => {
      if (
        currentRepoClass &&
        currentRepoClass.patches &&
        currentPatchFilter &&
        currentPullRequestFilter &&
        !currentFeedInitialized
      ) {
        const tryStart = () => {
          if (currentElement && !currentFeedInitialized) {
            feedInitialized = true
            const feed = makeFeed({
              element: currentElement,
              relays: currentRepoRelays,
              feedFilters: [currentPatchFilter, currentPullRequestFilter],
              subscriptionFilters: [currentPatchFilter, currentPullRequestFilter],
              initialEvents: currentPatchList,
              onExhausted: () => {
                // Feed exhausted, but we already showed content
              },
            })
            feedCleanup = feed.cleanup
          } else if (!currentElement) {
            requestAnimationFrame(tryStart)
          }
        }
        tryStart()
      }
    }, 100)

    return () => {
      clearTimeout(timeout)
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

  const searchedPatches = $derived.by(() => {
    const patchesToSearch = patchList.map(patch => {
      return {
        id: patch.id,
        title: patch.parsedPatch.title,
      }
    })

    const patchesSearch = createSearch(patchesToSearch, {
      getValue: (patch: {id: string; title: string}) => patch.id,
      fuseOptions: {
        keys: [{name: "title"}],
        includeScore: true,
        threshold: 0.3,
        isCaseSensitive: false,
        // When true, search will ignore location and distance, so it won't
        // matter where in the string the pattern appears
        ignoreLocation: true,
      },
      sortFn: ({score, item}) => {
        if (score && score > 0.3) return -score!
        return item.title
      },
    })
    const searchResults = patchesSearch.searchOptions(searchTerm)
    const result = patchList
      .filter(p => searchResults.find(res => res.id === p.id))
      .filter(p => {
        if (selectedLabels.length === 0) return true
        const labs = labelsByPatch.get(p.id) || []
        return matchAllLabels
          ? selectedLabels.every(l => labs.includes(l))
          : selectedLabels.some(l => labs.includes(l))
      })
    return result
  })
</script>

<svelte:head>
  <title>{repoClass?.name || "Repository"} - Patches</title>
</svelte:head>

<div bind:this={element}>
  <div class="mb-2 flex flex-col gap-y-2 py-4">
    <div class=" flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Patches</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Review and merge code changes</p>
      </div>
    </div>
    <div class="row-2 input grow overflow-x-hidden">
      <Icon icon={Magnifer} />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus={!isMobile}
        class="w-full"
        bind:value={searchTerm}
        type="text"
        placeholder="Search patches..." />
      <Button
        variant="outline"
        size="sm"
        class="gap-2"
        onclick={() => (showFilters = !showFilters)}>
        <Eye class="h-4 w-4" />
        {showFilters ? "Hide Filters" : "Filter"}
      </Button>
    </div>
  </div>

  {#if showFilters}
    <FilterPanel
      mode="patches"
      {storageKey}
      authors={Array.from(uniqueAuthors)}
      {authorFilter}
      on:authorChange={e => (authorFilter = e.detail)}
      allLabels={allNormalizedLabels}
      labelSearchEnabled={true}
      on:statusChange={e => (statusFilter = e.detail)}
      on:sortChange={e => (sortBy = e.detail)}
      on:labelsChange={e => (selectedLabels = e.detail)}
      on:matchAllChange={e => (matchAllLabels = e.detail)} />
  {/if}

  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading patches….
        {:else}
          End of patches history
        {/if}
      </Spinner>
    </div>
  {:else if searchedPatches.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No patches found.
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#key searchedPatches}
        {#each searchedPatches as patch (patch.id)}
          <div in:fly={slideAndFade({duration: 200})}>
            <div class="relative">
              <PatchCard
                event={patch}
                patches={patch.patches}
                status={patch.status as StatusEvent}
                comments={patch.comments}
                currentCommenter={$pubkey!}
                extraLabels={labelsByPatch.get(patch.id) || []}
                repo={repoClass}
                statusEvents={statusEventsByRoot?.get(patch.id) || []}
                actorPubkey={$pubkey}
                {onCommentCreated}
                reviewersCount={$roleAssignments?.get(patch.id)?.reviewers?.size || 0} />
              {#if labelsByPatch.get(patch.id)?.length}
                <div class="mt-2 flex flex-wrap gap-2 text-xs">
                  {#if patch.groups.Status.length}
                    <span class="opacity-60">Status:</span>
                    {#each patch.groups.Status as l (l)}<span class="badge badge-ghost badge-sm"
                        >{l}</span
                      >{/each}
                  {/if}
                  {#if patch.groups.Type.length}
                    <span class="opacity-60">Type:</span>
                    {#each patch.groups.Type as l (l)}<span class="badge badge-ghost badge-sm"
                        >{l}</span
                      >{/each}
                  {/if}
                  {#if patch.groups.Area.length}
                    <span class="opacity-60">Area:</span>
                    {#each patch.groups.Area as l (l)}<span class="badge badge-ghost badge-sm"
                        >{l}</span
                      >{/each}
                  {/if}
                  {#if patch.groups.Tags.length}
                    <span class="opacity-60">Tags:</span>
                    {#each patch.groups.Tags as l (l)}<span class="badge badge-ghost badge-sm"
                        >{l}</span
                      >{/each}
                  {/if}
                  {#if patch.groups.Other.length}
                    <span class="opacity-60">Other:</span>
                    {#each patch.groups.Other as l (l)}<span class="badge badge-ghost badge-sm"
                        >{l}</span
                      >{/each}
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      {/key}
    </div>
  {/if}
</div>
