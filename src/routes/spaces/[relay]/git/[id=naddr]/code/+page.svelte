<script lang="ts">
  import {FileView} from "@nostr-git/ui"
  import {fade, fly} from "svelte/transition"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {type FileEntry, type PermalinkEvent} from "@nostr-git/core"
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

  const rootDir: FileEntry = $state({
    name: ".",
    path: "",
    type: "directory",
  })

  // Initialize selectedBranch first
  let selectedBranch = $state(repoClass.selectedBranch || repoClass.mainBranch)

  // Keep local selectedBranch in sync with repoClass changes (e.g., BranchSelector)
  $effect(() => {
    if (repoClass) {
      // Explicitly track selectedBranch and mainBranch for reactivity
      const repoSelectedBranch = repoClass.selectedBranch;
      const repoMainBranch = repoClass.mainBranch;
      const next = repoSelectedBranch || repoMainBranch || selectedBranch
      if (next && next !== selectedBranch) {
        selectedBranch = next
      }
    }
  })

  let curDir: FileEntry = $state({
    name: "..",
    path: "",
    type: "directory",
  })

  let branchLoadTrigger = $state(0)
  let branchSwitchComplete = $state(0) // Increments when branch switch finishes
  
  // Track when branch switching completes
  let wasSwitching = $state(false)
  $effect(() => {
    const isSwitching = repoClass.isBranchSwitching
    if (wasSwitching && !isSwitching) {
      // Branch switch just completed
      console.log("✅ Branch switch completed, triggering reload")
      branchSwitchComplete++
    }
    wasSwitching = isSwitching
  })

  let refs: Array<{name: string; type: "heads" | "tags"; fullRef: string; commitId: string}> =
    $state([])
  // Start with false - only show loading when actually loading refs
  let loadingRefs = $state(false)

  // Check if repo is cloned and clone if needed (only on code tab)
  // Defer this heavy operation until after initial render
  $effect(() => {
    if (!repoClass || !repoClass.workerManager?.isReady) return
    
    // Defer cloning check to avoid blocking initial render
    const timeout = setTimeout(() => {
      ;(async () => {
        try {
          const isCloned = await repoClass.workerManager.isRepoCloned({
            repoId: repoClass.key
          })
          
          if (!isCloned) {
            // Show clone progress
            isCloning = true
            cloneProgress = "Initializing repository..."
            
            // Set up progress callback using WorkerManager's API
            const originalCallback = repoClass.workerManager.setProgressCallback.bind(repoClass.workerManager)
            repoClass.workerManager.setProgressCallback((progressEvent) => {
              if (progressEvent.repoId === repoClass.key) {
                cloneProgress = progressEvent.phase || "Cloning repository..."
                cloneProgressPercent = progressEvent.progress
              }
            })
            
            try {
              const cloneUrls = repoClass.cloneUrls
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
              
              // After cloning, sync with remote to ensure we have latest content
              console.log("🔄 Syncing with remote after clone...")
              cloneProgress = "Syncing with remote..."
              try {
                await repoClass.workerManager.syncWithRemote({
                  repoId: repoClass.key,
                  cloneUrls,
                  branch: selectedBranch?.split("/").pop()
                })
                console.log("✅ Sync complete")
              } catch (syncErr) {
                console.warn("Sync with remote failed:", syncErr)
                // Don't throw - repo is still usable even if sync fails
              }
            } finally {
              // Restore original callback (or clear it)
              repoClass.workerManager.setProgressCallback(() => {})
              isCloning = false
              cloneProgress = ""
              cloneProgressPercent = undefined
              // Trigger file reload after clone+sync completes
              branchSwitchComplete++
            }
          }
        } catch (error) {
          console.error("Failed to initialize repository:", error)
          pushToast({
            message: `Failed to initialize repository: ${error instanceof Error ? error.message : "Unknown error"}`,
            theme: "error",
          })
          isCloning = false
          error = error instanceof Error ? error.message : "Failed to initialize repository"
        }
      })()
    }, 100)
    
    return () => {
      clearTimeout(timeout)
    }
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
          .catch((error: Error) => {
            console.error("Failed to load repository references:", error)
            pushToast({
              message: "Failed to load branches from git repository: " + error,
              theme: "error",
            })
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
    const isSwitching = repoClass.isBranchSwitching;
    
    // Don't load files while branch is still switching, but show loading state
    if (isSwitching) {
      console.log("⏳ Branch is switching, showing loading state...");
      loading = true;
      return;
    }
    
    // Explicitly track branchSwitchComplete and selectedBranch to ensure effect re-runs after branch changes
    const currentBranch = selectedBranch;
    const switchTrigger = branchSwitchComplete; // This increments when branch switch completes
    
    if (currentBranch && !isCloning && !path) {
      // Show loading only when actually fetching
      loading = true
      // Defer file loading slightly to avoid blocking render
      const timeout = setTimeout(() => {
        console.log("🔄 Loading files for branch:", currentBranch, "trigger:", switchTrigger);
        files = repoClass
          .listRepoFiles({
            branch: currentBranch?.split("/").pop() || "master",
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
    }
  })

  $effect(() => {
    const currentBranch = selectedBranch;
    const currentPath = path;
    const switchTrigger = branchSwitchComplete; // Track branch switches
    
    if (currentPath && currentBranch && !isCloning) {
      curDir.path = currentPath.split("/").slice(0, -1).join("/")
      loading = true
      console.log("🔄 Loading files for branch:", currentBranch, "path:", currentPath, "trigger:", switchTrigger);
      files = repoClass
        .listRepoFiles({
          branch: currentBranch?.split("/").pop() || "master",
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
    }
  })

  const getFileContent = async (path: string) => {
    try {
      const result = await repoClass.getFileContent({
        branch: selectedBranch?.split("/").pop() || "master",
        path,
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
