<style>
  /* Ensure proper font rendering for code */
  .font-mono {
    font-family:
      ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  }

  /* Touch-friendly interactions */
  .touch-manipulation {
    touch-action: manipulation;
  }
</style>

<script lang="ts">
  import {
    ChevronDown,
    ChevronRight,
    ChevronsDown,
    ChevronsUp,
    FileText,
    FilePlus,
    FileMinus,
    FileX,
    FileCode,
  } from "@lucide/svelte"
  import {CommitHeader, SplitDiff} from "@nostr-git/ui"
  import type {PageData} from "./$types"
  import {getContext} from "svelte"
  import {REPO_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"

  const {data}: {data: PageData} = $props()

  // Extract data from page load
  const {commitMeta, changes} = data

  // Get repoClass from context
  const repoClass = getContext<Repo>(REPO_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  if (!commitMeta || !changes) {
    throw new Error("Commit data not available")
  }

  // State for collapsible file panels
  let expandedFiles = $state<Set<string>>(new Set())

  // Toggle file expansion
  const toggleFile = (filepath: string) => {
    if (expandedFiles.has(filepath)) {
      expandedFiles.delete(filepath)
    } else {
      expandedFiles.add(filepath)
    }
    expandedFiles = new Set(expandedFiles) // Trigger reactivity
  }

  // Get file status icon and styling
  const getFileStatusIcon = (status: string) => {
    switch (status) {
      case "added":
        return {icon: FilePlus, class: "text-green-600"}
      case "deleted":
        return {icon: FileMinus, class: "text-red-600"}
      case "modified":
        return {icon: FileText, class: "text-blue-600"}
      case "renamed":
        return {icon: FileX, class: "text-yellow-600"}
      default:
        return {icon: FileText, class: "text-muted-foreground"}
    }
  }

  // Get file status badge styling
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "added":
        return "bg-green-100 text-green-800 border-green-200"
      case "deleted":
        return "bg-red-100 text-red-800 border-red-200"
      case "modified":
        return "bg-blue-100 text-blue-800 border-blue-200"
      case "renamed":
        return "bg-yellow-100 text-yellow-800 border-yellow-200"
      default:
        return "bg-gray-100 text-gray-800 border-gray-200"
    }
  }

  // Calculate diff stats for each file
  const getFileStats = (hunks: any[]) => {
    let additions = 0
    let deletions = 0

    for (const hunk of hunks) {
      for (const patch of hunk.patches) {
        // Accept both SplitDiff ('+', '-') and parse-diff ('add','del','normal') styles
        const t = patch.type
        if (t === "+" || t === "add") additions++
        else if (t === "-" || t === "del") deletions++
      }
    }

    return {additions, deletions}
  }

  // Calculate total diff stats
  const totalStats = $derived(() => {
    let totalAdditions = 0
    let totalDeletions = 0

    for (const change of changes) {
      const stats = getFileStats(change.diffHunks)
      totalAdditions += stats.additions
      totalDeletions += stats.deletions
    }

    return {totalAdditions, totalDeletions}
  })

  // Normalize hunks for SplitDiff to ensure patch.type is one of '+', '-', ' '
  const normalizeHunks = (hunks: any[]) => {
    if (!Array.isArray(hunks)) return []
    return hunks.map(h => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      patches: (h.patches || []).map((p: any) => ({
        line: p.line,
        type:
          p.type === "add"
            ? "+"
            : p.type === "del"
              ? "-"
              : p.type === " " || p.type === "+" || p.type === "-"
                ? p.type
                : " ",
      })),
    }))
  }

  // Expand all files by default if there are few changes
  $effect(() => {
    if (changes.length <= 5) {
      expandedFiles = new Set(changes.map(change => change.path))
    }
  })

  // Calculate expanded files count
  const expandedCount = $derived(expandedFiles.size)
  const allExpanded = $derived(expandedCount === changes.length && changes.length > 0)
  const allCollapsed = $derived(expandedCount === 0)
</script>

<svelte:head>
  <title>{repoClass.name} - Commit {commitMeta.sha.slice(0, 7)}</title>
</svelte:head>

