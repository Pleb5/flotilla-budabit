<script lang="ts">
  import {page} from "$app/stores"
  import {normalizeRelayUrl, NAMED_BOOKMARKS, makeEvent, Address} from "@welshman/util"
  import {
    repository,
    publishThunk,
    profilesByPubkey,
    tracker,
    profileSearch,
    loadProfile,
    relaySearch,
    pubkey,
  } from "@welshman/app"
  import {deriveEvents} from "@welshman/store"
  import {Router} from "@welshman/router"
  import {load} from "@welshman/net"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import GitItem from "@app/components/GitItem.svelte"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {decodeRelay} from "@app/core/state"
  import {goto} from "$app/navigation"
  import {onMount} from "svelte"
  import {derived as _derived, get as getStore} from "svelte/store"
  import {nip19, type NostrEvent} from "nostr-tools"
  import {
    GIT_REPO_ANNOUNCEMENT,
    parseRepoAnnouncementEvent,
    type BookmarkedRepo,
  } from "@nostr-git/shared-types"
  import {
    NewRepoWizard,
    Avatar,
    AvatarImage,
    AvatarFallback,
    RepoPicker,
    bookmarksStore,
    repositoriesStore,
    signer,
    RepoTab,
  } from "@nostr-git/ui"
  import {
    deriveRepoRefState,
    deriveMaintainersForEuc,
    loadRepoAnnouncements,
    derivePatchGraph,
  } from "@lib/budabit/state"
  import {getInitializedGitWorker} from "@src/lib/budabit/worker-singleton"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Bookmark from "@assets/icons/bookmark.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"

  const url = decodeRelay($page.params.relay)

  let loading = $state(true)

  // Initialize worker for Git operations
  // Note: Not using $state because Comlink proxies don't work well with Svelte reactivity
  let workerApi: any = null
  let workerInstance: Worker | null = null
  onMount(async () => {
    try {
      const {api, worker} = await getInitializedGitWorker()
      workerApi = api
      workerInstance = worker
      console.log("[+page.svelte] Worker API initialized successfully")
    } catch (error) {
      console.error("[+page.svelte] Failed to initialize worker:", error)
    }
  })

  // Normalize all relay URLs to avoid whitespace/trailing-slash/socket issues
  const bookmarkRelays = Array.from(
    new Set(
      [url, ...Router.get().FromUser().getUrls()].map(u => normalizeRelayUrl(u)).filter(Boolean),
    ),
  ) as string[]

  // Derive bookmarked addresses from the singleton bookmarksStore
  const bookmarkedAddresses = $derived(
    $bookmarksStore?.map(b => ({
      address: b.address,
      author: b.address.split(":")[1],
      identifier: b.address.split(":")[2],
      relayHint: b.relayHint,
    })) || [],
  )

  // Fetch actual repo events for bookmarked addresses
  const repos = $derived.by(() => {
    if (bookmarkedAddresses.length === 0) return undefined

    const authors = bookmarkedAddresses.map(b => b.author)
    const identifiers = bookmarkedAddresses.map(b => b.identifier)
    const relayHints = Array.from(
      new Set(bookmarkedAddresses.map(b => b.relayHint).filter(Boolean)),
    )

    const repoFilter = {kinds: [GIT_REPO_ANNOUNCEMENT], authors, "#d": identifiers}
    return _derived(deriveEvents(repository, {filters: [repoFilter]}), events => {
      if (events.length !== identifiers.length && relayHints.length > 0) {
        load({relays: relayHints, filters: [repoFilter]})
      }
      return events
    })
  })

  // Loaded bookmarked repos - combines bookmark addresses with actual repo events
  const loadedBookmarkedRepos = $derived.by(() => {
    if (!$repos || !bookmarkedAddresses.length) return []

    return $repos.map(repo => {
      let addressString = ""
      try {
        const address = Address.fromEvent(repo)
        addressString = address.toString()
      } catch (e) {
        // Fallback: manually construct address if Address.fromEvent fails
        const dTag = (repo.tags || []).find((t: string[]) => t[0] === "d")?.[1]
        if (dTag && repo.pubkey && repo.kind) {
          addressString = `${repo.kind}:${repo.pubkey}:${dTag}`
          // Manually constructed address
        } else {
          console.error(`[loadedBookmarkedRepos] Failed to create address for event ${repo.id}:`, e)
        }
      }

      const bookmarkInfo = bookmarkedAddresses.find(b => b.address === addressString)
      const relayHintFromEvent = Router.get().getRelaysForPubkey(repo.pubkey)?.[0]
      const hint = bookmarkInfo?.relayHint || relayHintFromEvent

      return {address: addressString, event: repo, relayHint: hint}
    })
  })

  // Update repositoriesStore whenever loadedBookmarkedRepos changes
  $effect(() => {
    if (loadedBookmarkedRepos.length > 0) {
      loading = false
      // Compute cards using the store's method
      const cards = repositoriesStore.computeCards(loadedBookmarkedRepos, {
        deriveMaintainersForEuc,
        deriveRepoRefState,
        derivePatchGraph,
        parseRepoAnnouncementEvent,
        Router,
        nip19,
        Address,
      })
      repositoriesStore.set(cards)
    } else {
      repositoriesStore.clear()
    }
  })

  const back = () => history.back()

  const onAddRepo = () => {
    // Open RepoPicker in a modal for editing followed repos
    try {
      // Inject closures matching ThunkFunction signature
      const fetchRepos = (evt: {filters: any[]; onResult: (events: any[]) => void}) => {
        const controller = new AbortController()
        const store = deriveEvents(repository, {filters: evt.filters})
        store.subscribe((events: any[]) => {
          evt.onResult(events as any[])
        })
        load({relays: bookmarkRelays, filters: evt.filters})
        return {controller}
      }
      const publishBookmarks = ({tags, relays}: {tags: string[][]; relays?: string[]}) => {
        const controller = new AbortController()
        const eventToPublish = makeEvent(NAMED_BOOKMARKS, {tags, content: ""})

        // Extract a-tags and update the bookmarks store immediately
        const aTags = tags.filter(t => t[0] === "a")
        const newBookmarks: BookmarkedRepo[] = aTags.map(([_, address, relayHint]) => ({
          address,
          event: null,
          relayHint: relayHint || "",
        }))

        bookmarksStore.set(newBookmarks)

        // Then publish to relays in the background
        const thunk = publishThunk({event: eventToPublish, relays: relays || bookmarkRelays})

        return {controller}
      }
      const makeRelayHint = (event: any) => {
        try {
          const relayTag = (event.tags || []).find((t: string[]) => t[0] === "relays")?.[1] || ""
          const fromTracker = Array.from(tracker.getRelays(event.id) || [])[0] || ""
          const fromPubkey = Router.get().getRelaysForPubkey(event.pubkey)?.[0] || ""
          return relayTag || fromTracker || fromPubkey || ""
        } catch {
          return ""
        }
      }
      pushModal(RepoPicker, {
        selectedRepos: loadedBookmarkedRepos,
        fetchRepos,
        publishBookmarks,
        filters: [{kinds: [30617]}],
        relays: bookmarkRelays,
        makeRelayHint,
        onClose: back,
      })
    } catch (e) {
      // Fallback to settings route if modal fails for any reason
      console.error("Failed to open RepoPicker modal:", e)
      goto("/settings/repos")
    }
  }

  let defaultRepoRelays = $state<string[]>([])
  $effect(() => {
    try {
      defaultRepoRelays = Router.get()
        .FromUser()
        .getUrls()
        .map(u => normalizeRelayUrl(u))
        .filter(Boolean) as string[]
    } catch (error) {
      console.warn("Failed to get default repo relays:", error)
      defaultRepoRelays = []
    }
  })

  const publishEventToRelays = (event: any, relays: string[] = defaultRepoRelays) => {
    try {
      console.log("🔐 publishing event to relays", event, relays)
      const result = publishThunk({event, relays})
      console.log("📡 Published event to relays:", result)
      return result
    } catch (err) {
      console.error("[git/+page] Failed to publish repo event", err)
      pushToast({message: `Failed to publish repository event: ${String(err)}`, theme: "error"})
      throw err
    }
  }

  const getProfileForWizard = async (pubkey: string) => {
    try {
      const map = getStore(profilesByPubkey)
      const existing = map?.get(pubkey)
      if (existing) {
        return {
          name: existing.name,
          picture: existing.picture,
          nip05: existing.nip05,
          display_name: existing.display_name,
        }
      }

      await loadProfile(pubkey, [])
      const refreshed = getStore(profilesByPubkey)?.get(pubkey)
      if (refreshed) {
        return {
          name: refreshed.name,
          picture: refreshed.picture,
          nip05: refreshed.nip05,
          display_name: refreshed.display_name,
        }
      }
    } catch (err) {
      console.error("[git/+page] Failed to load profile", pubkey, err)
    }
    return null
  }

  const searchProfilesForWizard = async (query: string) => {
    try {
      const searchStore = getStore(profileSearch)
      const pubkeys = searchStore?.searchValues?.(query) || []
      const map = getStore(profilesByPubkey)
      return pubkeys.map((pk: string) => {
        const profile = map?.get(pk)
        return {
          pubkey: pk,
          name: profile?.name,
          picture: profile?.picture,
          nip05: profile?.nip05,
          display_name: profile?.display_name,
        }
      })
    } catch (err) {
      console.error("[git/+page] Failed to search profiles", err)
      return []
    }
  }

  const searchRelaysForWizard = async (query: string) => {
    try {
      const relayStore = getStore(relaySearch)
      return relayStore?.searchValues?.(query) || []
    } catch (err) {
      console.error("[git/+page] Failed to search relays", err)
      return []
    }
  }

  const onNewRepo = async () => {
    // Ensure worker is initialized before opening wizard
    if (!workerApi || !workerInstance) {
      try {
        const {api, worker} = await getInitializedGitWorker()
        workerApi = api
        workerInstance = worker
        console.log("[+page.svelte] Worker initialized for new repo")
      } catch (error) {
        console.error("[+page.svelte] Failed to initialize worker:", error)
        return
      }
    }

    pushModal(
      NewRepoWizard,
      {
        workerApi, // Pass initialized worker API
        workerInstance, // Pass worker instance for event signing
        onRepoCreated: () => {
          // Reload repos by forcing bookmarks refresh and announcements
          loadRepoAnnouncements(bookmarkRelays)
        },
        onCancel: back,
        defaultRelays: [...defaultRepoRelays],
        userPubkey: $pubkey,
        onPublishEvent: async (repoEvent: NostrEvent) => {
          // For GRASP repos (kind 30617/30618), publish to the GRASP relay from the event's 'relays' tag
          let targetRelays = defaultRepoRelays

          // Check if this is a repo announcement or state event
          if (repoEvent.kind === 30617 || repoEvent.kind === 30618) {
            // Extract relay URLs from the 'relays' tag if present
            const relaysTag = repoEvent.tags?.find((t: any[]) => t[0] === "relays")
            if (relaysTag && relaysTag.length > 1) {
              // For GRASP events, publish to BOTH the GRASP relay AND default relays
              const graspRelays = relaysTag.slice(1)
              targetRelays = [...graspRelays, ...defaultRepoRelays]
              // Remove duplicates while preserving order
              targetRelays = [...new Set(targetRelays)]
              console.log(
                "🔐 Publishing GRASP event to GRASP relay + default relays:",
                targetRelays,
              )
            }
          }

          const result = publishEventToRelays(repoEvent, targetRelays)
        },
        getProfile: getProfileForWizard,
        searchProfiles: searchProfilesForWizard,
        searchRelays: searchRelaysForWizard,
      },
      {fullscreen: true},
    )
  }
