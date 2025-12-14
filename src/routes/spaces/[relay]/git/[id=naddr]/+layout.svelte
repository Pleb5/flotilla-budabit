<script lang="ts">
  import {RepoHeader, RepoTab, toast, bookmarksStore} from "@nostr-git/ui"
  import {ConfigProvider} from "@nostr-git/ui"
  import {FileCode, GitBranch, CircleAlert, GitPullRequest, GitCommit, Layers} from "@lucide/svelte"
  import {page} from "$app/stores"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import Avatar from "@lib/components/Avatar.svelte"
  import Profile from "@src/app/components/Profile.svelte"
  import ProfileLink from "@src/app/components/ProfileLink.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import Input from "@lib/components/Field.svelte"
  import Dialog from "@lib/components/Dialog.svelte"
  import {pushToast} from "@src/app/util/toast"
  import EventActions from "@src/app/components/EventActions.svelte"
  import ReactionSummary from "@src/app/components/ReactionSummary.svelte"
  import Markdown from "@src/lib/components/Markdown.svelte"
  import {pushModal} from "@app/util/modal"
  import {EditRepoPanel, ForkRepoDialog} from "@nostr-git/ui"
  import {postRepoAnnouncement} from "@lib/budabit/commands.js"
  import type {RepoAnnouncementEvent} from "@nostr-git/shared-types"
  import {GIT_REPO_BOOKMARK_DTAG, GRASP_SET_KIND, DEFAULT_GRASP_SET_ID, parseGraspServersEvent} from "@nostr-git/shared-types"
  import {derived as _derived, get as getStore} from "svelte/store"
  import {repository, pubkey, profilesByPubkey, profileSearch, loadProfile, relaySearch, publishThunk} from "@welshman/app"
  import {deriveEvents} from "@welshman/store"
  import {load} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {goto, afterNavigate, beforeNavigate} from "$app/navigation"
  import {normalizeRelayUrl, NAMED_BOOKMARKS, makeEvent, Address} from "@welshman/util"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import MenuSpaceButton from "@src/app/components/MenuSpaceButton.svelte"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  
  const {id, relay} = $page.params

  let {data, children} = $props()
  const {repoClass} = data

  let activeTab: string | undefined = $page.url.pathname.split("/").pop()
  const encodedRelay = encodeURIComponent(relay)

  // Refresh state
  let isRefreshing = $state(false)
  
  // Bookmark state
  let isTogglingBookmark = $state(false)
  let isBookmarked = $state(false)
  
  // Check if repo is bookmarked
  $effect(() => {
    if (!repoClass || !repoClass.repoEvent) return
    try {
      const address = repoClass.address || Address.fromEvent(repoClass.repoEvent).toString()
      const bookmarks = getStore(bookmarksStore)
      isBookmarked = bookmarks.some((b) => b.address === address)
    } catch {
      isBookmarked = false
    }
  })
  
  // Subscribe to bookmarks store to update bookmark status
  $effect(() => {
    const unsubscribe = bookmarksStore.subscribe(() => {
      if (!repoClass || !repoClass.repoEvent) return
      try {
        const address = repoClass.address || Address.fromEvent(repoClass.repoEvent).toString()
        const bookmarks = getStore(bookmarksStore)
        isBookmarked = bookmarks.some((b) => b.address === address)
      } catch {
        isBookmarked = false
      }
    })
    return unsubscribe
  })
  
  // Scroll position management
  let pageContentElement = $state<Element | undefined>()
  const scrollStorageKey = `repoScroll:${id}`

  // --- GRASP servers (user profile) ---
  const graspServersFilter = {
    kinds: [GRASP_SET_KIND],
    authors: [pubkey.get()!],
    "#d": [DEFAULT_GRASP_SET_ID],
  }

  // Helper to compute base path for this repo scope
  function repoBasePath() {
    return `/spaces/${encodeURIComponent(relay)}/git/${id}`
  }

  afterNavigate(({to}) => {
    try {
      if (!to) return

      if (to.route.id === "/spaces/[relay]/git/[id=naddr]/issues") {
        // Restore scroll position for issues page
        const savedScroll = sessionStorage.getItem(scrollStorageKey)
        if (savedScroll && pageContentElement) {
          const scrollPosition = parseInt(savedScroll, 10)
          // Double requestAnimationFrame ensures the scroll restoration happens after:
          // 1. First RAF: Schedule callback for next paint cycle
          // 2. Second RAF: Execute after that paint has completed and content is fully rendered
          // This prevents scroll jumping and ensures all issue cards are in the DOM
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (pageContentElement) {
                pageContentElement.scrollTop = scrollPosition
              }
            })
          })
        }
      }
    } catch {}
  })

  beforeNavigate(({from, to}) => {
    if (from?.route.id === "/spaces/[relay]/git/[id=naddr]/issues") {
      // Save scroll position when leaving issues page
      if (pageContentElement) {
        const scrollPosition = pageContentElement.scrollTop
        sessionStorage.setItem(scrollStorageKey, scrollPosition.toString())
      }
    }
  })

  const graspServersEvent = _derived(
    deriveEvents(repository, {filters: [graspServersFilter]}),
    events => {
      if (events.length === 0) {
        const relays = Router.get()
          .FromUser()
          .getUrls()
          .map(u => normalizeRelayUrl(u))
          .filter(Boolean)
        load({relays: relays as string[], filters: [graspServersFilter]})
      }
      return events[0]
    },
  )

  let graspServerUrls = $state<string[]>([])
  graspServersEvent.subscribe(ev => {
    try {
      graspServerUrls = ev ? (parseGraspServersEvent(ev as any) as string[]) : []
    } catch {
      graspServerUrls = []
    }
  })

  async function updateRepo() {
    if (!repoClass || isRefreshing) return

    // Validate repository state before attempting sync
    if (!repoClass.key) {
      console.warn("[updateRepo] Repository key not available, skipping sync")
      return
    }

    if (!repoClass.workerManager?.isReady) {
      console.warn("[updateRepo] WorkerManager not ready, skipping sync")
      return
    }

    isRefreshing = true

    try {
      // Get clone URLs from the repo event
      const cloneUrls = repoClass.cloneUrls
      if (cloneUrls.length === 0) {
        throw new Error("No clone URLs found for repository")
      }

      // Check if repository is cloned before attempting sync
      try {
        const isCloned = await repoClass.workerManager.isRepoCloned({
          repoId: repoClass.key
        })
        
        if (!isCloned) {
          console.log("[updateRepo] Repository not cloned yet, initializing first...")
          // Initialize the repository before syncing
          const initResult = await repoClass.workerManager.smartInitializeRepo({
            repoId: repoClass.key,
            cloneUrls,
            forceUpdate: false
          })
          
          if (!initResult.success) {
            // Handle CORS errors gracefully
            const errorMessage = initResult.error || "Initialization failed"
            if (initResult.corsError || 
                errorMessage.includes('CORS') || 
                errorMessage.includes('network restrictions') ||
                errorMessage.includes('security policies')) {
              console.warn("[updateRepo] Repository initialization failed due to CORS/network restrictions:", errorMessage)
              // Don't show toast for CORS errors, just return silently
              return
            }
            throw new Error(`Repository initialization failed: ${errorMessage}`)
          }
          
          console.log("[updateRepo] Repository initialized successfully")
        }
      } catch (initError) {
        console.warn("[updateRepo] Failed to check/initialize repository:", initError)
        // Check if this is a CORS/network error and don't show toast
        const errorMessage = initError instanceof Error ? initError.message : String(initError)
        if (errorMessage.includes('CORS') || 
            errorMessage.includes('NetworkError') || 
            errorMessage.includes('network restrictions') ||
            errorMessage.includes('security policies')) {
          // Don't show toast for CORS errors
          return
        }
        // Don't throw here, continue with sync attempt as it might still work
      }

      // Call syncWithRemote through the repo's worker manager
      const result = await repoClass.workerManager.syncWithRemote({
        repoId: repoClass.key,
        cloneUrls,
        branch: repoClass.selectedBranch,
      })

      if (!result.success) {
        // Check for specific error types that should be handled gracefully
        const errorMessage = result.error || "Sync failed"
        
        if (errorMessage.includes("No branches found") || 
            errorMessage.includes("Repository not cloned locally") ||
            errorMessage.includes("CORS") ||
            errorMessage.includes("NetworkError")) {
          console.warn("[updateRepo] Sync failed with expected error:", errorMessage)
          // Don't show toast for these common/expected errors
          return
        }
        
        throw new Error(errorMessage)
      }
      
      console.log("[updateRepo] Repository sync completed successfully")
    } catch (error) {
      console.error("Failed to refresh repository:", error)
      
      // Only show toast for unexpected errors, not network/CORS issues
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      if (!errorMessage.includes("CORS") && 
          !errorMessage.includes("NetworkError") && 
          !errorMessage.includes("No branches found") &&
          !errorMessage.includes("Repository not cloned")) {
        pushToast({
          message: `Failed to sync repository: ${errorMessage}`,
          theme: "error",
        })
      }
    } finally {
      isRefreshing = false
    }
  }

  // Refresh repository function
  async function refreshRepo() {
    if (!repoClass || isRefreshing) return

    isRefreshing = true

    try {
      // Get clone URLs from the repo event
      const cloneUrls = repoClass.cloneUrls
      if (cloneUrls.length === 0) {
        throw new Error("No clone URLs found for repository")
      }

      // Call syncWithRemote through the repo's worker manager
      const result = await repoClass.workerManager.syncWithRemote({
        repoId: repoClass.key,
        cloneUrls,
        branch: repoClass.mainBranch,
      })

      if (result.success) {
        // Show success toast
        pushToast({
          message: `Repository synced with remote (${result.headCommit?.slice(0, 8)})`,
        })

        // Reset the repo to refresh all cached data
        await repoClass.reset()
      } else {
        throw new Error(result.error || "Sync failed")
      }
    } catch (error) {
      console.error("Failed to refresh repository:", error)
      pushToast({
        message: `Failed to sync repository: ${error instanceof Error ? error.message : "Unknown error"}`,
        theme: "error",
      })
    } finally {
      isRefreshing = false
    }
  }

  function forkRepo() {
    if (!repoClass) return

    pushModal(ForkRepoDialog, {
      repo: repoClass,
      onPublishEvent: (event: any) => {
        // Handle event publishing
        postRepoAnnouncement(event, [])
      },
      graspServerUrls: graspServerUrls,
    })
  }

  function settingsRepo() {
    if (!repoClass) return
    pushModal(EditRepoPanel, {
      repo: repoClass,
      onPublishEvent: (event: RepoAnnouncementEvent) => {
        postRepoAnnouncement(event, repoClass.relays)
      },
      getProfile: async (pubkey: string) => {
        const profile = $profilesByPubkey.get(pubkey)
        if (profile) {
          return {
            name: profile.name,
            picture: profile.picture,
            nip05: profile.nip05,
            display_name: profile.display_name,
          }
        }
        // Try to load profile if not in cache
        await loadProfile(pubkey, repoClass.relays)
        const loadedProfile = $profilesByPubkey.get(pubkey)
        if (loadedProfile) {
          return {
            name: loadedProfile.name,
            picture: loadedProfile.picture,
            nip05: loadedProfile.nip05,
            display_name: loadedProfile.display_name,
          }
        }
        return null
      },
      searchProfiles: async (query: string) => {
        // profileSearch.searchValues returns an array of pubkeys (strings)
        const pubkeys = $profileSearch.searchValues(query)
        
        // Map each pubkey to a profile object by looking it up in profilesByPubkey
        return pubkeys.map((pubkey: string) => {
          const profile = $profilesByPubkey.get(pubkey)
          return {
            pubkey: pubkey,
            name: profile?.name,
            picture: profile?.picture,
            nip05: profile?.nip05,
            display_name: profile?.display_name,
          }
        })
      },
      searchRelays: async (query: string) => {
        // relaySearch.searchValues returns an array of relay URLs (strings)
        return $relaySearch.searchValues(query)
      },
    })
  }

  async function bookmarkRepo() {
    if (!repoClass || !$pubkey || isTogglingBookmark) return

    isTogglingBookmark = true

    try {
      if (!repoClass.repoEvent) {
        throw new Error("Repository event not available")
      }
      
      // Get repo address
      const address = repoClass.address || Address.fromEvent(repoClass.repoEvent).toString()
      
      // Get current bookmarks
      const currentBookmarks = getStore(bookmarksStore)
      
      // Determine relay hint
      const relayHint = repoClass.relays?.[0] || Router.get().getRelaysForPubkey(repoClass.repoEvent.pubkey)?.[0] || ""
      const normalizedRelayHint = relayHint ? normalizeRelayUrl(relayHint) : ""
      
      // Build tags array
      const tags: string[][] = [["d", GIT_REPO_BOOKMARK_DTAG]]
      
      if (isBookmarked) {
        // Remove bookmark: keep all bookmarks except this one
        currentBookmarks
          .filter((b) => b.address !== address)
          .forEach((b) => {
            const aTag: string[] = ["a", b.address]
            if (b.relayHint) {
              aTag.push(b.relayHint)
            }
            tags.push(aTag)
          })
      } else {
        // Add bookmark: keep all existing bookmarks and add this one
        currentBookmarks.forEach((b) => {
          const aTag: string[] = ["a", b.address]
          if (b.relayHint) {
            aTag.push(b.relayHint)
          }
          tags.push(aTag)
        })
        
        // Add the new bookmark
        const newATag: string[] = ["a", address]
        if (normalizedRelayHint) {
          newATag.push(normalizedRelayHint)
        }
        tags.push(newATag)
      }
      
      // Create and publish bookmark event
      const bookmarkEvent = makeEvent(NAMED_BOOKMARKS, { tags, content: "" })
      
      // Capture the action before updating store (for toast message)
      const wasRemoving = isBookmarked
      
      // Update store immediately for responsive UI
      if (isBookmarked) {
        bookmarksStore.remove(address)
      } else {
        bookmarksStore.add({
          address,
          event: null,
          relayHint: normalizedRelayHint,
        })
      }
      
      // Publish to relays
      const relaysToPublish = repoClass.relays.length > 0 
        ? repoClass.relays.map(normalizeRelayUrl).filter(Boolean)
        : Router.get().FromUser().getUrls().map(normalizeRelayUrl).filter(Boolean)
      
      publishThunk({ event: bookmarkEvent, relays: relaysToPublish })
      
      pushToast({
        message: wasRemoving ? "Bookmark removed" : "Repository bookmarked",
      })
    } catch (error) {
      console.error("Failed to toggle bookmark:", error)
      // Use the current isBookmarked state for error message (before any changes)
      const action = isBookmarked ? "remove" : "add"
      pushToast({
        message: `Failed to ${action} bookmark: ${error instanceof Error ? error.message : "Unknown error"}`,
        theme: "error",
      })
    } finally {
      isTogglingBookmark = false
    }
  }

  function overviewRepo() {
    if (!repoClass) return
    goto(`/spaces/${relay}/git/${id}/`)
  }

  // Connect the nostr-git toast store to the toast component
  $effect(() => {
    if ($toast.length > 0) {
      $toast.forEach(t => {
        // The toast store now handles format conversion internally
        pushToast({
          message:
            t.message ||
            (t.title && t.description
              ? `${t.title}: ${t.description}`
              : t.title || t.description || ""),
          timeout: t.timeout || t.duration,
          theme: t.theme || (t.variant === "destructive" ? "error" : undefined),
        })
      })
      toast.clear()
    }
  })

  const back = () => history.back()//goto(`/spaces/${relay}/git/`)