<div class="flex min-h-screen flex-col gap-4 bg-background">
  <!-- Commit Header -->
  <CommitHeader
    sha={commitMeta.sha}
    author={commitMeta.author}
    email={commitMeta.email}
    date={commitMeta.date}
    message={commitMeta.message}
    parents={commitMeta.parents} />

  <!-- Diff Summary -->
  <div>
    <div class="mb-4 flex items-center justify-between">
      <h3 class="flex items-center gap-2 text-lg font-medium">
        <FileCode class="h-5 w-5" />
        Commit Details
      </h3>
    </div>

    <!-- Statistics Grid -->
    <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
      <div class="rounded-lg border bg-muted/20 p-3 text-center">
        <div class="text-2xl font-bold text-primary">{changes.length}</div>
        <div class="text-sm text-muted-foreground">
          {changes.length === 1 ? "file" : "files"} changed
        </div>
        <div class="mt-1 text-xs text-muted-foreground">
          {changes.length === 1 ? "Single file" : "Multiple files"}
        </div>
      </div>

      <div class="rounded-lg border bg-green-50 p-3 text-center dark:bg-green-950/20">
        <div class="text-2xl font-bold text-green-600">+{totalStats().totalAdditions}</div>
        <div class="text-sm text-muted-foreground">Lines Added</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {totalStats().totalAdditions === 0
            ? "No additions"
            : totalStats().totalAdditions < 10
              ? "Few additions"
              : totalStats().totalAdditions < 50
                ? "Moderate additions"
                : "Many additions"}
        </div>
      </div>

      <div class="rounded-lg border bg-red-50 p-3 text-center dark:bg-red-950/20">
        <div class="text-2xl font-bold text-red-600">-{totalStats().totalDeletions}</div>
        <div class="text-sm text-muted-foreground">Lines Removed</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {totalStats().totalDeletions === 0
            ? "No deletions"
            : totalStats().totalDeletions < 10
              ? "Few deletions"
              : totalStats().totalDeletions < 50
                ? "Moderate deletions"
                : "Many deletions"}
        </div>
      </div>
    </div>
  </div>

  <div
    class="z-10 sticky top-0 border-b border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:px-6 sm:py-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <!-- Expand/Collapse Controls -->
      <div class="flex items-center gap-2">
        <button
          onclick={() => {
            expandedFiles = new Set(changes.map(change => change.path))
          }}
          disabled={allExpanded}
          aria-label="Expand all files"
          class="inline-flex touch-manipulation items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-all hover:border-border/80 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background">
          <ChevronsDown class="h-4 w-4" />
          <span>Expand all</span>
        </button>
        <button
          onclick={() => {
            expandedFiles = new Set()
          }}
          disabled={allCollapsed}
          aria-label="Collapse all files"
          class="inline-flex touch-manipulation items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-all hover:border-border/80 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background">
          <ChevronsUp class="h-4 w-4" />
          <span>Collapse all</span>
        </button>
        {#if changes.length > 0}
          <span class="ml-2 text-sm text-muted-foreground">
            ({expandedCount} of {changes.length}
            {expandedCount === 1 ? "file" : "files"} expanded)
          </span>
        {/if}
      </div>
    </div>
  </div>

  <!-- File Changes -->
  <div class="divide-y divide-border">
    {#each changes as change (change.path)}
      {@const isExpanded = expandedFiles.has(change.path)}
      {@const statusInfo = getFileStatusIcon(change.status)}
      {@const stats = getFileStats(change.diffHunks)}

      <div class="w-full overflow-x-auto bg-background">
        <!-- File Header -->
        <button
          onclick={() => toggleFile(change.path)}
          class="min-h-[44px] w-full touch-manipulation px-4 py-3 text-left transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none sm:px-6 sm:py-4">
          <div
            class="flex min-w-fit flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div class="flex min-w-fit items-center gap-2 sm:gap-3">
              <!-- Expand/Collapse Icon -->
              {#if isExpanded}
                <ChevronDown class="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              {:else}
                <ChevronRight class="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              {/if}

              <!-- File Status Icon -->
              {#if statusInfo.icon}
                {@const IconComponent = statusInfo.icon}
                <IconComponent class="h-4 w-4 {statusInfo.class} flex-shrink-0" />
              {/if}

              <!-- File Path -->
              <span
                class="whitespace-nowrap font-mono text-xs text-foreground sm:text-sm"
                title={change.path}>{change.path}</span>

              <!-- Status Badge -->
              <span
                class="flex-shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium {getStatusBadgeClass(
                  change.status,
                )}">
                {change.status}
              </span>
            </div>

            <!-- File Stats -->
            <div
              class="ml-6 flex flex-shrink-0 items-center gap-2 whitespace-nowrap text-sm text-muted-foreground sm:ml-0">
              {#if stats.additions > 0}
                <span class="text-green-600">+{stats.additions}</span>
              {/if}
              {#if stats.deletions > 0}
                <span class="text-red-600">-{stats.deletions}</span>
              {/if}
            </div>
          </div>
        </button>

        <!-- File Diff Content -->
        {#if isExpanded}
          <div class="px-4 pb-4 sm:px-6 sm:pb-6">
            <SplitDiff hunks={normalizeHunks(change.diffHunks)} filepath={change.path} />
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Empty State -->
  {#if changes.length === 0}
    <div class="px-4 py-12 text-center sm:px-6">
      <FileText class="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 class="mt-4 text-lg font-medium text-foreground">No file changes</h3>
      <p class="mt-2 text-sm text-muted-foreground">
        This commit doesn't contain any file changes.
      </p>
    </div>
  {/if}
</div>
