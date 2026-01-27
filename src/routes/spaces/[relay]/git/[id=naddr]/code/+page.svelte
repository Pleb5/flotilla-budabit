<script lang="ts">
  import {FileView} from "@nostr-git/ui"
  import {fade, fly} from "svelte/transition"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {type FileEntry, type PermalinkEvent} from "@nostr-git/core/types"
  import {pushToast} from "@src/app/util/toast"
  import {postPermalink} from "@lib/budabit/commands.js"
  import {nip19} from "nostr-tools"
  import {getContext} from "svelte"
  import {REPO_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"

  const repoClass = getContext<Repo>(REPO_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Start with false - show content immediately, only show loading when actually loading
  let loading = $state(false)
  let error: string | null = $state(null)
  let files: Promise<FileEntry[]> = $state(Promise.resolve([]))
  let path = $state<string | undefined>(undefined)
  
  // Clone progress state - only show when actually cloning
  let isCloning = $state(false)
  let cloneProgress = $state<string>("")
  let cloneProgressPercent = $state<number | undefined>(undefined)
  
  // Guard to prevent multiple concurrent clone checks
  let cloneCheckInProgress = $state(false)

  const rootDir: FileEntry = $state({
    name: ".",
    path: "",
    type: "directory",
  })

  // Derive selectedBranch from repoClass to avoid circular effect dependencies.
  // Using $derived instead of $effect + $state prevents the read-write cycle
  // that was causing effect_update_depth_exceeded errors.
  const selectedBranch = $derived(repoClass.selectedBranch || repoClass.mainBranch || "")

  let curDir: FileEntry = $state({
    name: "..",
    path: "",
    type: "directory",
  })

  let branchLoadTrigger = $state(0)
  
  let refs: Array<{name: string; type: "heads" | "tags"; fullRef: string; commitId: string}> =
    $state([])
  // Start with false - only show loading when actually loading refs
  let loadingRefs = $state(false)

  // Track if we've already attempted clone check to prevent infinite retries
  let cloneCheckAttempted = $state(false)
  
  // Check if repo is cloned and clone if needed (only on code tab)
  // Skip this entirely if vendor API is available - files can be loaded directly from API
  $effect(() => {
    if (!repoClass) return
    // Wait for repo key to be populated (set when repoEvent is processed)
    if (!repoClass.key) return
    // Only attempt clone check once per page load
    if (cloneCheckAttempted || cloneCheckInProgress || isCloning) return
    
    // Check if vendor API is available - if so, skip clone entirely
    // The vendor API (GitHub, GitLab, etc.) can provide files immediately
    const cloneUrls = repoClass.cloneUrls
    const hasVendorApi = repoClass.vendorReadRouter?.hasVendorSupport(cloneUrls) ?? false
    if (hasVendorApi) {
      console.log("[code/+page] Vendor API available, skipping git clone check for fast UI")
      cloneCheckAttempted = true
      return
    }
    
    const timeout = setTimeout(() => {
      ;(async () => {
        if (cloneCheckAttempted || cloneCheckInProgress || isCloning) return
        if (!repoClass.key) return // Double-check key is still valid
        cloneCheckInProgress = true
        cloneCheckAttempted = true
        
        try {
          const isCloned = await repoClass.workerManager.isRepoCloned({
            repoId: repoClass.key
          })
          
          if (!isCloned) {
            isCloning = true
            cloneProgress = "Initializing repository..."
            
            repoClass.workerManager.setProgressCallback((progressEvent) => {
              if (progressEvent.repoId === repoClass.key) {
                cloneProgress = progressEvent.phase || "Cloning repository..."
                cloneProgressPercent = progressEvent.progress
              }
            })
            
            try {
              if (cloneUrls.length === 0) {
                throw new Error("No clone URLs found for repository")
              }
              
              const result = await repoClass.workerManager.smartInitializeRepo({
                repoId: repoClass.key,
                cloneUrls,
                forceUpdate: false
              })
              
              if (!result.success) {
                throw new Error(result.error || "Repository initialization failed")
              }
              
              // Skip syncWithRemote - it's slow and not needed for initial display
              // The vendor API or cached data will be used for file display
              console.log("✅ Repository initialized (skipping sync for faster UI)")
            } finally {
              repoClass.workerManager.setProgressCallback(() => {})
              isCloning = false
              cloneProgress = ""
              cloneProgressPercent = undefined
            }
          }
        } catch (err) {
          console.error("Failed to initialize repository:", err)
          const errorMessage = err instanceof Error ? err.message : "Unknown error"
          // Only show toast for non-transient errors
          if (!errorMessage.includes("No clone URLs")) {
            // Silently fail - file loading will handle it
            console.warn("Clone check failed, file loading will handle:", errorMessage)
          } else {
            pushToast({
              message: `Failed to initialize repository: ${errorMessage}`,
              theme: "error",
            })
            error = errorMessage
          }
          isCloning = false
        } finally {
          cloneCheckInProgress = false
        }
      })()
    }, 200) // Slightly longer delay to ensure worker is ready
    
    return () => clearTimeout(timeout)
  })

  // Load refs using the unified API - defer to avoid blocking render
  $effect(() => {
    if (repoClass && !isCloning) {
      // Defer ref loading to avoid blocking initial render
      const timeout = setTimeout(() => {
        loadingRefs = true
        repoClass
          .getAllRefsWithFallback()
          .then(loadedRefs => {
            refs = loadedRefs
            loadingRefs = false
            branchLoadTrigger++ // Trigger reactivity for dependent effects
          })
          .catch((err: Error) => {
            console.error("Failed to load repository references:", err)
            // Don't show toast for transient worker initialization errors
            const errorMessage = err.message || String(err)
            if (!errorMessage.includes("Cannot read properties of undefined") && 
                !errorMessage.includes("Worker operation") &&
                !errorMessage.includes("apply")) {
              pushToast({
                message: "Failed to load branches from git repository: " + errorMessage,
                theme: "error",
              })
            }
            refs = []
            loadingRefs = false
          })
      }, 100)
      
      return () => {
        clearTimeout(timeout)
      }
    }
  })

  $effect(() => {
    // Track branchChangeTrigger from Repo class to ensure effect re-runs after branch changes
    const currentBranch = selectedBranch;
    const switchTrigger = repoClass.branchChangeTrigger; // Increments when branch switch completes

    // Don't attempt to load files until we have a valid branch name
    // Branch should come from repo state event or git clone, not hardcoded
    const branchName = currentBranch?.split("/").pop();
    if (!branchName || !currentBranch || isCloning || path) return;

    // Show loading only when actually fetching
    loading = true
    // Defer file loading slightly to avoid blocking render
    const timeout = setTimeout(() => {
      console.log("🔄 Loading files for branch:", currentBranch, "trigger:", switchTrigger);
      files = repoClass
        .listRepoFiles({
          branch: branchName,
          path: undefined,
        })
        .then(result => {
          loading = false
          console.log("✅ Files loaded:", result.files.length, "files");
          return result.files.map(
            file =>
              ({
                name: file.path.split("/").pop() || file.path,
                path: file.path,
                type: file.type as "file" | "directory" | "submodule" | "symlink",
                oid: file.lastCommit,
              }) as FileEntry,
          )
        })
        .catch((e) => {
          loading = false
          error = e instanceof Error ? e.message : "Failed to load files"
          console.error("❌ Failed to load files:", e);
          return []
        })
    }, 100)
    
    return () => {
      clearTimeout(timeout)
    }
  })

  $effect(() => {
    const currentBranch = selectedBranch;
    const currentPath = path;
    const switchTrigger = repoClass.branchChangeTrigger; // Track branch switches via Repo class

    // Don't attempt to load files until we have a valid branch name
    const branchName = currentBranch?.split("/").pop();
    if (!branchName || !currentPath || !currentBranch || isCloning) return;

    curDir.path = currentPath.split("/").slice(0, -1).join("/")
    loading = true
    console.log("🔄 Loading files for branch:", currentBranch, "path:", currentPath, "trigger:", switchTrigger);
    files = repoClass
      .listRepoFiles({
        branch: branchName,
        path: currentPath,
      })
        .then(result => {
          loading = false
          console.log("✅ Files loaded:", result.files.length, "files");
          return result.files.map(
            file =>
              ({
                name: file.path.split("/").pop() || file.path,
                path: file.path,
                type: file.type as "file" | "directory" | "submodule" | "symlink",
                oid: file.lastCommit,
              }) as FileEntry,
          )
        })
        .catch((e) => {
          loading = false
          error = e instanceof Error ? e.message : "Failed to load files"
          console.error("❌ Failed to load files:", e);
          return []
        })
  })

  const getFileContent = async (filePath: string) => {
    // Don't attempt to get file content without a valid branch
    const branchName = selectedBranch?.split("/").pop();
    if (!branchName) {
      pushToast({
        message: "Cannot load file: branch not yet determined",
        theme: "error",
      })
      return ""
    }
    
    try {
      const result = await repoClass.getFileContent({
        branch: branchName,
        path: filePath,
        commit: undefined as any,
      })
      return result.content
    } catch (e) {
      pushToast({
        message: "Failed to load file: " + e,
        theme: "error",
      })
      return ""
    }
  }

  const setDirectory = (p: string) => {
    if (p !== path) {
      path = p
    }
  }

  const publish = async (permalink: PermalinkEvent) => {
    const thunk = postPermalink(permalink, repoClass.relays)

    pushToast({
      message: "Permalink published successfully",
    })
    console.log("Permalink published successfully", thunk.event)
    const nevent = nip19.neventEncode({
      id: thunk.event.id,
      kind: thunk.event.kind,
      relays: repoClass.relays,
    })
    console.log("Permalink published successfully", nevent)
    navigator.clipboard.writeText(nevent)
    pushToast({
      message: "Permalink copied to clipboard",
    })
  }
</script>

<svelte:head>
  <title>{repoClass.name} - Code</title>
</svelte:head>

<!-- Breadcrumb navigation -->
{#if path}
  <nav class="mt-2 mb-2 flex items-center gap-1 text-sm text-muted-foreground overflow-x-auto" aria-label="Breadcrumb">
    <button
      type="button"
      class="hover:text-foreground hover:underline transition-colors flex-shrink-0"
      onclick={() => setDirectory("")}
    >
      {repoClass.name}
    </button>
    {#each path.split("/") as segment, i}
      <span class="text-muted-foreground/50 flex-shrink-0">/</span>
      {#if i === path.split("/").length - 1}
        <span class="text-foreground font-medium truncate">{segment}</span>
      {:else}
        <button
          type="button"
          class="hover:text-foreground hover:underline transition-colors truncate max-w-[150px]"
          onclick={() => path && setDirectory(path.split("/").slice(0, i + 1).join("/"))}
        >
          {segment}
        </button>
      {/if}
    {/each}
  </nav>
{/if}

<div class="mt-2 rounded-lg border border-border bg-card">
  <div class="p-4">
    {#if isCloning}
      <div class="flex flex-col items-center justify-center py-12 space-y-4">
        <Spinner>Cloning repository...</Spinner>
        <div class="text-center space-y-2">
          <p class="text-lg font-medium">{cloneProgress}</p>
          {#if cloneProgressPercent !== undefined}
            <div class="w-64 bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
              <div 
                class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                style="width: {Math.round(cloneProgressPercent * 100)}%"
              ></div>
            </div>
            <p class="text-sm text-muted-foreground">{Math.round(cloneProgressPercent * 100)}%</p>
          {/if}
        </div>
      </div>
    {:else if loading}
      <Spinner {loading}>Loading files...</Spinner>
    {:else if error}
      <div class="text-red-500">{error}</div>
    {:else}
      <div class="border-border">
        {#key files}
          <div transition:fade>
            {#await files}
              <Spinner {loading}>Loading files...</Spinner>
            {:then files}
              {#if files.length === 0}
                <div class="text-muted-foreground">No files found in this branch.</div>
              {:else}
                {#if path}
                  <FileView file={rootDir} {getFileContent} {setDirectory} />
                  <FileView file={curDir} {getFileContent} {setDirectory} />
                {/if}
                {#each files as file (file)}
                  <FileView {file} {getFileContent} {setDirectory} {publish} repo={repoClass} />
                {/each}
              {/if}
            {/await}
          </div>
        {/key}
      </div>
    {/if}
  </div>
</div>
