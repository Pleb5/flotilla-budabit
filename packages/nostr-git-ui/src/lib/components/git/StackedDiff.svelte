<script lang="ts">
  import { onMount } from "svelte";
  import { diffStore } from "./useDiffStore.js";
  import type { Commit, CommitDiff as CommitDiffType } from "@nostr-git/core/types";
  import CommitDiff from "./CommitDiff.svelte";
  import { Loader2, AlertCircle, RefreshCw } from "@lucide/svelte";
  import type { Repo } from "./Repo.svelte.js";

  interface Props {
    commits: Commit[];
    repo: Repo;
    highlightedFiles?: string[];
    onSelectFileDiff?: (filePath: string) => void;
    autoExpandFirst?: boolean;
    enableVirtualization?: boolean;
    maxVisibleCommits?: number;
  }

  let {
    commits,
    repo,
    highlightedFiles = [],
    onSelectFileDiff,
    autoExpandFirst = true,
    enableVirtualization = false,
    maxVisibleCommits = 50,
  }: Props = $props();

  // Local state
  let containerElement: HTMLDivElement;
  let isInitialized = $state(false);
  let globalError = $state<string | null>(null);
  let retryCount = $state(0);

  // Reactive store state using Svelte 5 runes
  let storeState = $state({
    commitDiffs: new Map(),
    loadingCommits: new Set(),
    expandedCommits: new Set(),
    expandedFiles: new Map(),
    highlightedFiles: [] as string[],
    errors: new Map(),
  });

  // Virtualization state
  let visibleStartIndex = $state(0);
  let visibleEndIndex = $state(Math.min(maxVisibleCommits, commits.length));

  // Initialize store subscription
  onMount(() => {
    const unsubscribe = diffStore.subscribe((state) => {
      storeState = state;
    });

    // Set highlighted files
    if (highlightedFiles.length > 0) {
      diffStore.setHighlightedFiles(highlightedFiles);
    }

    // Auto-expand first commit if requested
    if (autoExpandFirst && commits.length > 0) {
      const firstCommit = commits[0];
      diffStore.expandCommit(firstCommit.oid);
      loadCommitDiff(firstCommit.oid);
    }

    isInitialized = true;

    // Return cleanup function
    return () => {
      unsubscribe();
    };
  });

  // Watch for highlighted files changes
  $effect(() => {
    if (isInitialized && highlightedFiles.length > 0) {
      diffStore.setHighlightedFiles(highlightedFiles);
      diffStore.autoExpandHighlightedFiles();
    }
  });

  // Load commit diff from worker
  const loadCommitDiff = async (commitSha: string) => {
    if (storeState.commitDiffs.has(commitSha) || storeState.loadingCommits.has(commitSha)) {
      return; // Already loaded or loading
    }

    diffStore.setCommitLoading(commitSha, true);

    try {
      const result = (await repo.workerManager.getCommitDetails({
        repoId: repo.key,
        commitId: commitSha,
        branch: repo.selectedBranch || repo.mainBranch,
        cloneUrls: repo.cloneUrls,
      })) as { success: boolean; meta?: any; changes?: any; error?: string };

      if (result.success && result.meta && result.changes) {
        const commitDiff: CommitDiffType = {
          meta: {
            oid: result.meta.sha ?? result.meta.oid,
            message: result.meta.message,
            author: {
              name: result.meta.author,
              email: result.meta.email,
              // Optionally add timestamp if available
              timestamp: result.meta.date,
            },
            parent: result.meta.parents,
            date: result.meta.date,
          },
          changes: result.changes.map((change: any) => ({
            path: change.path,
            status: change.status,
            diffHunks: change.diffHunks,
          })),
        };

        diffStore.setCommitDiff(commitSha, commitDiff);
      } else {
        diffStore.setCommitError(commitSha, result.error || "Failed to load commit details");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      diffStore.setCommitError(commitSha, errorMessage);
    }
  };

  // Handle commit expansion
  const handleToggleCommitExpansion = (commitSha: string) => {
    const isExpanded = storeState.expandedCommits.has(commitSha);

    if (isExpanded) {
      diffStore.collapseCommit(commitSha);
    } else {
      diffStore.expandCommit(commitSha);
      loadCommitDiff(commitSha);
    }
  };

  // Handle file expansion
  const handleToggleFileExpansion = (commitSha: string, filePath: string) => {
    diffStore.toggleFileExpansion(commitSha, filePath);
  };

  // Handle file selection
  const handleSelectFile = (filePath: string) => {
    onSelectFileDiff?.(filePath);
  };

  // Handle retry for failed commits
  const handleRetryCommit = (commitSha: string) => {
    diffStore.setCommitError(commitSha, ""); // Clear error
    loadCommitDiff(commitSha);
  };

  // Expand all commits
  const expandAllCommits = () => {
    commits.forEach((commit) => {
      diffStore.expandCommit(commit.oid);
      loadCommitDiff(commit.oid);
    });
  };

  // Collapse all commits
  const collapseAllCommits = () => {
    commits.forEach((commit) => {
      diffStore.collapseCommit(commit.oid);
    });
  };

  // Clear all cached diffs
  const clearCache = () => {
    diffStore.clear();
    retryCount++;
  };

  // Virtualization helpers
  const getVisibleCommits = () => {
    if (!enableVirtualization) return commits;
    return commits.slice(visibleStartIndex, visibleEndIndex);
  };

  // Handle scroll for virtualization
  const handleScroll = (event: Event) => {
    if (!enableVirtualization) return;

    const target = event.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const itemHeight = 200; // Approximate height per commit

    const newStartIndex = Math.floor(scrollTop / itemHeight);
    const newEndIndex = Math.min(newStartIndex + maxVisibleCommits, commits.length);

    if (newStartIndex !== visibleStartIndex || newEndIndex !== visibleEndIndex) {
      visibleStartIndex = newStartIndex;
      visibleEndIndex = newEndIndex;
    }
  };

  // Derived values
  const visibleCommits = $derived(getVisibleCommits());
  const totalExpandedCommits = $derived(storeState.expandedCommits.size);
  const totalLoadingCommits = $derived(storeState.loadingCommits.size);
  const hasErrors = $derived(storeState.errors.size > 0);
</script>

<div class="stacked-diff-container" bind:this={containerElement}>
  <!-- Header Controls -->
  <div
    class="flex items-center justify-between mb-6 p-4 bg-muted/20 rounded-lg border border-border"
  >
    <div class="flex items-center gap-4">
      <h2 class="text-lg font-semibold">
        Commit Stack ({commits.length} commit{commits.length !== 1 ? "s" : ""})
      </h2>

      {#if totalLoadingCommits > 0}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          Loading {totalLoadingCommits} commit{totalLoadingCommits !== 1 ? "s" : ""}...
        </div>
      {/if}

      {#if hasErrors}
        <div class="flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
          <AlertCircle class="h-4 w-4" />
          {storeState.errors.size} error{storeState.errors.size !== 1 ? "s" : ""}
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <button
        onclick={expandAllCommits}
        class="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        disabled={totalExpandedCommits === commits.length}
      >
        Expand All
      </button>

      <button
        onclick={collapseAllCommits}
        class="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
        disabled={totalExpandedCommits === 0}
      >
        Collapse All
      </button>

      <button
        onclick={clearCache}
        class="px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
        title="Clear cache and reload"
      >
        <RefreshCw class="h-4 w-4" />
      </button>
    </div>
  </div>

  <!-- Global Error -->
  {#if globalError}
    <div
      class="mb-6 p-4 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"
    >
      <div class="mb-2 flex items-center gap-2 text-rose-900 dark:text-rose-200">
        <AlertCircle class="h-5 w-5" />
        <span class="font-semibold">Error</span>
      </div>
      <p class="text-rose-800 dark:text-rose-300">{globalError}</p>
      <button
        onclick={() => (globalError = null)}
        class="mt-2 rounded bg-rose-700 px-3 py-1 text-sm text-white transition-colors hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500"
      >
        Dismiss
      </button>
    </div>
  {/if}

  <!-- Commit List -->
  <div
    class="space-y-0"
    class:overflow-y-auto={enableVirtualization}
    class:max-h-screen={enableVirtualization}
    onscroll={handleScroll}
  >
    {#if commits.length === 0}
      <div class="text-center py-12 text-muted-foreground">
        <div class="text-lg mb-2">No commits to display</div>
        <div class="text-sm">The commit stack is empty.</div>
      </div>
    {:else}
      {#each visibleCommits as commit, index (commit.oid)}
        {@const commitDiff = storeState.commitDiffs.get(commit.oid)}
        {@const isLoading = storeState.loadingCommits.has(commit.oid)}
        {@const error = storeState.errors.get(commit.oid)}
        {@const isExpanded = storeState.expandedCommits.has(commit.oid)}
        {@const expandedFiles = storeState.expandedFiles.get(commit.oid) || new Set()}

        <CommitDiff
          commitSha={commit.oid}
          commitDiff={commitDiff}
          loading={isLoading}
          error={error}
          expanded={isExpanded}
          expandedFiles={expandedFiles}
          highlightedFiles={highlightedFiles}
          onToggleExpansion={() => handleToggleCommitExpansion(commit.oid)}
          onToggleFileExpansion={(filePath) => handleToggleFileExpansion(commit.oid, filePath)}
          onSelectFile={handleSelectFile}
          onLoadCommit={() => handleRetryCommit(commit.oid)}
        />
      {/each}

      <!-- Virtualization spacers -->
      {#if enableVirtualization}
        {#if visibleStartIndex > 0}
          <div style="height: {visibleStartIndex * 200}px" class="bg-muted/10"></div>
        {/if}
        {#if visibleEndIndex < commits.length}
          <div
            style="height: {(commits.length - visibleEndIndex) * 200}px"
            class="bg-muted/10"
          ></div>
        {/if}
      {/if}
    {/if}
  </div>

  <!-- Footer Stats -->
  {#if commits.length > 0}
    <div class="mt-6 p-4 bg-muted/10 rounded-lg text-sm text-muted-foreground">
      <div class="flex items-center justify-between">
        <div>
          {commits.length} total commits •
          {totalExpandedCommits} expanded •
          {storeState.commitDiffs.size} loaded
        </div>

        {#if highlightedFiles.length > 0}
          <div>
            Highlighting {highlightedFiles.length} file{highlightedFiles.length !== 1 ? "s" : ""}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .stacked-diff-container {
    /* Ensure proper spacing and layout */
    width: 100%;
    max-width: 100%;
  }

  /* Smooth scrolling for virtualization */
  .overflow-y-auto {
    scroll-behavior: smooth;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
