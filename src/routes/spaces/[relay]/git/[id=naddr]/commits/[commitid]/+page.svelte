<style>
  /* Ensure proper font rendering for code */
  .font-mono {
    font-family:
      ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  }
</style>

<script lang="ts">
  import {page} from "$app/stores"
  import {ChevronDown, ChevronRight, FileText, FilePlus, FileMinus, FileX} from "@lucide/svelte"
  import {CommitHeader, SplitDiff} from "@nostr-git/ui"
  import type {PageData} from "./$types"

  const {data}: {data: PageData} = $props()

  // Extract data from page load
  const {commitMeta, changes, repoClass} = data

  // Safe repo title name derived from repoEvent content
  const repoTitleName = $derived(() => {
    try {
      const evt: any = (repoClass as any).repoEvent
      return evt?.content ? JSON.parse(evt.content).name : "Repository"
    } catch {
      return "Repository"
    }
  })

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
</script>

<svelte:head>
  <title>Commit {commitMeta.sha.slice(0, 7)} · {repoTitleName}</title>
</svelte:head>

<div class="min-h-screen bg-background">
  <!-- Commit Header -->
  <CommitHeader
    sha={commitMeta.sha}
    author={commitMeta.author}
    email={commitMeta.email}
    date={commitMeta.date}
    message={commitMeta.message}
    parents={commitMeta.parents} />

  <!-- Diff Summary -->
  <div class="border-b border-border bg-card px-6 py-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <h2 class="text-lg font-semibold text-foreground">
          {changes.length}
          {changes.length === 1 ? "file" : "files"} changed
        </h2>
        <div class="flex items-center gap-3 text-sm text-muted-foreground">
          <div class="rounded-lg border bg-muted/20 px-2 py-1 text-center">
            <span class="text-green-600">+{totalStats().totalAdditions}</span>
          </div>
          <div class="rounded-lg border bg-muted/20 px-2 py-1 text-center">
            <span class="text-red-600">-{totalStats().totalDeletions}</span>
          </div>
        </div>
      </div>

      <!-- Expand/Collapse All -->
      <div class="flex items-center gap-2">
        <button
          onclick={() => {
            expandedFiles = new Set(changes.map(change => change.path))
          }}
          class="text-sm text-muted-foreground transition-colors hover:text-foreground">
          Expand all
        </button>
        <span class="text-muted-foreground">|</span>
        <button
          onclick={() => {
            expandedFiles = new Set()
          }}
          class="text-sm text-muted-foreground transition-colors hover:text-foreground">
          Collapse all
        </button>
      </div>
    </div>
  </div>

  <!-- File Changes -->
  <div class="divide-y divide-border">
    {#each changes as change (change.path)}
      {@const isExpanded = expandedFiles.has(change.path)}
      {@const statusInfo = getFileStatusIcon(change.status)}
      {@const stats = getFileStats(change.diffHunks)}

      <div class="bg-background">
        <!-- File Header -->
        <button
          onclick={() => toggleFile(change.path)}
          class="w-full px-6 py-4 text-left transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <!-- Expand/Collapse Icon -->
              {#if isExpanded}
                <ChevronDown class="h-4 w-4 text-muted-foreground" />
              {:else}
                <ChevronRight class="h-4 w-4 text-muted-foreground" />
              {/if}

              <!-- File Status Icon -->
              {#if statusInfo.icon}
                {@const IconComponent = statusInfo.icon}
                <IconComponent class="h-4 w-4 {statusInfo.class}" />
              {/if}

              <!-- File Path -->
              <span class="font-mono text-sm text-foreground">{change.path}</span>

              <!-- Status Badge -->
              <span
                class="rounded-full border px-2 py-0.5 text-xs font-medium {getStatusBadgeClass(
                  change.status,
                )}">
                {change.status}
              </span>
            </div>

            <!-- File Stats -->
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
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
          <div class="px-6 pb-6">
            <SplitDiff hunks={normalizeHunks(change.diffHunks)} filepath={change.path} />
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Empty State -->
  {#if changes.length === 0}
    <div class="px-6 py-12 text-center">
      <FileText class="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 class="mt-4 text-lg font-medium text-foreground">No file changes</h3>
      <p class="mt-2 text-sm text-muted-foreground">
        This commit doesn't contain any file changes.
      </p>
    </div>
  {/if}
</div>
