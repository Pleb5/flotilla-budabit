<script lang="ts">
  import {page} from "$app/stores"
  import {normalizeRelayUrl, NAMED_BOOKMARKS, makeEvent, Address, getTagValue, type Filter} from "@welshman/util"
  import {
    repository,
    publishThunk,
    profilesByPubkey,
    tracker,
    profileSearch,
    getFollows,
    loadProfile,
    relaySearch,
    pubkey,
    session,
    deriveProfile,
  } from "@welshman/app"
  import {deriveEventsById, deriveEventsDesc} from "@welshman/store"
  import {Router} from "@welshman/router"
  import {load, PublishStatus} from "@welshman/net"
  import {fly, staggeredFade} from "@lib/transition"
  import {fade} from "svelte/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import RepoSearchSettingsModal from "@app/components/RepoSearchSettingsModal.svelte"
  import {getInteractiveCardTarget} from "@lib/html"
  import SpaceMenuButton from "@lib/budabit/components/SpaceMenuButton.svelte"
  import GitItem from "@app/components/GitItem.svelte"
  import {pushModal, clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {notifications, hasRepoNotification} from "@app/util/notifications"
  import {decodeRelay} from "@app/core/state"
  import {publishDelete} from "@app/core/commands"
  import {goto} from "$app/navigation"
  import {onMount, onDestroy, untrack} from "svelte"
  import {derived as _derived, get as getStore} from "svelte/store"
  import {nip19, type NostrEvent} from "nostr-tools"
  import {ListFilter, X} from "@lucide/svelte"
  import {
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_BOOKMARK_DTAG,
    GIT_REPO_STATE,
    parseRepoAnnouncementEvent,
    type BookmarkAddress,
    type RepoAnnouncementEvent,
  } from "@nostr-git/core/events"
  import {
    getTaggedRelaysFromRepoEvent,
    resolveRepoRelayPolicy,
    buildRepoNaddrFromEvent,
  } from "@nostr-git/core/utils"
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
    NewRepoWizard,
    ImportRepoDialog,
  } from "@nostr-git/ui"
  import type {ImportResult, NewRepoResult} from "@nostr-git/ui"
  import type {NostrFilter} from "@nostr-git/core"
  import {
    deriveRepoRefState,
    deriveMaintainersForEuc,
    effectiveRepoAddressesByRepoAddress,
    getEffectiveRepoAddresses,
    loadRepoAnnouncements,
    derivePatchGraph,
    GIT_RELAYS,
    getRepoAnnouncementRelays,
    repoAnnouncements,
  } from "@lib/budabit/state"
  import {getInitializedGitWorker, terminateGitWorker} from "@src/lib/budabit/worker-singleton"
  import {fetchRelayEventsWithTimeout} from "@lib/budabit/fetch-relay-events"
  import {createNip98AuthHeader} from "@src/lib/budabit/event-io"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Bookmark from "@assets/icons/bookmark.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import FolderWithFiles from "@assets/icons/folder-with-files.svg?dataurl"
  import Download from "@assets/icons/download.svg?dataurl"
  import Code from "@assets/icons/code.svg?dataurl"
  import {makeGitPath} from "@src/lib/budabit"
  import {gitSelectedTab, type GitTab} from "@app/util/git-tabs"
  import {
    buildBookmarkRepoFilters,
    buildBookmarkRepoLoadKey,
    getCanonicalRepoKeyFromEvent,
    getRepoAddressFromEvent,
    isAnyBookmarked,
    matchBookmarkedRepoEvents,
    toggleRepoBookmarks,
  } from "@src/lib/budabit/bookmarks"
  import {getActiveTrustGraph} from "@src/lib/budabit/trust-graph"
  import {
    REPO_DISCOVERY_TIMEOUT_MS,
    REPO_DISCOVERY_SETTINGS_STORAGE_KEY,
    buildRepoDiscoveryBuckets,
    coerceRepoDiscoveryPrioritySettings,
    dedupeRepoDiscoveryBuckets,
    getDefaultRepoDiscoveryPrioritySettings,
    mergeLoadedRepoSearchItems,
    repoMatchesSearchQuery,
    toLoadedRepoSearchItem,
    type RepoDiscoveryBucket,
    type RepoDiscoveryPriorityKey,
    type RepoDiscoveryPrioritySetting,
    type RepoOwnerProfile,
  } from "@src/lib/budabit/repo-discovery-search"

  const url = decodeRelay($page.params.relay!)

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

  const normalizeSearchValue = (value: unknown) => String(value ?? "").toLocaleLowerCase()

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
    let repoAddress = ""
    try {
      repoAddress = Address.fromEvent(event).toString()
    } catch {
      return false
    }
    return hasRepoNotification($notifications, {
      relay: url,
      repoAddress,
      repoAddresses: getEffectiveRepoAddresses($effectiveRepoAddressesByRepoAddress, repoAddress),
    })
  }

  const prioritizeFreshRepoCards = <T extends {first?: RepoAnnouncementEvent | null}>(cards: T[]) => {
    if (!Array.isArray(cards) || cards.length < 2) return cards || []

    const freshCards: T[] = []
    const otherCards: T[] = []

    for (const card of cards) {
      const event = card?.first
      if (event && repoHasNotifications(event)) {
        freshCards.push(card)
      } else {
        otherCards.push(card)
      }
    }

    return [...freshCards, ...otherCards]
  }

  const isDeletedRepoAnnouncement = (event?: {tags?: string[][]} | null) =>
    (event?.tags || []).some(tag => tag[0] === "deleted")

  const getRepoCardStableKey = (card: any) => {
    const event = card?.first
    const euc = card?.euc || ""
    const eventId = event?.id || ""

    if (event?.kind && event?.pubkey && Array.isArray(event?.tags)) {
      const d = getTagValue("d", event.tags)
      if (d) return `${event.kind}:${event.pubkey}:${d}:${euc}:${eventId}`

      const eucTag =
        event.tags.find((t: string[]) => t[0] === "r" && t[2] === "euc")?.[1] || ""
      if (eucTag) return `${event.kind}:${event.pubkey}:euc:${eucTag}:${euc}:${eventId}`

      if (event.id) return `${event.kind}:${event.pubkey}:id:${event.id}:${euc}`
    }

    return `${euc}:${card?.title || ""}:${eventId}`
  }

  type RepoDiscoveryStatus = {
    phase:
      | "idle"
      | "typing"
      | "preparing"
      | "fetching_profiles"
      | "fetching_repos"
      | "complete"
      | "aborted"
    currentBucketKey: RepoDiscoveryPriorityKey | null
    currentBucketLabel: string
    currentBucketIndex: number
    totalBuckets: number
    currentBucketProcessedAuthors: number
    currentBucketTotalAuthors: number
    loading: boolean
    timedOut: boolean
    searchedAuthors: number
    totalAuthors: number
    fetchedProfileAuthors: number
    fetchedRepoAuthors: number
    foundRepos: number
    matchedRepos: number
  }

  type RepoDiscoveryRunMode = "smart" | "exhaustive"

  type RepoDiscoverySnapshot = {
    query: string
    buckets: RepoDiscoveryBucket[]
    totalAuthors: number
    nextBucketIndex: number
    nextBucketOffset: number
    searchedAuthors: number
    fetchedProfileAuthors: number
    fetchedRepoAuthors: number
    foundRepos: number
    matchedRepos: number
  }

  const createEmptyRepoDiscoveryStatus = (): RepoDiscoveryStatus => ({
    phase: "idle",
    currentBucketKey: null,
    currentBucketLabel: "",
    currentBucketIndex: 0,
    totalBuckets: 0,
    currentBucketProcessedAuthors: 0,
    currentBucketTotalAuthors: 0,
    loading: false,
    timedOut: false,
    searchedAuthors: 0,
    totalAuthors: 0,
    fetchedProfileAuthors: 0,
    fetchedRepoAuthors: 0,
    foundRepos: 0,
    matchedRepos: 0,
  })

  let loading = $state(true)
  let activeTab = $state<GitTab>("my-repos")
  let gitTabHydrated = $state(false)
  let searchQuery = $state("")
  let activeTextSearchQuery = $state("")
  let repoDiscoveryRunMode = $state<RepoDiscoveryRunMode>("smart")
  let repoDiscoveryRunNonce = $state(0)
  let repoDiscoverySnapshot = $state<RepoDiscoverySnapshot | null>(null)
  let repoDiscoveryPrioritySettings = $state<RepoDiscoveryPrioritySetting[]>(
    getDefaultRepoDiscoveryPrioritySettings(),
  )
  let discoveredSearchRepoPool = $state<Array<{address: string; event: RepoAnnouncementEvent; relayHint: string}>>([])
  let discoveredOwnerProfiles = $state<Record<string, RepoOwnerProfile>>({})
  let repoDiscoveryStatus = $state<RepoDiscoveryStatus>(createEmptyRepoDiscoveryStatus())
  let repoDiscoveryController: AbortController | null = null
  let repoDiscoveryDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let snippetsLoadedFor = $state<string | null>(null)


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

  onMount(() => {
    const savedTab = getStore(gitSelectedTab)
    if (savedTab && savedTab !== activeTab) {
      activeTab = savedTab
    }
    gitTabHydrated = true

    try {
      const raw = localStorage.getItem(REPO_DISCOVERY_SETTINGS_STORAGE_KEY)
      if (raw) {
        repoDiscoveryPrioritySettings = coerceRepoDiscoveryPrioritySettings(JSON.parse(raw))
      }
    } catch {
      repoDiscoveryPrioritySettings = getDefaultRepoDiscoveryPrioritySettings()
    }
  })

  $effect(() => {
    if (!gitTabHydrated) return
    if ($gitSelectedTab !== activeTab) {
      gitSelectedTab.set(activeTab)
    }
  })

  $effect(() => {
    if (typeof localStorage === "undefined") return

    try {
      localStorage.setItem(
        REPO_DISCOVERY_SETTINGS_STORAGE_KEY,
        JSON.stringify(
          repoDiscoveryPrioritySettings.map(setting => ({
            key: setting.key,
            enabled: setting.enabled,
          })),
        ),
      )
    } catch {
      // pass
    }
  })

  // Load repos reactively when pubkey or relays change
  // Consolidated from duplicate effects to prevent flickering
  let lastLoadedRelays = $state<string>("")
  $effect(() => {
    if (!$pubkey) return
    if (!repoAnnouncementRelays.length) return
    
    // Prevent duplicate loads with same relay set
    const relayKey = repoAnnouncementRelays.slice().sort().join(",")
    if (relayKey === lastLoadedRelays) return
    lastLoadedRelays = relayKey
    
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
  // Memoize to prevent effect loops from array reference changes
  let cachedRepoRelays: string[] = []
  let cachedRepoRelaysKey = ""
  const repoAnnouncementRelays = $derived.by(() => {
    const relays = getRepoAnnouncementRelays()
    const key = relays.slice().sort().join(",")
    if (key === cachedRepoRelaysKey) {
      return cachedRepoRelays
    }
    cachedRepoRelaysKey = key
    cachedRepoRelays = relays
    return relays
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
    const filters = buildBookmarkRepoFilters(addresses)
    if (filters.length === 0) return undefined

    const loadKey = buildBookmarkRepoLoadKey(addresses)

    return _derived(deriveEventsDesc(deriveEventsById({repository, filters})), events => {
      const matched = matchBookmarkedRepoEvents({
        bookmarks: addresses,
        events: events as RepoAnnouncementEvent[],
        getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      })

      if (matched.length !== addresses.length) {
        if (!attemptedBookmarkLoads.has(loadKey)) {
          attemptedBookmarkLoads.add(loadKey)
          const relaysToQuery = repoAnnouncementRelays.length > 0 ? repoAnnouncementRelays : GIT_RELAYS
          if (relaysToQuery.length > 0) {
            load({relays: relaysToQuery, filters})
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

    return matchBookmarkedRepoEvents({
      bookmarks: addresses,
      events: $repos as RepoAnnouncementEvent[],
      getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      isDeleted: isDeletedRepoAnnouncement,
      getFallbackRelayHint: event => Router.get().getRelaysForPubkey(event.pubkey)?.[0] || "",
    })
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

  const mySnippetsEvents = $derived.by(() => {
    if (!$pubkey) return undefined
    const filter = {kinds: [GIT_PERMALINK], authors: [$pubkey]} as Filter
    return deriveEventsDesc(deriveEventsById({repository, filters: [filter]}))
  })

  const snippets = $derived.by(() => ($mySnippetsEvents ? ($mySnippetsEvents as NostrEvent[]) : []))

  const snippetQuery = $derived.by(() => normalizeSearchValue(searchQuery.trim()))

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
        .map(normalizeSearchValue)
        .join(" ")
      return haystack.includes(snippetQuery)
    })
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

  // Detect if search query is a bech32 account/address search
  const searchBech32 = $derived.by(() => {
    if (activeTab === "snippets") return null
    const trimmed = searchQuery.trim()
    if (!trimmed) return null
    if (trimmed.startsWith("nostr:")) return trimmed.replace("nostr:", "")
    return trimmed
  })

  type RepoSearchMode = "naddr" | "npub" | null

  const accountSearch = $derived.by((): {
    mode: RepoSearchMode
    pubkey: string | null
    identifier: string | null
    relayHints: string[]
    invalid: boolean
  } => {
    if (!searchBech32) {
      return {mode: null, pubkey: null, identifier: null, relayHints: [], invalid: false}
    }

    const isNaddrCandidate = searchBech32.startsWith("naddr1")
    const isNpubCandidate = searchBech32.startsWith("npub1")

    try {
      const decoded = nip19.decode(searchBech32) as {type: string; data: any}

      if (decoded.type === "naddr") {
        return {
          mode: "naddr",
          pubkey: decoded.data?.pubkey || null,
          identifier: decoded.data?.identifier || null,
          relayHints: Array.isArray(decoded.data?.relays) ? decoded.data.relays : [],
          invalid: false,
        }
      }

      if (decoded.type === "npub") {
        return {
          mode: "npub",
          pubkey: typeof decoded.data === "string" ? decoded.data : null,
          identifier: null,
          relayHints: [],
          invalid: false,
        }
      }
    } catch {
      if (isNaddrCandidate) {
        return {mode: "naddr", pubkey: null, identifier: null, relayHints: [], invalid: true}
      }
      if (isNpubCandidate) {
        return {mode: "npub", pubkey: null, identifier: null, relayHints: [], invalid: true}
      }
      return {mode: null, pubkey: null, identifier: null, relayHints: [], invalid: false}
    }

    if (isNaddrCandidate) {
      return {mode: "naddr", pubkey: null, identifier: null, relayHints: [], invalid: true}
    }
    if (isNpubCandidate) {
      return {mode: "npub", pubkey: null, identifier: null, relayHints: [], invalid: true}
    }
    return {mode: null, pubkey: null, identifier: null, relayHints: [], invalid: false}
  })

  const isAccountSearch = $derived.by(() => Boolean(accountSearch.mode))

  const attemptedAccountSearchLoads = new Set<string>()

  const getAccountSearchRelays = (pubkey: string, relayHints: string[]) => {
    let outboxRelays: string[] = []
    try {
      outboxRelays = Router.get().FromPubkeys([pubkey]).getUrls()
    } catch {
      outboxRelays = []
    }

    return Array.from(
      new Set([...relayHints, ...outboxRelays, ...repoAnnouncementRelays, ...GIT_RELAYS]),
    )
      .map(relay => normalizeRelayUrl(relay))
      .filter(Boolean) as string[]
  }

  const getDiscoveryRelays = (pubkeys: string[]) => {
    let outboxRelays: string[] = []

    try {
      outboxRelays = Router.get().FromPubkeys(pubkeys.filter(Boolean)).getUrls()
    } catch {
      outboxRelays = []
    }

    return Array.from(new Set([...outboxRelays, ...repoAnnouncementRelays, ...GIT_RELAYS]))
      .map(relay => normalizeRelayUrl(relay))
      .filter(Boolean) as string[]
  }

  const getProfileSearchMatches = (query: string) => {
    try {
      const searchStore = getStore(profileSearch)
      return (searchStore?.searchValues?.(query) || []) as string[]
    } catch {
      return []
    }
  }

  const getSearchProfile = (pubkey: string) =>
    discoveredOwnerProfiles[pubkey] || $profilesByPubkey.get(pubkey) || null

  const parseDiscoveryProfileEvent = (event: NostrEvent): RepoOwnerProfile | null => {
    try {
      const content = JSON.parse(event.content || "{}")
      if (!content || typeof content !== "object") return null

      return {
        display_name:
          typeof content.display_name === "string" ? content.display_name : undefined,
        name: typeof content.name === "string" ? content.name : undefined,
        nip05: typeof content.nip05 === "string" ? content.nip05 : undefined,
        picture: typeof content.picture === "string" ? content.picture : undefined,
      }
    } catch {
      return null
    }
  }

  const updateDiscoveredOwnerProfiles = (events: NostrEvent[]) => {
    const nextProfiles = {...discoveredOwnerProfiles}
    let changed = false

    for (const event of events) {
      if (event.kind !== 0 || !event.pubkey) continue
      const parsed = parseDiscoveryProfileEvent(event)
      if (!parsed) continue
      nextProfiles[event.pubkey] = {
        ...(nextProfiles[event.pubkey] || {}),
        ...parsed,
      }
      changed = true
    }

    if (changed) {
      discoveredOwnerProfiles = nextProfiles
    }
  }

  const openRepoSearchSettingsModal = () => {
    pushModal(RepoSearchSettingsModal, {
      settings: repoDiscoveryPrioritySettings,
      onApply: (nextSettings: RepoDiscoveryPrioritySetting[]) => {
        repoDiscoveryPrioritySettings = nextSettings
      },
    })
  }

  const abortRepoDiscovery = ({
    phase = "aborted",
    keepResults = true,
  }: {
    phase?: RepoDiscoveryStatus["phase"]
    keepResults?: boolean
  } = {}) => {
    if (repoDiscoveryDebounceTimer) {
      clearTimeout(repoDiscoveryDebounceTimer)
      repoDiscoveryDebounceTimer = null
    }

    if (repoDiscoveryController) {
      repoDiscoveryController.abort()
      repoDiscoveryController = null
    }

    const shouldReset = !keepResults || !searchQuery.trim()

    if (shouldReset) {
      discoveredSearchRepoPool = []
      discoveredOwnerProfiles = {}
      activeTextSearchQuery = ""
      repoDiscoveryRunMode = "smart"
      repoDiscoverySnapshot = null
      repoDiscoveryStatus = createEmptyRepoDiscoveryStatus()
      return
    }

    const currentStatus = untrack(() => repoDiscoveryStatus)

    repoDiscoveryStatus = {
      ...currentStatus,
      loading: false,
      phase,
    }
  }

  const stopRepoDiscovery = () => {
    if (!repoDiscoveryController) return
    abortRepoDiscovery({phase: "aborted", keepResults: true})
  }

  const continueRepoDiscovery = () => {
    if (!trimmedSearchQuery || trimmedSearchQuery !== activeTextSearchQuery) return
    repoDiscoveryRunMode = "exhaustive"
    repoDiscoveryRunNonce += 1
  }

  const bookmarkedRepoOwners = $derived.by(() =>
    Array.from(new Set(bookmarkedAddresses.map(bookmark => bookmark.author).filter(Boolean))),
  )

  const followedPubkeys = $derived.by(() => {
    if (!$pubkey) return [] as string[]

    try {
      return Array.from(new Set(getFollows($pubkey).filter(Boolean)))
    } catch {
      return []
    }
  })

  const knownRepoOwners = $derived.by(() => {
    const owners = new Set<string>()

    latestMyRepos.forEach(repo => owners.add(repo.event.pubkey))
    loadedBookmarkedRepos.forEach(repo => owners.add(repo.event.pubkey))
    ;(($repoAnnouncements as RepoAnnouncementEvent[]) || []).forEach(event => owners.add(event.pubkey))

    return Array.from(owners).filter(Boolean)
  })

  $effect(() => {
    const {pubkey, relayHints} = accountSearch
    if (!pubkey) return

    const filter = {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [pubkey]} as any
    const relaysToQuery = getAccountSearchRelays(pubkey, relayHints)
    const loadKey = `${pubkey}|${relaysToQuery.slice().sort().join(",")}`

    if (attemptedAccountSearchLoads.has(loadKey)) return

    attemptedAccountSearchLoads.add(loadKey)

    if (relaysToQuery.length > 0) {
      load({relays: relaysToQuery, filters: [filter]})
    }
  })

  const accountSearchReposStore = $derived.by(() => {
    const {pubkey} = accountSearch
    if (!pubkey) return undefined
    const filter = {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [pubkey]} as any

    return deriveEventsDesc(deriveEventsById({repository, filters: [filter]}))
  })

  const accountSearchRepos = $derived.by(() => {
    if (!$accountSearchReposStore) return []

    return ($accountSearchReposStore as RepoAnnouncementEvent[])
      .filter(event => !isDeletedRepoAnnouncement(event))
      .map(event => {
        let addressString = ""
        try {
          const address = Address.fromEvent(event)
          addressString = address.toString()
        } catch {
          const dTag = (event.tags || []).find((t: string[]) => t[0] === "d")?.[1]
          if (dTag && event.pubkey && event.kind) {
            addressString = `${event.kind}:${event.pubkey}:${dTag}`
          }
        }

        const relayHintFromEvent = Router.get().getRelaysForPubkey(event.pubkey)?.[0]
        return {address: addressString, event, relayHint: relayHintFromEvent || ""}
      })
      .filter(item => item.address)
  })

  const matchedNaddrRepo = $derived.by(() => {
    const {mode, identifier} = accountSearch
    if (mode !== "naddr" || !identifier) return null
    return (
      accountSearchRepos.find(repo => {
        const dTag = (repo.event.tags || []).find((t: string[]) => t[0] === "d")?.[1] || ""
        return dTag === identifier
      }) || null
    )
  })

  const accountSearchVisibleRepos = $derived.by(() => {
    const {mode, identifier} = accountSearch
    if (mode !== "naddr" || !identifier || !matchedNaddrRepo) {
      return accountSearchRepos
    }

    return accountSearchRepos.filter(repo => {
      const dTag = (repo.event.tags || []).find((t: string[]) => t[0] === "d")?.[1] || ""
      return dTag === identifier
    })
  })

  const trimmedSearchQuery = $derived.by(() => searchQuery.trim())

  const hasRepoSearchInput = $derived.by(
    () => activeTab !== "snippets" && !isAccountSearch && trimmedSearchQuery.length > 0,
  )

  const shouldLaunchTextSearch = $derived.by(
    () => activeTab !== "snippets" && !isAccountSearch && trimmedSearchQuery.length >= 2,
  )

  const localSearchFilteredRepos = $derived.by(() => {
    if (activeTab === "snippets" || isAccountSearch || !searchQuery.trim()) return []

    return filteredRepos.filter(repo =>
      repoMatchesSearchQuery({
        repo,
        query: searchQuery.trim(),
        profile: getSearchProfile(repo.event.pubkey),
      }),
    )
  })

  const matchedDiscoveredSearchRepos = $derived.by(() => {
    if (!hasRepoSearchInput) return [] as typeof discoveredSearchRepoPool

    return discoveredSearchRepoPool.filter(item =>
      repoMatchesSearchQuery({
        repo: item,
        query: trimmedSearchQuery,
        profile: getSearchProfile(item.event.pubkey),
      }),
    )
  })

  const canContinueRepoDiscovery = $derived.by(
    () =>
      Boolean(trimmedSearchQuery) &&
      trimmedSearchQuery === activeTextSearchQuery &&
      !repoDiscoveryStatus.loading &&
      Boolean(repoDiscoverySnapshot) &&
      repoDiscoverySnapshot!.query === activeTextSearchQuery &&
      repoDiscoverySnapshot!.nextBucketIndex < repoDiscoverySnapshot!.buckets.length,
  )

  const syncDiscoveredSearchRepos = ({
    query,
    repoItemsByAddress,
    nextRepoEvents = [],
  }: {
    query: string
    repoItemsByAddress: Map<string, {address: string; event: RepoAnnouncementEvent; relayHint: string}>
    nextRepoEvents?: RepoAnnouncementEvent[]
  }) => {
    for (const event of nextRepoEvents) {
      if (isDeletedRepoAnnouncement(event)) continue

      const item = toLoadedRepoSearchItem(event, Router.get().getRelaysForPubkey(event.pubkey)?.[0] || "")
      if (!item) continue

      const existing = repoItemsByAddress.get(item.address)
      if (!existing || item.event.created_at > existing.event.created_at) {
        repoItemsByAddress.set(item.address, item)
      }
    }

    const matchingItems = Array.from(repoItemsByAddress.values()).filter(item =>
      repoMatchesSearchQuery({
        repo: item,
        query,
        profile: getSearchProfile(item.event.pubkey),
      }),
    )

    discoveredSearchRepoPool = Array.from(repoItemsByAddress.values())

    return {
      foundRepos: repoItemsByAddress.size,
      matchedRepos: matchingItems.length,
    }
  }

  const repoDiscoveryStatusLines = $derived.by(() => {
    if (!hasRepoSearchInput) return [] as string[]

    if (
      !repoDiscoveryStatus.loading &&
      !repoDiscoveryStatus.timedOut &&
      repoDiscoveryStatus.phase === "idle" &&
      repoDiscoveryStatus.searchedAuthors === 0 &&
      repoDiscoveryStatus.foundRepos === 0
    ) {
      return [] as string[]
    }

    const lines: string[] = []

    if (repoDiscoveryStatus.phase === "preparing") {
      lines.push(
        repoDiscoveryRunMode === "exhaustive"
          ? "Preparing exhaustive discovery across all enabled search sources."
          : "Preparing discovery targets from your enabled search sources.",
      )
    }

    if (repoDiscoveryStatus.phase === "typing") {
      lines.push(
        trimmedSearchQuery.length < 2
          ? "Type at least 2 characters to discover repos beyond the local list."
          : "Typing... waiting to launch a new search.",
      )
    }

    if (repoDiscoveryStatus.phase === "fetching_profiles" && repoDiscoveryStatus.currentBucketLabel) {
      lines.push(`Loading owner profiles from ${repoDiscoveryStatus.currentBucketLabel}.`)
    }

    if (repoDiscoveryStatus.phase === "fetching_repos" && repoDiscoveryStatus.currentBucketLabel) {
      lines.push(`Loading repository announcements from ${repoDiscoveryStatus.currentBucketLabel}.`)
    }

    if (repoDiscoveryStatus.loading && repoDiscoveryRunMode === "exhaustive") {
      lines.push("Continuing search until all enabled targets are exhausted or you press Stop.")
    }

    if (repoDiscoveryStatus.totalBuckets > 0 && repoDiscoveryStatus.currentBucketLabel) {
      lines.push(
        `Target group ${repoDiscoveryStatus.currentBucketIndex}/${repoDiscoveryStatus.totalBuckets}: ${repoDiscoveryStatus.currentBucketLabel}.`,
      )
    }

    if (repoDiscoveryStatus.totalAuthors > 0) {
      lines.push(
        `Owners processed ${Math.min(repoDiscoveryStatus.searchedAuthors, repoDiscoveryStatus.totalAuthors)}/${repoDiscoveryStatus.totalAuthors}.`,
      )
    }

    if (repoDiscoveryStatus.currentBucketTotalAuthors > 0) {
      lines.push(
        `Current group progress ${Math.min(repoDiscoveryStatus.currentBucketProcessedAuthors, repoDiscoveryStatus.currentBucketTotalAuthors)}/${repoDiscoveryStatus.currentBucketTotalAuthors}.`,
      )
    }

    lines.push(
      `Profiles checked ${repoDiscoveryStatus.fetchedProfileAuthors}, repo owners checked ${repoDiscoveryStatus.fetchedRepoAuthors}.`,
    )
    lines.push(
      `Found ${repoDiscoveryStatus.foundRepos} repositories, ${repoDiscoveryStatus.matchedRepos} matching this search.`,
    )

    if (repoDiscoveryStatus.timedOut) {
      lines.push("Timed out after 30 seconds. Showing current results.")
    } else if (repoDiscoveryStatus.phase === "aborted") {
      lines.push("Search stopped. Showing results found so far.")
    } else if (!repoDiscoveryStatus.loading && repoDiscoveryStatus.phase === "complete") {
      lines.push(
        repoDiscoveryRunMode === "exhaustive"
          ? "Searched all enabled targets."
          : "Discovery finished within the 30 second budget.",
      )
    }

    return lines
  })

  $effect(() => {
    const query = trimmedSearchQuery

    if (activeTab === "snippets" || isAccountSearch) {
      abortRepoDiscovery({phase: "idle", keepResults: true})
      activeTextSearchQuery = ""
      return
    }

    if (!query) {
      abortRepoDiscovery({phase: "idle", keepResults: false})
      return
    }

    if (query !== activeTextSearchQuery) {
      abortRepoDiscovery({phase: "typing", keepResults: true})
    }

    if (query.length < 2) {
      activeTextSearchQuery = ""
      return
    }

    if (query === activeTextSearchQuery) {
      return
    }

    repoDiscoveryDebounceTimer = setTimeout(() => {
      repoDiscoveryRunMode = "smart"
      repoDiscoveryRunNonce += 1
      repoDiscoverySnapshot = null
      activeTextSearchQuery = query
      repoDiscoveryDebounceTimer = null
    }, 250)

    return () => {
      if (repoDiscoveryDebounceTimer) {
        clearTimeout(repoDiscoveryDebounceTimer)
        repoDiscoveryDebounceTimer = null
      }
    }
  })

  $effect(() => {
    const query = activeTextSearchQuery.trim()
    const runMode = repoDiscoveryRunMode
    repoDiscoveryRunNonce

    if (!query || activeTab === "snippets" || isAccountSearch) {
      return
    }

    const discoveryInputs = untrack(() => ({
      settings: repoDiscoveryPrioritySettings.map(setting => ({...setting})),
      viewerPubkey: $pubkey,
      bookmarkedOwners: [...bookmarkedRepoOwners],
      followPubkeys: [...followedPubkeys],
      knownOwners: [...knownRepoOwners],
      trustScores: new Map(getActiveTrustGraph().scores),
      profileMatches: getProfileSearchMatches(query),
      existingRepoPool: [...discoveredSearchRepoPool],
      runMode,
    }))

    const previousSnapshot = untrack(() => repoDiscoverySnapshot)

    let snapshot: RepoDiscoverySnapshot

    if (previousSnapshot?.query === query && previousSnapshot.nextBucketIndex < previousSnapshot.buckets.length) {
      snapshot = {
        ...previousSnapshot,
      }
    } else {
      const buckets = dedupeRepoDiscoveryBuckets(
        buildRepoDiscoveryBuckets({
          settings: discoveryInputs.settings,
          viewerPubkey: discoveryInputs.viewerPubkey,
          bookmarkedOwners: discoveryInputs.bookmarkedOwners,
          followPubkeys: discoveryInputs.followPubkeys,
          knownOwners: discoveryInputs.knownOwners,
          profileMatches: discoveryInputs.profileMatches,
          trustScores: discoveryInputs.trustScores,
        }),
      )

      snapshot = {
        query,
        buckets,
        totalAuthors: buckets.reduce((sum, bucket) => sum + bucket.pubkeys.length, 0),
        nextBucketIndex: 0,
        nextBucketOffset: 0,
        searchedAuthors: 0,
        fetchedProfileAuthors: 0,
        fetchedRepoAuthors: 0,
        foundRepos: 0,
        matchedRepos: 0,
      }

      repoDiscoverySnapshot = snapshot
    }

    const controller = new AbortController()
    repoDiscoveryController = controller

    const repoItemsByAddress = new Map<
      string,
      {address: string; event: RepoAnnouncementEvent; relayHint: string}
    >(discoveryInputs.existingRepoPool.map(item => [item.address, item]))
    const initialSync = untrack(() => syncDiscoveredSearchRepos({query, repoItemsByAddress}))
    const startedAt = Date.now()

    let searchedAuthors = snapshot.searchedAuthors
    let fetchedProfileAuthors = snapshot.fetchedProfileAuthors
    let fetchedRepoAuthors = snapshot.fetchedRepoAuthors
    let foundRepos = Math.max(snapshot.foundRepos, initialSync.foundRepos)
    let matchedRepos = Math.max(snapshot.matchedRepos, initialSync.matchedRepos)
    let timedOut = false
    let finalBucketKey: RepoDiscoveryPriorityKey | null =
      snapshot.buckets[snapshot.nextBucketIndex]?.key || null
    let finalBucketLabel = snapshot.buckets[snapshot.nextBucketIndex]?.label || ""
    let finalBucketIndex = snapshot.buckets[snapshot.nextBucketIndex]
      ? snapshot.nextBucketIndex + 1
      : 0
    let finalBucketProcessedAuthors = snapshot.nextBucketOffset
    let finalBucketTotalAuthors = snapshot.buckets[snapshot.nextBucketIndex]?.pubkeys.length || 0

    void (async () => {
      try {
        const buckets = snapshot.buckets
        const totalAuthors = snapshot.totalAuthors

        if (totalAuthors === 0) {
          if (!controller.signal.aborted) {
            repoDiscoverySnapshot = {
              ...snapshot,
              nextBucketIndex: buckets.length,
              nextBucketOffset: 0,
              foundRepos,
              matchedRepos,
            }
            repoDiscoveryStatus = {
              ...createEmptyRepoDiscoveryStatus(),
              phase: "complete",
              foundRepos,
              matchedRepos,
            }
          }
          return
        }

        repoDiscoveryStatus = {
          ...createEmptyRepoDiscoveryStatus(),
          loading: true,
          phase: "preparing",
          totalAuthors,
          totalBuckets: buckets.length,
          foundRepos,
          matchedRepos,
        }

        outer: for (let bucketIndex = snapshot.nextBucketIndex; bucketIndex < buckets.length; bucketIndex += 1) {
          const bucket = buckets[bucketIndex]
          finalBucketKey = bucket.key
          finalBucketLabel = bucket.label
          finalBucketIndex = bucketIndex + 1
          finalBucketTotalAuthors = bucket.pubkeys.length

          const initialOffset = bucketIndex === snapshot.nextBucketIndex ? snapshot.nextBucketOffset : 0

          for (let offset = initialOffset; offset < bucket.pubkeys.length; offset += 24) {
            if (controller.signal.aborted) return

            let remainingMs =
              discoveryInputs.runMode === "smart"
                ? REPO_DISCOVERY_TIMEOUT_MS - (Date.now() - startedAt)
                : Number.POSITIVE_INFINITY
            if (remainingMs <= 0) {
              timedOut = true
              break outer
            }

            const authors = bucket.pubkeys.slice(offset, offset + 24)
            const relays = getDiscoveryRelays(authors)
            finalBucketProcessedAuthors = offset

            repoDiscoveryStatus = {
              loading: true,
              timedOut: false,
              phase: "fetching_profiles",
              currentBucketKey: bucket.key,
              currentBucketLabel: bucket.label,
              currentBucketIndex: bucketIndex + 1,
              totalBuckets: buckets.length,
              currentBucketProcessedAuthors: offset,
              currentBucketTotalAuthors: bucket.pubkeys.length,
              searchedAuthors,
              totalAuthors,
              fetchedProfileAuthors,
              fetchedRepoAuthors,
              foundRepos,
              matchedRepos,
            }

              if (relays.length > 0) {
                const profileEvents = await fetchRelayEventsWithTimeout<NostrEvent>({
                  relays,
                  filters: [{kinds: [0], authors}],
                timeoutMs: Math.min(4000, remainingMs),
                signal: controller.signal,
              })

                if (controller.signal.aborted) return

                fetchedProfileAuthors += authors.length
                untrack(() => updateDiscoveredOwnerProfiles(profileEvents))

                const profileSync = untrack(() => syncDiscoveredSearchRepos({
                  query,
                  repoItemsByAddress,
                }))
                foundRepos = profileSync.foundRepos
                matchedRepos = profileSync.matchedRepos
              }

            remainingMs =
              discoveryInputs.runMode === "smart"
                ? REPO_DISCOVERY_TIMEOUT_MS - (Date.now() - startedAt)
                : Number.POSITIVE_INFINITY
            if (remainingMs <= 0) {
              timedOut = true
              break outer
            }

            repoDiscoveryStatus = {
              loading: true,
              timedOut: false,
              phase: "fetching_repos",
              currentBucketKey: bucket.key,
              currentBucketLabel: bucket.label,
              currentBucketIndex: bucketIndex + 1,
              totalBuckets: buckets.length,
              currentBucketProcessedAuthors: offset,
              currentBucketTotalAuthors: bucket.pubkeys.length,
              searchedAuthors,
              totalAuthors,
              fetchedProfileAuthors,
              fetchedRepoAuthors,
              foundRepos,
              matchedRepos,
            }

            if (relays.length > 0) {
              const repoEvents = await fetchRelayEventsWithTimeout<RepoAnnouncementEvent>({
                relays,
                filters: [{kinds: [GIT_REPO_ANNOUNCEMENT], authors}],
                timeoutMs: Math.min(5000, remainingMs),
                signal: controller.signal,
              })

              if (controller.signal.aborted) return

                fetchedRepoAuthors += authors.length

                const repoSync = untrack(() => syncDiscoveredSearchRepos({
                  query,
                  repoItemsByAddress,
                  nextRepoEvents: repoEvents,
                }))
                foundRepos = repoSync.foundRepos
                matchedRepos = repoSync.matchedRepos
              }

            searchedAuthors += authors.length
            finalBucketProcessedAuthors = Math.min(offset + authors.length, bucket.pubkeys.length)

            snapshot = {
              ...snapshot,
              nextBucketIndex:
                finalBucketProcessedAuthors < bucket.pubkeys.length ? bucketIndex : bucketIndex + 1,
              nextBucketOffset:
                finalBucketProcessedAuthors < bucket.pubkeys.length ? finalBucketProcessedAuthors : 0,
              searchedAuthors,
              fetchedProfileAuthors,
              fetchedRepoAuthors,
              foundRepos,
              matchedRepos,
            }
            repoDiscoverySnapshot = snapshot

            repoDiscoveryStatus = {
              loading: true,
              timedOut: false,
              phase: "fetching_repos",
              currentBucketKey: bucket.key,
              currentBucketLabel: bucket.label,
              currentBucketIndex: bucketIndex + 1,
              totalBuckets: buckets.length,
              currentBucketProcessedAuthors: finalBucketProcessedAuthors,
              currentBucketTotalAuthors: bucket.pubkeys.length,
              searchedAuthors,
              totalAuthors,
              fetchedProfileAuthors,
              fetchedRepoAuthors,
              foundRepos,
              matchedRepos,
            }
          }
        }

        if (controller.signal.aborted) return

        if (!timedOut) {
          snapshot = {
            ...snapshot,
            nextBucketIndex: buckets.length,
            nextBucketOffset: 0,
            searchedAuthors,
            fetchedProfileAuthors,
            fetchedRepoAuthors,
            foundRepos,
            matchedRepos,
          }
          repoDiscoverySnapshot = snapshot
        }

        repoDiscoveryStatus = {
          loading: false,
          timedOut,
          phase: "complete",
          currentBucketKey: finalBucketKey,
          currentBucketLabel: finalBucketLabel,
          currentBucketIndex: finalBucketIndex,
          totalBuckets: buckets.length,
          currentBucketProcessedAuthors: finalBucketProcessedAuthors,
          currentBucketTotalAuthors: finalBucketTotalAuthors,
          searchedAuthors,
          totalAuthors,
          fetchedProfileAuthors,
          fetchedRepoAuthors,
          foundRepos,
          matchedRepos,
        }
        if (repoDiscoveryController === controller) {
          repoDiscoveryController = null
        }
        } catch (error) {
          if (controller.signal.aborted) return
          console.error("[git/+page] Failed to discover repositories from search", error)
          const currentStatus = untrack(() => repoDiscoveryStatus)
          repoDiscoveryStatus = {
            ...currentStatus,
            loading: false,
            phase: "aborted",
          }
          if (repoDiscoveryController === controller) {
            repoDiscoveryController = null
          }
      }
    })()

    return () => {
      controller.abort()
      if (repoDiscoveryController === controller) {
        repoDiscoveryController = null
      }
    }
  })

  // Filter repos based on search query (from current tab)
  const searchFilteredRepos = $derived.by(() => {
    const repos = filteredRepos
    if (isAccountSearch) return []

    if (!trimmedSearchQuery) return repos

    return mergeLoadedRepoSearchItems(localSearchFilteredRepos, matchedDiscoveredSearchRepos)
  })

  // Store for account search (naddr/npub) repo cards
  let accountSearchRepoCards = $state<any[]>([])
  let accountSearchCardsComputeTimer: ReturnType<typeof setTimeout> | null = null
  const sortedAccountSearchRepoCards = $derived.by(() =>
    prioritizeFreshRepoCards(accountSearchRepoCards),
  )

  // Update account search repo cards
  $effect(() => {
    if (!isAccountSearch) {
      if (accountSearchCardsComputeTimer) {
        clearTimeout(accountSearchCardsComputeTimer)
        accountSearchCardsComputeTimer = null
      }
      accountSearchRepoCards = []
      return
    }

    const repos = accountSearchVisibleRepos
    if (repos.length > 0) {
      if (accountSearchCardsComputeTimer) {
        clearTimeout(accountSearchCardsComputeTimer)
      }
      accountSearchCardsComputeTimer = setTimeout(() => {
        const cards = repositoriesStore.computeCards(repos, {
          deriveMaintainersForEuc,
          deriveRepoRefState,
          derivePatchGraph,
          parseRepoAnnouncementEvent,
          Router,
          Address,
          repoAnnouncements: $repoAnnouncements,
          gitRelays: GIT_RELAYS,
        })
        accountSearchRepoCards = cards
        accountSearchCardsComputeTimer = null
      }, 0)
    } else {
      if (accountSearchCardsComputeTimer) {
        clearTimeout(accountSearchCardsComputeTimer)
        accountSearchCardsComputeTimer = null
      }
      accountSearchRepoCards = []
    }
  })

  // Memoize card computation to prevent jitter
  let cachedCards: any[] = []
  let cachedCardsKey = ""
  let cardsComputeTimer: ReturnType<typeof setTimeout> | null = null
  const sortedRepoCards = $derived.by(() => prioritizeFreshRepoCards($repositoriesStore as any[]))
  
  // Update repositoriesStore whenever repos change
  // Uses debouncing to wait for all repos to load before showing cards
  $effect(() => {
    if (activeTab === "snippets") {
      return
    }

    if (isAccountSearch) {
      return
    }

    const reposToShow = searchFilteredRepos
    if (reposToShow.length > 0 || !loading) {
      loading = false
      if (reposToShow.length > 0) {
        // Create a stable key based on visible repo IDs only
        const repoIds = reposToShow.map((r: any) => (r.event ?? r).id).sort().join(",")
        const cardsKey = repoIds
        
        // Only recompute and push cards when the key has actually changed
        if (cardsKey !== cachedCardsKey) {
          if (cardsComputeTimer) {
            clearTimeout(cardsComputeTimer)
            cardsComputeTimer = null
          }
          cardsComputeTimer = setTimeout(() => {
            const cards = repositoriesStore.computeCards(reposToShow, {
              deriveMaintainersForEuc,
              deriveRepoRefState,
              derivePatchGraph,
              parseRepoAnnouncementEvent,
              Router,
              Address,
              repoAnnouncements: $repoAnnouncements,
              gitRelays: GIT_RELAYS,
            })
            cachedCards = cards
            cachedCardsKey = cardsKey
            repositoriesStore.set(cachedCards)
            cardsComputeTimer = null
          }, 0)
        } else if (getStore(repositoriesStore).length === 0 && cachedCards.length > 0) {
          repositoriesStore.set(cachedCards)
        }

      } else {
        if (cardsComputeTimer) {
          clearTimeout(cardsComputeTimer)
          cardsComputeTimer = null
        }
        untrack(() => {
          repositoriesStore.clear()
        })
      }
    }
  })

  onDestroy(() => {
    if (cardsComputeTimer) {
      clearTimeout(cardsComputeTimer)
      cardsComputeTimer = null
    }
    if (accountSearchCardsComputeTimer) {
      clearTimeout(accountSearchCardsComputeTimer)
      accountSearchCardsComputeTimer = null
    }
    if (repoDiscoveryDebounceTimer) {
      clearTimeout(repoDiscoveryDebounceTimer)
      repoDiscoveryDebounceTimer = null
    }
    if (repoDiscoveryController) {
      repoDiscoveryController.abort()
      repoDiscoveryController = null
    }
  })

  const back = () => history.back()

  const shouldShowRepoCardBookmark = (event?: RepoAnnouncementEvent | null) =>
    Boolean(event && event.pubkey !== $pubkey)

  const getRepoCardRelayHint = (event: RepoAnnouncementEvent, address = getRepoAddressFromEvent(event)) => {
    const fromLoadedBookmarks = loadedBookmarkedRepos.find(repo => repo.address === address)?.relayHint || ""
    const fromTracker = Array.from(tracker.getRelays(event.id) || [])[0] || ""
    const fromPubkey = Router.get().getRelaysForPubkey(event.pubkey)?.[0] || ""
    const relayTag = (event.tags || []).find((tag: string[]) => tag[0] === "relays")?.[1] || ""

    return fromLoadedBookmarks || fromTracker || fromPubkey || relayTag || ""
  }

  const getRepoCardCanonicalKeys = (event?: RepoAnnouncementEvent | null) => {
    const canonicalKey = getCanonicalRepoKeyFromEvent(event)
    return canonicalKey ? [canonicalKey] : []
  }

  const getRepoCardCandidateAddresses = (event?: RepoAnnouncementEvent | null) => {
    if (!event) return new Set<string>()

    const address = getRepoAddressFromEvent(event)
    if (!address) return new Set<string>()

    const candidates = getEffectiveRepoAddresses($effectiveRepoAddressesByRepoAddress, address)
    candidates.add(address)
    return candidates
  }

  const isRepoCardBookmarked = (event?: RepoAnnouncementEvent | null) =>
    Boolean(event) &&
    isAnyBookmarked(bookmarkedAddresses, getRepoCardCandidateAddresses(event), {
      candidateRepoKeys: getRepoCardCanonicalKeys(event),
      getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent | undefined,
    })

  let pendingBookmarkAddresses = $state<Record<string, boolean>>({})

  const isRepoCardBookmarkPending = (event?: RepoAnnouncementEvent | null) => {
    if (!event) return false
    const address = getRepoAddressFromEvent(event)
    return address ? Boolean(pendingBookmarkAddresses[address]) : false
  }

  const setRepoCardBookmarkPending = (address: string, value: boolean) => {
    const next = {...pendingBookmarkAddresses}
    if (value) next[address] = true
    else delete next[address]
    pendingBookmarkAddresses = next
  }

  const toggleRepoCardBookmark = async (event?: RepoAnnouncementEvent | null) => {
    if (!event || !$pubkey) {
      if (!$pubkey) {
        pushToast({message: "Sign in to bookmark repositories", theme: "warning"})
      }
      return
    }

    const address = getRepoAddressFromEvent(event)
    if (!address || pendingBookmarkAddresses[address]) return

    setRepoCardBookmarkPending(address, true)

    try {
      const relayHint = getRepoCardRelayHint(event, address)
      const bookmarkEntry: BookmarkAddress = {
        address,
        relayHint,
        author: event.pubkey,
        identifier: address.split(":").slice(2).join(":") || getTagValue("d", event.tags) || "",
      }

      const toggleResult = toggleRepoBookmarks({
        bookmarks: bookmarkedAddresses,
        candidateAddresses: getRepoCardCandidateAddresses(event),
        candidateRepoKeys: getRepoCardCanonicalKeys(event),
        nextBookmark: bookmarkEntry,
        getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      })

      const tags: string[][] = [["d", GIT_REPO_BOOKMARK_DTAG]]
      toggleResult.nextBookmarks.forEach(bookmark => {
        const aTag = ["a", bookmark.address]
        if (bookmark.relayHint) aTag.push(bookmark.relayHint)
        tags.push(aTag)
      })

      bookmarksStore.set(toggleResult.nextBookmarks)

      const bookmarkEvent = makeEvent(NAMED_BOOKMARKS, {tags, content: ""})
      const relays = Array.from(
        new Set([relayHint, ...bookmarkRelays].map(relay => normalizeRelayUrl(relay)).filter(Boolean)),
      ) as string[]

      publishThunk({event: bookmarkEvent, relays})
      pushToast({message: toggleResult.isRemoving ? "Bookmark removed" : "Repository bookmarked"})
    } catch (error) {
      console.error("[git/+page] Failed to toggle bookmark from repo card", error)
      pushToast({message: "Failed to update bookmark", theme: "error"})
    } finally {
      setRepoCardBookmarkPending(address, false)
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

  const getUserOutboxRelays = (): string[] => {
    try {
      return Router.get().FromUser().getUrls() || []
    } catch {
      return []
    }
  }

  const resolveRepoEventPublishRelays = (event: any, fallbackRelays: string[] = defaultRepoRelays) => {
    const policy = resolveRepoRelayPolicy({
      event,
      fallbackRepoRelays: fallbackRelays,
      userOutboxRelays: getUserOutboxRelays(),
      gitRelays: GIT_RELAYS,
    })

    if (policy.isGrasp && policy.repoRelays.length === 0) {
      throw new Error("GRASP repository event is missing explicit relay targets")
    }

    return policy.publishRelays
  }

  const buildRepoNaddrFromAnnouncement = (
    event: any,
    fallbackPubkey: string,
    fallbackRelays: string[] = [],
  ): string => {
    const naddr = buildRepoNaddrFromEvent({
      event,
      fallbackPubkey,
      fallbackRepoRelays: [...getTaggedRelaysFromRepoEvent(event), ...(fallbackRelays || [])],
      userOutboxRelays: getUserOutboxRelays(),
      gitRelays: GIT_RELAYS,
    })

    if (!naddr) {
      throw new Error("Repository announcement is missing required naddr fields")
    }

    return naddr
  }

  const getRepoBrowseHref = (event: RepoAnnouncementEvent) =>
    makeGitPath(url, buildRepoNaddrFromAnnouncement(event, event.pubkey || ""))

  const navigateToRepoCard = (announcement: RepoAnnouncementEvent) =>
    void goto(getRepoBrowseHref(announcement)).catch(error => {
      console.error("[+page.svelte] Failed to navigate to repository:", error)
      pushToast({
        message: `Failed to navigate to repository: ${String(error)}`,
        theme: "error",
      })
    })

  const handleRepoCardNeutralClick = (event: MouseEvent, announcement: RepoAnnouncementEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return

    navigateToRepoCard(announcement)
  }

  const handleRepoCardNeutralKeydown = (event: KeyboardEvent, announcement: RepoAnnouncementEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return

    event.preventDefault()
    navigateToRepoCard(announcement)
  }

  const extractRelayAck = (thunk: any) => {
    const results = thunk?.results || {}
    const ackedRelays = Object.entries(results)
      .filter(([, result]: [string, any]) => result?.status === PublishStatus.Success)
      .map(([relay]) => relay)
    const failedRelays = Object.entries(results)
      .filter(([, result]: [string, any]) => result?.status !== PublishStatus.Success)
      .map(([relay]) => relay)

    return {
      ackedRelays,
      failedRelays,
      successCount: ackedRelays.length,
    }
  }

  const fetchRelayEvents = async (params: {
    relays: string[]
    filters: NostrFilter[]
    timeoutMs?: number
  }): Promise<NostrEvent[]> =>
    fetchRelayEventsWithTimeout<NostrEvent>({
      relays: params.relays,
      filters: params.filters as any,
      timeoutMs: params.timeoutMs,
    })

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
        NewRepoWizard,
        {
          workerApi, // Pass initialized worker API
          workerInstance, // Pass worker instance for event signing
          onRepoCreated: () => {
            // Reload repos by forcing bookmarks refresh and announcements
            loadRepoAnnouncements(repoAnnouncementRelays)
          },
          onNavigateToRepo: (result: NewRepoResult) => {
            try {
              const naddr = buildRepoNaddrFromAnnouncement(result.announcementEvent, $pubkey || "")
              const destination = makeGitPath(url, naddr)
              clearModals()
              void goto(destination).catch(error => {
                console.error("[+page.svelte] Failed to navigate to new repo:", error)
                pushToast({
                  message: `Failed to navigate to repository: ${String(error)}`,
                  theme: "error",
                })
              })
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
            const targetRelays = resolveRepoEventPublishRelays(repoEvent, defaultRepoRelays)
            const thunk = await publishEventToRelays(repoEvent, targetRelays)
            return extractRelayAck(thunk)
          },
          onFetchRelayEvents: fetchRelayEvents,
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

    // Ensure worker is initialized before opening import dialog
    if (!workerApi || !workerInstance) {
      console.log("[+page.svelte] Worker not initialized for import, initializing...")
      try {
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
        console.log("[+page.svelte] Worker initialized for import")
      } catch (error) {
        console.error("[+page.svelte] Failed to initialize worker for import:", error)
        pushToast({
          message: `Failed to initialize Git worker: ${String(error)}`,
          theme: "error",
        })
        return
      }
    }

    // Create onSignEvent callback that works with any signer
    const onSignEvent = async (
      event: Omit<NostrEvent, "id" | "sig" | "pubkey">,
    ): Promise<NostrEvent> => {
      return await signer.sign(event)
    }

    try {
      const rollbackPublishedRepoEvents = async (params: {
        repoName: string
        relays: string[]
      }): Promise<void> => {
        if (!$pubkey) return

        const rollbackRelays = Array.from(
          new Set(params.relays.map(r => normalizeRelayUrl(r)).filter(Boolean)),
        )

        if (rollbackRelays.length === 0) return

        const filters = [
          {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [$pubkey], "#d": [params.repoName]},
          {kinds: [GIT_REPO_STATE], authors: [$pubkey], "#d": [params.repoName]},
        ]

        try {
          await load({relays: rollbackRelays, filters: filters as any}).catch(() => {})
        } catch {
          // pass
        }

        const events = repository.query(filters as any, {shouldSort: false}) as Array<any>
        const seen = new Set<string>()

        for (const event of events) {
          if (event.pubkey !== $pubkey) continue
          if (!event.id || seen.has(event.id)) continue
          seen.add(event.id)

          const thunk = publishDelete({
            protect: false,
            event,
            relays: rollbackRelays,
          })
          if (thunk?.complete) {
            await thunk.complete
          }
        }
      }

      const modalId = pushModal(
        ImportRepoDialog,
        {
          pubkey: $pubkey!,
          workerApi,
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
          onFetchRelayEvents: fetchRelayEvents,
          onClose: () => {
            clearModals()
          },
          onPublishEvent: async (repoEvent: NostrEvent) => {
            const targetRelays = resolveRepoEventPublishRelays(repoEvent, defaultRepoRelays)
            const thunk = await publishEventToRelays(repoEvent, targetRelays)
            return extractRelayAck(thunk)
          },
          onRollbackPublishedRepoEvents: rollbackPublishedRepoEvents,
          onImportComplete: (result: ImportResult) => {
            // Reload repos by forcing bookmarks refresh and announcements
            loadRepoAnnouncements(repoAnnouncementRelays)
            pushToast({
              message: `Successfully imported repository! Imported ${result.issuesImported} issues, ${result.commentsImported} comments, ${result.prsImported} PRs, and created ${result.profilesCreated} profiles.`,
            })
          },
          onNavigateToRepo: (result: ImportResult) => {
            try {
              const naddr = buildRepoNaddrFromAnnouncement(result.announcementEvent as any, $pubkey || "")
              const destination = makeGitPath(url, naddr)
              clearModals()
              void goto(destination).catch(error => {
                console.error("[+page.svelte] Failed to navigate to imported repo:", error)
                pushToast({
                  message: `Failed to navigate to repository: ${String(error)}`,
                  theme: "error",
                })
              })
            } catch (error) {
              console.error("[+page.svelte] Failed to navigate to imported repo:", error)
              pushToast({
                message: `Failed to navigate to repository: ${String(error)}`,
                theme: "error",
              })
            }
          },
          onAbortImport: async () => {
            try {
              terminateGitWorker()
              const {api, worker} = await getInitializedGitWorker()
              workerApi = api
              workerInstance = worker
            } catch (error) {
              console.error("[+page.svelte] Failed to restart worker after import cancel:", error)
            }
          },
          defaultRelays: [...defaultRepoRelays],
          searchRelays: searchRelaysForWizard,
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
        <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <TabsList class="flex w-full overflow-x-auto sm:w-fit sm:max-w-full sm:self-start">
            <TabsTrigger value="my-repos" class="flex-1 whitespace-nowrap sm:flex-none">
              <span class="flex items-center gap-2">
                <Icon icon={FolderWithFiles} />
                <span>My Repos</span>
                {#if hasMyRepoNotifications}
                  <span class="h-2 w-2 rounded-full bg-primary" aria-label="Unread updates"></span>
                {/if}
              </span>
            </TabsTrigger>
            <TabsTrigger value="bookmarks" class="flex-1 whitespace-nowrap sm:flex-none">
              <span class="flex items-center gap-2">
                <Icon icon={Bookmark} />
                <span>Bookmarks</span>
                {#if hasBookmarkNotifications}
                  <span class="h-2 w-2 rounded-full bg-primary" aria-label="Unread updates"></span>
                {/if}
              </span>
            </TabsTrigger>
            <TabsTrigger value="snippets" class="flex-1 whitespace-nowrap sm:flex-none">
              <span class="flex items-center gap-2">
                <Icon icon={Code} />
                <span>Snippets</span>
              </span>
            </TabsTrigger>
          </TabsList>
          <div class="flex w-full items-center gap-2 xl:w-[30rem] xl:max-w-[45vw] xl:shrink-0">
            <label
              class="input input-bordered flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <Icon icon={Magnifier} />
              <input
                bind:value={searchQuery}
                class="grow min-w-0"
                type="text"
                placeholder={
                  activeTab === "snippets" ? "Search snippets..." : "Search repo, owner, npub, or naddr"
                } />
              {#if searchQuery}
                <button
                  type="button"
                  class="btn btn-ghost btn-circle btn-xs h-7 min-h-7 w-7 shrink-0"
                  aria-label="Clear search"
                  title="Clear search"
                  onclick={() => (searchQuery = "")}>
                  <X class="h-3.5 w-3.5" />
                </button>
              {/if}
            </label>
            {#if activeTab !== "snippets"}
              {#if repoDiscoveryStatus.loading}
                <button
                  type="button"
                  class="btn btn-error btn-outline btn-sm shrink-0 gap-1"
                  aria-label="Stop repository discovery"
                  title="Stop repository discovery"
                  onclick={stopRepoDiscovery}>
                  <X class="h-4 w-4" />
                  <span>Stop</span>
                </button>
              {:else if canContinueRepoDiscovery}
                <button
                  type="button"
                  class="btn btn-primary btn-outline btn-sm shrink-0"
                  aria-label="Continue searching"
                  title="Continue searching"
                  onclick={continueRepoDiscovery}>
                  <span>Continue searching</span>
                </button>
              {/if}
              <button
                type="button"
                class="btn btn-ghost btn-square btn-sm shrink-0"
                aria-label="Search discovery settings"
                title="Search discovery settings"
                onclick={openRepoSearchSettingsModal}>
                <ListFilter class="h-4 w-4" />
              </button>
            {/if}
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
            <EventRenderer event={snippet as any} />
          {/each}
        </div>
      {/if}
    </div>
  {:else}
  {#if isAccountSearch}
    <div class="flex flex-col gap-2" in:fade={{duration: 200}}>
      {#if accountSearch.mode === "naddr" && accountSearch.invalid}
        <p class="text-sm text-muted-foreground">Invalid repository naddr.</p>
      {:else if accountSearch.mode === "npub" && accountSearch.invalid}
        <p class="text-sm text-muted-foreground">Invalid npub.</p>
      {:else if accountSearch.mode === "naddr" && !matchedNaddrRepo}
        {#if sortedAccountSearchRepoCards.length > 0}
          <p class="text-sm text-muted-foreground">
            Repository not found, but here are other repositories we found from this account.
          </p>
        {:else}
          <p class="text-sm text-muted-foreground">
            Repository not found, and we could not find other repositories from this account.
          </p>
        {/if}
      {:else if accountSearch.mode === "naddr"}
        <p class="text-sm text-muted-foreground">
          Found repository. Showing this repository only.
        </p>
      {:else if accountSearch.mode === "npub"}
        <p class="text-sm text-muted-foreground">Repositories published by this account.</p>
      {/if}

      {#if sortedAccountSearchRepoCards.length > 0}
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {#each sortedAccountSearchRepoCards as g, i (getRepoCardStableKey(g))}
          <div
            class="rounded-md border border-border bg-card p-3"
            role="link"
            tabindex="0"
            onclick={g.first
              ? event => handleRepoCardNeutralClick(event, g.first as RepoAnnouncementEvent)
              : undefined}
            onkeydown={g.first
              ? event => handleRepoCardNeutralKeydown(event, g.first as RepoAnnouncementEvent)
              : undefined}
            in:staggeredFade={{index: i, staggerDelay: 40, duration: 250}}>
            {#if g.first}
              <GitItem
                {url}
                event={g.first as any}
                tabbable={false}
                bookmarked={shouldShowRepoCardBookmark(g.first as RepoAnnouncementEvent) ? isRepoCardBookmarked(g.first as RepoAnnouncementEvent) : false}
                bookmarkDisabled={shouldShowRepoCardBookmark(g.first as RepoAnnouncementEvent) ? isRepoCardBookmarkPending(g.first as RepoAnnouncementEvent) : false}
                onToggleBookmark={shouldShowRepoCardBookmark(g.first as RepoAnnouncementEvent) ? () => toggleRepoCardBookmark(g.first as RepoAnnouncementEvent) : undefined}
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
      {/if}
    </div>
  {:else}

  <!-- Tab-filtered Repos Grid -->
  <div>
    {#if repoDiscoveryStatusLines.length > 0}
      <div class="mb-3 rounded-md border border-border bg-card/70 p-3">
        <div class="flex items-center gap-2 text-sm font-medium text-foreground">
          {#if repoDiscoveryStatus.loading}
            <Spinner loading={repoDiscoveryStatus.loading}>
              {repoDiscoveryRunMode === "exhaustive"
                ? "Continuing search..."
                : "Discovering new Repos..."}
            </Spinner>
          {:else if repoDiscoveryStatus.phase === "typing"}
            <span>Waiting to search</span>
          {:else if repoDiscoveryStatus.phase === "aborted"}
            <span>Search stopped</span>
          {:else if repoDiscoveryStatus.timedOut}
            <span>Discovery timed out</span>
          {:else}
            <span>Discovery complete</span>
          {/if}
        </div>
        <div class="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
          {#each repoDiscoveryStatusLines as line}
            <p>{line}</p>
          {/each}
        </div>
      </div>
    {/if}
    {#if loading}
      <p class="flex h-10 items-center justify-center py-20" out:fly>
        <Spinner {loading}>
          {#if loading}
            Looking for Your Git Repos...
          {:else if $repositoriesStore.length === 0}
            No Repos found.
          {/if}
        </Spinner>
      </p>
    {:else if $repositoriesStore.length === 0}
      <p class="mx-auto max-w-full break-words px-4 py-20 text-center text-muted-foreground">
        {#if searchQuery.trim()}
          No repositories found matching
          <span class="inline max-w-full break-all">"{searchQuery}"</span>.
        {:else if activeTab === "my-repos"}
          You haven't created any repositories yet.
        {:else}
          No bookmarked repositories found.
        {/if}
      </p>
    {:else if sortedRepoCards.length > 0}
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {#each sortedRepoCards as g, i (getRepoCardStableKey(g))}
          {@const effectiveMaintainers = g.effectiveMaintainers ?? g.maintainers ?? []}
          {@const taggedMaintainers = g.taggedMaintainers ?? []}
          <div
            class="rounded-md border border-border bg-card p-3"
            role="link"
            tabindex="0"
            onclick={g.first
              ? event => handleRepoCardNeutralClick(event, g.first as RepoAnnouncementEvent)
              : undefined}
            onkeydown={g.first
              ? event => handleRepoCardNeutralKeydown(event, g.first as RepoAnnouncementEvent)
              : undefined}>
            <!-- Use GitItem for consistent repo card rendering -->
            {#if g.first}
              <GitItem
                {url}
                event={g.first as any}
                tabbable={false}
                bookmarked={shouldShowRepoCardBookmark(g.first as RepoAnnouncementEvent) ? isRepoCardBookmarked(g.first as RepoAnnouncementEvent) : false}
                bookmarkDisabled={shouldShowRepoCardBookmark(g.first as RepoAnnouncementEvent) ? isRepoCardBookmarkPending(g.first as RepoAnnouncementEvent) : false}
                onToggleBookmark={shouldShowRepoCardBookmark(g.first as RepoAnnouncementEvent) ? () => toggleRepoCardBookmark(g.first as RepoAnnouncementEvent) : undefined}
                showActivity={true}
                showIssues={true}
                showActions={true}
                hideDate={true} />
            {/if}

            <!-- Maintainers avatars and date -->
            <div class="mt-3 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="flex -space-x-2">
                  {#each effectiveMaintainers.slice(0, 4) as pk (pk)}
                    {@const prof = $profilesByPubkey.get(pk)}
                    <Avatar class="h-6 w-6 border" title={prof?.display_name || prof?.name || pk}>
                      <AvatarImage src={prof?.picture} alt={prof?.name || pk} />
                      <AvatarFallback
                        >{(prof?.display_name || prof?.name || pk)
                          .slice(0, 2)
                          .toUpperCase()}</AvatarFallback>
                    </Avatar>
                  {/each}
                  {#if effectiveMaintainers.length > 4}
                    <div
                      class="grid h-6 w-6 place-items-center rounded-full border bg-muted text-[10px]">
                      +{effectiveMaintainers.length - 4}
                    </div>
                  {/if}
                </div>
                <span class="text-xs opacity-60"
                  >{effectiveMaintainers.length} effective maintainer{effectiveMaintainers.length !== 1 ? "s" : ""}
                  / {taggedMaintainers.length} tagged</span>
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
  </div>
  {/if}
  {/if}
</PageContent>
