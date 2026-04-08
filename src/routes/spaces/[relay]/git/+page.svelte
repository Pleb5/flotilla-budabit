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
  import {load, PublishStatus} from "@welshman/net"
  import {fly, staggeredFade, staggeredSlideScale, staggeredScaleBounce, staggeredFlip} from "@lib/transition"
  import {fade} from "svelte/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
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
  import {
    GIT_REPO_ANNOUNCEMENT,
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
    RepoPicker,
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
    matchBookmarkedRepoEvents,
  } from "@src/lib/budabit/bookmarks"

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
  })

  $effect(() => {
    if (!gitTabHydrated) return
    if ($gitSelectedTab !== activeTab) {
      gitSelectedTab.set(activeTab)
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

  // Filter repos based on search query (from current tab)
  const searchFilteredRepos = $derived.by(() => {
    const repos = filteredRepos
    if (isAccountSearch) return []

    if (!searchQuery.trim()) return repos

    const query = normalizeSearchValue(searchQuery.trim())
    return repos.filter((repo: any) => {
      try {
        const parsed = parseRepoAnnouncementEvent((repo.event ?? repo) as any)
        const haystack = [parsed?.name, parsed?.description, parsed?.repoId]
          .map(normalizeSearchValue)
          .join(" ")
        return haystack.includes(query)
      } catch {
        return false
      }
    })
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

      pushModal(RepoPicker, {
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
              class="input input-bordered order-1 flex w-full min-w-0 items-center gap-2 overflow-x-hidden sm:order-2 sm:w-auto sm:max-w-md">
              <Icon icon={Magnifier} />
              <input
                bind:value={searchQuery}
                class="grow min-w-0"
                type="text"
                placeholder={activeTab === "snippets" ? "Search snippets..." : "npub naddr or repo name"} />
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
      {/if}
    </div>
  {:else}

  <!-- Tab-filtered Repos Grid -->
  <div>
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
          <div class="rounded-md border border-border bg-card p-3">
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
