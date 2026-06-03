<script lang="ts">
  import { GitCommit, User, Calendar, ChevronDown, ChevronRight, Loader2 } from "@lucide/svelte";
  import { formatDistanceToNow } from "date-fns";
  import FileDiff from "./FileDiff.svelte";
  import type { CommitDiff } from "@nostr-git/core/types";

  interface Props {
    commitSha: string;
    commitDiff?: CommitDiff;
    loading?: boolean;
    error?: string;
    expanded?: boolean;
    expandedFiles?: Set<string>;
    highlightedFiles?: string[];
    onToggleExpansion?: () => void;
    onToggleFileExpansion?: (filePath: string) => void;
    onSelectFile?: (filePath: string) => void;
    onLoadCommit?: () => void;
  }

  let {
    commitSha,
    commitDiff,
    loading = false,
    error,
    expanded = false,
    expandedFiles = new Set(),
    highlightedFiles = [],
    onToggleExpansion,
    onToggleFileExpansion,
    onSelectFile,
    onLoadCommit,
  }: Props = $props();

  // Trigger loading if commit diff is not available
  $effect(() => {
    if (!commitDiff && !loading && !error) {
      onLoadCommit?.();
    }
  });

  // Format commit message (first line as title, rest as body)
  const formatCommitMessage = (message: string) => {
    const lines = message.trim().split("\n");
    const title = lines[0] || "";
    const body = lines.slice(1).join("\n").trim();
    return { title, body };
  };

  // Get short SHA (first 7 characters)
  const shortSha = $derived(commitSha.substring(0, 7));

  // Calculate file stats
  const fileStats = $derived(
    (() => {
      if (!commitDiff) return { added: 0, modified: 0, deleted: 0, renamed: 0 };

      return commitDiff.changes.reduce(
        (stats, file) => {
          switch (file.status) {
            case "added":
              stats.added++;
              break;
            case "modified":
              stats.modified++;
              break;
            case "deleted":
              stats.deleted++;
              break;
            case "renamed":
              stats.renamed++;
              break;
          }
          return stats;
        },
        { added: 0, modified: 0, deleted: 0, renamed: 0 }
      );
    })()
  );

  // Check if file should be highlighted
  const isFileHighlighted = (filePath: string) => {
    return highlightedFiles.includes(filePath);
  };

  // Track files that have already been auto-expanded to prevent infinite re-renders
  let autoExpandedFiles = new Set<string>();

  // Auto-expand highlighted files when commit is expanded
  $effect(() => {
    if (expanded && commitDiff && highlightedFiles.length > 0) {
      for (const file of commitDiff.changes) {
        if (isFileHighlighted(file.path) && !autoExpandedFiles.has(file.path)) {
          autoExpandedFiles.add(file.path);
          onToggleFileExpansion?.(file.path);
        }
      }
    }
  });
</script>