</script>

<svelte:head>
  <title>Git Repositories</title>
</svelte:head>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={Git} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Git Repositories</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <nav class="w-full rounded-md bg-muted text-muted-foreground">
        <div class="scrollbar-hide flex overflow-x-auto">
          <div class="m-1 flex w-full min-w-max justify-evenly gap-1">
          </div>
        </div>
      </nav>
      <Button class="btn btn-secondary btn-sm" onclick={() => onNewRepo()}>
        <Icon icon={AddCircle} />
        New Repo
      </Button>
      <Button class="btn btn-primary btn-sm" onclick={() => onAddRepo()}>
        <Icon icon={Bookmark} />
        My Repos
      </Button>
      <Button class="btn btn-primary btn-sm" onclick={() => onAddRepo()}>
        <Icon icon={Git} />
        All Repos
      </Button>
    </div>
  {/snippet}
</PageBar>

<PageContent class="mt-4 flex flex-grow flex-col gap-2 overflow-auto p-2">
  <div>
    {#if loading}
      <p class="flex h-10 items-center justify-center py-20" out:fly>
        <Spinner {loading}>
          {#if loading}
            Looking for Your Git Repos...
          {:else if !$repos || $repos.length === 0}
            No Repos found.
          {/if}
        </Spinner>
      </p>
    {:else}
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {#each $repositoriesStore as g (g.repoNaddr || g.euc)}
          <div class="rounded-md border border-border bg-card p-3" in:fly>
            <!-- Use GitItem for consistent repo card rendering -->
            {#if g.first}
              <GitItem
                {url}
                event={g.first as any}
                showActivity={true}
                showIssues={true}
                showActions={true} />
            {/if}

            <!-- Maintainers avatars -->
            <div class="mt-3 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="flex -space-x-2">
                  {#each g.maintainers.slice(0, 4) as pk (pk)}
                    {@const prof = $profilesByPubkey.get(pk)}
                    <Avatar class="h-6 w-6 border" title={prof?.display_name || prof?.name || pk}>
                      <AvatarImage src={prof?.picture} alt={prof?.name || pk} />
                      <AvatarFallback
                        >{(prof?.display_name || prof?.name || pk)
                          .slice(0, 2)
                          .toUpperCase()}</AvatarFallback>
                    </Avatar>
                  {/each}
                  {#if g.maintainers.length > 4}
                    <div
                      class="grid h-6 w-6 place-items-center rounded-full border bg-muted text-[10px]">
                      +{g.maintainers.length - 4}
                    </div>
                  {/if}
                </div>
                <span class="text-xs opacity-60"
                  >{g.maintainers.length} maintainer{g.maintainers.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</PageContent>
