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
  import { page } from '$app/stores';
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
  import {CommitHeader, SplitDiff, toast} from "@nostr-git/ui"
  import {notifyCorsProxyIssue} from "@app/util/git-cors-proxy"
  import type {PageData} from "./$types"
  import {getContext, onMount, tick} from "svelte"
  import {REPO_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"
  import type {CommitMeta, PermalinkEvent} from "@nostr-git/core/types"
  import { githubPermalinkDiffId } from "@nostr-git/core/git"
  import {nip19} from "nostr-tools"
  import {postPermalink} from "@lib/budabit"
  import type {CommitChange} from "./+page"

  const {data}: {data: PageData} = $props()

  // Get repoClass from context
  const repoClass = getContext<Repo>(REPO_KEY)

  // Create navigation helper for parent commits
  const getParentHref = (commitId: string) => {
    return `/spaces/${encodeURIComponent($page.params.relay as string)}/git/${encodeURIComponent($page.params.id as string)}/commits/${commitId}`;
  };

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Component-level state for commit data (loaded after repo is ready)
  let commitMeta = $state<CommitMeta | undefined>(data?.commitMeta)
  let changes = $state<CommitChange[] | undefined>(data?.changes)
  let fallbackStats = $state<
    | {
        additions: number
        deletions: number
        total: number
      }
    | undefined
  >(data?.stats)
  let diffUnavailable = $state(data?.diffAvailable === false)
  let commitWarning = $state<string | undefined>(data?.warning)
  let loadError = $state<string | undefined>(undefined)
  let loadAttempted = $state(false)

  // Load commit details after ensuring repo is cloned
  async function loadCommitDetails() {
    const commitid = $page.params.commitid
    if (!commitid) return

    loadError = undefined
    commitWarning = undefined
    diffUnavailable = false
    fallbackStats = undefined

    try {
      // Wait for repo to be ready (replaces inefficient polling loop)
      await repoClass.waitForReady()
      
      if (!repoClass.key) {
        loadError = "Repository information not available"
        return
      }
      // Ensure repo is cloned first
      const isCloned = await repoClass.workerManager.isRepoCloned({
        repoId: repoClass.key
      })

      // Optimization: Check if commit metadata is already available in repoClass.commits
      // Show it immediately to eliminate perceived delay, then load diff details
      const existingCommit = repoClass.commits?.find((c: any) => c.sha === commitid || c.oid === commitid)
      
      if (existingCommit) {
        // Show commit metadata immediately from cache
        commitMeta = {
          sha: existingCommit.sha || existingCommit.oid,
          author: existingCommit.author?.name || existingCommit.commit?.author?.name || 'Unknown',
          email: existingCommit.author?.email || existingCommit.commit?.author?.email || '',
          date: existingCommit.author?.timestamp || existingCommit.commit?.author?.timestamp || Date.now() / 1000,
          message: existingCommit.message || existingCommit.commit?.message || '',
          parents: existingCommit.parents || existingCommit.commit?.parent || [],
          pubkey: undefined,
          nip05: undefined,
          nip39: undefined
        }
      }

      // Try REST API first (much faster for GitHub/GitLab repos)
      const cloneUrls = repoClass.cloneUrls
      if (cloneUrls.length === 0) {
        loadError = "No clone URLs available for this repository"
        return
      }

      const {getCommitDetailsViaRestApi} = await import("$lib/budabit/commit-api")
      let commitDetails = await getCommitDetailsViaRestApi(cloneUrls, commitid, repoClass.key)
      const needsWorkerDiff =
        !commitDetails ||
        !commitDetails.success ||
        commitDetails.diffAvailable === false ||
        !Array.isArray(commitDetails.changes)

      // If REST API didn't provide a usable diff payload, fall back to worker git data
      if (needsWorkerDiff) {
        console.log("[commit page] REST metadata-only or unavailable, using worker git diff")
        
        if (!isCloned) {
          const result = await repoClass.workerManager.smartInitializeRepo({
            repoId: repoClass.key,
            cloneUrls,
            forceUpdate: false
          })

          if (!result.success) {
            notifyCorsProxyIssue(result)
            loadError = result.error || "Failed to initialize repository"
            return
          }
        }

        commitDetails = await repoClass.workerManager.getCommitDetails({
          repoId: repoClass.key,
          commitId: commitid
        })
      }

      if (!commitDetails?.success || !commitDetails.meta || !Array.isArray(commitDetails.changes)) {
        notifyCorsProxyIssue(commitDetails)
        loadError = commitDetails?.error || "Failed to load commit details"
        return
      }

      // Set the data
      commitMeta = {
        sha: commitDetails.meta.sha,
        author: commitDetails.meta.author,
        email: commitDetails.meta.email,
        date: commitDetails.meta.date,
        message: commitDetails.meta.message,
        parents: commitDetails.meta.parents,
        pubkey: undefined,
        nip05: undefined,
        nip39: undefined
      }

      changes = commitDetails.changes.map((change: any) => ({
        path: change.path,
        status: change.status,
        diffHunks: change.diffHunks
      }))

      diffUnavailable = commitDetails.diffAvailable === false
      fallbackStats = commitDetails.stats
      commitWarning =
        typeof commitDetails.warning === "string"
          ? commitDetails.warning
          : diffUnavailable
            ? "Commit metadata loaded, but diff is unavailable."
            : undefined

    } catch (err: any) {
      console.error("Error loading commit details:", err)
      notifyCorsProxyIssue(err)
      loadError = err?.message || "Failed to load commit details"
    }
  }

  const publishPermalink = async (permalink: PermalinkEvent) => {
    const relays = repoClass.relays || []
    const thunk = postPermalink(permalink, relays)
    toast.push({
      message: "Permalink published successfully",
      timeout: 2000,
    })
    const nevent = nip19.neventEncode({
      id: thunk.event.id,
      kind: thunk.event.kind,
      relays,
    })
    await navigator.clipboard.writeText(nevent)
    toast.push({
      message: "Permalink copied to clipboard",
      timeout: 2000,
    })
  }

  // Load commit details when component mounts if not already loaded from +page.ts
  onMount(() => {
    if (!commitMeta || !changes || diffUnavailable) {
      if (!loadAttempted) {
        loadAttempted = true
        loadCommitDetails()
      }
    }
  })

  // Handle missing data gracefully - show loading or error state instead of throwing
  const hasData = $derived(!!commitMeta && !!changes)

  // State for collapsible file panels
  let expandedFiles = $state<Set<string>>(new Set())
  let diffAnchors = $state<Record<string, string>>({})

  const getDiffHashFromLocation = () => {
    if (typeof window === "undefined") return null
    const match = window.location.hash.match(/^#diff-([a-f0-9]+)/i)
    return match ? match[1] : null
  }

  const hasDiffLineAnchor = () => {
    if (typeof window === "undefined") return false
    return /^#diff-[a-f0-9]+[LR]\d+(?:-[LR]\d+)?$/i.test(window.location.hash || "")
  }

  const scrollToDiffHash = async () => {
    const hash = getDiffHashFromLocation()
    if (!hash) return
    const path = Object.keys(diffAnchors).find(key => diffAnchors[key] === hash)
    if (path && !expandedFiles.has(path)) {
      expandedFiles = new Set(expandedFiles).add(path)
      await tick()
    }
    if (hasDiffLineAnchor()) {
      return
    }
    await tick()
    const el = document.getElementById(`diff-${hash}`)
    if (el) el.scrollIntoView({ block: "start" })
  }

  // Toggle file expansion
  const toggleFile = (filepath: string) => {
    if (expandedFiles.has(filepath)) {
      expandedFiles.delete(filepath)
    } else {
      expandedFiles.add(filepath)
    }
    expandedFiles = new Set(expandedFiles) // Trigger reactivity
  }

  $effect(() => {
    if (!changes || changes.length === 0) {
      diffAnchors = {}
      return
    }
    const paths = Array.from(new Set(changes.map(change => change.path).filter(Boolean)))
    let cancelled = false
    Promise.all(paths.map(async path => [path, await githubPermalinkDiffId(path)] as const))
      .then(entries => {
        if (!cancelled) diffAnchors = Object.fromEntries(entries)
      })
      .catch(() => {
        if (!cancelled) diffAnchors = {}
      })
    return () => {
      cancelled = true
    }
  })

  $effect(() => {
    const anchors = diffAnchors
    if (Object.keys(anchors).length === 0) return
    void scrollToDiffHash()
  })

  $effect(() => {
    if (typeof window === "undefined") return
    const handler = () => void scrollToDiffHash()
    window.addEventListener("hashchange", handler)
    return () => window.removeEventListener("hashchange", handler)
  })

  // Get file status icon and styling
  const getFileStatusIcon = (status: string) => {
    switch (status) {
      case "added":
        return {icon: FilePlus, class: "text-emerald-700 dark:text-emerald-300"}
      case "deleted":
        return {icon: FileMinus, class: "text-rose-700 dark:text-rose-300"}
      case "modified":
        return {icon: FileText, class: "text-sky-700 dark:text-sky-300"}
      case "renamed":
        return {icon: FileX, class: "text-amber-700 dark:text-amber-300"}
      default:
        return {icon: FileText, class: "text-muted-foreground"}
    }
  }

  // Get file status badge styling
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "added":
        return "border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
      case "deleted":
        return "border-rose-200 bg-rose-100 text-rose-900 dark:border-rose-900 dark:bg-rose-900/40 dark:text-rose-200"
      case "modified":
        return "border-sky-200 bg-sky-100 text-sky-900 dark:border-sky-900 dark:bg-sky-900/40 dark:text-sky-200"
      case "renamed":
        return "border-amber-200 bg-amber-100 text-amber-900 dark:border-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
      default:
        return "border-border bg-muted text-muted-foreground"
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

  // Calculate total diff stats (safe for missing data)
  const totalStats = $derived(() => {
    if ((!changes || changes.length === 0) && diffUnavailable && fallbackStats) {
      return {
        totalAdditions: Number(fallbackStats.additions || 0),
        totalDeletions: Number(fallbackStats.deletions || 0),
      }
    }
    if (!changes) return {totalAdditions: 0, totalDeletions: 0}
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
    if (changes && changes.length <= 5 && !getDiffHashFromLocation()) {
      expandedFiles = new Set(changes.map(change => change.path))
    }
  })

  // Calculate expanded files count (safe for missing data)
  const expandedCount = $derived(expandedFiles.size)
  const allExpanded = $derived(changes ? expandedCount === changes.length && changes.length > 0 : false)
  const allCollapsed = $derived(expandedCount === 0)
</script>

<svelte:head>
  <title>{repoClass.name} - Commit {hasData ? commitMeta?.sha.slice(0, 7) : 'Loading...'}</title>
</svelte:head>

{#if loadError}
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
    <div class="text-center text-muted-foreground">
      <p class="text-lg text-rose-700 dark:text-rose-300">Failed to load commit</p>
      <p class="text-sm">{loadError}</p>
      <button 
        onclick={() => loadCommitDetails()}
        class="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
        Retry
      </button>
    </div>
  </div>
{:else if !hasData}
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
    <div class="text-center text-muted-foreground">
      <p class="text-lg">Loading commit details...</p>
      <p class="text-sm">Initializing repository...</p>
    </div>
  </div>
{:else}
<div class="flex min-h-screen flex-col gap-4 bg-background">
  <!-- Commit Header -->
  <CommitHeader
    sha={commitMeta!.sha}
    author={commitMeta!.author}
    email={commitMeta!.email}
    date={commitMeta!.date}
    message={commitMeta!.message}
    parents={commitMeta!.parents}
    getParentHref={getParentHref}
  />

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
        <div class="text-2xl font-bold text-primary">{diffUnavailable ? "?" : changes!.length}</div>
        <div class="text-sm text-muted-foreground">
          {diffUnavailable ? "Files changed" : `${changes!.length === 1 ? "file" : "files"} changed`}
        </div>
        <div class="mt-1 text-xs text-muted-foreground">
          {diffUnavailable ? "Unavailable from current remotes" : changes!.length === 1 ? "Single file" : "Multiple files"}
        </div>
      </div>

      <div class="rounded-lg border bg-emerald-50 p-3 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
        <div class="text-2xl font-bold text-emerald-700 dark:text-emerald-300">+{totalStats().totalAdditions}</div>
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

      <div class="rounded-lg border bg-rose-50 p-3 text-center dark:border-rose-900 dark:bg-rose-950/30">
        <div class="text-2xl font-bold text-rose-700 dark:text-rose-300">-{totalStats().totalDeletions}</div>
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

    {#if commitWarning}
      <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
        {commitWarning}
      </div>
    {/if}
  </div>

  <div
    class="border-b border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:px-6 sm:py-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <!-- Expand/Collapse Controls -->
      <div class="flex items-center gap-2">
        <button
          onclick={() => {
            expandedFiles = new Set(changes!.map(change => change.path))
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
        {#if changes!.length > 0}
          <span class="ml-2 text-sm text-muted-foreground">
            ({expandedCount} of {changes!.length} {expandedCount === 1 ? "file" : "files"} expanded)
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

      <div
        class="w-full overflow-x-auto bg-background"
        id={diffAnchors[change.path] ? `diff-${diffAnchors[change.path]}` : undefined}
      >
        <!-- File Header -->
        <button
          onclick={() => toggleFile(change.path)}
          class="min-h-[44px] w-full touch-manipulation px-2 py-3 text-left transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none sm:px-6 sm:py-4">
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
                <span class="text-emerald-700 dark:text-emerald-300">+{stats.additions}</span>
              {/if}
              {#if stats.deletions > 0}
                <span class="text-rose-700 dark:text-rose-300">-{stats.deletions}</span>
              {/if}
            </div>
          </div>
        </button>

        <!-- File Diff Content -->
        {#if isExpanded}
          <div class="px-1 pb-3 sm:px-6 sm:pb-6">
            <SplitDiff
              hunks={normalizeHunks(change.diffHunks)}
              filepath={change.path}
              repo={repoClass}
              publish={publishPermalink}
              commitSha={commitMeta?.sha}
              parentSha={commitMeta?.parents?.[0]}
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Empty State -->
  {#if changes!.length === 0}
    <div class="px-4 py-12 text-center sm:px-6">
      <FileText class="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 class="mt-4 text-lg font-medium text-foreground">
        {diffUnavailable ? "Diff unavailable" : "No file changes"}
      </h3>
      <p class="mt-2 text-sm text-muted-foreground">
        {diffUnavailable
          ? "The commit exists, but file diffs could not be loaded from the current remotes."
          : "This commit doesn't contain any file changes."}
      </p>
    </div>
  {/if}
</div>
{/if}
