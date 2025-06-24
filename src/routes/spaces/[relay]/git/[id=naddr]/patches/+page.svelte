<script lang="ts">
  import {Button, PatchCard} from "@nostr-git/ui"
  import {CalendarDays, Check, Clock, Funnel, GitCommit, Plus, SearchX, User, X} from "@lucide/svelte"
  import {Address, COMMENT} from "@welshman/util"
  import {nthEq, sortBy} from "@welshman/lib"
  import {repository} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {deriveEvents} from "@welshman/store"
  import {
    GIT_PATCH,
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
  } from "@welshman/util"
  import {fly} from "@lib/transition"
  import {load} from "@welshman/net"
  import {getTags, type PatchEvent, type StatusEvent} from "@nostr-git/shared-types"
  import {parseGitPatchFromEvent} from "@nostr-git/core"

  const {data} = $props()
  const {repoClass} = data

  const statusEventFilter = {
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [...repoClass.patches.map((patch: PatchEvent) => patch.id)],
  }
  const statusEvents = deriveEvents(repository, {filters: [statusEventFilter]})

  // Filter and sort options
  let statusFilter = $state<string>("all") // all, open, applied, closed, draft
  let sortBy = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let showFilters = $state(false)
    
  // Get all unique authors from patches
  const uniqueAuthors = $derived.by(() => {
    if (!repoClass.patches) return []
    
    const authors = new Set<string>()
    repoClass.patches.forEach((patch: PatchEvent) => {
      const pubkey = patch.pubkey
      if (pubkey) authors.add(pubkey)
    })
    
    return Array.from(authors)
  })
  
  const patchList = $derived.by(() => {
    if (repoClass.patches && $statusEvents.length > 0) {
      // First get all root patches
      let filteredPatches = repoClass.patches
        .filter((patch: PatchEvent) => {
          const tags = getTags(patch, "t")
          return tags.length > 0 && tags[0][1] === "root"
        })
        .map((patch: PatchEvent) => {
          const status = $statusEvents
            ?.filter((s: any) => {
              let [_, eventId] = s.tags.find(nthEq(0, "e")) || []
              return eventId === patch.id
            })
            .sort((a: any, b: any) => b.created_at - a.created_at)[0]

          const patches = repoClass.patches.filter(issue => {
            const tags = getTags(issue, "e")
            return tags.length > 0 && tags[0][1] === patch.id
          })

          // Parse the patch to get additional metadata
          const parsedPatch = parseGitPatchFromEvent(patch)
          
          return {
            ...patch,
            patches,
            status,
            parsedPatch,
            // Add commit count directly for easier sorting
            commitCount: parsedPatch?.commitCount || 0,
          }
        })
      
      // Apply status filter
      if (statusFilter !== "all") {
        filteredPatches = filteredPatches.filter(patch => {
          if (!patch.status) {
            // If no status and filter is "open", show it (default is open)
            return statusFilter === "open"
          }
          
          switch (statusFilter) {
            case "open":
              return patch.status.kind === GIT_STATUS_OPEN
            case "applied":
              return patch.status.kind === GIT_STATUS_COMPLETE
            case "closed":
              return patch.status.kind === GIT_STATUS_CLOSED
            case "draft":
              return patch.status.kind === GIT_STATUS_DRAFT
            default:
              return true
          }
        })
      }
      
      // Apply author filter
      if (authorFilter) {
        filteredPatches = filteredPatches.filter(patch => patch.pubkey === authorFilter)
      }
      
      // Create a new array to avoid mutating the original
      let sortedPatches = [...filteredPatches]
      
      // Apply sorting - make a copy first to ensure reactivity
      const currentSortBy = sortBy // Capture the current sort value
      
      if (currentSortBy === "newest") {
        sortedPatches.sort((a, b) => b.created_at - a.created_at)
      } else if (currentSortBy === "oldest") {
        sortedPatches.sort((a, b) => a.created_at - b.created_at)
      } else if (currentSortBy === "status") {
        // Sort by status priority: open, draft, complete, closed
        sortedPatches.sort((a, b) => {
          const getStatusPriority = (status?: any) => {
            if (!status) return 0 // Open (default)
            switch (status.kind) {
              case GIT_STATUS_OPEN: return 0
              case GIT_STATUS_DRAFT: return 1
              case GIT_STATUS_COMPLETE: return 2
              case GIT_STATUS_CLOSED: return 3
              default: return 4
            }
          }
          return getStatusPriority(a.status) - getStatusPriority(b.status)
        })
      } else if (currentSortBy === "commits") {
        // Sort by commit count (highest first)
        sortedPatches.sort((a, b) => b.commitCount - a.commitCount)
      }
      return sortedPatches
    }
  })

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  const patchFilter = {
    kinds: [GIT_PATCH],
    "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
    "#t": ["root"],
  }

  const commentFilter = {
    kinds: [COMMENT],
    "#E": [...repoClass.patches.map(i => i.id)],
  }

  const allComments = $derived.by(() => {
    if (repoClass.patches) {
      return deriveEvents(repository, {filters: [commentFilter]})
    }
  })

  $effect(() => {
    if (repoClass.patches) {
      load({relays: repoClass.relays, filters: [patchFilter, statusEventFilter, commentFilter]})

      makeFeed({
        element: element!,
        relays: repoClass.relays,
        feedFilters: [patchFilter],
        subscriptionFilters: [patchFilter],
        initialEvents: patchList,
        onExhausted: () => {
          loading = false
        },
      })
      loading = false
    }
  })
