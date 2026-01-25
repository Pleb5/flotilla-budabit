<script lang="ts">
  import { page } from '$app/stores';
  import {User, Search} from "@lucide/svelte"
  import {
    Input,
    Select,
    SelectContent,
    SelectTrigger,
    SelectItem,
    Separator,
    CommitCard,
    context,
  } from "@nostr-git/ui"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import { slide } from 'svelte/transition'
  import {getContext} from "svelte"
  import {REPO_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"

  const repoClass = getContext<Repo>(REPO_KEY)
  
  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Reactive state for UI
  let searchQuery = $state("")
  let selectedAuthor = $state([])

  // Get commits from the repo class (lazy-loaded and reactive)
  // Start with false - only show loading when actually fetching
  let commitsLoading = $state(false)
  let commitsError = $state<string | undefined>(undefined)
  let commits = $state<any[]>([])
  let totalCommits = $state<number | undefined>(undefined)
  let currentPage = $state(1)
  let hasMoreCommits = $state(false)

  // Available page sizes
  const pageSizeOptions = [10, 30, 50, 100]
  let selectedPageSize = $state(30)

  // Branch selector removed; commits follow repoClass.selectedBranch

  // Get unique authors from commits for filtering
  let authors = $state<Set<string>>(new Set())

  // Track if we've loaded the initial commits
  let initialLoadComplete = $state(false)

  // Track if we're currently loading more commits
  let isLoadingMore = $state(true)

  // Create navigation helper
  const getCommitUrl = (commitId: string) => {
    return `/spaces/${encodeURIComponent($page.params.relay)}/git/${encodeURIComponent($page.params.id)}/commits/${commitId}`;
  };

  // Track the previous branch to detect changes
  let previousBranch = $state<string | undefined>(undefined);
  let wasJustSwitching = $state(false);
  let branchSwitchComplete = $state(false);

  // Handle branch switching state changes
  $effect(() => {
    const isSwitching = repoClass.isBranchSwitching
    // Track branchChangeTrigger to ensure we re-run when switch completes
    const branchTrigger = repoClass.branchChangeTrigger
    // Also track commits from repoClass to trigger re-render when they change
    const repoCommits = repoClass.commits
    const selectedBranch = repoClass.selectedBranch

    if (isSwitching) {
      // Show loading state while switching
      commitsLoading = true
      wasJustSwitching = true
      branchSwitchComplete = false
    } else if (wasJustSwitching) {
      // Switch just completed - commits are already loaded by setSelectedBranch
      wasJustSwitching = false
      branchSwitchComplete = true
      commitsLoading = false

      // Immediately sync commits from repoClass (which is now reactive)
      // IMPORTANT: Create a new array reference to ensure Svelte 5 reactivity detects the change
      // This is critical because $derived only re-runs when dependencies change by reference
      const newCommits = [...(repoCommits || [])];
      commits = newCommits
      totalCommits = repoClass.totalCommits
      hasMoreCommits = repoClass.hasMoreCommits

      // Reset branchSwitchComplete after a tick
      setTimeout(() => {
        branchSwitchComplete = false
      }, 0)
    }
  })

  // Load commits when branch changes (but not during active switching or right after)
  $effect(() => {
    const selectedBranch = repoClass.selectedBranch;
    const mainBranch = repoClass.mainBranch;
    const currentBranch = selectedBranch || mainBranch;
    const isSwitching = repoClass.isBranchSwitching
    const repoKey = repoClass.key;
    
    // Guard: wait for repoClass.key to be populated (not empty string)
    if (!repoKey || repoKey.trim() === "") {
      return;
    }
    
    if (repoClass && repoClass.repoId && currentBranch) {
      // Skip if actively switching or just completed (setSelectedBranch already loaded commits)
      if (isSwitching || wasJustSwitching || branchSwitchComplete) {
        return
      }

      // Detect branch changes (e.g., from navigation, not from selector)
      if (previousBranch !== undefined && previousBranch !== currentBranch) {
        currentPage = 1;
        initialLoadComplete = false;
        previousBranch = currentBranch;
        loadCommits();
      } else if (previousBranch === undefined) {
        // Initial load
        previousBranch = currentBranch;
        loadCommits();
      }
    }
  })

  // Handle page size changes
  function handlePageSizeChange(event: Event) {
    const newSize = parseInt((event.target as HTMLSelectElement).value, 10)
    if (!isNaN(newSize) && newSize !== selectedPageSize) {
      selectedPageSize = newSize
      repoClass.setCommitsPerPage(selectedPageSize)
      loadCommits()
    }
  }

  // Load commits with pagination
  async function loadCommits() {
    const selectedBranch = repoClass.selectedBranch;
    const storedBranch = repoClass.commitManager?.getCurrentBranch?.();

    if (!initialLoadComplete) {
      commitsLoading = true
    }

    // Check if WorkerManager is ready before attempting operations
    if (!repoClass.workerManager?.isReady) {
      commitsError = "Repository worker not initialized. Please refresh the page."
      commitsLoading = false
      return
    }

    try {
      const result = await repoClass.loadPage(currentPage);

      // Check if the result indicates an error
      if (result && !result.success) {
        throw new Error(result.error || "Failed to load commits");
      }

      // IMPORTANT: Create a new array reference to ensure Svelte 5 reactivity
      // detects the change. This is critical for $derived to re-run.
      commits = [...repoClass.commits]
      totalCommits = repoClass.totalCommits
      hasMoreCommits = repoClass.hasMoreCommits

      // Update authors list with new commits
      const newAuthors = new Set(authors)
      commits.forEach(commit => {
        if (commit.commit?.author?.name) {
          newAuthors.add(commit.commit.author.name)
        }
      })
      authors = newAuthors

      initialLoadComplete = true
    } catch (error) {
      console.error("Failed to load commits:", error)
      commitsError = error instanceof Error ? error.message : "Failed to load commits"
    } finally {
      commitsLoading = false
    }
  }

  // Handle loading more commits (next page)
  async function loadMore() {
    if (hasMoreCommits && !commitsLoading && !isLoadingMore) {
      isLoadingMore = true
      currentPage++
      await loadCommits()
      isLoadingMore = false
    }
  }

  // Branch list removed

  // NOTE: Removed duplicate sync effect that was causing infinite loop
  // The branch switching effect (line 65-101) and loadCommits() already handle
  // syncing commits from repoClass. Having a second effect that reads repoClass.commits
  // and writes to commits caused effect_update_depth_exceeded error.

  // Filter commits based on search and filters
  // IMPORTANT: Track branchChangeTrigger to force re-derivation after branch switches
  // This is necessary because Svelte 5's fine-grained reactivity may not detect
  // changes to class-based $state fields accessed via getters through context
  const filteredCommits = $derived.by(() => {
    // Force dependency tracking on branchChangeTrigger to ensure re-calculation
    // when branch switches complete (even if commits array reference tracking fails)
    const _branchTrigger = repoClass.branchChangeTrigger;

    if (commits) {
      let filtered = commits

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        filtered = filtered.filter(
          commit =>
            commit.commit.message.toLowerCase().includes(query) ||
            commit.commit.author.name.toLowerCase().includes(query) ||
            commit.oid.toLowerCase().includes(query),
        )
      }

      // Filter by author
      if (selectedAuthor.length > 0) {
        filtered = filtered.filter(commit => commit.commit.author.name === selectedAuthor[0])
      }

      return filtered.slice((currentPage - 1) * selectedPageSize, currentPage * selectedPageSize)
    }
    return []
  })

  const handleReact = (commitId: string, type: "heart") => {

  }

  const handleComment = (commitId: string, comment: string) => {

    // TODO: Implement Nostr comments for commits
  }
