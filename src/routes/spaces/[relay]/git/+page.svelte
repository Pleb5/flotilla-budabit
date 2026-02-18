<script lang="ts">
  import {page} from "$app/stores"
  import {normalizeRelayUrl, NAMED_BOOKMARKS, makeEvent, Address, getTagValue, type Filter} from "@welshman/util"
  import {
    repository,
    publishThunk,
    profilesByPubkey,
    tracker,
    profileSearch,
    loadProfile,
    relaySearch,
    pubkey,
    session,
    deriveProfile,
  } from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById, deriveEventsDesc} from "@welshman/store"
  import {Router} from "@welshman/router"
  import {load} from "@welshman/net"
  import {fly, staggeredFade} from "@lib/transition"
  import {fade} from "svelte/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import SpaceMenuButton from "@lib/budabit/components/SpaceMenuButton.svelte"
  import GitItem from "@app/components/GitItem.svelte"
  import {pushModal, clearModals} from "@app/util/modal"
  import {pushToast, popToast} from "@app/util/toast"
  import {notifications} from "@app/util/notifications"
  import {decodeRelay} from "@app/core/state"
  import {goto} from "$app/navigation"
  import {onMount} from "svelte"
  import {derived as _derived, get as getStore} from "svelte/store"
  import {nip19, type NostrEvent} from "nostr-tools"
  import {
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_STATE,
    createRepoStateEvent,
    parseRepoAnnouncementEvent,
    type BookmarkAddress,
    type RepoAnnouncementEvent,
    type RepoStateEvent,
  } from "@nostr-git/core/events"
  import {filterValidCloneUrls} from "@nostr-git/core/utils"
  import {GIT_PERMALINK} from "@nostr-git/core/types"
  import {
    Avatar,
    AvatarImage,
    AvatarFallback,
    bookmarksStore,
    repositoriesStore,
    Tabs,
    TabsList,
    TabsTrigger,
    EventRenderer,
    toast,
  } from "@nostr-git/ui"
  import NewRepoWizardWrapper from "@app/components/NewRepoWizardWrapper.svelte"
  import BranchStateSyncModal from "@app/components/BranchStateSyncModal.svelte"
  import RepoPickerWrapper from "@app/components/RepoPickerWrapper.svelte"
  import ImportRepoDialogWrapper from "@app/components/ImportRepoDialogWrapper.svelte"
  import type {ImportResult, NewRepoResult} from "@nostr-git/ui"
  import type {NostrFilter} from "@nostr-git/core"
  import {
    deriveRepoRefState,
    deriveMaintainersForEuc,
    loadRepoAnnouncements,
    derivePatchGraph,
    deriveNaddrEvent,
    GIT_RELAYS,
    getRepoAnnouncementRelays,
  } from "@lib/budabit/state"
  import {getInitializedGitWorker} from "@src/lib/budabit/worker-singleton"
  import {createNip98AuthHeader} from "@src/lib/budabit/event-io"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Bookmark from "@assets/icons/bookmark.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import FolderWithFiles from "@assets/icons/folder-with-files.svg?dataurl"
  import Download from "@assets/icons/download.svg?dataurl"
  import Code from "@assets/icons/code.svg?dataurl"
  import {makeGitPath} from "@src/lib/budabit"
  import {
    type BranchChange,
    diffBranchHeads,
    buildBranchUpdateDedupeKey,
    overlayLatestRepoStates,
  } from "@src/lib/budabit/branch-update"

  const url = decodeRelay($page.params.relay!)

  const gitPath = makeGitPath(url)

  // Derive current user's profile for git commit author info
  const userProfile = $derived($pubkey ? deriveProfile($pubkey) : null)
  
  // Helper to generate author email from nip-05 or npub
  const getAuthorEmail = (profile: any, pk: string | null | undefined) => {
    if (profile?.nip05) return profile.nip05
    if (pk) {
      try {
        const npub = nip19.npubEncode(pk)
        return `${npub.slice(0, 12)}@nostr.git`
      } catch {
        return `${pk.slice(0, 12)}@nostr.git`
      }
    }
    return ""
  }
  
  // Helper to get author name from profile
  const getAuthorName = (profile: any) => {
    return profile?.display_name || profile?.name || "Anonymous"
  }

  // Connect the nostr-git toast store to the app toast component
  $effect(() => {
    const unsubscribe = toast.subscribe((toasts) => {
      if (toasts.length > 0) {
        toasts.forEach(t => {
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

    return () => {
      unsubscribe()
    }
  })

  const getPermalinkTagValue = (evt: NostrEvent, name: string) =>
    evt.tags?.find(tag => tag[0] === name)?.[1] || ""

  const getPermalinkTagValueAny = (evt: NostrEvent, names: string[]) => {
    for (const name of names) {
      const value = getPermalinkTagValue(evt, name)
      if (value) return value
    }
    return ""
  }

  const getSnippetFilePath = (evt: NostrEvent) =>
    getPermalinkTagValueAny(evt, ["file", "path", "f"]) || getPermalinkTagValue(evt, "p")

  const repoHasNotifications = (event: RepoAnnouncementEvent) => {
    let naddr = ""
    try {
      naddr = Address.fromEvent(event).toNaddr()
    } catch {
      return false
    }
    const base = makeGitPath(url, naddr)
    return $notifications.has(`${base}/issues`) || $notifications.has(`${base}/patches`)
  }

  const isDeletedRepoAnnouncement = (event?: {tags?: string[][]} | null) =>
    (event?.tags || []).some(tag => tag[0] === "deleted")

  type RepoBranchUpdate = {
    repoId: string
    repoName: string
    cloneUrl: string
    relays: string[]
    headBranch?: string
    updates: BranchChange[]
    refs: Array<{type: "heads"; name: string; commit: string}>
  }

  type ServerRef = {
    ref?: string
    oid?: string
    symref?: string
    target?: string
  }

  let loading = $state(true)
  let activeTab = $state<"my-repos" | "bookmarks" | "snippets">("my-repos")
  let searchQuery = $state("")
  // Track when cards are ready to be shown (after all repos have loaded)
  let cardsReady = $state(false)
  // Debounce timer for settling repo count before showing cards
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let lastRepoCount = $state(0)
  let snippetsLoadedFor = $state<string | null>(null)
  let repoStateLoadKey = $state("")
  let myRepoStateEvents = $state<RepoStateEvent[]>([])
  let optimisticRepoStates = $state<Record<string, RepoStateEvent>>({})
  let repoStateSettled = $state(false)
  let repoStateSettleTimer: ReturnType<typeof setTimeout> | null = null
  // Per-page-load guard (reset on refresh/navigation remount)
  let branchUpdateCheckDone = $state(false)
  let branchUpdateChecking = $state(false)
  let pendingBranchUpdates = $state<RepoBranchUpdate[]>([])
  let branchUpdateToastLastKey = ""
  let branchUpdateToastId: string | null = null
  const logBranchUpdate = (message: string, details?: unknown) => {
    if (details === undefined) {
      console.warn(`[branch-update] ${message}`)
    } else {
      console.warn(`[branch-update] ${message}`, details)
    }
  }

  // Initialize worker for Git operations
  // Note: Not using $state because Comlink proxies don't work well with Svelte reactivity
  let workerApi: any = null
  let workerInstance: Worker | null = null
  let workerReady = $state(false)
  onMount(async () => {
    try {
      const {api, worker} = await getInitializedGitWorker()
      workerApi = api
      workerInstance = worker
      workerReady = true
      console.log("[+page.svelte] Worker API initialized successfully")
    } catch (error) {
      console.error("[+page.svelte] Failed to initialize worker:", error)
      workerReady = false
    }

    branchUpdateCheckDone = false
    logBranchUpdate("session start: check flag reset for this page load")
    branchUpdateToastLastKey = ""
    logBranchUpdate("toast dedupe key reset for this page load")

    // Load my repos on mount
    if ($pubkey) {
      const filter = {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [$pubkey]}
      load({relays: repoAnnouncementRelays, filters: [filter]})
    }
  })

  $effect(() => {
    if (!$pubkey) return
    if (!repoAnnouncementRelays.length) return
    const filter = {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [$pubkey]}
    load({relays: repoAnnouncementRelays, filters: [filter]})
  })

  $effect(() => {
    if (activeTab !== "snippets") return
    if (!$pubkey) return
    if (snippetsLoadedFor === $pubkey) return
    const filter = {kinds: [GIT_PERMALINK], authors: [$pubkey]} as Filter
    load({relays: bookmarkRelays, filters: [filter]})
    snippetsLoadedFor = $pubkey
  })

  // Normalize all relay URLs to avoid whitespace/trailing-slash/socket issues
  // Include GIT_RELAYS to ensure we fetch repos from git-specific relays
  const bookmarkRelays = Array.from(
    new Set(
      [url, ...Router.get().FromUser().getUrls(), ...GIT_RELAYS].map(u => normalizeRelayUrl(u)).filter(Boolean),
    ),
  ) as string[]

  // Repo announcements should always be fetched from user outbox + GIT_RELAYS
  let repoAnnouncementRelays = $state<string[]>([])
  $effect(() => {
    repoAnnouncementRelays = getRepoAnnouncementRelays()
  })

  const normalizeBookmarks = (value: unknown): BookmarkAddress[] => {
    if (!value) return []
    if (Array.isArray(value)) return value as BookmarkAddress[]
    return []
  }

  const toBookmarkAddresses = (bookmarks: BookmarkAddress[]): BookmarkAddress[] =>
    bookmarks.map(
      (b: BookmarkAddress): BookmarkAddress => ({
        address: b.address,
        author: b.address.split(":")[1] || "",
        identifier: b.address.split(":")[2] || "",
        relayHint: b.relayHint,
      }),
    )

  const bookmarkedAddresses = $derived.by((): BookmarkAddress[] => {
    const bookmarks = normalizeBookmarks($bookmarksStore)
    return toBookmarkAddresses(bookmarks)
  })

  const hasBookmarkedAddresses = $derived(bookmarkedAddresses.length > 0)

  // Fetch actual repo events for bookmarked addresses
  const attemptedBookmarkLoads = new Set<string>()

  const repos = $derived.by(() => {
    if (!hasBookmarkedAddresses) return undefined

    const addresses = toBookmarkAddresses(normalizeBookmarks($bookmarksStore))
    if (addresses.length === 0) return undefined

    const authors = addresses.map(b => b.author)
    const identifiers = addresses.map(b => b.identifier)
    const relayHints = Array.from(
      new Set(addresses.map(b => b.relayHint).filter((hint): hint is string => Boolean(hint))),
    )

    const repoFilter = {kinds: [GIT_REPO_ANNOUNCEMENT], authors, "#d": identifiers}
    const loadKey = `${authors.join(",")}|${identifiers.join(",")}`

    return _derived(deriveEventsDesc(deriveEventsById({repository, filters: [repoFilter]})), events => {
      if (events.length !== identifiers.length) {
        if (!attemptedBookmarkLoads.has(loadKey)) {
          attemptedBookmarkLoads.add(loadKey)
          const relaysToQuery = repoAnnouncementRelays.length > 0 ? repoAnnouncementRelays : GIT_RELAYS
          if (relaysToQuery.length > 0) {
            load({relays: relaysToQuery, filters: [repoFilter]})
          } else {
            loadRepoAnnouncements()
          }
        }
      }
      return events
    })
  })

  // Loaded bookmarked repos - combines bookmark addresses with actual repo events
  const loadedBookmarkedRepos = $derived.by(() => {
    if (!$repos || !hasBookmarkedAddresses) return []

    const addresses = toBookmarkAddresses(normalizeBookmarks($bookmarksStore))
    if (addresses.length === 0) return []

    return ($repos as any[]).map((repo: RepoAnnouncementEvent) => {
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

      if (addressString) {
        const latest = repository.getEvent(addressString) as RepoAnnouncementEvent | undefined
        if (latest && isDeletedRepoAnnouncement(latest)) {
          return null
        }
      }

      const bookmarkInfo = addresses.find(b => b.address === addressString)
      const relayHintFromEvent = Router.get().getRelaysForPubkey(repo.pubkey)?.[0]
      const hint = bookmarkInfo?.relayHint || relayHintFromEvent

      return {address: addressString, event: repo, relayHint: hint}
    }).filter(
      (item): item is {address: string; event: RepoAnnouncementEvent; relayHint: string} =>
        Boolean(item),
    )
  })

  const myReposEvents = $derived.by(() => {
    if (!$pubkey) return undefined
    const filter = {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [$pubkey]} as any
    return deriveEventsDesc(deriveEventsById({repository, filters: [filter]}))
  })

  const latestMyRepos = $derived.by(() => {
    if (!$myReposEvents || !$pubkey) return []
    const repoIds = new Set<string>()
    for (const repo of $myReposEvents as RepoAnnouncementEvent[]) {
      const repoId = getTagValue("d", repo.tags) || ""
      if (repoId) repoIds.add(repoId)
    }

    const latest: Array<{address: string; event: RepoAnnouncementEvent; relayHint: string}> = []
    for (const repoId of repoIds) {
      const address = `${GIT_REPO_ANNOUNCEMENT}:${$pubkey}:${repoId}`
      const event = repository.getEvent(address) as RepoAnnouncementEvent | undefined
      if (!event) continue
      if (isDeletedRepoAnnouncement(event)) continue

      let addressString = ""
      try {
        const parsedAddress = Address.fromEvent(event)
        addressString = parsedAddress.toString()
      } catch {
        addressString = address
      }

      const relayHintFromEvent = Router.get().getRelaysForPubkey(event.pubkey)?.[0]
      latest.push({address: addressString, event, relayHint: relayHintFromEvent || ""})
    }

    return latest
  })

  const hasMyRepoNotifications = $derived.by(() =>
    latestMyRepos.some(repo => repoHasNotifications(repo.event as RepoAnnouncementEvent)),
  )

  const hasBookmarkNotifications = $derived.by(() =>
    loadedBookmarkedRepos.some(repo => repoHasNotifications(repo.event as RepoAnnouncementEvent)),
  )

  const myRepoIds = $derived.by(() => {
    if (!latestMyRepos || latestMyRepos.length === 0) return []
    const ids = new Set<string>()
    for (const repo of latestMyRepos) {
      try {
        const parsed = parseRepoAnnouncementEvent(repo.event as RepoAnnouncementEvent)
        if (parsed.repoId) ids.add(parsed.repoId)
      } catch (error) {
        console.warn("[git/+page] Failed to parse repo announcement for state lookup:", error)
      }
    }
    return Array.from(ids)
  })

  const myRepoRelays = $derived.by(() => {
    if (!latestMyRepos || latestMyRepos.length === 0) return []
    const relays = new Set<string>()
    for (const repo of latestMyRepos) {
      try {
        const parsed = parseRepoAnnouncementEvent(repo.event as RepoAnnouncementEvent)
        for (const relay of parsed.relays || []) {
          const normalized = normalizeRelayUrl(relay)
          if (normalized) relays.add(normalized)
        }
      } catch (error) {
        console.warn("[git/+page] Failed to parse repo announcement relays:", error)
      }
    }
    return Array.from(relays)
  })

  const branchStateRelays = $derived.by(() => {
    const relays = new Set<string>()
    for (const relay of [...myRepoRelays, ...GIT_RELAYS]) {
      const normalized = normalizeRelayUrl(relay)
      if (normalized) relays.add(normalized)
    }
    return Array.from(relays)
  })

  $effect(() => {
    if (!$pubkey || myRepoIds.length === 0) {
      myRepoStateEvents = []
      optimisticRepoStates = {}
      return
    }
    const filter = {kinds: [GIT_REPO_STATE], authors: [$pubkey], "#d": myRepoIds} as Filter
    const store = deriveEventsDesc(deriveEventsById({repository, filters: [filter]}))
    const unsubscribe = store.subscribe(events => {
      myRepoStateEvents = events as RepoStateEvent[]
    })
    return () => unsubscribe()
  })

  const latestMyRepoStates = $derived.by(() => {
    const map = new Map<string, RepoStateEvent>()
    for (const ev of myRepoStateEvents) {
      const repoId = getTagValue("d", ev.tags) || ""
      if (!repoId || map.has(repoId)) continue
      map.set(repoId, ev)
    }
    return overlayLatestRepoStates(map, optimisticRepoStates)
  })

  $effect(() => {
    if (!$pubkey) return
    if (myRepoIds.length === 0) {
      repoStateSettled = false
      logBranchUpdate("repo-state unset: no repo ids yet")
      return
    }
    const ids = [...myRepoIds].sort()
    const relayKey = [...branchStateRelays].sort().join(",")
    const key = `${$pubkey}:${ids.join(",")}:${relayKey}`
    if (repoStateLoadKey === key) return
    repoStateLoadKey = key
    repoStateSettled = false
    logBranchUpdate("repo-state settle timer armed", {key, waitMs: 2500})
    if (repoStateSettleTimer) {
      clearTimeout(repoStateSettleTimer)
      repoStateSettleTimer = null
    }
    repoStateSettleTimer = setTimeout(() => {
      repoStateSettled = true
      repoStateSettleTimer = null
      logBranchUpdate("repo-state settled")
    }, 2500)
    const filter = {kinds: [GIT_REPO_STATE], authors: [$pubkey], "#d": ids} as Filter
    const relays = branchStateRelays
    load({relays, filters: [filter]})
  })

  const mySnippetsEvents = $derived.by(() => {
    if (!$pubkey) return undefined
    const filter = {kinds: [GIT_PERMALINK], authors: [$pubkey]} as Filter
    return deriveEventsDesc(deriveEventsById({repository, filters: [filter]}))
  })

  const snippets = $derived.by(() => ($mySnippetsEvents ? ($mySnippetsEvents as NostrEvent[]) : []))

  const snippetQuery = $derived.by(() => searchQuery.trim().toLowerCase())

  const filteredSnippets = $derived.by(() => {
    const items = snippets
    if (activeTab !== "snippets") return items
    if (!snippetQuery) return items
    return items.filter(evt => {
      const haystack = [
        getPermalinkTagValue(evt, "a"),
        getPermalinkTagValue(evt, "repo"),
        getPermalinkTagValue(evt, "commit"),
        getPermalinkTagValue(evt, "parent-commit"),
        getSnippetFilePath(evt),
        evt.content,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(snippetQuery)
    })
  })


  // Reset cardsReady when tab changes to trigger fresh animation
  $effect(() => {
    const tab = activeTab
    cardsReady = false
    lastRepoCount = 0
    // Clear any pending settle timer
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  })

  // Filter repos based on active tab
  const filteredRepos = $derived.by(() => {
    if (activeTab === "snippets") {
      return []
    }
    if (activeTab === "bookmarks") {
      return loadedBookmarkedRepos
    } else {
      return latestMyRepos
    }
  })

  // Detect if search query is a URI (naddr or nostr:naddr)
  const isUriSearch = $derived.by(() => {
    if (activeTab === "snippets") return false
    const trimmed = searchQuery.trim()
    return trimmed.startsWith("naddr1") || trimmed.startsWith("nostr:naddr1")
  })

  // Extract naddr from search query (handle both naddr1... and nostr:naddr1...)
  const extractedNaddr = $derived.by(() => {
    if (!isUriSearch) return null
    const trimmed = searchQuery.trim()
    if (trimmed.startsWith("nostr:")) {
      return trimmed.replace("nostr:", "")
    }
    return trimmed
  })

  // Fetch event for URI search
  const uriSearchEvent = $derived.by(() => {
    if (!extractedNaddr) return null
    const naddr = extractedNaddr

    try {
      const decoded = nip19.decode(naddr) as {type: string; data: any}
      // Only fetch if it's a repo announcement (kind 30617)
      if (decoded.type === "naddr" && decoded.data.kind === GIT_REPO_ANNOUNCEMENT) {
        const eventStore = deriveNaddrEvent(naddr, repoAnnouncementRelays)
        return getStore(eventStore)
      }
    } catch (e) {
      console.error("[+page.svelte] Failed to decode naddr:", e)
    }
    return null
  })

  // Convert URI search event to repo card format if found
  const uriSearchRepo = $derived.by(() => {
    const event = uriSearchEvent
    if (!event || isDeletedRepoAnnouncement(event)) return null

    try {
      let addressString = ""
      try {
        const address = Address.fromEvent(event)
        addressString = address.toString()
      } catch (e) {
        const dTag = (event.tags || []).find((t: string[]) => t[0] === "d")?.[1]
        if (dTag && event.pubkey && event.kind) {
          addressString = `${event.kind}:${event.pubkey}:${dTag}`
        }
      }

      const relayHintFromEvent = Router.get().getRelaysForPubkey(event.pubkey)?.[0]
      return {address: addressString, event: event, relayHint: relayHintFromEvent || ""}
    } catch (e) {
      console.error("[+page.svelte] Failed to process URI search event:", e)
      return null
    }
  })

  // Filter repos based on search query (from current tab)
  const searchFilteredRepos = $derived.by(() => {
    const repos = filteredRepos
    // If URI search, don't filter tab repos (URI search shows in separate section)
    if (isUriSearch) return repos

    if (!searchQuery.trim()) return repos

    const query = searchQuery.toLowerCase().trim()
    return repos.filter((repo: any) => {
      try {
        const parsed = parseRepoAnnouncementEvent((repo.event ?? repo) as any)
        const title = parsed?.name || ""
        const description = parsed?.description || ""
        return title.toLowerCase().includes(query) || description.toLowerCase().includes(query)
      } catch {
        return false
      }
    })
  })

  const hasRepoStateRefs = (state?: RepoStateEvent) => {
    if (!state?.tags) return false
    return state.tags.some((t: string[]) => typeof t[0] === "string" && t[0].startsWith("refs/"))
  }

  const getRepoStateHeads = (state?: RepoStateEvent) => {
    const heads = new Map<string, string>()
    if (!state?.tags) return heads
    for (const tag of state.tags) {
      const [ref, commit] = tag
      if (!ref || typeof ref !== "string") continue
      if (!ref.startsWith("refs/heads/")) continue
      if (!commit || typeof commit !== "string") continue
      heads.set(ref, commit)
    }
    return heads
  }

  const parseHeadBranchFromRefs = (refs: ServerRef[]) => {
    const headRef = refs.find(r => r?.ref === "HEAD")
    const symref = typeof headRef?.symref === "string" ? headRef.symref : headRef?.target
    if (typeof symref === "string" && symref.startsWith("refs/heads/")) {
      return symref.replace("refs/heads/", "")
    }
    return undefined
  }

  const parseRemoteHeads = (refs: ServerRef[]) => {
    const heads = new Map<string, string>()
    for (const ref of refs) {
      if (!ref?.ref || typeof ref.ref !== "string") continue
      if (!ref.ref.startsWith("refs/heads/")) continue
      if (!ref.oid || typeof ref.oid !== "string") continue
      heads.set(ref.ref, ref.oid)
    }
    let headBranch = parseHeadBranchFromRefs(refs)
    if (!headBranch) {
      if (heads.has("refs/heads/main")) headBranch = "main"
      else if (heads.has("refs/heads/master")) headBranch = "master"
    }
    return {heads, headBranch}
  }

  const logBranchComparisons = (
    repoLabel: string,
    currentHeads: Map<string, string>,
    remoteHeads: Map<string, string>,
  ) => {
    for (const [ref, newOid] of remoteHeads.entries()) {
      const oldOid = currentHeads.get(ref) || "<none>"
      logBranchUpdate(`${repoLabel}: comparing ${ref} ${oldOid} -> ${newOid}`)
    }
    for (const [ref, oldOid] of currentHeads.entries()) {
      if (remoteHeads.has(ref)) continue
      logBranchUpdate(`${repoLabel}: comparing ${ref} ${oldOid} -> <missing>`)
    }
  }

  const logHeadMap = (repoLabel: string, prefix: "local" | "remote", heads: Map<string, string>) => {
    if (heads.size === 0) {
      logBranchUpdate(`${repoLabel}: ${prefix} heads: <none>`)
      return
    }
    for (const [ref, oid] of Array.from(heads.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      logBranchUpdate(`${repoLabel}: ${prefix} ${ref} = ${oid}`)
    }
  }

  const logBranchChanges = (repoLabel: string, changes: BranchChange[]) => {
    if (changes.length === 0) {
      logBranchUpdate(`${repoLabel}: diff result: no changes`)
      return
    }
    for (const change of changes) {
      const ref = `refs/heads/${change.name}`
      const from = change.oldOid || "<none>"
      const to = change.newOid || "<missing>"
      logBranchUpdate(`${repoLabel}: diff ${change.change} ${ref} ${from} -> ${to}`)
    }
  }

  const isNotFoundError = (error: unknown) => {
    const anyError = error as {status?: number; code?: number; data?: {status?: number}; message?: string}
    const status = anyError?.status ?? anyError?.code ?? anyError?.data?.status
    const message = String(anyError?.message ?? error ?? "")
    return status === 404 || message.includes("404") || message.includes("Not Found")
  }

  const buildCloneCandidates = (cloneUrl: string) => {
    const raw = String(cloneUrl || "").trim()
    const valid = filterValidCloneUrls([raw])
    if (valid.length === 0) return []

    const candidates: string[] = []
    const add = (url: string) => {
      const cleaned = url.replace(/\/+$/, "")
      if (cleaned && !candidates.includes(cleaned)) {
        candidates.push(cleaned)
      }
    }

    const base = valid[0]
    if (/^https?:\/\//i.test(base)) {
      add(base)
    } else if (/^git@/i.test(base)) {
      const match = base.match(/^git@([^:]+):(.+)$/)
      if (match) add(`https://${match[1]}/${match[2]}`)
    } else if (/^ssh:\/\//i.test(base)) {
      const match = base.match(/^ssh:\/\/(?:.+@)?([^/]+)\/(.+)$/)
      if (match) add(`https://${match[1]}/${match[2]}`)
    } else if (/^git:\/\//i.test(base)) {
      const match = base.match(/^git:\/\/([^/]+)\/(.+)$/)
      if (match) add(`https://${match[1]}/${match[2]}`)
    } else {
      add(base)
    }

    const withGit: string[] = []
    for (const url of candidates) {
      withGit.push(url)
      if (!url.endsWith(".git")) {
        withGit.push(`${url}.git`)
      }
    }

    return Array.from(new Set(withGit))
  }

  const listServerRefsWithFallback = async (cloneUrl: string) => {
    const candidates = buildCloneCandidates(cloneUrl)
    logBranchUpdate("remote ref lookup candidates", {cloneUrl, candidates})
    let lastError: unknown = null
    let sawNotFound = false
    for (const candidate of candidates) {
      try {
        logBranchUpdate("remote ref lookup attempt", candidate)
        const result = await workerApi.listServerRefs({url: candidate, symrefs: true})
        if (Array.isArray(result)) {
          logBranchUpdate("remote ref lookup success", {candidate, count: result.length})
          return result as ServerRef[]
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          sawNotFound = true
          logBranchUpdate("remote ref lookup not found", candidate)
          continue
        }
        lastError = error
        logBranchUpdate("remote ref lookup failed", {candidate, error})
      }
    }
    if (lastError) throw lastError
    if (sawNotFound) return []
    return []
  }

  const openBranchSyncModal = () => {
    if (!pendingBranchUpdates.length) return
    pushModal(BranchStateSyncModal, {
      repos: pendingBranchUpdates,
      onCancel: () => clearModals(),
      onUpdate: async (
        selected: RepoBranchUpdate[],
        onProgress?: (completed: number, total: number) => void,
      ) => {
        if (!selected.length) {
          clearModals()
          return {total: 0, completed: 0, failures: []}
        }
        const total = selected.length
        let completed = 0
        const failures: Array<{repoId: string; repoName: string; error: string}> = []
        onProgress?.(completed, total)

        for (const repo of selected) {
          try {
            const baseRelays = repo.relays && repo.relays.length > 0 ? repo.relays : repoAnnouncementRelays
            if (!baseRelays || baseRelays.length === 0) {
              throw new Error(`No relays configured for ${repo.repoName || repo.repoId}`)
            }
            const targetRelays = Array.from(new Set([...baseRelays, ...GIT_RELAYS]))
              .map(relay => normalizeRelayUrl(relay))
              .filter(Boolean) as string[]
            const stateEvent = createRepoStateEvent({
              repoId: repo.repoId,
              head: repo.headBranch,
              refs: repo.refs,
            })
            const thunk = await publishEventToRelays(stateEvent, targetRelays)
            if (thunk?.event) {
              const published = thunk.event as RepoStateEvent
              optimisticRepoStates = {
                ...optimisticRepoStates,
                [repo.repoId]: published,
              }
              myRepoStateEvents = [
                published,
                ...myRepoStateEvents.filter(event => event.id !== published.id),
              ]
              logBranchUpdate(`${repo.repoName || repo.repoId}: optimistic repo state applied`, {
                stateEventId: published.id,
                created_at: published.created_at,
              })
            }
          } catch (error) {
            failures.push({
              repoId: repo.repoId,
              repoName: repo.repoName || repo.repoId,
              error: error instanceof Error ? error.message : String(error),
            })
          } finally {
            completed += 1
            onProgress?.(completed, total)
          }
        }

        if (failures.length > 0) {
          const failedNames = failures.map(f => f.repoName || f.repoId)
          const summary =
            failedNames.length > 3
              ? `${failedNames.slice(0, 3).join(", ")} +${failedNames.length - 3} more`
              : failedNames.join(", ")
          pushToast({
            message: `Branch state update failed for: ${summary}`,
            theme: "error",
          })
          pendingBranchUpdates = pendingBranchUpdates.filter(repo =>
            failures.some(failure => failure.repoId === repo.repoId),
          )
        } else {
          pushToast({message: "Branches synchronized to Nostr", theme: "success"})
          pendingBranchUpdates = []
        }
        const updatedCount = total - failures.length
        return {total, completed: updatedCount, failures}
      },
    })
  }

  const checkRepoBranchUpdates = async () => {
    if (!workerApi || !$pubkey) {
      logBranchUpdate("check aborted: worker or pubkey missing")
      return
    }
    if (branchUpdateChecking) {
      logBranchUpdate("check aborted: already in progress")
      return
    }
    if (!latestMyRepos || latestMyRepos.length === 0) {
      logBranchUpdate("check aborted: no repos in latestMyRepos")
      return
    }

    branchUpdateChecking = true
    logBranchUpdate("check start", {
      repoCount: latestMyRepos.length,
      knownStateCount: latestMyRepoStates.size,
    })
    try {
      const updates: RepoBranchUpdate[] = []
      for (const repo of latestMyRepos) {
        const repoEvent = repo.event as RepoAnnouncementEvent
        let parsed
        try {
          parsed = parseRepoAnnouncementEvent(repoEvent)
        } catch (error) {
          console.warn("[git/+page] Failed to parse repo announcement:", error)
          logBranchUpdate("repo parse failed", error)
          continue
        }

        const repoId = parsed.repoId
        if (!repoId) {
          logBranchUpdate("repo skipped: missing repoId", parsed)
          continue
        }

        const repoLabel = parsed.name || repoId

        const cloneUrl = parsed.clone?.[0]
        if (!cloneUrl) {
          logBranchUpdate(`${repoLabel}: skipped, missing clone URL`)
          continue
        }

        const relays = parsed.relays || []
        const latestState = latestMyRepoStates.get(repoId)
        logBranchUpdate(`${repoLabel}: evaluation start`, {
          repoId,
          cloneUrl,
          relayCount: relays.length,
          stateEventId: latestState?.id || "<none>",
        })
        if (latestState && !hasRepoStateRefs(latestState)) {
          logBranchUpdate(`${repoLabel}: skipping, latest state has no refs tags`)
          continue
        }

        let refs: ServerRef[] = []
        try {
          refs = await listServerRefsWithFallback(cloneUrl)
        } catch (error) {
          console.warn("[git/+page] listServerRefs failed:", error)
          logBranchUpdate(`${repoLabel}: failed to list remote refs`, error)
          continue
        }

        if (refs.length === 0) {
          logBranchUpdate(`${repoLabel}: no remote refs found for ${cloneUrl}`)
        }

        const {heads, headBranch} = parseRemoteHeads(refs)
        if (heads.size === 0) {
          logBranchUpdate(`${repoLabel}: skipped, remote has zero heads`)
          continue
        }

        const currentHeads = getRepoStateHeads(latestState)
        logHeadMap(repoLabel, "local", currentHeads)
        logHeadMap(repoLabel, "remote", heads)
        logBranchComparisons(repoLabel, currentHeads, heads)
        const changes = diffBranchHeads(currentHeads, heads)
        logBranchChanges(repoLabel, changes)
        if (changes.length === 0) {
          logBranchUpdate(`${repoLabel}: no branch changes`)
          continue
        }
        logBranchUpdate(`${repoLabel}: detected ${changes.length} branch change(s)`)

        const refsForEvent = Array.from(heads.entries()).map(([ref, commit]) => ({
          type: "heads" as const,
          name: ref.replace("refs/heads/", ""),
          commit,
        }))

        updates.push({
          repoId,
          repoName: repoLabel,
          cloneUrl,
          relays,
          headBranch,
          updates: changes,
          refs: refsForEvent,
        })
      }

      pendingBranchUpdates = updates
      if (updates.length > 0) {
        const key = buildBranchUpdateDedupeKey(updates)
        logBranchUpdate("computed update dedupe key", key)
        logBranchUpdate("previous update dedupe key", branchUpdateToastLastKey || "<none>")

        if (key && key !== branchUpdateToastLastKey) {
          branchUpdateToastLastKey = key
          logBranchUpdate("showing update toast (new dedupe key)")
          if (branchUpdateToastId) {
            popToast(branchUpdateToastId)
            branchUpdateToastId = null
          }
          const toastId = pushToast({
            message: "Some branches need to be updated",
            timeout: 0,
            action: {
              message: "Review",
              onclick: () => {
                if (branchUpdateToastId) {
                  popToast(branchUpdateToastId)
                  branchUpdateToastId = null
                }
                openBranchSyncModal()
              },
            },
          })
          branchUpdateToastId = toastId
        } else {
          logBranchUpdate("toast suppressed by dedupe key match")
        }
      } else {
        logBranchUpdate("no repos require branch updates")
        if (branchUpdateToastId) {
          popToast(branchUpdateToastId)
          branchUpdateToastId = null
        }
      }
    } finally {
      branchUpdateChecking = false
      logBranchUpdate("check complete")
    }
  }

  // Store for URI search repo card
  let uriSearchRepoCard = $state<any[]>([])

  // Update URI search repo card
  $effect(() => {
    const repo = uriSearchRepo
    if (repo) {
      const cards = repositoriesStore.computeCards([repo], {
        deriveMaintainersForEuc,
        deriveRepoRefState,
        derivePatchGraph,
        parseRepoAnnouncementEvent,
        Router,
        nip19,
        Address,
      })
      uriSearchRepoCard = cards
    } else {
      uriSearchRepoCard = []
    }
  })

  // Update repositoriesStore whenever repos change
  // Uses debouncing to wait for all repos to load before showing cards
  $effect(() => {
    const reposToShow = searchFilteredRepos
    if (reposToShow.length > 0 || !loading) {
      loading = false
      if (reposToShow.length > 0) {
        // Compute cards using the store's method
        const cards = repositoriesStore.computeCards(reposToShow, {
          deriveMaintainersForEuc,
          deriveRepoRefState,
          derivePatchGraph,
          parseRepoAnnouncementEvent,
          Router,
          nip19,
          Address,
        })
        repositoriesStore.set(cards)

        // Debounce: wait for repo count to stabilize before showing cards
        // This ensures all repos are loaded before the animation starts
        const currentCount = cards.length
        if (currentCount !== lastRepoCount) {
          lastRepoCount = currentCount
          // Reset cardsReady while more repos are loading
          cardsReady = false
          // Clear previous timer
          if (settleTimer) {
            clearTimeout(settleTimer)
          }
          // Wait for count to stabilize (no new repos for 400ms)
          settleTimer = setTimeout(() => {
            cardsReady = true
            settleTimer = null
          }, 400)
        }
      } else {
        repositoriesStore.clear()
        cardsReady = false
        lastRepoCount = 0
      }
    }
  })

  $effect(() => {
    if (!workerReady) {
      logBranchUpdate("skip check trigger: worker not ready")
      return
    }
    if (!$pubkey) {
      logBranchUpdate("skip check trigger: no pubkey")
      return
    }
    if (myRepoIds.length === 0) {
      logBranchUpdate("skip check trigger: no repo ids")
      return
    }
    if (!repoStateLoadKey) {
      logBranchUpdate("skip check trigger: repoStateLoadKey empty")
      return
    }
    if (!repoStateSettled) {
      logBranchUpdate("skip check trigger: repo-state not settled yet")
      return
    }
    if (branchUpdateCheckDone) {
      logBranchUpdate("skip check: already ran on this page load")
      return
    }
    if (branchUpdateChecking) {
      logBranchUpdate("skip check trigger: check already in progress")
      return
    }
    logBranchUpdate("triggering check after settle gate")
    void (async () => {
      try {
        await checkRepoBranchUpdates()
      } finally {
        branchUpdateCheckDone = true
        logBranchUpdate("check marked done for current page load")
      }
    })()
  })

  const back = () => history.back()

  const onAddRepo = () => {
    // Open RepoPicker in a modal for editing followed repos
    try {
      // Inject closures matching ThunkFunction signature
      const fetchRepos = (evt: {filters: any[]; onResult: (events: any[]) => void}) => {
        const controller = new AbortController()
        const store = deriveEventsAsc(deriveEventsById({repository, filters: evt.filters}))
        store.subscribe((events: any[]) => {
          evt.onResult(events as any[])
        })
        load({relays: bookmarkRelays, filters: evt.filters})
        return {controller}
      }
      const publishBookmarks = ({tags, relays}: {tags: string[][]; relays?: string[]}) => {
        const eventToPublish = makeEvent(NAMED_BOOKMARKS, {tags, content: ""})
        const targetRelays = relays || bookmarkRelays

        console.log("[publishBookmarks] Creating bookmark event:", eventToPublish)
        console.log("[publishBookmarks] Tags:", tags)
        console.log("[publishBookmarks] Target relays:", targetRelays)

        // Extract a-tags and update the bookmarks store immediately
        const aTags = tags.filter(t => t[0] === "a")
        const newBookmarks: BookmarkAddress[] = aTags.map(([_, address, relayHint]) => ({
          address,
          author: address.split(":")[1] || "",
          identifier: address.split(":")[2] || "",
          relayHint: relayHint || "",
        }))

        bookmarksStore.set(newBookmarks)

        // Publish to relays and return the thunk for awaiting
        const thunk = publishThunk({
          event: eventToPublish,
          relays: targetRelays,
          onSuccess: (result) => {
            console.log("[publishBookmarks] Success on relay:", result.relay, result)
          },
          onFailure: (result) => {
            console.error("[publishBookmarks] Failed on relay:", result.relay, result.detail)
          },
          onComplete: (result) => {
            console.log("[publishBookmarks] Complete:", result)
          },
        })
        
        console.log("[publishBookmarks] Thunk created, event id:", thunk.event?.id)

        return {controller: new AbortController(), complete: thunk.complete}
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

      pushModal(RepoPickerWrapper, {
        selectedRepos: loadedBookmarkedRepos,
        fetchRepos,
        publishBookmarks,
        filters: [{kinds: [30617]}],
        relays: repoAnnouncementRelays,
        makeRelayHint,
        onClose: back,
      })
    } catch (e) {
      // Fallback to settings route if modal fails for any reason
      console.error("Failed to open RepoPicker modal:", e)
      goto(gitPath)
    }
  }

  let defaultRepoRelays = $state<string[]>([])
  $effect(() => {
    defaultRepoRelays = repoAnnouncementRelays
  })

  const publishEventToRelays = async (event: any, relays: string[] = defaultRepoRelays) => {
    try {
      console.log("🔐 publishing event to relays", event, relays)
      const thunk = publishThunk({event, relays})
      // Wait for the thunk to complete - this ensures events are actually sent to relays
      // before we proceed with the git push
      if (thunk && thunk.complete) {
        console.log("📡 Waiting for thunk.complete...")
        await thunk.complete
        console.log("📡 Published event to relays (completed):", thunk.event?.id)
      } else {
        console.log("📡 Published event to relays (no complete promise):", thunk)
      }
      return thunk
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
    console.log("[+page.svelte] onNewRepo called")

    // Ensure worker is initialized before opening wizard
    if (!workerApi || !workerInstance) {
      console.log("[+page.svelte] Worker not initialized, initializing...")
      try {
        // Add a timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("Worker initialization timeout after 15 seconds")),
            15000,
          )
        })

        const workerPromise = getInitializedGitWorker()

        const {api, worker} = (await Promise.race([workerPromise, timeoutPromise])) as {
          api: any
          worker: Worker
        }
        workerApi = api
        workerInstance = worker
        console.log("[+page.svelte] Worker initialized for new repo")
      } catch (error) {
        console.error("[+page.svelte] Failed to initialize worker:", error)
        pushToast({message: `Failed to initialize Git worker: ${String(error)}`, theme: "error"})
        return
      }
    }

    console.log("[+page.svelte] About to push NewRepoWizard modal")
    
    // Get user profile for git author info
    const profile = userProfile ? getStore(userProfile) : null
    const authorName = getAuthorName(profile)
    const authorEmail = getAuthorEmail(profile, $pubkey)
    
    try {
      const modalId = pushModal(
        NewRepoWizardWrapper,
        {
          workerApi, // Pass initialized worker API
          workerInstance, // Pass worker instance for event signing
          onRepoCreated: () => {
            // Reload repos by forcing bookmarks refresh and announcements
            loadRepoAnnouncements(repoAnnouncementRelays)
          },
          onNavigateToRepo: (result: NewRepoResult) => {
            try {
              const d =
                getTagValue("d", result.announcementEvent.tags) || result.localRepo.repoId
              const address = new Address(GIT_REPO_ANNOUNCEMENT, $pubkey!, d, [url])
              const naddr = address.toNaddr()
              goto(makeGitPath(url, naddr))
            } catch (error) {
              console.error("[+page.svelte] Failed to navigate to new repo:", error)
              pushToast({
                message: `Failed to navigate to repository: ${String(error)}`,
                theme: "error",
              })
            }
          },
          onCancel: back,
          defaultRelays: [...defaultRepoRelays],
          userPubkey: $pubkey,
          defaultAuthorName: authorName,
          defaultAuthorEmail: authorEmail,
          onPublishEvent: async (repoEvent: NostrEvent) => {
            // For GRASP repos (kind 30617/30618), publish to the GRASP relay from the event's 'relays' tag
            let targetRelays = defaultRepoRelays

            // Check if this is a repo announcement or state event
            if (repoEvent.kind === 30617 || repoEvent.kind === 30618) {
              console.log("🔐 Processing GRASP event kind:", repoEvent.kind, "tags:", repoEvent.tags)
              // Extract relay URLs from the 'relays' tag if present
              const relaysTag = repoEvent.tags?.find((t: any[]) => t[0] === "relays")
              console.log("🔐 Found relays tag:", relaysTag)
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
              } else {
                console.warn("🔐 No relays tag found in GRASP event, using default relays:", defaultRepoRelays)
              }
            }

            const result = publishEventToRelays(repoEvent, targetRelays)
          },
          getProfile: getProfileForWizard,
          searchProfiles: searchProfilesForWizard,
          searchRelays: searchRelaysForWizard,
          createAuthHeader: createNip98AuthHeader, // For GRASP NIP-98 authentication
        },
        {fullscreen: true},
      )
      console.log("[+page.svelte] NewRepoWizard modal pushed with ID:", modalId)
    } catch (error) {
      console.error("[+page.svelte] Failed to push NewRepoWizard modal:", error)
      pushToast({message: `Failed to open New Repo wizard: ${String(error)}`, theme: "error"})
    }
  }

  const onImportRepo = async () => {
    console.log("[+page.svelte] onImportRepo called")

    if (!$session || !$pubkey) {
      pushToast({
        theme: "error",
        message: "Please log in to import a repository.",
      })
      return
    }

    // Get signer for event signing (supports NIP-07, NIP-46, NIP-01)
    const {getSigner} = await import("@welshman/app")
    const signer = getSigner($session)

    if (!signer) {
      pushToast({
        theme: "error",
        message:
          "No signer available. Please log in with a supported signer (NIP-01, NIP-07, or NIP-46).",
      })
      return
    }

    // Create onSignEvent callback that works with any signer
    const onSignEvent = async (
      event: Omit<NostrEvent, "id" | "sig" | "pubkey">,
    ): Promise<NostrEvent> => {
      return await signer.sign(event)
    }

    try {
      const modalId = pushModal(
        ImportRepoDialogWrapper,
        {
          pubkey: $pubkey!,
          onSignEvent: onSignEvent, // Primary signing method (works with all signers)
          onFetchEvents: async (filters: NostrFilter[]) => {
            const events: NostrEvent[] = [];
            await load({
              relays: Router.get().FromUser().getUrls(),
              filters: filters as any,
              onEvent: (e) => events.push(e as NostrEvent),
            });
            return events;
          },
          onClose: () => {
            clearModals()
          },
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
          onImportComplete: (result: ImportResult) => {
            // Reload repos by forcing bookmarks refresh and announcements
            loadRepoAnnouncements(repoAnnouncementRelays)
            pushToast({
              message: `Successfully imported repository! Imported ${result.issuesImported} issues, ${result.commentsImported} comments, ${result.prsImported} PRs, and created ${result.profilesCreated} profiles.`,
            })
          },
          onNavigateToRepo: (result: ImportResult) => {
            try {
              // Convert announcement event to naddr and navigate
              const naddr = Address.fromEvent(result.announcementEvent as any).toNaddr()
              const destination = makeGitPath(url, naddr)
              goto(destination)
            } catch (error) {
              console.error("[+page.svelte] Failed to navigate to imported repo:", error)
              pushToast({
                message: `Failed to navigate to repository: ${String(error)}`,
                theme: "error",
              })
            }
          },
          defaultRelays: [...defaultRepoRelays],
        },
        {fullscreen: true},
      )
      console.log("[+page.svelte] ImportRepoDialog modal pushed with ID:", modalId)
    } catch (error) {
      console.error("[+page.svelte] Failed to push ImportRepoDialog modal:", error)
      pushToast({
        message: `Failed to open Import Repo dialog: ${String(error)}`,
        theme: "error",
      })
    }
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
      <div class="hidden items-center gap-2 sm:flex">
        <Button class="btn btn-primary btn-sm" onclick={() => onNewRepo()}>
          <Icon icon={AddCircle} />
          New Repo
        </Button>
        <Button class="btn btn-secondary btn-sm" onclick={() => onImportRepo()}>
          <Icon icon={Download} />
          Import Repo
        </Button>
      </div>
      <SpaceMenuButton {url} />
    </div>
  {/snippet}
</PageBar>

<PageContent class="mt-4 flex flex-grow flex-col gap-4 overflow-auto p-2">
  <div class="flex flex-col gap-2 sm:hidden">
    <Button class="btn btn-primary btn-sm w-full" onclick={() => onNewRepo()}>
      <Icon icon={AddCircle} />
      New Repo
    </Button>
    <Button class="btn btn-secondary btn-sm w-full" onclick={() => onImportRepo()}>
      <Icon icon={Download} />
      Import Repo
    </Button>
  </div>
  <!-- Tabs and Search Bar -->
  <div class="flex flex-col gap-3">
    <Tabs bind:value={activeTab} class="w-full">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList class="flex w-full sm:w-auto">
            <TabsTrigger value="my-repos" class="flex-1 sm:flex-none">
              <span class="flex items-center gap-2">
                <Icon icon={FolderWithFiles} />
                <span>My Repos</span>
                {#if hasMyRepoNotifications}
                  <span class="h-2 w-2 rounded-full bg-primary" aria-label="Unread updates"></span>
                {/if}
              </span>
            </TabsTrigger>
            <TabsTrigger value="bookmarks" class="flex-1 sm:flex-none">
              <span class="flex items-center gap-2">
                <Icon icon={Bookmark} />
                <span>Bookmarks</span>
                {#if hasBookmarkNotifications}
                  <span class="h-2 w-2 rounded-full bg-primary" aria-label="Unread updates"></span>
                {/if}
              </span>
            </TabsTrigger>
            <TabsTrigger value="snippets" class="flex-1 sm:flex-none">
              <span class="flex items-center gap-2">
                <Icon icon={Code} />
                <span>Snippets</span>
              </span>
            </TabsTrigger>
          </TabsList>
          <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {#if activeTab === "bookmarks"}
              <Button
                class="btn btn-primary btn-sm order-2 w-full sm:order-1 sm:w-auto"
                onclick={onAddRepo}>
                <Icon icon={Bookmark} />
                <span>Bookmark a Repo</span>
              </Button>
            {/if}
            <label
              class="input input-bordered order-1 flex w-full items-center gap-2 sm:order-2 sm:w-auto sm:max-w-md">
              <Icon icon={Magnifier} />
              <input
                bind:value={searchQuery}
                class="grow"
                type="text"
                placeholder={activeTab === "snippets" ? "Search snippets..." : "Paste naddr or search..."} />
            </label>
          </div>
        </div>
      </div>
    </Tabs>
  </div>

  {#if activeTab === "snippets"}
    <div class="flex flex-col gap-3" in:fade={{duration: 150}}>
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-muted-foreground">Your Snippets</h3>
        {#if $pubkey}
          <span class="text-xs text-muted-foreground">{filteredSnippets.length}</span>
        {/if}
      </div>
      {#if !$pubkey}
        <p class="text-sm text-muted-foreground">Sign in to view your snippets.</p>
      {:else if filteredSnippets.length === 0}
        <p class="text-sm text-muted-foreground">
          No snippets yet. Create a permalink from a code file or diff.
        </p>
      {:else}
        <div class="flex flex-col gap-3">
          {#each filteredSnippets as snippet (snippet.id)}
            <EventRenderer event={snippet as any} relay={url} />
          {/each}
        </div>
      {/if}
    </div>
  {:else}
  <!-- URI Search Result (if found) -->
  {#if uriSearchRepoCard.length > 0}
    <div class="flex flex-col gap-2" in:fade={{duration: 200}}>
      <h3 class="text-sm font-semibold text-muted-foreground">Found Repository</h3>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {#each uriSearchRepoCard as g, i (g.repoNaddr || g.euc)}
          <div
            class="rounded-md border border-border bg-card p-3"
            in:staggeredFade={{index: i, staggerDelay: 40, duration: 250}}>
            {#if g.first}
              <GitItem
                {url}
                event={g.first as any}
                showActivity={true}
                showIssues={true}
                showActions={true}
                hideDate={true} />
            {/if}
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
              {#if g.first}
                {@const date = new Date(g.first.created_at * 1000)}
                <span class="text-xs opacity-60">
                  {String(date.getDate()).padStart(2, '0')}/{String(date.getMonth() + 1).padStart(2, '0')}/{String(date.getFullYear()).slice(-2)}
                </span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Tab-filtered Repos Grid -->
  <div>
    {#if loading && !uriSearchRepoCard.length}
      <p class="flex h-10 items-center justify-center py-20" out:fly>
        <Spinner {loading}>
          {#if loading}
            Looking for Your Git Repos...
          {:else if $repositoriesStore.length === 0}
            No Repos found.
          {/if}
        </Spinner>
      </p>
    {:else if $repositoriesStore.length === 0 && !uriSearchRepoCard.length}
      <p class="flex h-10 items-center justify-center py-20 text-muted-foreground">
        {#if searchQuery.trim() && !isUriSearch}
          No repositories found matching "{searchQuery}".
        {:else if isUriSearch && !uriSearchRepoCard.length}
          Repository not found. Please check the URI.
        {:else if activeTab === "my-repos"}
          You haven't created any repositories yet.
        {:else}
          No bookmarked repositories found.
        {/if}
      </p>
    {:else if $repositoriesStore.length > 0}
      {#if uriSearchRepoCard.length > 0}
        <h3 class="mb-2 text-sm font-semibold text-muted-foreground">
          {activeTab === "my-repos" ? "My Repositories" : "Bookmarked Repositories"}
        </h3>
      {/if}
      {#if !cardsReady}
        <!-- Show subtle loading while waiting for all repos to load -->
        <p class="flex h-10 items-center justify-center py-20" out:fade={{duration: 150}}>
          <Spinner loading={true}>
            Loading repositories...
          </Spinner>
        </p>
      {/if}
      {#if cardsReady}
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3" in:fade={{duration: 150}}>
          {#each $repositoriesStore as g, i (g.repoNaddr || g.euc)}
            <div
              class="rounded-md border border-border bg-card p-3"
              in:staggeredFade={{index: i, staggerDelay: 40, duration: 250}}>
              <!-- Use GitItem for consistent repo card rendering -->
              {#if g.first}
                <GitItem
                  {url}
                  event={g.first as any}
                  showActivity={true}
                  showIssues={true}
                  showActions={true}
                  hideDate={true} />
              {/if}

              <!-- Maintainers avatars and date -->
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
                {#if g.first}
                  {@const date = new Date(g.first.created_at * 1000)}
                  <span class="text-xs opacity-60">
                    {String(date.getDate()).padStart(2, '0')}/{String(date.getMonth() + 1).padStart(2, '0')}/{String(date.getFullYear()).slice(-2)}
                  </span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
  {/if}
</PageContent>