</script>

<svelte:head>
  <title>{repoClass?.name}</title>
</svelte:head>

<PageBar class="!mx-0 flex items-center my-2">
  {#snippet icon()}
    <div>
      <Button class="btn btn-neutral btn-sm flex-nowrap whitespace-nowrap" onclick={back}>
        <Icon icon={AltArrowLeft} />
        <span class="hidden sm:inline">Go back</span>
      </Button>
    </div>
  {/snippet}
  {#snippet title()}
    <h1 class="text-xl">{""}</h1>
  {/snippet}
  {#snippet action()}
    <div>
      <MenuSpaceButton url={id} />
    </div>
  {/snippet}
</PageBar>

<PageContent bind:element={pageContentElement} class="flex flex-grow flex-col gap-2 overflow-auto p-8">
  {#if repoClass === undefined}
    <div class="p-4 text-center">Loading repository...</div>
  {:else if !repoClass}
    <div class="p-4 text-center text-red-500">Repository not found.</div>
  {:else}
    <RepoHeader
      {repoClass}
      {activeTab}
      {refreshRepo}
      {isRefreshing}
      {forkRepo}
      {settingsRepo}
      {overviewRepo}
      {bookmarkRepo}
      {isBookmarked}
      isTogglingBookmark={isTogglingBookmark}
      userPubkey={$pubkey}
      >
      {#snippet children(activeTab: string)}
        <RepoTab
          tabValue="feed"
          label="Feed"
          href={`/spaces/${encodedRelay}/git/${id}/feed`}
          {activeTab}>
          {#snippet icon()}
            <FileCode class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="pipelines"
          label="Pipelines"
          href={`/spaces/${encodedRelay}/git/${id}/cicd`}
          {activeTab}>
          {#snippet icon()}
            <FileCode class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="code"
          label="Code"
          href={`/spaces/${encodedRelay}/git/${id}/code`}
          {activeTab}>
          {#snippet icon()}
            <GitBranch class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="issues"
          label="Issues"
          href={`/spaces/${encodedRelay}/git/${id}/issues`}
          {activeTab}>
          {#snippet icon()}
            <CircleAlert class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="patches"
          label="Patches"
          href={`/spaces/${encodedRelay}/git/${id}/patches`}
          {activeTab}>
          {#snippet icon()}
            <GitPullRequest class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="commits"
          label="Commits"
          href={`/spaces/${encodedRelay}/git/${id}/commits`}
          {activeTab}>
          {#snippet icon()}
            <GitCommit class="h-4 w-4" />
          {/snippet}
        </RepoTab>
      {/snippet}
    </RepoHeader>
    <ConfigProvider
      components={{
        AvatarImage: Avatar as typeof import("@nostr-git/ui").AvatarImage,
        Separator: Divider as typeof import("@nostr-git/ui").Separator,
        Input: Input as typeof import("@nostr-git/ui").Input,
        Alert: Dialog as typeof import("@nostr-git/ui").Alert,
        ProfileComponent: Profile as typeof import("@nostr-git/ui").Profile,
        ProfileLink: ProfileLink as typeof import("@nostr-git/ui").ProfileLink,
        EventActions: EventActions as typeof import("@nostr-git/ui").EventActions,
        ReactionSummary: ReactionSummary as typeof import("@nostr-git/ui").ReactionSummary,
        Markdown: Markdown as any,
      } as any}>
      {@render children()}
    </ConfigProvider>
  {/if}
</PageContent>
