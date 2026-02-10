<script lang="ts">
  import {FileView} from "@nostr-git/ui"
  import {fade, fly} from "svelte/transition"
  import {goto} from "$app/navigation"
  import {ChevronLeft, PanelLeftClose, PanelLeftOpen} from "@lucide/svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import {type FileEntry, type PermalinkEvent} from "@nostr-git/core/types"
  import {pushToast} from "@src/app/util/toast"
  import {postPermalink} from "@lib/budabit/commands.js"
  import {nip19} from "nostr-tools"
  import {getContext} from "svelte"
  import {REPO_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"
  import {page} from "$app/stores"

  const repoClass = getContext<Repo>(REPO_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Start with false - show content immediately, only show loading when actually loading
  let loading = $state(false)
  let error: string | null = $state(null)
  let files: Promise<FileEntry[]> = $state(Promise.resolve([]))
  let currentFiles = $state<FileEntry[]>([])
  let path = $state("")
  let autoOpenPath = $state<string | undefined>(undefined)
  let selectedFile = $state<FileEntry | null>(null)
  let overlayFile = $state<FileEntry | null>(null)
  let isBrowserOpen = $state(true)
  let showScrollButton = $state(false)
  let scrollParent: HTMLElement | null = $state(null)
  let pageContainerRef: HTMLElement | undefined = $state()
  let showOverlayScrollButton = $state(false)
  let overlayScrollParent: HTMLElement | null = $state(null)
  
  // Clone progress state - only show when actually cloning
  let isCloning = $state(false)
  let cloneProgress = $state<string>("")
  let cloneProgressPercent = $state<number | undefined>(undefined)
  
  // Guard to prevent multiple concurrent clone checks
  let cloneCheckInProgress = $state(false)

  // Derive selectedBranch from repoClass to avoid circular effect dependencies.
  // Using $derived instead of $effect + $state prevents the read-write cycle
  // that was causing effect_update_depth_exceeded errors.
  const selectedBranch = $derived(repoClass.selectedBranch || repoClass.mainBranch || "")

  let branchLoadTrigger = $state(0)

  const normalizePath = (value: string | null | undefined) =>
    (value ?? "").replace(/^\/+/, "").replace(/\/+$/, "")

  const dirFromPath = (value: string) => value.split("/").slice(0, -1).join("/")

  const updateQueryParams = ({
    dir,
    file,
  }: {
    dir?: string
    file?: string
  }) => {
    const next = new URL($page.url)
    if (file) next.searchParams.set("path", file)
    else next.searchParams.delete("path")
    if (dir) next.searchParams.set("dir", dir)
    else next.searchParams.delete("dir")
    const nextUrl = `${next.pathname}${next.search}${next.hash}`
    const currentUrl = `${$page.url.pathname}${$page.url.search}${$page.url.hash}`
    if (nextUrl !== currentUrl) {
      goto(nextUrl, {replaceState: true, keepfocus: true, noScroll: true})
    }
  }

  const setDirectory = (p: string) => {
    const normalized = normalizePath(p)
    if (normalized !== path) {
      path = normalized
    }
    selectedFile = null
    updateQueryParams({dir: normalized, file: undefined})
  }

  const openFile = (file: FileEntry) => {
    selectedFile = file
    const dir = dirFromPath(file.path)
    if (dir !== path) {
      path = dir
    }
    updateQueryParams({dir, file: file.path})
  }

  const closeFilePreview = () => {
    selectedFile = null
    updateQueryParams({dir: path, file: undefined})
  }

  const breadcrumbPath = $derived.by(() => selectedFile?.path || path)
  const breadcrumbSegments = $derived.by(() => {
    const normalized = normalizePath(breadcrumbPath)
    return normalized ? normalized.split("/") : []
  })
  const canGoUp = $derived.by(() => path.length > 0)
  const parentPath = $derived.by(() => (path ? dirFromPath(path) : ""))

  const urlSearch = $derived($page.url.search)

  $effect(() => {
    void urlSearch
    const fileParam = normalizePath($page.url.searchParams.get("path"))
    const dirParam = normalizePath($page.url.searchParams.get("dir"))
    autoOpenPath = fileParam || undefined
    path = fileParam ? dirFromPath(fileParam) : dirParam
    if (!fileParam) {
      selectedFile = null
    }
  })

  $effect(() => {
    if (!autoOpenPath) return
    const match = currentFiles.find(entry => entry.path === autoOpenPath)
    if (match && selectedFile?.path !== match.path) {
      selectedFile = match
    }
  })

  $effect(() => {
    if (selectedFile) {
      overlayFile = selectedFile
    }
  })

  $effect(() => {
    if (!selectedFile) {
      showOverlayScrollButton = false
    }
  })

  $effect(() => {
    const container = pageContainerRef
    if (!container) return
    scrollParent = container.closest(".scroll-container") as HTMLElement | null
  })

  $effect(() => {
    const scrollEl = scrollParent
    if (!scrollEl) return

    const handleScroll = () => {
      showScrollButton = scrollEl.scrollTop > 1500
    }

    handleScroll()
    scrollEl.addEventListener("scroll", handleScroll, {passive: true})
    return () => scrollEl.removeEventListener("scroll", handleScroll)
  })

  $effect(() => {
    const scrollEl = overlayScrollParent
    if (!scrollEl) return

    const handleScroll = () => {
      showOverlayScrollButton = scrollEl.scrollTop > 600
    }

    handleScroll()
    scrollEl.addEventListener("scroll", handleScroll, {passive: true})
    return () => scrollEl.removeEventListener("scroll", handleScroll)
  })

  const scrollToTop = () => {
    scrollParent?.scrollTo({top: 0, behavior: "smooth"})
  }

  const scrollOverlayToTop = () => {
    overlayScrollParent?.scrollTo({top: 0, behavior: "smooth"})
  }

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
    const refs = repoClass.refs;

    // Don't attempt to load files until we have a valid branch name
    // Branch should come from repo state event or git clone, not hardcoded
    const branchName = currentBranch?.split("/").pop();
    if (!branchName || !currentBranch || isCloning || path) return;
    if (!refs || refs.length === 0) return;
    const availableBranches = refs.filter(ref => ref.type === "heads").map(ref => ref.name);
    if (availableBranches.length > 0 && !availableBranches.includes(branchName)) return;

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
          const mapped = result.files.map(
            file =>
              ({
                name: file.path.split("/").pop() || file.path,
                path: file.path,
                type: file.type as "file" | "directory" | "submodule" | "symlink",
                oid: file.lastCommit,
              }) as FileEntry,
          )
          currentFiles = mapped
          return mapped
        })
        .catch((e) => {
          loading = false
          const message = e instanceof Error ? e.message : "Failed to load files"
          const activeBranch = selectedBranch?.split("/").pop()
          if (activeBranch && activeBranch !== branchName) return []
          if (availableBranches.length > 0 && !availableBranches.includes(branchName)) return []
          error = message
          console.error("❌ Failed to load files:", e);
          currentFiles = []
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
    const refs = repoClass.refs;

    // Don't attempt to load files until we have a valid branch name
    const branchName = currentBranch?.split("/").pop();
    if (!branchName || !currentPath || !currentBranch || isCloning) return;
    if (!refs || refs.length === 0) return;
    const availableBranches = refs.filter(ref => ref.type === "heads").map(ref => ref.name);
    if (availableBranches.length > 0 && !availableBranches.includes(branchName)) return;

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
          const mapped = result.files.map(
            file =>
              ({
                name: file.path.split("/").pop() || file.path,
                path: file.path,
                type: file.type as "file" | "directory" | "submodule" | "symlink",
                oid: file.lastCommit,
              }) as FileEntry,
          )
          currentFiles = mapped
          return mapped
        })
        .catch((e) => {
          loading = false
          const message = e instanceof Error ? e.message : "Failed to load files"
          const activeBranch = selectedBranch?.split("/").pop()
          if (activeBranch && activeBranch !== branchName) return []
          if (availableBranches.length > 0 && !availableBranches.includes(branchName)) return []
          error = message
          console.error("❌ Failed to load files:", e);
          currentFiles = []
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

<div class="hidden lg:flex items-center justify-between px-1 text-sm text-muted-foreground">
  <div class="flex min-w-0 items-center gap-2">
    {#if canGoUp}
      <button
        type="button"
        class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
        onclick={() => setDirectory(parentPath)}
        title="Up"
      >
        <ChevronLeft class="h-4 w-4" />
        <span class="hidden xl:inline">Up</span>
      </button>
    {/if}
    <nav class="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Breadcrumb">
      <button
        type="button"
        class="hover:text-foreground hover:underline transition-colors flex-shrink-0"
        onclick={() => setDirectory("")}
      >
        {repoClass.name}
      </button>
      {#each breadcrumbSegments as segment, i}
        <span class="text-muted-foreground/50 flex-shrink-0">/</span>
        {#if i === breadcrumbSegments.length - 1}
          <span class="text-foreground font-medium truncate max-w-[240px]" title={segment}>
            {segment}
          </span>
        {:else}
          <button
            type="button"
            class="hover:text-foreground hover:underline transition-colors truncate max-w-[240px]"
            onclick={() => setDirectory(breadcrumbSegments.slice(0, i + 1).join("/"))}
          >
            {segment}
          </button>
        {/if}
      {/each}
    </nav>
  </div>
</div>

<div class="mt-2 rounded-lg border border-border bg-card" data-component="code-browser" bind:this={pageContainerRef}>
  {#if isCloning}
    <div class="p-4 sm:p-6">
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
    </div>
  {:else}
    <div
      class={
        isBrowserOpen
          ? "grid lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]"
          : "grid lg:grid-cols-[48px_minmax(0,1fr)]"
      }
    >
      <div
        class={
          isBrowserOpen
            ? "border-b border-border lg:border-b-0 lg:border-r"
            : "border-b border-border lg:border-b-0 lg:border-r"
        }
      >
        <div class="p-2 sm:p-3" data-component="code-browser-list">
          {#if !isBrowserOpen}
            <div class="hidden lg:flex h-full items-start justify-center pt-2">
              <Button
                class="btn btn-ghost btn-sm"
                onclick={() => (isBrowserOpen = true)}
                title="Show files"
              >
                <PanelLeftOpen class="h-4 w-4" />
              </Button>
            </div>
          {:else}
            <div class="hidden lg:flex items-center justify-between pb-2">
              <span class="text-xs font-medium text-muted-foreground">Files</span>
              <Button
                class="btn btn-ghost btn-sm gap-2"
                onclick={() => (isBrowserOpen = false)}
                title="Hide files"
              >
                <PanelLeftClose class="h-4 w-4" />
                <span class="hidden xl:inline">Hide files</span>
              </Button>
            </div>
            {#if error}
              <div class="text-sm text-red-500">{error}</div>
            {:else}
            {#key files}
              <div transition:fade>
                {#await files}
                  <Spinner {loading}>Loading files...</Spinner>
                {:then fileEntries}
                  {#if fileEntries.length === 0}
                    <div class="text-sm text-muted-foreground">No files found in this branch.</div>
                  {:else}
                    <div class="flex flex-col">
                      {#each fileEntries as file (file.path)}
                        <FileView
                          {file}
                          {getFileContent}
                          {setDirectory}
                          {publish}
                          repo={repoClass}
                          displayMode="list"
                          showActions={false}
                          isActive={selectedFile?.path === file.path}
                          onSelectFile={openFile}
                        />
                      {/each}
                    </div>
                  {/if}
                {/await}
              </div>
            {/key}
          {/if}
          {/if}
        </div>
      </div>
      <div class="hidden lg:block p-3">
        {#if selectedFile}
          <FileView
            file={selectedFile}
            {getFileContent}
            {setDirectory}
            {publish}
            repo={repoClass}
            displayMode="viewer"
            autoOpenPath={autoOpenPath}
          />
        {:else}
          <div
            class="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border bg-background/40 text-sm text-muted-foreground"
          >
            Select a file to preview
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if selectedFile}
    <div
      class="fixed left-0 right-0 top-[calc(var(--sait)+3rem)] cb z-40 bg-background lg:hidden overflow-y-auto overscroll-contain"
      bind:this={overlayScrollParent}
      in:fly={{y: 24, duration: 200}}
      out:fly={{y: 24, duration: 200}}
      onoutroend={() => {
        if (!selectedFile) overlayFile = null
      }}
    >
      <div class="min-h-full">
        <div class="p-3">
          {#if overlayFile}
            <FileView
            file={overlayFile}
            {getFileContent}
            {setDirectory}
            {publish}
            repo={repoClass}
            displayMode="viewer"
            onClose={closeFilePreview}
            autoOpenPath={autoOpenPath}
          />
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if showScrollButton}
  <div in:fade class="chat__scroll-down">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToTop}>
      <Icon icon={AltArrowUp} />
    </Button>
  </div>
{/if}

{#if selectedFile && showOverlayScrollButton}
  <div class="chat__scroll-down z-50 lg:hidden" in:fade>
    <Button class="btn btn-circle btn-neutral" onclick={scrollOverlayToTop}>
      <Icon icon={AltArrowUp} />
    </Button>
  </div>
{/if}