</script>

<div bind:this={element}>
  <div class="z-10 sticky -top-8 z-nav mb-4 flex items-center justify-between py-4 backdrop-blur">
    <div>
      <h2 class="text-xl font-semibold">Patches</h2>
      <p class="text-sm text-muted-foreground">Review and merge code changes</p>
    </div>

    <div class="flex items-center gap-2">
      <Button 
        variant="outline" 
        size="sm" 
        class="gap-2" 
        onclick={() => showFilters = !showFilters}
      >
        <Funnel class="h-4 w-4" />
        {showFilters ? 'Hide Filters' : 'Filter'}
      </Button>

      <Button size="sm" class="gap-2 bg-git hover:bg-git-hover">
        <Plus class="h-4 w-4" />
        New Patch
      </Button>
    </div>
  </div>

  {#if showFilters}
    <div class="mb-6 p-4 border border-border rounded-md bg-card">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Status Filter -->
        <div>
          <h3 class="text-sm font-medium mb-2">Status</h3>
          <div class="flex flex-wrap gap-2">
            <Button 
              variant={statusFilter === "all" ? "default" : "outline"} 
              size="sm"
              onclick={() => statusFilter = "all"}
            >
              All
            </Button>
            <Button 
              variant={statusFilter === "open" ? "default" : "outline"} 
              size="sm"
              onclick={() => statusFilter = "open"}
              class="gap-1"
            >
              <GitCommit class="h-3 w-3" /> Open
            </Button>
            <Button 
              variant={statusFilter === "applied" ? "default" : "outline"} 
              size="sm"
              onclick={() => statusFilter = "applied"}
              class="gap-1"
            >
              <Check class="h-3 w-3" /> Applied
            </Button>
            <Button 
              variant={statusFilter === "closed" ? "default" : "outline"} 
              size="sm"
              onclick={() => statusFilter = "closed"}
              class="gap-1"
            >
              <X class="h-3 w-3" /> Closed
            </Button>
            <Button 
              variant={statusFilter === "draft" ? "default" : "outline"} 
              size="sm"
              onclick={() => statusFilter = "draft"}
              class="gap-1"
            >
              <Clock class="h-3 w-3" /> Draft
            </Button>
          </div>
        </div>
        
        <!-- Sort Options -->
        <div>
          <h3 class="text-sm font-medium mb-2">Sort By</h3>
          <div class="flex flex-wrap gap-2">
            <Button 
              variant={sortBy === "newest" ? "default" : "outline"} 
              size="sm"
              onclick={() => sortBy = "newest"}
              class="gap-1"
            >
              <CalendarDays class="h-3 w-3" /> Newest
            </Button>
            <Button 
              variant={sortBy === "oldest" ? "default" : "outline"} 
              size="sm"
              onclick={() => sortBy = "oldest"}
              class="gap-1"
            >
              <CalendarDays class="h-3 w-3" /> Oldest
            </Button>
            <Button 
              variant={sortBy === "status" ? "default" : "outline"} 
              size="sm"
              onclick={() => sortBy = "status"}
              class="gap-1"
            >
              <Check class="h-3 w-3" /> Status
            </Button>
            <Button 
              variant={sortBy === "commits" ? "default" : "outline"} 
              size="sm"
              onclick={() => sortBy = "commits"}
              class="gap-1"
            >
              <GitCommit class="h-3 w-3" /> Commits
            </Button>
          </div>
        </div>
        
        <!-- Author Filter -->
        {#if uniqueAuthors.length > 1}
          <div class="md:col-span-2">
            <h3 class="text-sm font-medium mb-2">Author</h3>
            <div class="flex flex-wrap gap-2">
              <Button 
                variant={authorFilter === "" ? "default" : "outline"} 
                size="sm"
                onclick={() => authorFilter = ""}
              >
                All Authors
              </Button>
              
              {#each uniqueAuthors as author}
                <Button 
                  variant={authorFilter === author ? "default" : "outline"} 
                  size="sm"
                  onclick={() => authorFilter = author}
                  class="gap-1"
                >
                  <User class="h-3 w-3" />
                  <span class="text-sm">{author.slice(0, 8)}...</span>
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
          Loading patches….
        {:else}
          End of patches history
        {/if}
      </Spinner>
    </div>
  {:else if repoClass.patches.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No patches found.
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#each patchList! as patch}
        <div in:fly>
          <PatchCard event={patch} patches={patch.patches} status={patch.status as StatusEvent} />
        </div>
      {/each}
    </div>
  {/if}
</div>