</script>

<svelte:head>
  <title>{repoClass.name} - Commits</title>
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="mt-2 flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row">
    <div class="flex-1">
      <div class="relative">
        <Search
          class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
        <Input placeholder="Search commits..." bind:value={searchQuery} class="pl-10" />
      </div>
    </div>

    <Select bind:value={selectedAuthor} type="multiple">
      <SelectTrigger class="w-[120px]">
        <User class="mr-2 h-4 w-4" />
        <span>{selectedAuthor.length > 0 ? selectedAuthor[0] : "All authors"}</span>
      </SelectTrigger>
      <SelectContent>
        {#each authors as author (author)}
          <SelectItem value={author}>
            {author}
          </SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex-1">
      <h2 class="text-lg font-medium">
        {#if totalCommits !== undefined}
          {totalCommits.toLocaleString()} {totalCommits === 1 ? "commit" : "commits"}
        {:else}
          Commits
        {/if}
      </h2>
      {#if commits.length > 0}
        <p class="mt-1 text-sm text-gray-500">
          Showing {(currentPage - 1) * selectedPageSize + 1} to
          {currentPage * selectedPageSize > (totalCommits || 0)
            ? ` ${totalCommits} of ${totalCommits}`
            : ` ${currentPage * selectedPageSize} of ${totalCommits?.toLocaleString() || "..."}`}
        </p>
      {/if}
    </div>

    <div>{$context.error}</div>

    <div class="flex items-center gap-2">
      <label for="page-size" class="text-sm text-gray-700">Commits per page:</label>
      <select
        id="page-size"
        value={selectedPageSize}
        onchange={handlePageSizeChange}
        class="rounded-md border-gray-300 py-1 pl-2 pr-8 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
        {#each pageSizeOptions as size}
          <option value={size}>
            {size}
          </option>
        {/each}
      </select>
    </div>
  </div>

  {#if commitsLoading}
    <div class="flex items-center justify-center py-12">
      <Spinner loading={commitsLoading}>Loading commits...</Spinner>
    </div>
  {:else if commitsError}
    <div class="py-12 text-center">
      <p class="text-muted-foreground">Failed to load commits.</p>
    </div>
  {:else}
    <div>
      <div class="space-y-4">

        <Separator />

        {#if commits}
          <div class="space-y-4" transition:slide>
            {#each filteredCommits as commit (commit.oid)}
              <CommitCard
                {commit}
                onReact={handleReact}
                onComment={handleComment}
                href={getCommitUrl(commit.oid)}
                getParentHref={getCommitUrl}
                displayName={commit?.commit?.author?.name || undefined} />
            {/each}
          </div>
          <div class="mt-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div class="text-sm text-gray-500">
              {#if totalCommits !== undefined}
                <span>Page {currentPage} of {Math.ceil(totalCommits / selectedPageSize)}</span>
              {/if}
            </div>

            <div class="flex gap-2">
              <button
                onclick={() => {
                  if (currentPage > 1) {
                    currentPage--
                    loadCommits()
                  }
                }}
                disabled={currentPage <= 1 || commitsLoading}
                class="focus:z-10 inline-flex items-center rounded-l-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
                Previous
              </button>

              <button
                onclick={loadMore}
                disabled={!hasMoreCommits || commitsLoading}
                class="focus:z-10 inline-flex items-center rounded-r-md border border-l-0 border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
                {#if commitsLoading}
                  <Spinner loading={commitsLoading}>Loading...</Spinner>
                {:else}
                  Next
                {/if}
              </button>
            </div>
          </div>
        {/if}

        {#if commitsError}
          <div class="rounded-md bg-red-50 p-4">
            <div class="flex">
              <div class="ml-3">
                <h3 class="text-sm font-medium text-red-800">Error loading commits</h3>
                <div class="mt-2 text-sm text-red-700">
                  <p>{commitsError}</p>
                </div>
                <button
                  onclick={loadCommits}
                  class="mt-2 text-sm font-medium text-red-800 hover:text-red-700">
                  Retry
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