<div class="border border-border rounded-lg overflow-hidden mb-6 bg-card">
  <!-- Commit Header -->
  <div class="bg-muted/20 border-b border-border">
    <button
      type="button"
      class="w-full p-4 text-left hover:bg-muted/30 transition-colors"
      onclick={onToggleExpansion}
      aria-expanded={expanded}
    >
      <div class="flex items-start gap-3">
        <!-- Expansion Icon -->
        <div class="mt-1 shrink-0">
          {#if expanded}
            <ChevronDown class="h-5 w-5 text-muted-foreground" />
          {:else}
            <ChevronRight class="h-5 w-5 text-muted-foreground" />
          {/if}
        </div>

        <!-- Commit Info -->
        <div class="flex-1 min-w-0">
          {#if commitDiff}
            {@const { title, body } = formatCommitMessage(commitDiff.meta.message)}

            <!-- Commit Title -->
            <div class="flex items-start gap-3 mb-2">
              <GitCommit class="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-foreground text-base leading-tight">
                  {title}
                </h3>
                {#if body}
                  <p class="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                    {body}
                  </p>
                {/if}
              </div>
            </div>

            <!-- Commit Metadata -->
            <div class="flex items-center gap-4 text-sm text-muted-foreground">
              <div class="flex items-center gap-1.5">
                <User class="h-4 w-4" />
                <span>{commitDiff.meta.author}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <Calendar class="h-4 w-4" />
                <span
                  >{commitDiff.meta.date
                    ? formatDistanceToNow(new Date(commitDiff.meta.date), { addSuffix: true })
                    : "Unknown date"}</span
                >
              </div>
              <div class="font-mono text-xs bg-muted px-2 py-1 rounded">
                {shortSha}
              </div>
            </div>

            <!-- File Stats -->
            {#if commitDiff.changes.length > 0}
              <div class="flex items-center gap-3 mt-3 text-sm">
                <span class="text-muted-foreground">
                  {commitDiff.changes.length} file{commitDiff.changes.length !== 1 ? "s" : ""} changed
                </span>
                {#if fileStats.added > 0}
                  <span class="text-emerald-700 dark:text-emerald-300"
                    >+{fileStats.added} added</span
                  >
                {/if}
                {#if fileStats.modified > 0}
                  <span class="text-sky-700 dark:text-sky-300">{fileStats.modified} modified</span>
                {/if}
                {#if fileStats.deleted > 0}
                  <span class="text-rose-700 dark:text-rose-300">-{fileStats.deleted} deleted</span>
                {/if}
                {#if fileStats.renamed > 0}
                  <span class="text-violet-700 dark:text-violet-300"
                    >{fileStats.renamed} renamed</span
                  >
                {/if}
              </div>
            {/if}
          {:else if loading}
            <div class="flex items-center gap-3">
              <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
              <div class="flex-1">
                <div class="font-mono text-sm text-muted-foreground">
                  Loading commit {shortSha}...
                </div>
              </div>
            </div>
          {:else if error}
            <div class="flex items-center gap-3">
              <div
                class="h-5 w-5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 flex items-center justify-center"
              >
                <span class="text-xs font-bold">!</span>
              </div>
              <div class="flex-1">
                <div class="font-mono text-sm text-foreground mb-1">
                  Error loading commit {shortSha}
                </div>
                <div class="text-sm text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              </div>
            </div>
          {:else}
            <div class="font-mono text-sm text-muted-foreground">
              Commit {shortSha}
            </div>
          {/if}
        </div>
      </div>
    </button>
  </div>

  <!-- Commit Diff Content -->
  {#if expanded && commitDiff}
    <div class="p-4">
      {#if commitDiff.changes.length === 0}
        <div class="text-center text-muted-foreground py-8">No file changes in this commit</div>
      {:else}
        <div class="space-y-0">
          {#each commitDiff.changes as fileDiff}
            {@const isExpanded = expandedFiles.has(fileDiff.path)}
            {@const isHighlighted = isFileHighlighted(fileDiff.path)}

            <div
              class:ring-2={isHighlighted}
              class:ring-primary={isHighlighted}
              class:ring-offset-2={isHighlighted}
              class="transition-all"
            >
              <FileDiff
                fileDiff={fileDiff}
                expanded={isExpanded}
                onToggleExpansion={() => onToggleFileExpansion?.(fileDiff.path)}
                onSelectFile={onSelectFile}
              />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if expanded && loading}
    <div class="p-8 text-center">
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-2" />
      <div class="text-muted-foreground">Loading commit details...</div>
    </div>
  {:else if expanded && error}
    <div class="p-8 text-center">
      <div class="text-rose-700 dark:text-rose-300 mb-2">Failed to load commit details</div>
      <div class="text-sm text-muted-foreground">{error}</div>
      <button
        onclick={onLoadCommit}
        class="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        Retry
      </button>
    </div>
  {/if}
</div>

<style>
  /* Smooth transitions for expansion */
  .transition-all {
    transition: all 0.2s ease-in-out;
  }
</style>
