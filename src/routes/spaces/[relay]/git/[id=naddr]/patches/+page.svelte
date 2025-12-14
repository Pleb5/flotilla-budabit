<script lang="ts">
  import {
    Button,
    PatchCard,
  } from "@nostr-git/ui"
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
  import { normalizeEffectiveLabels, toNaturalArray, groupLabels } from "@lib/budabit/labels"
  import {
    getTags,
    type CommentEvent,
    type PatchEvent,
    type PullRequestEvent,
    type StatusEvent,
  } from "@nostr-git/shared-types"
  import {parseGitPatchFromEvent} from "@nostr-git/core"
  import {parsePullRequestEvent} from "@nostr-git/shared-types"
  import Icon from "@src/lib/components/Icon.svelte"
  import {isMobile} from "@src/lib/html.js"
  import {postComment} from "@lib/budabit/commands.js"
  import FilterPanel from "@src/lib/budabit/components/FilterPanel.svelte"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  
  const {data} = $props()
  const {repoClass, comments, statusEventsByRoot, patchFilter, pullRequestFilter, repoRelays, uniqueAuthors, pullRequests} = data

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
  const labelsData = $derived.by(() => {
    const byId = new Map<string, string[]>()
    const groupsById = new Map<string, Record<string, string[]>>()
    for (const patch of repoClass.patches) {
      // Use deriveEffectiveLabels to get proper NIP-32 labels
      const effStore = deriveEffectiveLabels(patch.id)
      // Subscribe to the store to get its current value
      const effValue = effStore.get()
      const eff = normalizeEffectiveLabels(effValue)
      const naturals = toNaturalArray(eff?.flat)
      byId.set(patch.id, naturals)
      const groups = eff ? groupLabels(eff) : {Status: [], Type: [], Area: [], Tags: [], Other: []}
      groupsById.set(patch.id, groups)
    }
    const allLabels = Array.from(new Set(Array.from(byId.values()).flat()))
    return { byId, groupsById, allLabels }
  })

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
      const rootAuthor =
        repoClass.patches.find((p: any) => p.id === rootId)?.pubkey ||
        ($pullRequests || []).find((pr: any) => pr.id === rootId)?.pubkey
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

  const patchList = $derived.by((): any[] => {
    if (repoClass.patches && $comments) {
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
            type: "patch" as const,
            patches,
            status,
            parsedPatch,
            comments: commentEvents,
            // Add commit count directly for easier sorting
            commitCount: parsedPatch?.commitCount || 0,
            groups: labelGroupsFor(patch.id),
          }
        })

      // Merge in PR roots
      const prEvents = $pullRequests || []
      const prItems = prEvents.map((pr: PullRequestEvent) => {
        const parsedPR: any = parsePullRequestEvent(pr)
        const commentEvents = $comments?.filter((comment: CommentEvent) => {
          return getTags(comment, "E").find((tag: string[]) => tag[1] === pr.id)
        })
        const status = { kind: kindFromState(statusData.stateById[pr.id]) } as any
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

      // Merge PR items into the unified list; allow heterogeneous rows at runtime
      filteredPatches = [...filteredPatches, ...(prItems as any[])]

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
    postComment(comment, repoClass.relays || repoRelays)
  }

  $effect(() => {
    if (repoClass.patches && patchFilter && pullRequestFilter) {
      const tryStart = () => {
        if (element) {
          makeFeed({
            element,
            relays: repoClass.relays,
            feedFilters: [patchFilter, pullRequestFilter],
            subscriptionFilters: [patchFilter, pullRequestFilter],
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
      // Set loading to false immediately if we have patches already
      // makeFeed will handle incremental loading
      if (patchList.length > 0) {
        loading = false
      }
    } else if (repoClass.patches && repoClass.patches.length === 0) {
      // No patches, so we're done loading
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
      authorFilter={authorFilter}
      on:authorChange={(e) => (authorFilter = e.detail)}
      allLabels={allNormalizedLabels}
      labelSearchEnabled={true}
      on:statusChange={(e) => (statusFilter = e.detail)}
      on:sortChange={(e) => (sortBy = e.detail)}
      on:labelsChange={(e) => (selectedLabels = e.detail)}
      on:matchAllChange={(e) => (matchAllLabels = e.detail)}
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
                {onCommentCreated}
                reviewersCount={$roleAssignments?.get(patch.id)?.reviewers?.size || 0} 
              />
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
