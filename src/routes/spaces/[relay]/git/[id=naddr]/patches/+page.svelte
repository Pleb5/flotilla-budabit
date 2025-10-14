<script lang="ts">
  import {
    Button,
    PatchCard,
    pushRepoAlert,
  } from "@nostr-git/ui"
  import {
    CalendarDays,
    Check,
    Clock,
    Eye,
    GitCommit,
    SearchX,
    User,
    X,
  } from "@lucide/svelte"
  import {createSearch, pubkey} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/core/requests"
  import {
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
  } from "@welshman/util"
  import {fly, slide, slideAndFade} from "@lib/transition"
  import {
    getTags,
    type CommentEvent,
    type PatchEvent,
    type StatusEvent,
  } from "@nostr-git/shared-types"
  import {parseGitPatchFromEvent} from "@nostr-git/core"
  import Icon from "@src/lib/components/Icon.svelte"
  import {isMobile} from "@src/lib/html.js"
  import {postComment} from "@lib/budabit/commands.js"
  import FilterPanel from "@src/app/components/FilterPanel.svelte"
  import {onMount, onDestroy} from "svelte"
  import {now} from "@welshman/lib"

  const {data} = $props()
  const {repoClass, comments, statusEvents, statusEventsByRoot, patchFilter, repoRelays, uniqueAuthors} = data
  const mounted = now()
  const alertedIds = new Set<string>()
  // Track previous review-needed state to only alert on false -> true transitions
  const prevReviewStateByPatch: Map<string, boolean> = new Map()
  // Debounce window for comment mention alerts per patch (ms)
  const mentionWindowMs = 3000
  const lastMentionAlertAtByPatch: Map<string, number> = new Map()

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

  // Types + helpers to normalize effective labels
  const labelsData = $derived.by(() => repoClass.patchManager.getLabelsData(repoClass))

  // Alerts: if current user is explicitly tagged via 'p' on a root patch, treat as review request
  $effect(() => {
    try {
      const me = $pubkey
      if (!me) return
      const arr = repoClass.patches || []
      for (const p of arr) {
        if (!p || !p.id) continue
        // only root patches
        const isRoot = getTags(p, "t").some((t: string[]) => t[1] === "root")
        if (!isRoot) continue
        const pTags = getTags(p, "p").map((t: string[]) => t[1])
        const current = pTags.includes(me)
        const prev = prevReviewStateByPatch.get(p.id) || false
        if (!prev && current) {
          pushRepoAlert({
            repoKey: repoClass.key,
            kind: "review-request",
            title: "Review requested",
            body: parseGitPatchFromEvent(p)?.title || "",
          })
        }
        prevReviewStateByPatch.set(p.id, current)
      }
    } catch {}
  })

  // Alerts: thread/comment mentions (p-tag to me) on patch threads; alert once per comment, with debounce window per patch
  $effect(() => {
    try {
      const me = $pubkey
      if (!me) return
      const arr = repoClass.patches || []
      for (const p of arr) {
        if (!p || !p.id) continue
        const thread = repoClass.getIssueThread(p.id)
        const comments = thread?.comments || []
        for (const c of comments) {
          if (!c?.id) continue
          if (alertedIds.has(`review-cmnt:${c.id}`)) continue
          const pks = getTags(c as any, "p").map((t: string[]) => t[1])
          if (pks.includes(me)) {
            const nowTs = Date.now()
            const last = lastMentionAlertAtByPatch.get(p.id) || 0
            if (nowTs - last > mentionWindowMs) {
              pushRepoAlert({
                repoKey: repoClass.key,
                kind: "review-request",
                title: "Review requested in comments",
                body: parseGitPatchFromEvent(p)?.title || "",
              })
              lastMentionAlertAtByPatch.set(p.id, nowTs)
            }
            alertedIds.add(`review-cmnt:${c.id}`)
          }
        }
      }
    } catch {}
  })

  // Alerts: review-request based on Type labels; alert on transition to true
  $effect(() => {
    try {
      const arr = repoClass.patches || []
      for (const p of arr) {
        if (!p || !p.id) continue
        const groups = labelGroupsFor(p.id)
        const typeVals = (groups?.Type || []).map(v => v.toLowerCase())
        const current = typeVals.some(v => v.includes("review"))
        const prev = prevReviewStateByPatch.get(p.id) || false
        if (!prev && current) {
          pushRepoAlert({
            repoKey: repoClass.key,
            kind: "review-request",
            title: "Review requested",
            body: parseGitPatchFromEvent(p)?.title || "",
          })
        }
        prevReviewStateByPatch.set(p.id, current)
      }
    } catch {}
  })

  const labelsByPatch = $derived.by(() => labelsData.byId)
  const labelGroupsFor = (id: string) =>
    labelsData.groupsById.get(id) || {Status: [], Type: [], Area: [], Tags: [], Other: []}

  // Persist filters per repo
  let storageKey = ""
  onMount(() => {
    try {
      storageKey = repoClass.key
        ? `patchesFilters:${repoClass.key}`
        : ""
    } catch (e) {
      storageKey = ""
    }
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const data = JSON.parse(raw)
        if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
        if (typeof data.sortBy === "string") sortBy = data.sortBy
        if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
        if (typeof data.showFilters === "boolean") showFilters = data.showFilters
        if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
        if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
        if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
        if (typeof data.labelSearch === "string") labelSearch = data.labelSearch
      }
    } catch (e) {
      // ignore
    }
  })

  // Alerts: watch for new status events since mount and push alerts
  $effect(() => {
    try {
      const arr = $statusEvents || []
      for (const e of arr) {
        if (!e || !e.id) continue
        if (alertedIds.has(e.id)) continue
        if (e.created_at <= mounted) continue
        const k = e.kind as number
        if ([GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE].includes(k)) {
          const title =
            k === GIT_STATUS_COMPLETE
              ? "Patch merged"
              : k === GIT_STATUS_CLOSED
                ? "Patch closed"
                : k === GIT_STATUS_DRAFT
                  ? "Patch draft"
                  : "Patch opened"
          pushRepoAlert({
            repoKey: repoClass.key,
            kind: "status-change",
            title,
          })
          alertedIds.add(e.id)
        }
      }
    } catch {}
  })

  const persist = () => {
    if (!storageKey) return
    try {
      const data = {
        statusFilter,
        sortBy,
        authorFilter,
        showFilters,
        searchTerm,
        selectedLabels,
        matchAllLabels,
        labelSearch,
      }
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch (e) {
      // ignore
    }
  }

  // Debounced persist to avoid excessive writes
  let persistTimer: number | null = null
  const persistDebounced = () => {
    if (!storageKey) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      persist()
      persistTimer = null
    }, 150)
  }

  // Single reactive watcher for all filter inputs
  $effect(() => {
    statusFilter
    sortBy
    authorFilter
    showFilters
    searchTerm
    selectedLabels
    matchAllLabels
    labelSearch
    persistDebounced()
  })

  const applyFromData = (data: any) => {
    if (!data) return
    if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
    if (typeof data.sortBy === "string") sortBy = data.sortBy
    if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
    if (typeof data.showFilters === "boolean") showFilters = data.showFilters
    if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
    if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
    if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
    if (typeof data.labelSearch === "string") labelSearch = data.labelSearch
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
    if (persistTimer) clearTimeout(persistTimer)
  })
  const allNormalizedLabels = $derived.by(() =>
    Array.from(new Set(Array.from(labelsByPatch.values()).flat())),
  )

  // Precompute status via PatchManager; map state -> kind where needed (fallback)
  const statusData = $derived.by(() => repoClass.patchManager.getStatusData(repoClass))
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
    try {
      const maintainers = repoClass.maintainers || []
      const owner = (repoClass as any).repoEvent?.pubkey
      return new Set([...(maintainers || []), owner].filter(Boolean))
    } catch { return new Set<string>() }
  })
  const currentPatchStateFor = (rootId: string): "open" | "draft" | "closed" | "applied" => {
    try {
      const events = ($statusEventsByRoot?.get(rootId) || []) as StatusEvent[]
      const rootAuthor = repoClass.patches.find((p: any) => p.id === rootId)?.pubkey
      const auth = events.filter(e => e.pubkey === rootAuthor || patchMaintainerSet.has(e.pubkey))
      if (auth.length === 0) return "open"
      const latest = [...auth].sort((a, b) => b.created_at - a.created_at)[0]
      switch (latest.kind) {
        case GIT_STATUS_OPEN: return "open"
        case GIT_STATUS_DRAFT: return "draft"
        case GIT_STATUS_CLOSED: return "closed"
        case GIT_STATUS_COMPLETE: return "applied"
        default: return "open"
      }
    } catch { return "open" }
  }

  const patchList = $derived.by(() => {
    if (repoClass.patches && $statusEvents.length > 0 && $comments) {
      // First get all root patches
      let filteredPatches = repoClass.patches
        .filter((patch: PatchEvent) => {
          return getTags(patch, "t").find((tag: string[]) => tag[1] === "root")
        })
        .map((patch: PatchEvent) => {
          // Use manager-provided state and derive kind for UI
          const status = { kind: kindFromState(statusData.stateById[patch.id]) } as any

          const patches = repoClass.patches.filter((issue: PatchEvent) => {
            return getTags(issue, "e").find((tag: string[]) => tag[1] === patch.id)
          })
          const parsedPatch = parseGitPatchFromEvent(patch)

          const commentEvents = $comments?.filter((comment: CommentEvent) => {
            return getTags(comment, "E").find((tag: string[]) => tag[1] === patch.id)
          })

          return {
            ...patch,
            patches,
            status,
            parsedPatch,
            comments: commentEvents,
            // Add commit count directly for easier sorting
            commitCount: parsedPatch?.commitCount || 0,
            groups: labelGroupsFor(patch.id),
          }
        })

      if (statusFilter !== "all") {
        filteredPatches = filteredPatches.filter(patch => {
          const state = currentPatchStateFor(patch.id)
          if (statusFilter === "open") return state === "open"
          if (statusFilter === "applied") return state === "applied"
          if (statusFilter === "closed") return state === "closed"
          if (statusFilter === "draft") return state === "draft"
          return true
        })
      }

      // Apply author filter
      if (authorFilter) {
        filteredPatches = filteredPatches.filter(patch => patch.pubkey === authorFilter)
      }

      const sortedPatches = [...filteredPatches]

      const currentSortBy = sortBy

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
      return sortedPatches
    }
    return []
  })

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, repoClass.relays || repoRelays).result
  }

  $effect(() => {
    if (repoClass.patches) {
      const tryStart = () => {
        if (element) {
          makeFeed({
            element,
            relays: repoClass.relays,
            feedFilters: [patchFilter],
            subscriptionFilters: [patchFilter],
            initialEvents: patchList,
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
  <title>{repoClass.name} - Patches</title>
</svelte:head>

<div bind:this={element}>
  <div class="z-10 sticky -top-8 z-nav mb-2 flex flex-col gap-y-2 py-4 backdrop-blur">
    <div class=" flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Patches</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Review and merge code changes</p>
      </div>
    </div>
    <div class="row-2 input grow overflow-x-hidden">
      <Icon icon="magnifer" />
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
      statusOptions={[
        { value: "open", label: "Open", icon: GitCommit },
        { value: "applied", label: "Applied", icon: Check },
        { value: "closed", label: "Closed", icon: X },
        { value: "draft", label: "Draft", icon: Clock },
      ]}
      selectedStatus={statusFilter}
      onStatusChange={(v) => (statusFilter = v)}

      sortOptions={[
        { value: "newest", label: "Newest", icon: CalendarDays },
        { value: "oldest", label: "Oldest", icon: CalendarDays },
        { value: "status", label: "Status", icon: Check },
        { value: "commits", label: "Commits", icon: GitCommit },
      ]}
      sortBy={sortBy}
      onSortChange={(v) => (sortBy = v)}

      authors={Array.from(uniqueAuthors)}
      authorFilter={authorFilter}
      onAuthorChange={(v) => (authorFilter = v)}

      allLabels={allNormalizedLabels}
      selectedLabels={selectedLabels}
      onToggleLabel={(lbl) => (selectedLabels = selectedLabels.includes(lbl) ? selectedLabels.filter(l => l !== lbl) : [...selectedLabels, lbl])}
      onClearLabels={() => (selectedLabels = [])}
      matchAllLabels={matchAllLabels}
      onMatchAllToggle={() => (matchAllLabels = !matchAllLabels)}
      labelSearchEnabled={true}
      labelSearch={labelSearch}
      onLabelSearchChange={(s) => (labelSearch = s)}

      showReset={false}
      showReviewIndicator={true}
    />
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
                statusEvents={$statusEventsByRoot?.get(patch.id) || []}
                actorPubkey={$pubkey}
                {onCommentCreated} />
              <!-- Grouped labels below card -->
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
