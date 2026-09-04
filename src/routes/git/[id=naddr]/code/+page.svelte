<script lang="ts">
  import {FileView, Input, type RepoCommunityOption} from "@nostr-git/ui"
  import {fade} from "svelte/transition"
  import {goto} from "$app/navigation"
  import {browser} from "$app/environment"
  import {CircleAlert, PanelLeftClose, PanelLeftOpen, Search} from "@lucide/svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import {type FileEntry, type PermalinkEvent} from "@nostr-git/core/types"
  import {filterValidCloneUrls} from "@nostr-git/core/utils"
  import {pushToast} from "@src/app/util/toast"
  import {notifyCorsProxyIssue} from "@app/util/git-cors-proxy"
  import {makeEventShareEntityForEvent} from "@app/util/event-share"
  import {createSearch, profilesByPubkey, pubkey} from "@welshman/app"
  import {getContext, hasContext} from "svelte"
  import {REPO_CLONE_URLS_KEY, REPO_KEY} from "@app/core/git-state"
  import {readable, type Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import {page} from "$app/stores"
  import RepoCollectModal from "@app/components/RepoCollectModal.svelte"
  import {clearModals, pushModal} from "@app/util/modal"
  import {activeUserCommunityRefs} from "@app/core/community-state"
  import {
    COMMUNITY_WRITE_TARGETS,
    communityWritableSectionsSupportTarget,
  } from "@app/core/community-permissions"
  import {
    publishPermalinkToDestinations,
    type PublicationDestinationSelection,
  } from "@app/util/permalink-publishing"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoCloneUrlsStore = hasContext(REPO_CLONE_URLS_KEY)
    ? getContext<Readable<string[]>>(REPO_CLONE_URLS_KEY)
    : readable<string[]>([])

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
  let isBrowserOpen = $state(true)
  let isDesktopViewport = $state(true)
  let fileSearchQuery = $state("")
  let debouncedFileSearchQuery = $state("")
  let lineWrapping = $state(false)
  let showScrollButton = $state(false)
  let scrollParent: HTMLElement | null = $state(null)
  let pageContainerRef: HTMLElement | undefined = $state()
  let fileSearchSource: FileEntry[] | null = null
  let fileSearchCache: {searchOptions: (query: string) => FileEntry[]} | null = null
  let fileLoadSeq = 0

  const FILE_SEARCH_DEBOUNCE_MS = 350

  let cloneCheckAttempted = $state(false)

  // Derive selectedBranch from repoClass to avoid circular effect dependencies.
  // Using $derived instead of $effect + $state prevents the read-write cycle
  // that was causing effect_update_depth_exceeded errors.
  const selectedBranch = $derived(repoClass.selectedBranch || repoClass.defaultBranch || "")
  const repoEventId = $derived.by(() => repoClass.repoEvent?.id || "")
  const repoLinkBasePath = $derived.by(() => {
    const repoNaddr = repoClass.repoEvent
      ? makeEventShareEntityForEvent(repoClass.repoEvent as any, {
          relays: [...repoClass.relays, ...((($page.data as any)?.naddrRelays || []) as string[])],
        })
      : ""

    return `/git/${repoNaddr || $page.params.id}`
  })
  const supportedCloneUrls = $derived.by(() =>
    filterValidCloneUrls(
      ($repoCloneUrlsStore.length > 0 ? $repoCloneUrlsStore : repoClass.cloneUrls) || [],
    ),
  )
  const supportedCloneUrlKey = $derived.by(() => supportedCloneUrls.join("|"))
  const repositoryContentUnavailable = $derived.by(() => {
    if (selectedBranch || !repoClass.isRefDiscoveryUnavailable) return false
    if (supportedCloneUrls.length === 0) return true

    const hasVendorApi = repoClass.vendorReadRouter?.hasVendorSupport(supportedCloneUrls) ?? false
    return hasVendorApi || cloneCheckAttempted
  })

  const normalizePath = (value: string | null | undefined) =>
    (value ?? "").replace(/^\/+/, "").replace(/\/+$/, "")

  const normalizeBranchRef = (value?: string | null) => {
    const raw = String(value || "").trim()
    if (!raw) return ""
    return raw
      .replace(/^ref:\s*refs\/heads\//i, "")
      .replace(/^refs\/heads\//, "")
      .replace(/^refs\/remotes\/origin\//, "")
      .replace(/^origin\//, "")
  }

  const dirFromPath = (value: string) => value.split("/").slice(0, -1).join("/")
  const selectedFileViewKey = $derived.by(() =>
    [
      normalizeBranchRef(selectedBranch),
      repoClass.branchChangeTrigger,
      selectedFile?.path || "",
    ].join(":"),
  )

  const normalizeSearchValue = (value: unknown) =>
    String(value ?? "")
      .toLocaleLowerCase()
      .trim()

  const filterFileEntries = (entries: FileEntry[]) => {
    const query = normalizeSearchValue(debouncedFileSearchQuery)
    if (!query) return entries

    if (fileSearchSource !== entries || !fileSearchCache) {
      fileSearchCache = createSearch(entries, {
        getValue: entry => entry.path,
        fuseOptions: {
          keys: ["name", "path"],
          threshold: 0.42,
          ignoreLocation: true,
          minMatchCharLength: 1,
          isCaseSensitive: false,
        },
      })
      fileSearchSource = entries
    }

    return fileSearchCache.searchOptions(query)
  }

  const mapFileListing = (result: {files: readonly any[]}): FileEntry[] =>
    result.files.map(
      file =>
        ({
          name: file.path.split("/").pop() || file.path,
          path: file.path,
          type: file.type as "file" | "directory" | "submodule" | "symlink",
          oid: file.lastCommit,
        }) as FileEntry,
    )

  const loadFilesForBranch = ({
    branchName,
    directory,
    repoEventId: expectedRepoEventId,
    cloneUrlKey: expectedCloneUrlKey,
  }: {
    branchName: string
    directory: string
    repoEventId: string
    cloneUrlKey: string
  }) => {
    const requestId = ++fileLoadSeq
    loading = true
    error = null

    const loadPromise = repoClass
      .listRepoFiles({
        branch: branchName,
        path: directory || undefined,
      })
      .then(result => {
        const activeBranch = normalizeBranchRef(selectedBranch)
        const isStale =
          requestId !== fileLoadSeq ||
          repoEventId !== expectedRepoEventId ||
          supportedCloneUrlKey !== expectedCloneUrlKey ||
          (activeBranch && activeBranch !== branchName)
        if (isStale) return []

        const mapped = mapFileListing(result)
        currentFiles = mapped
        loading = false
        error = null
        console.log("✅ Files loaded:", mapped.length, "files")
        return mapped
      })
      .catch(e => {
        const activeBranch = normalizeBranchRef(selectedBranch)
        const isStale =
          requestId !== fileLoadSeq ||
          repoEventId !== expectedRepoEventId ||
          supportedCloneUrlKey !== expectedCloneUrlKey ||
          (activeBranch && activeBranch !== branchName)
        if (isStale) return []

        loading = false
        const message = e instanceof Error ? e.message : "Failed to load files"
        error = message
        console.error("❌ Failed to load files:", e)
        currentFiles = []
        return []
      })

    files = loadPromise
    return loadPromise
  }

  const getCommunityOptionLabel = (communityPubkey: string) => {
    const profile = $profilesByPubkey.get(communityPubkey)
    return (
      profile?.display_name ||
      profile?.name ||
      `${communityPubkey.slice(0, 8)}...${communityPubkey.slice(-6)}`
    )
  }

  const permalinkCommunityOptions = $derived.by((): RepoCommunityOption[] =>
    $activeUserCommunityRefs
      .filter(ref =>
        communityWritableSectionsSupportTarget({
          definition: ref.definition,
          writableSections: ref.writableSections,
          target: COMMUNITY_WRITE_TARGETS.permalink,
        }),
      )
      .map(ref => ({
        ownerPubkey: ref.definition.ownerPubkey,
        address: ref.community.address,
        communityId: ref.community.communityId,
        label: getCommunityOptionLabel(ref.definition.ownerPubkey),
        relays: ref.definition.relays,
      })),
  )

  const updateQueryParams = ({dir, file}: {dir?: string; file?: string}) => {
    const next = new URL($page.url)
    if (file) next.searchParams.set("path", file)
    else next.searchParams.delete("path")
    if (dir) next.searchParams.set("dir", dir)
    else next.searchParams.delete("dir")
    const nextUrl = `${next.pathname}${next.search}${next.hash}`
    const currentUrl = `${$page.url.pathname}${$page.url.search}${$page.url.hash}`
    if (nextUrl !== currentUrl) {
      goto(nextUrl, {replaceState: true, keepFocus: true, noScroll: true})
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

  const showBrowserList = $derived.by(() => !isDesktopViewport || isBrowserOpen)

  const urlSearch = $derived($page.url.search)

  $effect(() => {
    if (!browser) return

    const media = window.matchMedia("(min-width: 768px)")
    const syncViewport = () => {
      isDesktopViewport = media.matches
    }

    syncViewport()
    media.addEventListener("change", syncViewport)

    return () => {
      media.removeEventListener("change", syncViewport)
    }
  })

  $effect(() => {
    const value = fileSearchQuery
    if (!value.trim()) {
      debouncedFileSearchQuery = ""
      return
    }

    const timeout = setTimeout(() => {
      debouncedFileSearchQuery = value
    }, FILE_SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  })

  $effect(() => {
    if (!isDesktopViewport) {
      isBrowserOpen = true
    }
  })

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

  let lastHandledBranchChangeTrigger = $state<number | undefined>(undefined)

  $effect(() => {
    const switchTrigger = repoClass.branchChangeTrigger

    if (lastHandledBranchChangeTrigger === undefined) {
      lastHandledBranchChangeTrigger = switchTrigger
      return
    }
    if (switchTrigger === lastHandledBranchChangeTrigger) return

    lastHandledBranchChangeTrigger = switchTrigger
    const branchName = normalizeBranchRef(selectedBranch)
    const currentRepoEventId = repoEventId
    const currentCloneUrlKey = supportedCloneUrlKey
    path = ""
    autoOpenPath = undefined
    selectedFile = null
    currentFiles = []
    fileSearchQuery = ""
    debouncedFileSearchQuery = ""

    if ($page.url.searchParams.has("dir") || $page.url.searchParams.has("path")) {
      updateQueryParams({dir: "", file: undefined})
    }

    if (branchName && currentRepoEventId && currentCloneUrlKey && !repoClass.isBranchSwitching) {
      void loadFilesForBranch({
        branchName,
        directory: "",
        repoEventId: currentRepoEventId,
        cloneUrlKey: currentCloneUrlKey,
      })
    } else {
      ++fileLoadSeq
      loading = false
      error = null
      files = Promise.resolve([])
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

  const scrollToTop = () => {
    scrollParent?.scrollTo({top: 0, behavior: "smooth"})
  }

  // Routed reads decide whether missing filter support justifies clone fallback.
  $effect(() => {
    if (!repoClass) return
    if (!repoEventId) return
    if (!repoClass.isInitialized) return
    if (repoClass.isRefsLoading) return
    if (!repoClass.key) return
    cloneCheckAttempted = true
  })

  // Load refs using the unified API - defer to avoid blocking render
  $effect(() => {
    if (repoClass.isInitialized && cloneCheckAttempted && selectedBranch) {
      // Defer ref loading to avoid blocking initial render
      const timeout = setTimeout(() => {
        repoClass.getAllRefsWithFallback().catch((err: Error) => {
          console.error("Failed to load repository references:", err)
          notifyCorsProxyIssue(err)
          // Don't show toast for transient worker initialization errors
          const errorMessage = err.message || String(err)
          if (
            !errorMessage.includes("Cannot read properties of undefined") &&
            !errorMessage.includes("Worker operation") &&
            !errorMessage.includes("apply")
          ) {
            pushToast({
              message: "Failed to load branches from git repository: " + errorMessage,
              theme: "error",
            })
          }
        })
      }, 100)

      return () => {
        clearTimeout(timeout)
      }
    }
  })

  $effect(() => {
    // Track branchChangeTrigger from Repo class to ensure effect re-runs after branch changes
    const currentBranch = selectedBranch
    const currentRepoEventId = repoEventId
    const currentCloneUrlKey = supportedCloneUrlKey
    const switchTrigger = repoClass.branchChangeTrigger // Increments when branch switch completes
    const cloneUrls = supportedCloneUrls
    const isSwitching = repoClass.isBranchSwitching

    // Don't attempt to load files until we have a valid branch name
    // Branch should come from repo state event or git clone, not hardcoded
    const branchName = normalizeBranchRef(currentBranch)
    if (!branchName || !currentBranch || isSwitching || path) return
    if (!currentRepoEventId || cloneUrls.length === 0) {
      loading = false
      return
    }

    // Show loading only when actually fetching
    loading = true
    error = null
    // Defer file loading slightly to avoid blocking render
    const timeout = setTimeout(() => {
      if (repoEventId !== currentRepoEventId || supportedCloneUrlKey !== currentCloneUrlKey) {
        loading = false
        return
      }

      console.log("🔄 Loading files for branch:", currentBranch, "trigger:", switchTrigger)
      void loadFilesForBranch({
        branchName,
        directory: "",
        repoEventId: currentRepoEventId,
        cloneUrlKey: currentCloneUrlKey,
      })
    }, 100)

    return () => {
      clearTimeout(timeout)
    }
  })

  $effect(() => {
    const currentBranch = selectedBranch
    const currentPath = path
    const currentRepoEventId = repoEventId
    const currentCloneUrlKey = supportedCloneUrlKey
    const switchTrigger = repoClass.branchChangeTrigger // Track branch switches via Repo class
    const cloneUrls = supportedCloneUrls
    const isSwitching = repoClass.isBranchSwitching

    // Don't attempt to load files until we have a valid branch name
    const branchName = normalizeBranchRef(currentBranch)
    if (!branchName || !currentPath || !currentBranch || isSwitching) return
    if (!currentRepoEventId || cloneUrls.length === 0) {
      loading = false
      return
    }

    loading = true
    error = null
    console.log(
      "🔄 Loading files for branch:",
      currentBranch,
      "path:",
      currentPath,
      "trigger:",
      switchTrigger,
    )
    void loadFilesForBranch({
      branchName,
      directory: currentPath,
      repoEventId: currentRepoEventId,
      cloneUrlKey: currentCloneUrlKey,
    })
  })

  const getFileContent = async (filePath: string) => {
    // Don't attempt to get file content without a valid branch
    const branchName = normalizeBranchRef(selectedBranch)
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
      return result
    } catch (e) {
      pushToast({
        message: "Failed to load file: " + e,
        theme: "error",
      })
      return ""
    }
  }

  const publish = async (permalink: PermalinkEvent) => {
    if (!$pubkey) {
      pushToast({message: "Sign in to publish permalinks", theme: "warning"})
      return false
    }

    return new Promise<boolean>(resolve => {
      pushModal(RepoCollectModal, {
        title: "Publish permalink",
        description: "Choose where this permalink should be saved or curated.",
        personalLabel: "Personal snippets",
        submitLabel: "Publish",
        submittingLabel: "Publishing...",
        communityOptions: permalinkCommunityOptions,
        onCancel: () => {
          clearModals()
          resolve(false)
        },
        onCollect: async (selection: PublicationDestinationSelection) => {
          try {
            const published = publishPermalinkToDestinations({
              permalink,
              relays: repoClass.relays,
              communityOptions: permalinkCommunityOptions,
              selection,
            })
            clearModals()

            if (!published) {
              pushToast({message: "No permalink was published", theme: "warning"})
              resolve(false)
              return
            }

            const nevent = makeEventShareEntityForEvent(published.event, {
              relays: published.relays,
            })
            await navigator.clipboard.writeText(nevent)
            pushToast({message: "Permalink copied to clipboard"})
            resolve(true)
          } catch (error) {
            clearModals()
            console.error("Failed to publish permalink", error)
            pushToast({message: "Failed to publish permalink", theme: "error"})
            resolve(false)
          }
        },
      })
    })
  }
</script>

<svelte:head>
  <title>{repoClass.name} - Code</title>
</svelte:head>

<div
  class="mt-2 rounded-lg border border-border bg-card"
  data-component="code-browser"
  data-testid="code-browser"
  bind:this={pageContainerRef}>
  {#if !isDesktopViewport && selectedFile}
    <div class="p-3 md:hidden">
      {#key selectedFileViewKey}
        <FileView
          file={selectedFile}
          {getFileContent}
          {setDirectory}
          {publish}
          repo={repoClass}
          linkBasePath={repoLinkBasePath}
          displayMode="viewer"
          bind:lineWrapping
          {autoOpenPath}
          onClose={closeFilePreview} />
      {/key}
    </div>
  {:else}
    <div
      class={showBrowserList
        ? "grid md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]"
        : "grid md:grid-cols-[48px_minmax(0,1fr)]"}>
      <div
        class={showBrowserList
          ? "border-b border-border md:border-b-0 md:border-r"
          : "border-b border-border md:border-b-0 md:border-r"}>
        <div class="p-2 sm:p-3" data-component="code-browser-list">
          {#if !showBrowserList}
            <div class="hidden h-full items-start justify-center pt-2 md:flex">
              <Button
                class="btn btn-ghost btn-sm"
                onclick={() => (isBrowserOpen = true)}
                title="Show files">
                <PanelLeftOpen class="h-4 w-4" />
              </Button>
            </div>
          {:else}
            <div class="hidden items-center justify-between pb-2 md:flex">
              <span class="text-xs font-medium text-muted-foreground">Files</span>
              <Button
                class="btn btn-ghost btn-sm gap-2"
                onclick={() => (isBrowserOpen = false)}
                title="Hide files">
                <PanelLeftClose class="h-4 w-4" />
                <span class="hidden xl:inline">Hide files</span>
              </Button>
            </div>
            <div class="relative pb-2">
              <Search
                class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search files..."
                bind:value={fileSearchQuery}
                class="h-9 pl-9"
                data-testid="code-browser-search" />
            </div>
            {#if repositoryContentUnavailable}
              <div class="rounded-md border border-border bg-muted/30 px-4 py-6 text-center">
                <CircleAlert class="mx-auto mb-3 h-6 w-6 text-warning" />
                <h3 class="font-medium">Repository content unavailable</h3>
                <p class="mt-2 text-sm text-muted-foreground">
                  Repository metadata was found, but no Git branches could be resolved from its
                  repository state or declared clone URLs.
                </p>
              </div>
            {:else if !selectedBranch}
              <div class="flex justify-center px-4 py-6">
                <Spinner loading>Resolving repository branches...</Spinner>
              </div>
            {:else if error}
              <div class="w-full min-w-0 max-w-full text-sm text-muted-foreground">
                Unable to load repository files from the declared clone URLs.
              </div>
            {:else}
              {#key files}
                <div transition:fade>
                  {#await files}
                    <Spinner {loading}>Loading files...</Spinner>
                  {:then fileEntries}
                    {@const visibleFileEntries = filterFileEntries(fileEntries)}
                    {#if fileEntries.length === 0}
                      <div class="text-sm text-muted-foreground">
                        No files found in this branch.
                      </div>
                    {:else if visibleFileEntries.length === 0}
                      <div class="text-sm text-muted-foreground">
                        No files match "{debouncedFileSearchQuery.trim()}".
                      </div>
                    {:else}
                      <div class="flex flex-col">
                        {#each visibleFileEntries as file (file.path)}
                          <FileView
                            {file}
                            {getFileContent}
                            {setDirectory}
                            {publish}
                            repo={repoClass}
                            linkBasePath={repoLinkBasePath}
                            displayMode="list"
                            showActions={false}
                            isActive={selectedFile?.path === file.path}
                            onSelectFile={openFile} />
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
      <div class="hidden p-3 md:block">
        {#if selectedFile}
          {#key selectedFileViewKey}
            <FileView
              file={selectedFile}
              {getFileContent}
              {setDirectory}
              {publish}
              repo={repoClass}
              linkBasePath={repoLinkBasePath}
              displayMode="viewer"
              bind:lineWrapping
              {autoOpenPath} />
          {/key}
        {:else}
          <div
            class="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border bg-background/40 text-sm text-muted-foreground">
            Select a file to preview
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToTop}>
      <Icon icon={AltArrowUp} />
    </Button>
  </div>
{/if}
