<script lang="ts">
  import {page} from "$app/stores"
  import {Address, NAMED_BOOKMARKS, type TrustedEvent, makeEvent} from "@welshman/util"
  import {GIT_REPO, GIT_REPO_BOOKMARK_DTAG} from "@src/lib/util"
  import {repository} from "@welshman/app"
  import {publishThunk} from "@welshman/app"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {decodeRelay} from "@app/state"
  import {pushModal, clearModals} from "@app/modal"
  import {goto} from "$app/navigation"
  import {load} from "@welshman/net"
  import {pubkey} from "@welshman/app"
  import {getAddressTags} from "@welshman/util"
  import {Router} from "@welshman/router"
  import {normalizeRelayUrl} from "@welshman/util"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {deriveEvents} from "@welshman/store"
  import {derived as _derived, get as getStore} from "svelte/store"
  import {
    NewRepoWizard,
    Avatar,
    AvatarImage,
    AvatarFallback,
  } from "@nostr-git/ui"
  import type {RepoAnnouncementEvent} from "@nostr-git/shared-types"
  import {parseRepoAnnouncementEvent} from "@nostr-git/shared-types"
  import {GRASP_SET_KIND, DEFAULT_GRASP_SET_ID, parseGraspServersEvent, resolveStatus} from "@nostr-git/core"
  import {nip19} from "nostr-tools"
  import {onMount} from "svelte"
  import {pushToast} from "@src/app/toast"
  import {profilesByPubkey, tracker} from "@welshman/app"
  import GitItem from "@app/components/GitItem.svelte"
  import { RepoPicker, bookmarksStore, type BookmarkedRepo } from "@nostr-git/ui"
  import {
    deriveRepoRefState,
    deriveMaintainersForEuc,
    loadRepoAnnouncements,
    derivePatchGraph,
    shouldReloadRepos,
  } from "@app/git-state"

  const url = decodeRelay($page.params.relay)

  let loading = $state(true)

  // Normalize all relay URLs to avoid whitespace/trailing-slash/socket issues
  const bookmarkRelays = Array.from(
    new Set(
      [url, ...Router.get().FromUser().getUrls()].map(u => normalizeRelayUrl(u)).filter(Boolean),
    ),
  ) as string[]

  const bookmarkFilter = {
    kinds: [NAMED_BOOKMARKS],
    "#d": [GIT_REPO_BOOKMARK_DTAG],
    authors: [$pubkey!],
  }

  // Load initial bookmarks from Welshman repository into our store
  const bookmarkEvents = _derived(
    deriveEvents(repository, {filters: [bookmarkFilter]}),
    (events: TrustedEvent[]) => {
      if (events.length === 0) {
        load({relays: bookmarkRelays, filters: [bookmarkFilter]})
        return undefined
      }
      // Return the event with the highest created_at (most recent)
      const latest = events.reduce((latest, current) => 
        (current.created_at > latest.created_at) ? current : latest
      )
      return latest
    },
  )

  // Derive bookmarked addresses from the singleton bookmarksStore
  const bookmarkedAddresses = $derived($bookmarksStore.map(b => ({
    address: b.address,
    author: b.address.split(":")[1],
    identifier: b.address.split(":")[2],
    relayHint: b.relayHint
  })))

  // Fetch actual repo events for bookmarked addresses
  const repos = $derived.by(() => {
    if (bookmarkedAddresses.length === 0) return undefined
    
    const authors = bookmarkedAddresses.map(b => b.author)
    const identifiers = bookmarkedAddresses.map(b => b.identifier)
    const relayHints = Array.from(new Set(bookmarkedAddresses.map(b => b.relayHint).filter(Boolean)))
    
    const repoFilter = {kinds: [GIT_REPO], authors, "#d": identifiers}
    return _derived(deriveEvents(repository, {filters: [repoFilter]}), events => {
      if (events.length !== identifiers.length && relayHints.length > 0) {
        load({relays: relayHints, filters: [repoFilter]})
      }
      return events
    })
  })

  // Load user's saved GRASP servers (profile settings) and expose as list of URLs
  const graspServersFilter = {
    kinds: [GRASP_SET_KIND],
    authors: [$pubkey!],
    "#d": [DEFAULT_GRASP_SET_ID],
  }

  const graspServersEvent = _derived(
    deriveEvents(repository, {filters: [graspServersFilter]}),
    (events: TrustedEvent[]) => {
      if (events.length === 0) {
        load({relays: Router.get().FromUser().getUrls(), filters: [graspServersFilter]})
      }
      return events[0]
    },
  )

  // Keep a reactive list of saved GRASP servers
  let graspServerUrls = $state<string[]>([])
  graspServersEvent.subscribe(ev => {
    try {
      graspServerUrls = ev ? (parseGraspServersEvent(ev as any) as string[]) : []
    } catch {
      graspServerUrls = []
    }
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

  onMount(() => {
    load({relays: bookmarkRelays, filters: [bookmarkFilter]})
    // Also load repo announcements (30617) so repoGroups can populate
    loadRepoAnnouncements(bookmarkRelays)
    
    // Subscribe to bookmark events and sync to bookmarksStore
    const unsubscribe = bookmarkEvents.subscribe((event) => {
      if (event) {
        const aTagList = getAddressTags(event.tags)
        const bookmarkedRepos: BookmarkedRepo[] = aTagList.map(([_, value, relayHint]) => ({
          address: value,
          event: null,
          relayHint: relayHint ? normalizeRelayUrl(relayHint) : ""
        }))
        bookmarksStore.set(bookmarkedRepos)
      }
    })
    
    return unsubscribe
  })

  $effect(() => {
    if (loadedBookmarkedRepos.length > 0) {
      loading = false
    }
    if ($shouldReloadRepos) {
      $shouldReloadRepos = false
      load({
        relays: bookmarkRelays, 
        filters: [bookmarkFilter]
      })
      
      // Reload repo announcements
      loadRepoAnnouncements(bookmarkRelays)
    }
  })
  

  // Cache per-EUC derived stores to avoid creating too many listeners repeatedly
  const refStateStoreByEuc = new Map<string, ReturnType<typeof deriveRepoRefState>>()
  const maintainersStoreByEuc = new Map<string, ReturnType<typeof deriveMaintainersForEuc>>()
  const patchDagStoreByAddr = new Map<string, ReturnType<typeof derivePatchGraph>>()
  
  // Helper to create composite key for proper fork/duplicate distinction
  function createRepoKey(event: any): string {
    const euc = (event.tags || []).find((t: string[]) => t[0] === "r" && t[2] === "euc")?.[1] || ""
    const d = (event.tags || []).find((t: string[]) => t[0] === "d")?.[1] || ""
    const name = (event.tags || []).find((t: string[]) => t[0] === "name")?.[1] || d || ""
    
    // Normalize clone URLs by:
    // 1. Remove .git suffix
    // 2. Remove trailing slashes
    // 3. Replace npub-specific paths with placeholder (for gitnostr.com, relay.ngit.dev, etc.)
    // 4. Lowercase and sort
    const cloneUrls = (event.tags || [])
      .filter((t: string[]) => t[0] === "clone")
      .flatMap((t: string[]) => t.slice(1))
      .map((url: string) => {
        let normalized = url.trim().toLowerCase().replace(/\.git$/, '').replace(/\/$/, '')
        // Replace npub paths with generic placeholder to group by repo name only
        normalized = normalized.replace(/\/npub1[a-z0-9]+\//g, '/{npub}/')
        return normalized
      })
      .sort()
      .join('|')
    return `${euc}:${name}:${cloneUrls}`
  }
  
  const groupCards = $derived.by(() => {
    // Only from loadedBookmarkedRepos
    const bookmarked = loadedBookmarkedRepos || []
    const byCompositeKey = new Map<string, any>()
    
    
    for (const {event, relayHint} of bookmarked) {
      // Try to find EUC tag, fall back to any r tag, or use event ID as last resort
      const eucTag = (event.tags || []).find((t: string[]) => t[0] === "r" && t[2] === "euc")
      const anyRTag = (event.tags || []).find((t: string[]) => t[0] === "r")
      const euc = eucTag?.[1] || anyRTag?.[1] || event.id || ""
      
      if (!euc) {
        continue
      }
      

      // Use composite key to distinguish forks from duplicates
      const compositeKey = createRepoKey(event)
      const d = (event.tags || []).find((t: string[]) => t[0] === "d")?.[1] || ""
      const name = (event.tags || []).find((t: string[]) => t[0] === "name")?.[1] || ""
      const cloneUrls = (event.tags || []).filter((t: string[]) => t[0] === "clone").map(t => t[1])
      
      // Extract event data
      const web = (event.tags || [])
        .filter((t: string[]) => t[0] === "web")
        .flatMap((t: string[]) => t.slice(1))
      const clone = (event.tags || [])
        .filter((t: string[]) => t[0] === "clone")
        .flatMap((t: string[]) => t.slice(1))
      
      // If we already have this repo, merge maintainers (duplicate announcement)
      if (byCompositeKey.has(compositeKey)) {
        const existing = byCompositeKey.get(compositeKey)
        // Add this event's author as maintainer if not already present
        if (event.pubkey && !existing.maintainers.includes(event.pubkey)) {
          existing.maintainers.push(event.pubkey)
        }
        // Merge web/clone URLs
        existing.web = Array.from(new Set([...existing.web, ...web]))
        existing.clone = Array.from(new Set([...existing.clone, ...clone]))
        continue
      }

      let mStore = maintainersStoreByEuc.get(euc)
      if (!mStore) {
        mStore = deriveMaintainersForEuc(euc)
        maintainersStoreByEuc.set(euc, mStore)
      }
      const maintainers = Array.from(mStore.get() || [])
      let rStore = refStateStoreByEuc.get(euc)
      if (!rStore) {
        rStore = deriveRepoRefState(euc)
        refStateStoreByEuc.set(euc, rStore)
      }
      const refs = rStore.get() || {}
      const first = event
      let title = euc
      let description = ""
      try {
        if (first) {
          const parsed = parseRepoAnnouncementEvent(first as unknown as RepoAnnouncementEvent)
          if (parsed?.name) title = parsed.name
          if (parsed?.description) description = parsed.description
        }
      } catch {}
      // Compute principal maintainer and naddr for navigation
      const principal = maintainers[0] || (first as any)?.pubkey || ""
      const repoNaddr = (() => {
        try {
          if (!principal || !title) return ""
          const relays = Router.get().FromPubkeys([principal]).getUrls()
          return nip19.naddrEncode({pubkey: principal, kind: 30617, identifier: title, relays})
        } catch {
          return ""
        }
      })()

      let rootsCount = 0
      let revisionsCount = 0
      try {
        if (first) {
          const addrA = Address.fromEvent(first).toString()
          let dStore = patchDagStoreByAddr.get(addrA)
          if (!dStore) {
            dStore = derivePatchGraph(addrA)
            patchDagStoreByAddr.set(addrA, dStore)
          }
          const dag: any = dStore.get()
          rootsCount = Array.isArray(dag?.roots)
            ? dag.roots.length
            : typeof dag?.nodeCount === "number"
              ? Math.min(1, dag.nodeCount)
              : 0
          revisionsCount = Array.isArray(dag?.rootRevisions)
            ? dag.rootRevisions.length
            : typeof dag?.edgesCount === "number"
              ? dag.edgesCount
              : 0
        }
      } catch {}
      const card = {
        euc,
        web: Array.from(new Set(web)),
        clone: Array.from(new Set(clone)),
        maintainers,
        refs,
        rootsCount,
        revisionsCount,
        title,
        description,
        first,
        principal,
        repoNaddr,
      }
      byCompositeKey.set(compositeKey, card)
    }
    
    const result = Array.from(byCompositeKey.values())
    return result
  })

  // Use groupCards directly - it already filters to bookmarked repos only
  const groupCardsToRender = $derived(groupCards)

  // Map first repo announcement per EUC for navigation using only bookmarks
  const firstRepoByEuc = $derived.by(() => {
    const map = new Map<string, TrustedEvent>()
    for (const {event} of loadedBookmarkedRepos || []) {
      const t = (event.tags || []).find((t: string[]) => t[0] === "r" && t[2] === "euc")
      const euc = t ? t[1] : ""
      if (!euc) continue
      if (!map.has(euc)) map.set(euc, event as any)
    }
    return map
  })

  // Inline alert markers per EUC (persist during session)
  const headChangedByEuc = new Set<string>()
  const hasGraspDelay = $derived.by(() => {
    try {
      // Reuse platform setting send_delay > 0 as proxy for GRASP delay
      const v = (window as any)?.flotilla?.settings?.send_delay
      return typeof v === "number" && v > 0
    } catch {
      return false
    }
  })

  function onHeadChange(euc: string, newRef: string) {
    try {
      headChangedByEuc.add(euc)
      pushToast({message: `HEAD switched to ${newRef}`})
    } catch {}
  }

  const back = () => {
    // Trigger reload when closing the modal
    $shouldReloadRepos = true
    clearModals()
  }

  const onAddRepo = () => {
    // Open RepoPicker in a modal for editing followed repos
    try {
      // Inject closures matching ThunkFunction signature
      const fetchRepos = (evt: { filters: any[]; onResult: (events: any[]) => void }) => {
        const controller = new AbortController()
        const store = deriveEvents(repository, { filters: evt.filters })
        store.subscribe((events: any[]) => {
          evt.onResult(events as any[])
        })
        load({ relays: bookmarkRelays, filters: evt.filters })
        return { controller }
      }
      const publishBookmarks = ({ tags, relays }: { tags: string[][]; relays?: string[] }) => {
        const controller = new AbortController()
        const eventToPublish = makeEvent(NAMED_BOOKMARKS, {tags, content: ""})
        
        // Extract a-tags and update the bookmarks store immediately
        const aTags = tags.filter(t => t[0] === 'a')
        const newBookmarks: BookmarkedRepo[] = aTags.map(([_, address, relayHint]) => ({
          address,
          event: null,
          relayHint: relayHint || ""
        }))
        
        bookmarksStore.set(newBookmarks)
        
        // Then publish to relays in the background
        const thunk = publishThunk({ event: eventToPublish, relays: relays || bookmarkRelays })
        
        thunk.result
          .then(() => {
            // Force reload from relays after a delay to get the new event
            setTimeout(() => {
              load({relays: relays || bookmarkRelays, filters: [bookmarkFilter]})
            }, 2000)
          })
          .catch((err) => {
            console.error('[git/+page] Failed to publish bookmarks:', err)
          })
          .finally(() => {
            controller.abort()
          })
        
        return { controller }
      }
      const makeRelayHint = (event: any) => {
        try {
          const relayTag = (event.tags || []).find((t: string[]) => t[0] === "relays")?.[1] || ""
          const fromTracker = Array.from(tracker.getRelays(event.id) || [])[0] || ""
          const fromPubkey = Router.get().getRelaysForPubkey(event.pubkey)?.[0] || ""
          return relayTag || fromTracker || fromPubkey || ""
        } catch { return "" }
      }
      pushModal(RepoPicker, {
        selectedRepos: loadedBookmarkedRepos,
        fetchRepos,
        publishBookmarks,
        filters: [{ kinds: [30617] }],
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

  const onNewRepo = () => {
    pushModal(NewRepoWizard, {onCancel: back})
  }
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon="git" />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Your Git Repositories</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <Button class="btn btn-secondary btn-sm" onclick={() => onNewRepo()}>
        <Icon icon="add-circle" />
        New Repo
      </Button>
      <Button class="btn btn-primary btn-sm" onclick={() => onAddRepo()}>
        <Icon icon="git" />
        Edit Repos
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
        {#each groupCardsToRender as g (g.repoNaddr || g.euc)}
          <div class="rounded-md border border-border bg-card p-3" in:fly>
            <!-- Use GitItem for consistent repo card rendering -->
            {#if g.first}
              <GitItem url={url} event={g.first as any} showActivity={true} showIssues={true} showActions={true} />
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
                <span class="text-xs opacity-60">{g.maintainers.length} maintainer{g.maintainers.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</PageContent>
