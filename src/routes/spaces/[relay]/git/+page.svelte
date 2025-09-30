<script lang="ts">
  import {page} from "$app/stores"
  import {Address, NAMED_BOOKMARKS, type TrustedEvent} from "@welshman/util"
  import {GIT_REPO, GIT_REPO_BOOKMARK_DTAG} from "@src/lib/util"
  import {repository} from "@welshman/app"
  import {publishThunk} from "@welshman/app"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {decodeRelay, shouldReloadRepos} from "@app/state"
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
    RepoAlertBadge,
    BranchSelector,
    Avatar,
    AvatarImage,
    AvatarFallback,
  } from "@nostr-git/ui"
  import type {RepoAnnouncementEvent} from "@nostr-git/shared-types"
  import {parseRepoAnnouncementEvent} from "@nostr-git/shared-types"
  import {GRASP_SET_KIND, DEFAULT_GRASP_SET_ID, parseGraspServersEvent} from "@nostr-git/core"
  import {nip19} from "nostr-tools"
  import {onMount} from "svelte"
  import {pushToast} from "@src/app/toast"
  import {profilesByPubkey} from "@welshman/app"
  import {
    deriveRepoRefState,
    deriveMaintainersForEuc,
    loadRepoAnnouncements,
    derivePatchGraph,
  } from "@app/state"

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

  const bookmarks = _derived(
    deriveEvents(repository, {filters: [bookmarkFilter]}),
    (events: TrustedEvent[]) => {
      if (events.length === 0) {
        load({relays: bookmarkRelays, filters: [bookmarkFilter]})
      }
      return events[0]
    },
  )

  const relaysOfAddresses = $state(new Map<string, string>())

  const repos = $derived.by(() => {
    if ($bookmarks) {
      const aTagList = getAddressTags($bookmarks.tags)
      const dTagValues: string[] = []
      const authors: string[] = []
      const relayHints: string[] = []
      aTagList.forEach(([_, value, relayHint]) => {
        dTagValues.push(value.split(":")[2])
        authors.push(value.split(":")[1])
        const normalizedHint = relayHint ? normalizeRelayUrl(relayHint) : ""
        relaysOfAddresses.set(value, normalizedHint)
        if (normalizedHint && !relayHints.includes(normalizedHint)) relayHints.push(normalizedHint)
      })
      const repoFilter = {kinds: [GIT_REPO], authors, "#d": dTagValues}
      return _derived(deriveEvents(repository, {filters: [repoFilter]}), events => {
        if (events.length !== dTagValues.length) {
          load({relays: relayHints, filters: [repoFilter]})
        }
        return events
      })
    }
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

  const loadedBookmarkedRepos = $derived.by(() => {
    if ($repos) {
      return $repos.map(repo => {
        const address = Address.fromEvent(repo)
        const addressString = address.toString()
        const relayHintFromEvent = Router.get().getRelaysForPubkey(repo.pubkey)?.[0]
        const hint = relaysOfAddresses.get(addressString) ?? relayHintFromEvent
        return {address: addressString, event: repo, relayHint: hint}
      })
    } else {
      return []
    }
  })

  onMount(() => {
    load({relays: bookmarkRelays, filters: [bookmarkFilter]})
    // Also load repo announcements (30617) so repoGroups can populate
    loadRepoAnnouncements(bookmarkRelays)
  })

  $effect(() => {
    if (loadedBookmarkedRepos.length > 0) {
      loading = false
    }
    if ($shouldReloadRepos) {
      $shouldReloadRepos = false
      load({relays: bookmarkRelays, filters: [bookmarkFilter]})
      loadRepoAnnouncements(bookmarkRelays)
    }
  })

  // Cache per-EUC derived stores to avoid creating too many listeners repeatedly
  const refStateStoreByEuc = new Map<string, ReturnType<typeof deriveRepoRefState>>()
  const maintainersStoreByEuc = new Map<string, ReturnType<typeof deriveMaintainersForEuc>>()
  const patchDagStoreByAddr = new Map<string, ReturnType<typeof derivePatchGraph>>()
  const groupCards = $derived.by(() => {
    // Only from loadedBookmarkedRepos
    const bookmarked = loadedBookmarkedRepos || []
    const byEuc = new Map<string, any>()
    for (const {event, relayHint} of bookmarked) {
      const t = (event.tags || []).find((t: string[]) => t[0] === "r" && t[2] === "euc")
      const euc = t ? t[1] : ""
      if (!euc) continue

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
        web: [],
        clone: [],
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
      if (!byEuc.has(euc)) byEuc.set(euc, card)
    }
    return Array.from(byEuc.values())
  })

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

  const back = () => history.back()

  const onAddRepo = () => {
    console.log("[git page] onAddRepo handler invoked")
    console.log("[git page] onAddRepo clicked")
    goto("/settings/repos")
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
        {#each groupCards as g (g.euc)}
          <div class="rounded-md border border-border bg-card p-3" in:fly>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <a
                  class="block truncate text-base font-semibold hover:underline"
                  href={g.principal
                    ? `/spaces/${$page.params.relay}/git/${g.principal}/${encodeURIComponent(g.title)}`
                    : undefined}>{g.title}</a>
                {#if g.description}
                  <div class="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                    {g.description}
                  </div>
                {/if}
                <div class="mt-2 flex items-center gap-2">
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
                </div>
              </div>
            </div>

            <div class="mt-2 flex flex-wrap gap-2 text-xs">
              {#if Object.keys(g.refs).length}
                <span class="badge badge-ghost">{Object.keys(g.refs).length} refs</span>
              {/if}
              {#if g.web?.length}
                <span class="badge badge-ghost">{g.web.length} web</span>
              {/if}
              {#if g.clone?.length}
                <span class="badge badge-ghost">{g.clone.length} clone</span>
              {/if}
              {#if g.rootsCount > 0}
                <span class="badge badge-ghost">{g.rootsCount} roots</span>
              {/if}
              {#if g.revisionsCount > 0}
                <span class="badge badge-ghost">{g.revisionsCount} revisions</span>
              {/if}
            </div>

            <div class="mt-3 flex items-center justify-between">
              <div class="text-xs opacity-60">{g.maintainers.length} maintainers</div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</PageContent>
