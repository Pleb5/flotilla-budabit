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
  import {
    CommitHeader,
    DiffViewer,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    prChangeToParseDiffFile,
    prChangeToReviewParseDiffFile,
    toast,
  } from "@nostr-git/ui"
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

  type CommitDiffTab = "diffs" | "files"

  const COMMIT_DIFF_CONTEXT_LINES = 3

  // State for diff tabs and collapsible file panels
  let commitDiffTab = $state<CommitDiffTab>("diffs")
  let expandedDiffFiles = $state<Set<string>>(new Set())
  let expandedFiles = $state<Set<string>>(new Set())
  let diffAnchors = $state<Record<string, string>>({})
  let currentHash = $state("")
  let autoSelectedFilesAnchor = $state<string | null>(null)

  const getCommitReviewDiff = (change: CommitChange) =>
    prChangeToReviewParseDiffFile(change, {
      contextLines: COMMIT_DIFF_CONTEXT_LINES,
    })

  const commitDiffRootEvent = $derived.by(() => {
    if (!commitMeta?.sha) return undefined

    const tags: string[][] = []
    if (repoClass.address) tags.push(["a", repoClass.address])
    tags.push(["commit", commitMeta.sha])

    const parentCommit = commitMeta.parents?.[0]
    if (parentCommit) tags.push(["parent-commit", parentCommit])

    return {
      id: `commit:${commitMeta.sha}`,
      tags,
    }
  })

  const getDiffHashFromLocation = (hash = currentHash) => {
    const match = hash.match(/^#diff-([a-f0-9]+)/i)
    return match ? match[1] : null
  }

  const hasDiffLineAnchor = (hash = currentHash) => /^#diff-[a-f0-9]+[LR]\d+(?:-[LR]\d+)?$/i.test(hash)

  const scrollToDiffHash = async (hashValue = currentHash, activeTab = commitDiffTab) => {
    const hash = getDiffHashFromLocation(hashValue)
    if (!hash) return
    const path = Object.keys(diffAnchors).find(key => diffAnchors[key] === hash)
    let expandedChanged = false

    if (path && !expandedDiffFiles.has(path)) {
      expandedDiffFiles = new Set(expandedDiffFiles).add(path)
      expandedChanged = true
    }

    if (path && !expandedFiles.has(path)) {
      expandedFiles = new Set(expandedFiles).add(path)
      expandedChanged = true
    }

    if (expandedChanged) {
      await tick()
    }

    if (hasDiffLineAnchor(hashValue)) {
      const anchor = hashValue.slice(1)
      if (
        anchor &&
        !document.getElementById(anchor) &&
        activeTab !== "files" &&
        autoSelectedFilesAnchor !== anchor
      ) {
        commitDiffTab = "files"
        autoSelectedFilesAnchor = anchor
        await tick()
      }

      const lineEl = anchor ? document.getElementById(anchor) : null
      if (lineEl) lineEl.scrollIntoView({block: "center"})
      return
    }
    await tick()
    const el = document.getElementById(`diff-${hash}`)
    if (el) el.scrollIntoView({ block: "start" })
  }

  // Toggle compact diff expansion
  const toggleDiffFile = (filepath: string) => {
    if (expandedDiffFiles.has(filepath)) {
      expandedDiffFiles.delete(filepath)
    } else {
      expandedDiffFiles.add(filepath)
    }
    expandedDiffFiles = new Set(expandedDiffFiles)
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
    const hash = currentHash
    const activeTab = commitDiffTab
    if (!hash || Object.keys(anchors).length === 0) return
    void scrollToDiffHash(hash, activeTab)
  })

  $effect(() => {
    if (typeof window === "undefined") return
    currentHash = window.location.hash || ""
    const syncHash = () => {
      currentHash = window.location.hash || ""
      void scrollToDiffHash(currentHash, commitDiffTab)
    }
    window.addEventListener("hashchange", syncHash)
    return () => window.removeEventListener("hashchange", syncHash)
  })

  $effect(() => {
    if (!hasDiffLineAnchor()) autoSelectedFilesAnchor = null
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

  // Expand all files by default if there are few changes
  $effect(() => {
    if (changes && changes.length <= 5 && !getDiffHashFromLocation()) {
      expandedDiffFiles = new Set(changes.map(change => change.path))
      expandedFiles = new Set(changes.map(change => change.path))
    }
  })

  // Calculate expanded files count (safe for missing data)
  const expandedDiffCount = $derived(expandedDiffFiles.size)
  const allDiffsExpanded = $derived(
    changes ? expandedDiffCount === changes.length && changes.length > 0 : false,
  )
  const allDiffsCollapsed = $derived(expandedDiffCount === 0)
  const expandedFileCount = $derived(expandedFiles.size)
  const allFilesExpanded = $derived(
    changes ? expandedFileCount === changes.length && changes.length > 0 : false,
  )
  const allFilesCollapsed = $derived(expandedFileCount === 0)
  const activeExpandedCount = $derived(
    commitDiffTab === "diffs" ? expandedDiffCount : expandedFileCount,
  )
  const activeAllExpanded = $derived(commitDiffTab === "diffs" ? allDiffsExpanded : allFilesExpanded)
  const activeAllCollapsed = $derived(
    commitDiffTab === "diffs" ? allDiffsCollapsed : allFilesCollapsed,
  )
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

  <Tabs bind:value={commitDiffTab} class="w-full">
    <div
      class="border-b border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:px-6 sm:py-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList class="grid w-full grid-cols-2 sm:max-w-sm">
          <TabsTrigger value="diffs" class="px-2 text-xs sm:text-sm">
            <span class="sm:hidden">Diffs</span>
            <span class="hidden sm:inline">Diffs ({changes!.length})</span>
          </TabsTrigger>
          <TabsTrigger value="files" class="px-2 text-xs sm:text-sm">
            <span class="sm:hidden">Files</span>
            <span class="hidden sm:inline">Files changed ({changes!.length})</span>
          </TabsTrigger>
        </TabsList>

        {#if changes!.length > 0}
          <div class="flex flex-wrap items-center gap-2">
            <button
              onclick={() => {
                if (commitDiffTab === "diffs") {
                  expandedDiffFiles = new Set(changes!.map(change => change.path))
                } else {
                  expandedFiles = new Set(changes!.map(change => change.path))
                }
              }}
              disabled={activeAllExpanded}
              aria-label={`Expand all ${commitDiffTab === "diffs" ? "diffs" : "files"}`}
              class="inline-flex touch-manipulation items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-all hover:border-border/80 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background">
              <ChevronsDown class="h-4 w-4" />
              <span>Expand all</span>
            </button>
            <button
              onclick={() => {
                if (commitDiffTab === "diffs") {
                  expandedDiffFiles = new Set()
                } else {
                  expandedFiles = new Set()
                }
              }}
              disabled={activeAllCollapsed}
              aria-label={`Collapse all ${commitDiffTab === "diffs" ? "diffs" : "files"}`}
              class="inline-flex touch-manipulation items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-all hover:border-border/80 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background">
              <ChevronsUp class="h-4 w-4" />
              <span>Collapse all</span>
            </button>
            <span class="text-sm text-muted-foreground">
              ({activeExpandedCount} of {changes!.length} {activeExpandedCount === 1 ? "file" : "files"} expanded)
            </span>
          </div>
        {/if}
      </div>
    </div>

    <TabsContent value="diffs" class="mt-0">
      {#if commitDiffTab === "diffs"}
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
        {:else}
          <div class="divide-y divide-border">
            {#each changes as change (change.path)}
              {@const isExpanded = expandedDiffFiles.has(change.path)}
              {@const statusInfo = getFileStatusIcon(change.status)}
              {@const stats = getFileStats(change.diffHunks)}

              <div
                class="w-full overflow-x-auto bg-background"
                id={diffAnchors[change.path] ? `diff-${diffAnchors[change.path]}` : undefined}>
                <button
                  onclick={() => toggleDiffFile(change.path)}
                  class="min-h-[44px] w-full touch-manipulation px-2 py-3 text-left transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none sm:px-6 sm:py-4">
                  <div
                    class="flex min-w-fit flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div class="flex min-w-fit items-center gap-2 sm:gap-3">
                      {#if isExpanded}
                        <ChevronDown class="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      {:else}
                        <ChevronRight class="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      {/if}

                      {#if statusInfo.icon}
                        {@const IconComponent = statusInfo.icon}
                        <IconComponent class="h-4 w-4 {statusInfo.class} flex-shrink-0" />
                      {/if}

                      <span
                        class="whitespace-nowrap font-mono text-xs text-foreground sm:text-sm"
                        title={change.path}>{change.path}</span>

                      <span
                        class="flex-shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium {getStatusBadgeClass(
                          change.status,
                        )}">
                        {change.status}
                      </span>
                    </div>

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

                {#if isExpanded}
                  <div class="border-t border-border px-2 pb-2 pt-1.5 sm:px-3 sm:pb-3">
                    <DiffViewer
                      diff={[getCommitReviewDiff(change)]}
                      showLineNumbers={true}
                      expandAll={true}
                      rootEvent={commitDiffRootEvent}
                      repo={repoClass}
                      publish={publishPermalink}
                      showFileHeaders={false}
                      showFileAnchors={false}
                      compact={true}
                      framed={false}
                    />
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </TabsContent>

    <TabsContent value="files" class="mt-0">
      {#if commitDiffTab === "files"}
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
        {:else}
          <div class="divide-y divide-border">
            {#each changes as change (change.path)}
              {@const isExpanded = expandedFiles.has(change.path)}
              {@const statusInfo = getFileStatusIcon(change.status)}
              {@const stats = getFileStats(change.diffHunks)}

              <div
                class="w-full overflow-x-auto bg-background"
                id={diffAnchors[change.path] ? `diff-${diffAnchors[change.path]}` : undefined}>
                <button
                  onclick={() => toggleFile(change.path)}
                  class="min-h-[44px] w-full touch-manipulation px-2 py-3 text-left transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none sm:px-6 sm:py-4">
                  <div
                    class="flex min-w-fit flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div class="flex min-w-fit items-center gap-2 sm:gap-3">
                      {#if isExpanded}
                        <ChevronDown class="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      {:else}
                        <ChevronRight class="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      {/if}

                      {#if statusInfo.icon}
                        {@const IconComponent = statusInfo.icon}
                        <IconComponent class="h-4 w-4 {statusInfo.class} flex-shrink-0" />
                      {/if}

                      <span
                        class="whitespace-nowrap font-mono text-xs text-foreground sm:text-sm"
                        title={change.path}>{change.path}</span>

                      <span
                        class="flex-shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium {getStatusBadgeClass(
                          change.status,
                        )}">
                        {change.status}
                      </span>
                    </div>

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

                {#if isExpanded}
                  <div class="border-t border-border px-2 pb-2 pt-1.5 sm:px-3 sm:pb-3">
                    <DiffViewer
                      diff={[prChangeToParseDiffFile(change)]}
                      showLineNumbers={true}
                      expandAll={true}
                      rootEvent={commitDiffRootEvent}
                      repo={repoClass}
                      publish={publishPermalink}
                      showFileHeaders={false}
                      showFileAnchors={false}
                      compact={true}
                      framed={false}
                    />
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </TabsContent>
  </Tabs>
</div>
{/if}
