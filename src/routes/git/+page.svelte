<script lang="ts">
  import {page} from "$app/stores"
  import {
    normalizeRelayUrl,
    Address,
    DELETE,
    REACTION,
    getRelaysFromList,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {
    repository,
    profilesByPubkey,
    tracker,
    profileSearch as repositoryOwnerProfileSearch,
    getFollows,
    relaySearch,
    pubkey,
    session,
    userRelayList,
  } from "@welshman/app"
  import {deriveEventsById, deriveEventsDesc} from "@welshman/store"
  import {Router} from "@welshman/router"
  import {load as welshmanLoad, request as welshmanRequest, type LoadOptions} from "@welshman/net"
  import {fade} from "svelte/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import RepoSearchSettingsModal from "@app/components/RepoSearchSettingsModal.svelte"
  import PerformanceDiagnosticsStatus from "@app/components/PerformanceDiagnosticsStatus.svelte"
  import {IMPORT_REPO_ENABLED, PERFORMANCE_DIAGNOSTICS_ENABLED} from "@app/core/feature-flags"
  import {
    activePerformanceDiagnosticsRun,
    completeAutomaticPerformanceDiagnosticsCapture,
    markPerformanceDiagnosticsMilestone,
    recordPerformanceDiagnostics,
  } from "@app/core/performance-diagnostics"
  import LogIn from "@app/components/LogIn.svelte"
  import {getInteractiveCardTarget, preventDefault, stopPropagation} from "@lib/html"
  import GitItem from "@app/components/GitItem.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import RepoMaintainerList from "@app/components/RepoMaintainerList.svelte"
  import GitCommunityMenuButton from "@app/components/GitCommunityMenuButton.svelte"
  import {pushModal, clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {notifications, hasRepoNotification} from "@app/util/notifications"
  import {APP_URL} from "@app/core/state"
  import {makeExactEventDelete} from "@app/core/commands"
  import {
    createRepoPublishTransport,
    publishRepoEventWithRelayOutcomes,
    type RepoPublishTransport,
  } from "@app/core/git-commands"
  import {getDeclaredRepoRelays, getRepoPublicationAddress} from "@app/core/repo-publication"
  import {afterNavigate, goto, replaceState} from "$app/navigation"
  import {getContext, onMount, onDestroy, untrack} from "svelte"
  import {derived as _derived, get as getStore, type Readable} from "svelte/store"
  import {nip19, type NostrEvent} from "nostr-tools"
  import {CodeXml, Folder, ListFilter, Star, X} from "@lucide/svelte"
  import {
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_STATE,
    parseRepoAnnouncementEvent,
    type BookmarkAddress,
    type RepoAnnouncementEvent,
  } from "@nostr-git/core/events"
  import {getTaggedRelaysFromRepoEvent, resolveRepoRelayPolicy} from "@nostr-git/core/utils"
  import {GIT_PERMALINK} from "@nostr-git/core/types"
  import {
    repositoriesStore,
    Tabs,
    TabsList,
    TabsTrigger,
    EventRenderer,
    getPendingRepoCreationTransactions,
    recoverRepoCreationRecord,
    toast,
    NewRepoWizard,
    ImportRepoDialog,
  } from "@nostr-git/ui"
  import type {
    ImportResult,
    NewRepoResult,
    ProfileSearchContext,
    RepoCommunityOption,
  } from "@nostr-git/ui"
  import type {NostrFilter} from "@nostr-git/core"
  import {
    loadRepoAnnouncements,
    GIT_RELAYS,
    getRepoAnnouncementPublishRelays,
    repoAnnouncementRelaysStore,
    repoAnnouncements,
    REPO_LIST_HYDRATION_READY_KEY,
  } from "@app/core/git-state"
  import {
    getInitializedGitWorker,
    subscribeGitWorkerProgress,
    terminateGitWorker,
  } from "@app/core/worker-singleton"
  import {
    activeExactCommunityPointer,
    activeExactCommunityDefinition,
    activePreferredCommunities,
    activeUserCommunityRefs,
    activeUserCommunityProfileListEvents,
    communityMemberReportStates,
    communityPreferencesLoading,
    hydratePreferredCommunityList,
    makeCommunityProfileListFilters,
    makeCommunityReportDeleteFilters,
    makeCommunityReportFilters,
    refreshPubkeyOutboxRelays,
    setActiveExactCommunityPointer,
    clearActiveExactCommunity,
  } from "@app/core/community-state"
  import {userRenouncedCommunityAddresses} from "@app/core/community-renunciations"
  import {
    parseCommunityNaddr,
    makeCommunityPointer,
    TARGETED_PUBLICATION_KIND,
  } from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    communityWritableSectionsSupportTarget,
    filterAuthorizedCommunityTargetingEvents,
    getCommunityTargetWriterPubkeys,
    type CommunityWriteTarget,
  } from "@app/core/community-permissions"
  import {getEffectiveCommunityReportState} from "@app/core/community-reports"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityRepositoryFilter,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilterPlan,
    makeTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-feeds"
  import {fetchRelayEventsWithTimeout} from "@app/util/fetch-relay-events"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Download from "@assets/icons/download.svg?dataurl"
  import {
    GIT_COMMUNITY_ENTRY,
    GIT_COMMUNITY_PARAM,
    GIT_ENTRY_PARAM,
    GIT_PERSONAL_ENTRY,
    makeGitCommunityPath,
    makeGitPath,
  } from "@app/util/routes"
  import {makeRepoNaddrFromEvent} from "@app/util/repo-links"
  import {getEventShareRelayHints} from "@app/util/event-share"
  import {
    getInitialGitMode,
    getInitialGitTab,
    gitSelectedMode,
    gitSelectedTab,
    type GitMode,
    type GitTab,
  } from "@app/util/git-tabs"
  import {
    buildBookmarkRepoFilters,
    buildBookmarkRepoLoadKey,
    getRepoAddressFromEvent,
    isAnyBookmarked,
    matchBookmarkedRepoEvents,
  } from "@app/util/bookmarks"
  import {activeRepoStars, hydrateRepoStars, repoStarsLoading} from "@app/core/repo-stars-state"
  import {
    parseRepoStarReaction,
    repoStarToBookmarkAddress,
    type RepoStarRef,
  } from "@app/util/repo-stars"
  import {buildCommunityTrustAssessments} from "@app/core/community-trust"
  import {
    REPO_DISCOVERY_TIMEOUT_MS,
    REPO_DISCOVERY_SETTINGS_STORAGE_KEY,
    buildRepoDiscoveryBuckets,
    coerceRepoDiscoveryPrioritySettings,
    dedupeRepoDiscoveryBuckets,
    getDefaultRepoDiscoveryPrioritySettings,
    mergeLoadedRepoSearchItems,
    repoMatchesSearchQuery,
    sortRepoSearchResults,
    toLoadedRepoSearchItem,
    type RepoDiscoveryBucket,
    type RepoDiscoveryPriorityKey,
    type RepoDiscoveryPrioritySetting,
    type RepoOwnerProfile,
  } from "@app/util/repo-discovery-search"
  import {loadBudabitProfile, loadBudabitProfileBatch} from "@app/core/profile-resolver"
  import {peopleDiscoverySearch} from "@app/core/people-discovery-search"
  import {REPO_LIST_ANNOUNCEMENT_LIMIT, REPO_LIST_MAX_RELAYS} from "@app/core/repo-list-preload"
  import {
    buildRepoCommunityStarCollections,
    type RepoCollectionReadState,
  } from "@app/core/repo-collection-read-model"
  import {loadRepoCardVerification} from "@app/core/repo-card-verification"
  import {createRepoListCardProjector, type RepoListCardModel} from "@app/core/repo-list-card-model"
  import {getRepoAddress, isAuthorizedDirectCommunityRepo} from "@app/core/repo-community-context"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {loadBoundedCommunityHistory, makeSameAuthorDeleteFilters} from "@app/core/requests"

  const url = GIT_RELAYS[0] || ""
  const repoListHydrationReadyStore = getContext<Readable<boolean>>(REPO_LIST_HYDRATION_READY_KEY)

  const normalizeSearchValue = (value: unknown) => String(value ?? "").toLocaleLowerCase()
  const projectRepoListCard = createRepoListCardProjector()

  // Connect the nostr-git toast store to the app toast component
  $effect(() => {
    const unsubscribe = toast.subscribe(toasts => {
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
    })
  }

  const prioritizeFreshRepoCards = <T extends {first?: RepoAnnouncementEvent | null}>(
    cards: T[],
  ) => {
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

  const REPO_SEARCH_DEBOUNCE_MS = 300
  const REPO_SEARCH_PAGE_SIZE = 18
  const REPO_LOAD_SETTLE_DELAY_MS = 75
  const REPO_LIST_LOAD_TIMEOUT_MS = 8_000
  const REPO_CARD_HYDRATION_DELAY_MS = 250
  const REPO_CARDS_CONTEXT_CACHE_LIMIT = 4

  const repoLoadSettleTimers = new Set<ReturnType<typeof setTimeout>>()
  const repoLoadTimeoutTimers = new Set<ReturnType<typeof setTimeout>>()
  const gitPageLoadController = new AbortController()
  const load = (options: LoadOptions) =>
    gitPageReadWorkStopped
      ? Promise.resolve([])
      : welshmanLoad({
          ...options,
          signal: options.signal
            ? AbortSignal.any([options.signal, gitPageLoadController.signal])
            : gitPageLoadController.signal,
        })
  let gitPageReadWorkStopped = false
  const requestRepoAnnouncements = ({
    relays,
    filters,
    signal,
    owner,
  }: {
    relays: string[]
    filters: Filter[]
    signal?: AbortSignal
    owner: string
  }) => {
    if (gitPageReadWorkStopped) return Promise.resolve([])
    const requestSignal = signal
      ? AbortSignal.any([signal, gitPageLoadController.signal])
      : gitPageLoadController.signal
    const admit = (event: TrustedEvent, relay: string) => {
      if (requestSignal.aborted) return
      if (relay && !tracker.hasRelay(event.id, relay)) tracker.addRelay(event.id, relay)
      if (!repository.hasEvent(event)) repository.publish(event)
    }
    return welshmanRequest({
      relays,
      filters,
      signal: requestSignal,
      autoClose: true,
      lifetime: "finite",
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner,
      tracker,
      onEvent: admit,
      onDuplicate: admit,
    })
  }

  const afterRepoLoadSettle = (callback: () => void) => {
    const timer = setTimeout(() => {
      repoLoadSettleTimers.delete(timer)
      if (gitPageReadWorkStopped) return
      callback()
    }, REPO_LOAD_SETTLE_DELAY_MS)
    repoLoadSettleTimers.add(timer)
  }

  const settleRepoLoad = ({
    promise,
    onSettled,
    timeoutMs = REPO_LIST_LOAD_TIMEOUT_MS,
  }: {
    promise: Promise<unknown>
    onSettled: () => void
    timeoutMs?: number
  }) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      repoLoadTimeoutTimers.delete(timeout)
      if (gitPageReadWorkStopped) return
      afterRepoLoadSettle(onSettled)
    }

    const timeout = setTimeout(settle, timeoutMs)
    repoLoadTimeoutTimers.add(timeout)
    void promise.finally(settle).catch(() => {})
  }

  const requestedGitCommunityInput = $derived(
    $page.url.searchParams.get(GIT_COMMUNITY_PARAM)?.trim() || "",
  )
  const getInitialGitEntry = () =>
    getStore(page).url.searchParams.get(GIT_ENTRY_PARAM)?.trim() || ""
  const getInitialGitCommunityInput = () =>
    getStore(page).url.searchParams.get(GIT_COMMUNITY_PARAM)?.trim() || ""
  const getInitialGitCommunityPointer = () =>
    parseCommunityNaddr(getInitialGitCommunityInput()) || getStore(activeExactCommunityPointer)
  const getInitialGitCommunityPubkey = () => getInitialGitCommunityPointer()?.ownerPubkey || ""

  const getInitialGitModeForContext = (): GitMode => {
    const entry = getInitialGitEntry()
    if (entry === GIT_PERSONAL_ENTRY) return "personal"
    if (entry === GIT_COMMUNITY_ENTRY || parseCommunityNaddr(getInitialGitCommunityInput())) {
      return "community"
    }
    return getInitialGitMode()
  }

  const getInitialGitTabForContext = (): GitTab =>
    getInitialGitEntry() === GIT_PERSONAL_ENTRY || getInitialGitEntry() === GIT_COMMUNITY_ENTRY
      ? "my-repos"
      : getInitialGitTab()

  let loading = $state(true)
  let activeMode = $state<GitMode>(getInitialGitModeForContext())
  let activeTab = $state<GitTab>(getInitialGitTabForContext())
  let selectedCommunityAddress = $state(getInitialGitCommunityPointer()?.address || "")
  let selectedCommunityPubkey = $state(getInitialGitCommunityPubkey())
  let gitTabHydrated = $state(false)
  let searchQuery = $state("")
  let activeRepoSearchQuery = $state("")
  let activeTextSearchQuery = $state("")
  let repoResultsVisibleLimit = $state(REPO_SEARCH_PAGE_SIZE)
  let repoDiscoveryRunMode = $state<RepoDiscoveryRunMode>("smart")
  let repoDiscoveryRunNonce = $state(0)
  let repoDiscoverySnapshot = $state<RepoDiscoverySnapshot | null>(null)
  let repoDiscoveryPrioritySettings = $state<RepoDiscoveryPrioritySetting[]>(
    getDefaultRepoDiscoveryPrioritySettings(),
  )
  let navigatingRepoCardKey = $state("")
  let discoveredSearchRepoPool = $state<
    Array<{address: string; event: RepoAnnouncementEvent; relayHint: string}>
  >([])
  let discoveredOwnerProfiles = $state<Record<string, RepoOwnerProfile>>({})
  let repoDiscoveryStatus = $state<RepoDiscoveryStatus>(createEmptyRepoDiscoveryStatus())
  let repoDiscoveryController: AbortController | null = null
  let repoDiscoveryDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let snippetsLoadedFor = $state<string | null>(null)

  const hasRepositoryTextSearchIntent = $derived.by(() => {
    if (activeTab === "snippets") return false
    const query = searchQuery.trim().replace(/^nostr:/, "")
    return Boolean(query && !query.startsWith("npub1") && !query.startsWith("naddr1"))
  })

  const hasActiveCommunityContext = $derived(Boolean($activeExactCommunityPointer))
  const gitPageWidthClass = $derived(hasActiveCommunityContext ? "" : "cw-full")

  // Initialize worker for Git operations
  // Note: Not using $state because Comlink proxies don't work well with Svelte reactivity
  let workerApi: any = null
  let workerInstance: Worker | null = null

  onMount(() => {
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
    if ($gitSelectedMode !== activeMode) {
      gitSelectedMode.set(activeMode)
    }
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
  let lastLoadedPersonalRepoKey = $state("")
  let personalRepoLoadRequestId = 0
  let personalRepoAnnouncementsSettled = $state(false)
  $effect(() => {
    if ((activeMode !== "personal" || activeTab !== "my-repos") && !hasRepositoryTextSearchIntent) {
      personalRepoLoadRequestId += 1
      personalRepoAnnouncementsSettled = true
      lastLoadedPersonalRepoKey = ""
      return
    }

    if (!$pubkey) {
      personalRepoLoadRequestId += 1
      personalRepoAnnouncementsSettled = true
      lastLoadedPersonalRepoKey = ""
      return
    }

    if (!repoListReadRelays.length) {
      personalRepoLoadRequestId += 1
      personalRepoAnnouncementsSettled = true
      lastLoadedPersonalRepoKey = ""
      return
    }

    // Prevent duplicate loads with same relay set
    const relayKey = repoListReadRelays.slice().sort().join(",")
    const loadKey = `${$pubkey}:${relayKey}:${repoResultsVisibleLimit}`
    if (loadKey === lastLoadedPersonalRepoKey) return
    lastLoadedPersonalRepoKey = loadKey
    personalRepoAnnouncementsSettled = false
    const requestId = ++personalRepoLoadRequestId

    const filter = {
      kinds: [GIT_REPO_ANNOUNCEMENT],
      authors: [$pubkey],
      limit: repoResultsVisibleLimit,
    }
    const controller = new AbortController()
    settleRepoLoad({
      promise: requestRepoAnnouncements({
        relays: repoListReadRelays,
        filters: [filter],
        signal: controller.signal,
        owner: "git-list:personal",
      }).catch(error => {
        console.warn("[git/+page] Failed to load personal repos", error)
      }),
      onSettled: () => {
        if (requestId === personalRepoLoadRequestId) personalRepoAnnouncementsSettled = true
      },
    })

    return () => controller.abort()
  })

  $effect(() => {
    if (activeTab !== "snippets") return
    if (!$pubkey) return
    if (snippetsLoadedFor === $pubkey) return
    const filter = {kinds: [GIT_PERMALINK], authors: [$pubkey]} as Filter
    load({relays: bookmarkRelays, filters: [filter]})
    snippetsLoadedFor = $pubkey
  })

  // Repo announcements should always be fetched from the current derived relay set
  // Memoize to prevent effect loops from array reference changes
  let cachedRepoRelays: string[] = []
  let cachedRepoRelaysKey = ""
  const repoAnnouncementRelays = $derived.by(() => {
    const relays = $repoAnnouncementRelaysStore
    const key = relays.slice().sort().join(",")
    if (key === cachedRepoRelaysKey) {
      return cachedRepoRelays
    }
    cachedRepoRelaysKey = key
    cachedRepoRelays = relays
    return relays
  })
  const repoListReadRelays = $derived(repoAnnouncementRelays.slice(0, REPO_LIST_MAX_RELAYS))

  // Normalize all relay URLs to avoid whitespace/trailing-slash/socket issues.
  // Include resolved repo announcement relays so personal stars retry after user relays load.
  const bookmarkRelays = $derived.by(
    () =>
      Array.from(
        new Set(
          [url, ...repoAnnouncementRelays, ...Router.get().FromUser().getUrls(), ...GIT_RELAYS]
            .map(u => normalizeRelayUrl(u))
            .filter(Boolean),
        ),
      ) as string[],
  )
  const bookmarkListRelays = $derived(bookmarkRelays.slice(0, REPO_LIST_MAX_RELAYS))

  $effect(() => {
    if (!$pubkey) return
    // Fast path: reads community stars, admin defs, moderator forms, and
    // memberships without waiting on relay auth. This is enough for the
    // community selector to render. The slower `hydratePreferredCommunities`
    // is intentionally NOT called here because it authenticates on every
    // request and blocks on slow bunkers, which stalls the community mode
    // switch even when the fast path could have served results.
    hydratePreferredCommunityList({relayHints: bookmarkRelays}).catch(error => {
      console.warn("[git/+page] Failed to hydrate preferred communities", error)
    })
  })

  const safeNormalizeRelay = (relay?: string) => {
    if (!relay) return ""
    try {
      return normalizeRelayUrl(relay)
    } catch {
      return ""
    }
  }

  const getCommunityOptionLabel = (pubkey: string) => {
    const profile = $profilesByPubkey.get(pubkey)
    return profile?.display_name || profile?.name || `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}`
  }

  const repoPublishCommunityOptions = $derived.by((): RepoCommunityOption[] =>
    $activeUserCommunityRefs
      .filter(ref =>
        communityWritableSectionsSupportTarget({
          definition: ref.definition,
          writableSections: ref.writableSections,
          target: COMMUNITY_WRITE_TARGETS.repository,
        }),
      )
      .map(ref => ({
        ownerPubkey: ref.definition.ownerPubkey,
        address: ref.community.address,
        communityId: ref.community.communityId,
        name: ref.definition.metadata.name,
        about: ref.definition.metadata.description,
        relays: ref.definition.relays,
        graspServers: ref.definition.graspServers,
      })),
  )

  const repoViewCommunityOptions = $derived.by((): RepoCommunityOption[] => {
    const options = new Map<string, RepoCommunityOption>()

    for (const ref of $activeUserCommunityRefs) {
      options.set(ref.community.address, {
        ownerPubkey: ref.definition.ownerPubkey,
        address: ref.community.address,
        communityId: ref.community.communityId,
        name: ref.definition.metadata.name,
        about: ref.definition.metadata.description,
        relays: Array.from(new Set([...ref.definition.relays, ...ref.relayHints])),
        graspServers: ref.definition.graspServers,
      })
    }

    for (const community of $activePreferredCommunities) {
      const pointer = community.star?.community
      if (!pointer) continue
      const current = options.get(pointer.address)
      options.set(pointer.address, {
        ownerPubkey: pointer.ownerPubkey,
        address: pointer.address,
        communityId: pointer.communityId,
        name: current?.name,
        about: current?.about,
        relays: Array.from(
          new Set([...(current?.relays || []), ...pointer.relayHints, ...community.relayHints]),
        ),
      })
    }

    const exactPointer = $activeExactCommunityPointer
    const exactDefinition = $activeExactCommunityDefinition
    if (exactPointer && !options.has(exactPointer.address)) {
      options.set(exactPointer.address, {
        ownerPubkey: exactPointer.ownerPubkey,
        address: exactPointer.address,
        communityId: exactPointer.communityId,
        name: exactDefinition?.metadata.name,
        about: exactDefinition?.metadata.description,
        relays: Array.from(
          new Set([...exactPointer.relayHints, ...(exactDefinition?.relays || [])]),
        ),
        graspServers: exactDefinition?.graspServers,
      })
    }

    return Array.from(options.values())
  })

  let appliedGitCommunityInput = $state("")

  afterNavigate(() => {
    const currentPage = getStore(page)
    const entry = currentPage.url.searchParams.get(GIT_ENTRY_PARAM)?.trim() || ""
    if (entry !== GIT_PERSONAL_ENTRY && entry !== GIT_COMMUNITY_ENTRY) return

    activeMode = entry
    activeTab = "my-repos"

    if (entry === GIT_COMMUNITY_ENTRY) {
      const communityInput = currentPage.url.searchParams.get(GIT_COMMUNITY_PARAM)?.trim() || ""
      const parsed = parseCommunityNaddr(communityInput)
      if (parsed) {
        clearActiveExactCommunity()
        setActiveExactCommunityPointer(parsed)
        selectedCommunityAddress = parsed.address
        selectedCommunityPubkey = parsed.ownerPubkey
      }
    }

    const url = new URL(currentPage.url)
    url.searchParams.delete(GIT_ENTRY_PARAM)
    if (entry === GIT_COMMUNITY_ENTRY) url.searchParams.delete(GIT_COMMUNITY_PARAM)
    replaceState(`${url.pathname}${url.search}${url.hash}`, currentPage.state)
  })

  $effect(() => {
    const communityInput = requestedGitCommunityInput
    if (!communityInput || communityInput === appliedGitCommunityInput) return

    appliedGitCommunityInput = communityInput
    const parsed = parseCommunityNaddr(communityInput)
    if (!parsed) return

    clearActiveExactCommunity()
    setActiveExactCommunityPointer(parsed)
    activeMode = "community"
    selectedCommunityAddress = parsed.address
    selectedCommunityPubkey = parsed.ownerPubkey
  })

  $effect(() => {
    if (activeMode !== "community") return
    if (parseCommunityNaddr(requestedGitCommunityInput)) return
    const pointer = $activeExactCommunityPointer

    if (pointer && selectedCommunityAddress !== pointer.address) {
      selectedCommunityAddress = pointer.address
      selectedCommunityPubkey = pointer.ownerPubkey
      return
    }

    if (
      selectedCommunityAddress &&
      !repoViewCommunityOptions.some(c => c.address === selectedCommunityAddress)
    ) {
      selectedCommunityAddress = ""
      selectedCommunityPubkey = ""
    }
  })

  const selectedCommunityOption = $derived.by(() =>
    repoViewCommunityOptions.find(option => option.address === selectedCommunityAddress),
  )
  const selectedCommunityPointer = $derived.by(() =>
    selectedCommunityOption
      ? makeCommunityPointer({
          ownerPubkey: selectedCommunityOption.ownerPubkey,
          communityId: selectedCommunityOption.communityId,
          relayHints: selectedCommunityOption.relays,
        })
      : undefined,
  )
  const selectedCommunityLabel = $derived(
    selectedCommunityOption?.name ||
      selectedCommunityOption?.label ||
      (selectedCommunityPubkey ? getCommunityOptionLabel(selectedCommunityPubkey) : ""),
  )
  const communityOptionsLoading = $derived(
    activeMode === "community" &&
      !selectedCommunityPubkey &&
      repoViewCommunityOptions.length === 0 &&
      $communityPreferencesLoading,
  )

  const getCommunityOptionRelayHints = (option?: RepoCommunityOption) =>
    Array.from(new Set([...(option?.relays || []), option?.relay || ""].filter(Boolean)))

  const selectedCommunityProfileRelays = $derived.by(() =>
    getCommunityOptionRelayHints(selectedCommunityOption)
      .map(relay => safeNormalizeRelay(relay))
      .filter(Boolean),
  )

  const selectGitCommunity = (communityAddress: string) => {
    selectedCommunityAddress = communityAddress
    const option = repoViewCommunityOptions.find(item => item.address === communityAddress)
    selectedCommunityPubkey = option?.ownerPubkey || ""
    if (!option) return

    const pointer = makeCommunityPointer({
      ownerPubkey: option.ownerPubkey,
      communityId: option.communityId,
      relayHints: option.relays,
    })
    if (!pointer) return
    setActiveExactCommunityPointer(pointer)
    goto(makeGitCommunityPath(pointer.naddr))
  }

  const openExploreCommunities = () => goto("/explore")
  const openCreateCommunity = () => goto("/explore/create-community")

  const selectedCommunityRelays = $derived.by(() =>
    Array.from(
      new Set(
        [
          ...(selectedCommunityOption?.relays || []),
          selectedCommunityOption?.relay || "",
          ...repoAnnouncementRelays,
          ...GIT_RELAYS,
        ]
          .map(relay => safeNormalizeRelay(relay))
          .filter(Boolean),
      ),
    ),
  )
  const selectedCommunityListRelays = $derived(
    selectedCommunityRelays.slice(0, REPO_LIST_MAX_RELAYS),
  )

  const getRepoCardProfileRelays = (model: RepoListCardModel) => {
    const event = model.event
    const trackedRelays = Array.from(tracker.getRelays(event.id) || [])
    const pubkeyRelays = Router.get().getRelaysForPubkey(event.pubkey) || []

    return Array.from(
      new Set(
        [
          ...(activeMode === "community" ? selectedCommunityProfileRelays : []),
          model.communityRelay,
          getRepoCardRelayHint(event, model.address),
          ...trackedRelays,
          ...pubkeyRelays,
          ...model.declaredRelays,
          ...repoAnnouncementRelays,
        ]
          .map(relay => safeNormalizeRelay(relay))
          .filter(Boolean),
      ),
    )
  }

  const openRepoCardProfile = (profilePubkey: string, profileRelays: string[] = []) => {
    pushModal(ProfileDetail, {
      pubkey: profilePubkey,
      url: profileRelays[0],
      relays: profileRelays,
    })
  }

  const EMPTY_VERIFIED_REPO_MAINTAINERS = new Set<string>()

  const selectedCommunityRef = $derived.by(() =>
    $activeUserCommunityRefs.find(ref => ref.community.address === selectedCommunityAddress),
  )
  const selectedCommunityDefinition = $derived.by(() => {
    if (selectedCommunityRef) return selectedCommunityRef.definition
    return $activeExactCommunityDefinition?.pointer.address === selectedCommunityAddress
      ? $activeExactCommunityDefinition
      : undefined
  })

  const selectedCommunityProfileListFilters = $derived.by(() =>
    selectedCommunityDefinition ? makeCommunityProfileListFilters(selectedCommunityDefinition) : [],
  )
  const selectedCommunityProfileListEvents = $derived.by(() =>
    selectedCommunityProfileListFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: selectedCommunityProfileListFilters as any}),
        )
      : undefined,
  )
  const selectedCommunityReportFilters = $derived.by(() =>
    selectedCommunityDefinition
      ? makeCommunityReportFilters(selectedCommunityDefinition.pointer)
      : [],
  )
  const selectedCommunityReportEvents = $derived.by(() =>
    selectedCommunityReportFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: selectedCommunityReportFilters as any}),
        )
      : undefined,
  )
  const selectedCommunityReportDeleteFilters = $derived.by(() =>
    $selectedCommunityReportEvents
      ? makeCommunityReportDeleteFilters($selectedCommunityReportEvents as TrustedEvent[])
      : [],
  )
  const selectedCommunityReportDeleteEvents = $derived.by(() =>
    selectedCommunityReportDeleteFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: selectedCommunityReportDeleteFilters as any}),
        )
      : undefined,
  )
  const selectedCommunityReportState = $derived.by(() =>
    selectedCommunityDefinition
      ? getEffectiveCommunityReportState({
          definition: selectedCommunityDefinition,
          profileListEvents: $selectedCommunityProfileListEvents
            ? ($selectedCommunityProfileListEvents as TrustedEvent[])
            : [],
          reportEvents: $selectedCommunityReportEvents
            ? ($selectedCommunityReportEvents as TrustedEvent[])
            : [],
          deleteEvents: $selectedCommunityReportDeleteEvents
            ? ($selectedCommunityReportDeleteEvents as TrustedEvent[])
            : [],
        })
      : undefined,
  )
  const getSelectedCommunityTargetWriterPubkeys = (target: CommunityWriteTarget) =>
    selectedCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: selectedCommunityDefinition,
          profileListEvents: $selectedCommunityProfileListEvents
            ? ($selectedCommunityProfileListEvents as TrustedEvent[])
            : [],
          target,
          reportState: selectedCommunityReportState,
        })
      : []
  const selectedCommunityRepoWriterPubkeys = $derived.by(() =>
    getSelectedCommunityTargetWriterPubkeys(COMMUNITY_WRITE_TARGETS.repository),
  )
  const selectedCommunityStarWriterPubkeys = $derived.by(() =>
    getSelectedCommunityTargetWriterPubkeys(COMMUNITY_WRITE_TARGETS.reaction),
  )
  const selectedCommunitySnippetWriterPubkeys = $derived.by(() =>
    getSelectedCommunityTargetWriterPubkeys(COMMUNITY_WRITE_TARGETS.permalink),
  )

  let selectedCommunityAuthorityLoadKey = ""
  $effect(() => {
    if (
      (activeMode !== "community" && !hasRepositoryTextSearchIntent) ||
      selectedCommunityRelays.length === 0
    ) {
      selectedCommunityAuthorityLoadKey = ""
      return
    }

    const filters = [...selectedCommunityProfileListFilters, ...selectedCommunityReportFilters]
    if (filters.length === 0) return

    const key = filters.map(filter => JSON.stringify(filter)).join("|")
    if (key === selectedCommunityAuthorityLoadKey) return
    selectedCommunityAuthorityLoadKey = key
    load({relays: selectedCommunityRelays, filters: filters as any}).catch(error => {
      console.warn("[git/+page] Failed to load community authority events", error)
    })
  })

  let selectedCommunityReportDeleteLoadKey = ""
  $effect(() => {
    if (
      (activeMode !== "community" && !hasRepositoryTextSearchIntent) ||
      selectedCommunityRelays.length === 0 ||
      selectedCommunityReportDeleteFilters.length === 0
    ) {
      selectedCommunityReportDeleteLoadKey = ""
      return
    }

    const key = selectedCommunityReportDeleteFilters.map(filter => JSON.stringify(filter)).join("|")
    if (key === selectedCommunityReportDeleteLoadKey) return
    selectedCommunityReportDeleteLoadKey = key
    load({
      relays: selectedCommunityRelays,
      filters: selectedCommunityReportDeleteFilters as any,
    }).catch(error => {
      console.warn("[git/+page] Failed to load community report deletes", error)
    })
  })

  const getStarredRepoLoadRelays = (addresses: BookmarkAddress[]) =>
    Array.from(
      new Set(
        [
          ...addresses.map(address => safeNormalizeRelay(address.relayHint)),
          ...repoAnnouncementRelays,
          ...GIT_RELAYS,
        ].filter(Boolean),
      ),
    ).slice(0, REPO_LIST_MAX_RELAYS) as string[]

  const repoStarAddresses = $derived.by((): BookmarkAddress[] =>
    $activeRepoStars.map(repoStarToBookmarkAddress),
  )
  const renderedRepoStarAddresses = $derived(repoStarAddresses.slice(0, repoResultsVisibleLimit))

  const hasRepoStarAddresses = $derived(renderedRepoStarAddresses.length > 0)
  const starredRepoRelaysToQuery = $derived.by(() =>
    getStarredRepoLoadRelays(renderedRepoStarAddresses),
  )
  const starredRepoLoadKey = $derived.by(() =>
    hasRepoStarAddresses
      ? `${buildBookmarkRepoLoadKey(renderedRepoStarAddresses)}:${starredRepoRelaysToQuery.slice().sort().join(",")}`
      : "",
  )

  let repoStarsHydrationRequestId = 0
  let repoStarsHydrationSettled = $state(false)

  $effect(() => {
    if (
      !$pubkey ||
      ((activeMode !== "personal" || activeTab !== "bookmarks") && !hasRepositoryTextSearchIntent)
    ) {
      repoStarsHydrationRequestId += 1
      repoStarsHydrationSettled = true
      return
    }

    const requestId = ++repoStarsHydrationRequestId
    repoStarsHydrationSettled = false
    const controller = new AbortController()
    hydrateRepoStars({relayHints: bookmarkListRelays, signal: controller.signal})
      .catch(error => {
        console.warn("[git/+page] Failed to hydrate repo stars", error)
      })
      .finally(() => {
        afterRepoLoadSettle(() => {
          if (requestId === repoStarsHydrationRequestId) repoStarsHydrationSettled = true
        })
      })

    return () => controller.abort()
  })

  // Fetch actual repo events for starred addresses
  const attemptedStarredRepoLoads = new Set<string>()
  let settledStarredRepoLoadKey = $state("")

  const repos = $derived.by(() => {
    if ((activeMode !== "personal" || activeTab !== "bookmarks") && !hasRepositoryTextSearchIntent)
      return undefined
    if (!hasRepoStarAddresses) return undefined

    const addresses = renderedRepoStarAddresses
    const filters = buildBookmarkRepoFilters(addresses)
    if (filters.length === 0) {
      if (starredRepoLoadKey) settledStarredRepoLoadKey = starredRepoLoadKey
      return undefined
    }

    const relaysToQuery = starredRepoRelaysToQuery
    const loadKey = starredRepoLoadKey

    return _derived(deriveEventsDesc(deriveEventsById({repository, filters})), events => {
      const matched = matchBookmarkedRepoEvents({
        bookmarks: addresses,
        events: events as RepoAnnouncementEvent[],
        getCachedEvent: address =>
          repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      })

      if (matched.length !== addresses.length) {
        if (!attemptedStarredRepoLoads.has(loadKey)) {
          attemptedStarredRepoLoads.add(loadKey)
          const loadPromise =
            relaysToQuery.length > 0
              ? load({relays: relaysToQuery, filters})
              : loadRepoAnnouncements(undefined, gitPageLoadController.signal)
          settleRepoLoad({
            promise: loadPromise.catch(error => {
              console.warn("[git/+page] Failed to load starred repos", error)
            }),
            onSettled: () => {
              if (starredRepoLoadKey === loadKey) settledStarredRepoLoadKey = loadKey
            },
          })
        }
      }
      return events
    })
  })

  // Loaded starred repos - combines star addresses with actual repo events
  const loadedStarredRepos = $derived.by(() => {
    if (!hasRepoStarAddresses) return []

    const addresses = renderedRepoStarAddresses
    if (addresses.length === 0) return []

    return matchBookmarkedRepoEvents({
      bookmarks: addresses,
      events: $repos ? ($repos as RepoAnnouncementEvent[]) : [],
      getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      isDeleted: isDeletedRepoAnnouncement,
      getFallbackRelayHint: event => Router.get().getRelaysForPubkey(event.pubkey)?.[0] || "",
    })
  })
  const starredRepoAnnouncementsLoading = $derived(
    Boolean(starredRepoLoadKey) &&
      loadedStarredRepos.length < renderedRepoStarAddresses.length &&
      settledStarredRepoLoadKey !== starredRepoLoadKey,
  )

  const latestMyRepos = $derived.by(() => {
    if (!$pubkey) return []
    const latest: Array<{address: string; event: RepoAnnouncementEvent; relayHint: string}> = []
    for (const event of ($repoAnnouncements as RepoAnnouncementEvent[]) || []) {
      if (event.pubkey !== $pubkey) continue
      let addressString = ""
      try {
        const parsedAddress = Address.fromEvent(event)
        addressString = parsedAddress.toString()
      } catch {
        continue
      }

      const relayHintFromEvent = Router.get().getRelaysForPubkey(event.pubkey)?.[0]
      latest.push({address: addressString, event, relayHint: relayHintFromEvent || ""})
    }

    return latest
  })

  const communityRepoFilterPlan = $derived.by(() =>
    selectedCommunityDefinition
      ? makeCommunityContentFilterPlan(
          [
            makeCommunityRepositoryFilter(selectedCommunityDefinition.communityId, {
              limit: repoResultsVisibleLimit,
            }),
          ],
          selectedCommunityRepoWriterPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )

  const communityRepoEvents = $derived.by(() =>
    communityRepoFilterPlan.localFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: communityRepoFilterPlan.localFilters as any}),
        )
      : undefined,
  )
  let communityRepoLoadKey = ""
  let communityRepoLoadRequestId = 0
  let communityRepoAnnouncementsSettled = $state(false)
  const communityRepoRetryVersion = $state(0)
  $effect(() => {
    void communityRepoRetryVersion
    if (
      ((activeMode !== "community" || activeTab !== "my-repos") &&
        !hasRepositoryTextSearchIntent) ||
      !selectedCommunityAddress ||
      selectedCommunityListRelays.length === 0 ||
      communityRepoFilterPlan.relayFilters.length === 0
    ) {
      communityRepoLoadRequestId += 1
      communityRepoLoadKey = ""
      communityRepoAnnouncementsSettled = true
      return
    }

    const relayFilters = communityRepoFilterPlan.relayFilters
    const localFilters = communityRepoFilterPlan.localFilters
    const key = JSON.stringify({
      community: selectedCommunityAddress,
      relays: selectedCommunityListRelays,
      relayFilters,
      localFilters,
      retry: communityRepoRetryVersion,
    })
    if (key === communityRepoLoadKey) return
    communityRepoLoadKey = key
    communityRepoAnnouncementsSettled = false
    const requestId = ++communityRepoLoadRequestId
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, gitPageLoadController.signal])
    void loadBoundedCommunityHistory({
      relays: selectedCommunityListRelays,
      relayFilters,
      localFilters,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `global-git-community:${selectedCommunityAddress}`,
      pageSize: repoResultsVisibleLimit,
      maxPages: 1,
      signal,
    }).catch(error => {
        if (signal.aborted || requestId !== communityRepoLoadRequestId) return
        console.warn("[git/+page] Failed to load community repos", error)
      })
      .finally(() => {
        if (signal.aborted || requestId !== communityRepoLoadRequestId) return
        afterRepoLoadSettle(() => {
          if (requestId === communityRepoLoadRequestId) {
            communityRepoAnnouncementsSettled = true
          }
        })
      })

    return () => controller.abort()
  })

  const latestCommunityRepos = $derived.by(() => {
    if (!selectedCommunityDefinition || !selectedCommunityAddress) return []

    const latest = new Map<string, RepoAnnouncementEvent>()
    const candidates = $communityRepoEvents ? ($communityRepoEvents as RepoAnnouncementEvent[]) : []

    for (const event of candidates) {
      if (isDeletedRepoAnnouncement(event)) continue
      if (
        !isAuthorizedDirectCommunityRepo({
          event,
          communityId: selectedCommunityDefinition.communityId,
          authorPubkeys: selectedCommunityRepoWriterPubkeys,
        })
      ) {
        continue
      }

      const address = getRepoAddress(event)
      if (!address) continue
      const current = latest.get(address)
      if (!current || event.created_at > current.created_at) latest.set(address, event)
    }

    return Array.from(latest.entries()).map(([address, event]) => ({
      address,
      event,
      relayHint:
        Router.get().getRelaysForPubkey(event.pubkey)?.[0] || selectedCommunityRelays[0] || "",
    }))
  })

  const hasStarredRepoNotifications = $derived.by(() =>
    loadedStarredRepos.some(repo => repoHasNotifications(repo.event as RepoAnnouncementEvent)),
  )

  const mySnippetsEvents = $derived.by(() => {
    if (!$pubkey) return undefined
    const filter = {kinds: [GIT_PERMALINK], authors: [$pubkey]} as Filter
    return deriveEventsDesc(deriveEventsById({repository, filters: [filter]}))
  })

  const snippets = $derived.by(() => ($mySnippetsEvents ? ($mySnippetsEvents as NostrEvent[]) : []))

  const snippetQuery = $derived.by(() => normalizeSearchValue(searchQuery.trim()))

  const getDeletedTargetEventIds = (targets: TrustedEvent[], deleteEvents: TrustedEvent[]) => {
    const targetsById = new Map(targets.map(event => [event.id, event]))
    const deletedIds = new Set<string>()

    for (const event of deleteEvents) {
      if (event.kind !== DELETE) continue

      for (const tag of event.tags || []) {
        if (tag[0] !== "e" || !tag[1]) continue
        const target = targetsById.get(tag[1])
        if (target?.pubkey === event.pubkey) deletedIds.add(tag[1])
      }
    }

    return deletedIds
  }

  const communityStarTargetFilters = $derived.by(() =>
    selectedCommunityPointer
      ? [
          makeCommunityTargetingFilter(selectedCommunityPointer.communityId, [REACTION], {
            limit: REPO_LIST_ANNOUNCEMENT_LIMIT,
          }),
        ]
      : [],
  )
  const communityStarTargetFilterPlan = $derived.by(() =>
    selectedCommunityDefinition
      ? makeCommunityContentFilterPlan(
          communityStarTargetFilters,
          selectedCommunityStarWriterPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const communityStarTargetEvents = $derived.by(() =>
    communityStarTargetFilterPlan.localFilters.length
      ? deriveEventsDesc(
          deriveEventsById({
            repository,
            filters: communityStarTargetFilterPlan.localFilters as any,
          }),
        )
      : undefined,
  )
  const authorizedCommunityStarTargetEvents = $derived.by(() =>
    selectedCommunityDefinition && selectedCommunityPointer && $communityStarTargetEvents
      ? filterAuthorizedCommunityTargetingEvents({
          community: selectedCommunityPointer,
          definition: selectedCommunityDefinition,
          profileListEvents: $selectedCommunityProfileListEvents
            ? ($selectedCommunityProfileListEvents as TrustedEvent[])
            : [],
          events: $communityStarTargetEvents as TrustedEvent[],
          reportState: selectedCommunityReportState,
          kinds: [REACTION],
        })
      : [],
  )
  const communityStarTargetDeleteFilters = $derived.by(() =>
    makeSameAuthorDeleteFilters(authorizedCommunityStarTargetEvents),
  )
  const communityStarTargetDeleteEvents = $derived.by(() =>
    communityStarTargetDeleteFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: communityStarTargetDeleteFilters as any}),
        )
      : undefined,
  )
  const deletedCommunityStarTargetIds = $derived.by(() =>
    getDeletedTargetEventIds(
      authorizedCommunityStarTargetEvents,
      $communityStarTargetDeleteEvents ? ($communityStarTargetDeleteEvents as TrustedEvent[]) : [],
    ),
  )
  const eligibleCommunityStarTargetEvents = $derived(
    authorizedCommunityStarTargetEvents.filter(
      event => !deletedCommunityStarTargetIds.has(event.id),
    ),
  )
  const communityStarReactionFilterPlan = $derived.by(() =>
    makeTargetedPublicationOriginalFilterPlan(eligibleCommunityStarTargetEvents),
  )
  const communityStarReactionRelayHintPlans = $derived.by(() =>
    makeTargetedPublicationOriginalRelayHintPlans(eligibleCommunityStarTargetEvents),
  )
  const communityStarReactionEvents = $derived.by(() =>
    communityStarReactionFilterPlan.localFilters.length
      ? deriveEventsDesc(
          deriveEventsById({
            repository,
            filters: communityStarReactionFilterPlan.localFilters as any,
          }),
        )
      : undefined,
  )
  const communityRepoStarAddresses = $derived.by((): BookmarkAddress[] => {
    if (!$communityStarReactionEvents) return []
    return ($communityStarReactionEvents as TrustedEvent[])
      .map(parseRepoStarReaction)
      .filter((star): star is RepoStarRef => Boolean(star))
      .map(repoStarToBookmarkAddress)
  })

  const communityStarProfileRequests = new Set<string>()
  $effect(() => {
    if (activeMode !== "community" || activeTab !== "bookmarks" || !$communityStarReactionEvents)
      return

    for (const event of $communityStarReactionEvents as TrustedEvent[]) {
      const star = parseRepoStarReaction(event)
      if (!star || !event.pubkey) continue
      const profileRequestKey = `${event.pubkey}:${selectedCommunityProfileRelays.join(",")}`
      if (
        $profilesByPubkey.get(event.pubkey) ||
        communityStarProfileRequests.has(profileRequestKey)
      )
        continue

      communityStarProfileRequests.add(profileRequestKey)
      loadBudabitProfile(event.pubkey, {communityRelays: selectedCommunityProfileRelays}).catch(
        error => {
          console.warn("[git/+page] Failed to load community stargazer profile", error)
        },
      )
    }
  })

  const communityStarReposStore = $derived.by(() => {
    if (communityRepoStarAddresses.length === 0) return undefined
    const filters = buildBookmarkRepoFilters(communityRepoStarAddresses)
    if (filters.length === 0) return undefined
    return deriveEventsDesc(deriveEventsById({repository, filters}))
  })

  const loadedCommunityStarRepos = $derived.by(() => {
    if (!$communityStarReposStore || communityRepoStarAddresses.length === 0) return []

    return matchBookmarkedRepoEvents({
      bookmarks: communityRepoStarAddresses,
      events: $communityStarReposStore as RepoAnnouncementEvent[],
      getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      isDeleted: isDeletedRepoAnnouncement,
      getFallbackRelayHint: event => Router.get().getRelaysForPubkey(event.pubkey)?.[0] || "",
    })
  })

  const communitySnippetTargetFilters = $derived.by(() =>
    selectedCommunityPointer
      ? [
          makeCommunityTargetingFilter(selectedCommunityPointer.communityId, [GIT_PERMALINK], {
            limit: REPO_LIST_ANNOUNCEMENT_LIMIT,
          }),
        ]
      : [],
  )
  const communitySnippetTargetFilterPlan = $derived.by(() =>
    selectedCommunityDefinition
      ? makeCommunityContentFilterPlan(
          communitySnippetTargetFilters,
          selectedCommunitySnippetWriterPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const communitySnippetTargetEvents = $derived.by(() =>
    communitySnippetTargetFilterPlan.localFilters.length
      ? deriveEventsDesc(
          deriveEventsById({
            repository,
            filters: communitySnippetTargetFilterPlan.localFilters as any,
          }),
        )
      : undefined,
  )
  const authorizedCommunitySnippetTargetEvents = $derived.by(() =>
    selectedCommunityDefinition && selectedCommunityPointer && $communitySnippetTargetEvents
      ? filterAuthorizedCommunityTargetingEvents({
          community: selectedCommunityPointer,
          definition: selectedCommunityDefinition,
          profileListEvents: $selectedCommunityProfileListEvents
            ? ($selectedCommunityProfileListEvents as TrustedEvent[])
            : [],
          events: $communitySnippetTargetEvents as TrustedEvent[],
          reportState: selectedCommunityReportState,
          kinds: [GIT_PERMALINK],
        })
      : [],
  )
  const communitySnippetTargetDeleteFilters = $derived.by(() =>
    makeSameAuthorDeleteFilters(authorizedCommunitySnippetTargetEvents),
  )
  const communitySnippetTargetDeleteEvents = $derived.by(() =>
    communitySnippetTargetDeleteFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: communitySnippetTargetDeleteFilters as any}),
        )
      : undefined,
  )
  const deletedCommunitySnippetTargetIds = $derived.by(() =>
    getDeletedTargetEventIds(
      authorizedCommunitySnippetTargetEvents,
      $communitySnippetTargetDeleteEvents
        ? ($communitySnippetTargetDeleteEvents as TrustedEvent[])
        : [],
    ),
  )
  const eligibleCommunitySnippetTargetEvents = $derived(
    authorizedCommunitySnippetTargetEvents.filter(
      event => !deletedCommunitySnippetTargetIds.has(event.id),
    ),
  )
  const communitySnippetFilterPlan = $derived.by(() =>
    makeTargetedPublicationOriginalFilterPlan(eligibleCommunitySnippetTargetEvents),
  )
  const communitySnippetRelayHintPlans = $derived.by(() =>
    makeTargetedPublicationOriginalRelayHintPlans(eligibleCommunitySnippetTargetEvents),
  )
  const communitySnippetEvents = $derived.by(() =>
    communitySnippetFilterPlan.localFilters.length
      ? deriveEventsDesc(
          deriveEventsById({
            repository,
            filters: communitySnippetFilterPlan.localFilters as any,
          }),
        )
      : undefined,
  )
  const communitySnippets = $derived.by(() =>
    $communitySnippetEvents ? ($communitySnippetEvents as NostrEvent[]) : [],
  )

  const filteredSnippets = $derived.by(() => {
    const items = activeMode === "community" ? communitySnippets : snippets
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

  const getSnippetShareRelays = (event: NostrEvent) => {
    const eventRelays = getEventShareRelayHints(event as any)
    if (eventRelays.length > 0) return eventRelays

    return activeMode === "community" ? selectedCommunityRelays : bookmarkRelays
  }

  let communityTargetLoadKey = ""
  let communityTargetLoadRequestId = 0
  let communityTargetsSettled = $state(false)
  const communityCurationRetryVersion = $state(0)
  const communityCurationSearchTab = $derived.by(() => {
    if (hasRepositoryTextSearchIntent) return "bookmarks" as const
    if (activeMode !== "community") return null
    return activeTab === "bookmarks" || activeTab === "snippets" ? activeTab : null
  })
  $effect(() => {
    void communityCurationRetryVersion
    if (
      !communityCurationSearchTab ||
      !selectedCommunityAddress ||
      selectedCommunityListRelays.length === 0
    ) {
      communityTargetLoadRequestId += 1
      communityTargetLoadKey = ""
      communityTargetsSettled = true
      return
    }

    const filterPlan =
      communityCurationSearchTab === "bookmarks"
        ? communityStarTargetFilterPlan
        : communitySnippetTargetFilterPlan
    const relayFilters = filterPlan.relayFilters
    const localFilters = filterPlan.localFilters
    if (relayFilters.length === 0 || localFilters.length === 0) {
      communityTargetsSettled = true
      return
    }

    const key = JSON.stringify({
      tab: communityCurationSearchTab,
      community: selectedCommunityAddress,
      relays: selectedCommunityListRelays,
      relayFilters,
      localFilters,
      retry: communityCurationRetryVersion,
    })
    if (key === communityTargetLoadKey) return
    communityTargetLoadKey = key
    communityTargetsSettled = false
    const requestId = ++communityTargetLoadRequestId
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, gitPageLoadController.signal])
    void loadBoundedCommunityHistory({
      relays: selectedCommunityListRelays,
      relayFilters,
      localFilters,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `global-git-community-curation-targets:${selectedCommunityAddress}`,
      signal,
    }).catch(error => {
        if (signal.aborted || requestId !== communityTargetLoadRequestId) return
        console.warn("[git/+page] Failed to load community curation targets", error)
      })
      .finally(() => {
        if (signal.aborted || requestId !== communityTargetLoadRequestId) return
        afterRepoLoadSettle(() => {
          if (requestId === communityTargetLoadRequestId) communityTargetsSettled = true
        })
      })

    return () => controller.abort()
  })

  let communityTargetDeleteLoadKey = ""
  let communityTargetDeleteLoadRequestId = 0
  let communityTargetDeletesSettled = $state(false)
  $effect(() => {
    if (
      !communityCurationSearchTab ||
      !selectedCommunityAddress ||
      selectedCommunityListRelays.length === 0
    ) {
      communityTargetDeleteLoadRequestId += 1
      communityTargetDeleteLoadKey = ""
      communityTargetDeletesSettled = true
      return
    }

    const filters =
      communityCurationSearchTab === "bookmarks"
        ? communityStarTargetDeleteFilters
        : communitySnippetTargetDeleteFilters
    if (filters.length === 0) {
      communityTargetDeletesSettled = true
      return
    }

    const key = filters.map(filter => JSON.stringify(filter)).join("|")
    if (key === communityTargetDeleteLoadKey) return
    communityTargetDeleteLoadKey = key
    communityTargetDeletesSettled = false
    const requestId = ++communityTargetDeleteLoadRequestId
    settleRepoLoad({
      promise: load({relays: selectedCommunityListRelays, filters: filters as any}).catch(error => {
        console.warn("[git/+page] Failed to load community curation deletes", error)
      }),
      onSettled: () => {
        if (requestId === communityTargetDeleteLoadRequestId) communityTargetDeletesSettled = true
      },
    })
  })

  let communityOriginalLoadKey = ""
  let communityOriginalLoadRequestId = 0
  let communityOriginalsSettled = $state(false)
  $effect(() => {
    void communityCurationRetryVersion
    if (
      !communityCurationSearchTab ||
      !selectedCommunityAddress ||
      selectedCommunityListRelays.length === 0
    ) {
      communityOriginalLoadRequestId += 1
      communityOriginalLoadKey = ""
      communityOriginalsSettled = true
      return
    }

    const filterPlan =
      communityCurationSearchTab === "bookmarks"
        ? communityStarReactionFilterPlan
        : communitySnippetFilterPlan
    const relayHintPlans =
      communityCurationSearchTab === "bookmarks"
        ? communityStarReactionRelayHintPlans
        : communitySnippetRelayHintPlans
    if (filterPlan.relayFilters.length === 0) {
      communityOriginalsSettled = true
      return
    }
    const plans = [
      {
        relays: selectedCommunityListRelays,
        relayFilters: filterPlan.relayFilters,
        localFilters: filterPlan.localFilters,
      },
      ...relayHintPlans,
    ].filter(plan => plan.relays.length > 0)
    if (plans.length === 0) {
      communityOriginalsSettled = true
      return
    }
    const key = JSON.stringify({plans, retry: communityCurationRetryVersion})
    if (key === communityOriginalLoadKey) return
    communityOriginalLoadKey = key
    communityOriginalsSettled = false
    const requestId = ++communityOriginalLoadRequestId
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, gitPageLoadController.signal])
    void Promise.all(
      plans.map(plan =>
        loadBoundedCommunityHistory({
          ...plan,
          priority: RELAY_REQUEST_PRIORITY.interactive,
          owner: `global-git-community-curation-originals:${selectedCommunityAddress}`,
          signal,
        }),
      ),
    ).catch(error => {
        if (signal.aborted || requestId !== communityOriginalLoadRequestId) return
        console.warn("[git/+page] Failed to load community curated originals", error)
      })
      .finally(() => {
        if (signal.aborted || requestId !== communityOriginalLoadRequestId) return
        afterRepoLoadSettle(() => {
          if (requestId === communityOriginalLoadRequestId) communityOriginalsSettled = true
        })
      })

    return () => controller.abort()
  })

  let communityStarRepoLoadKey = ""
  let communityStarRepoLoadRequestId = 0
  let communityStarReposSettled = $state(false)
  $effect(() => {
    if (
      ((activeMode !== "community" || activeTab !== "bookmarks") &&
        !hasRepositoryTextSearchIntent) ||
      communityRepoStarAddresses.length === 0
    ) {
      communityStarRepoLoadRequestId += 1
      communityStarRepoLoadKey = ""
      communityStarReposSettled = true
      return
    }
    const filters = buildBookmarkRepoFilters(communityRepoStarAddresses)
    const relays = getStarredRepoLoadRelays(communityRepoStarAddresses)
    if (filters.length === 0) {
      communityStarReposSettled = true
      return
    }
    if (relays.length === 0) {
      communityStarReposSettled = true
      return
    }
    const key = `${buildBookmarkRepoLoadKey(communityRepoStarAddresses)}:${relays
      .slice()
      .sort()
      .join(",")}`
    if (key === communityStarRepoLoadKey) return
    communityStarRepoLoadKey = key
    communityStarReposSettled = false
    const requestId = ++communityStarRepoLoadRequestId
    settleRepoLoad({
      promise: load({relays, filters}).catch(error => {
        console.warn("[git/+page] Failed to load community starred repos", error)
      }),
      onSettled: () => {
        if (requestId === communityStarRepoLoadRequestId) communityStarReposSettled = true
      },
    })
  })

  // Filter repos based on active tab
  const filteredRepos = $derived.by(() => {
    if (activeTab === "snippets") {
      return []
    }
    if (activeTab === "bookmarks") {
      return activeMode === "community" ? loadedCommunityStarRepos : loadedStarredRepos
    } else {
      return activeMode === "community" ? latestCommunityRepos : latestMyRepos
    }
  })

  const repoCollectionCommunityOptions = $derived.by((): RepoCommunityOption[] =>
    $activeUserCommunityRefs
      .filter(ref =>
        communityWritableSectionsSupportTarget({
          definition: ref.definition,
          writableSections: ref.writableSections,
          target: COMMUNITY_WRITE_TARGETS.reaction,
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
  const repoCollectionRelays = $derived.by(() =>
    Array.from(
      new Set(
        [
          ...repoCollectionCommunityOptions.flatMap(option => [
            option.relay || "",
            ...(option.relays || []),
          ]),
          ...bookmarkRelays,
        ]
          .map(relay => safeNormalizeRelay(relay))
          .filter(Boolean),
      ),
    ),
  )
  const repoCollectionTargetFilters = $derived.by((): Filter[] => {
    if (!$pubkey || repoCollectionCommunityOptions.length === 0) return []

    return [
      {
        kinds: [TARGETED_PUBLICATION_KIND],
        "#h": repoCollectionCommunityOptions
          .map(option => option.communityId)
          .filter((communityId): communityId is string => Boolean(communityId)),
        "#k": [String(REACTION)],
        limit: REPO_LIST_ANNOUNCEMENT_LIMIT,
      },
    ]
  })
  const repoCollectionTargetFilterPlan = $derived.by(() =>
    $pubkey
      ? makeCommunityContentFilterPlan(repoCollectionTargetFilters, [$pubkey])
      : {relayFilters: [], localFilters: []},
  )
  const repoCollectionTargetEventsStore = $derived.by(() =>
    repoCollectionTargetFilterPlan.localFilters.length
      ? deriveEventsDesc(
          deriveEventsById({
            repository,
            filters: repoCollectionTargetFilterPlan.localFilters as any,
          }),
        )
      : undefined,
  )
  const repoCollectionTargetEvents = $derived.by(() =>
    repoCollectionTargetEventsStore
      ? (($repoCollectionTargetEventsStore || []) as TrustedEvent[])
      : [],
  )
  const authorizedRepoCollectionTargetEvents = $derived.by(() => {
    if (!$pubkey || repoCollectionTargetEvents.length === 0) return []
    const authorizedIds = new Set<string>()
    const optionAddresses = new Set(repoCollectionCommunityOptions.map(option => option.address))

    for (const ref of $activeUserCommunityRefs) {
      if (!optionAddresses.has(ref.community.address)) continue

      for (const event of filterAuthorizedCommunityTargetingEvents({
        community: ref.community,
        definition: ref.definition,
        profileListEvents: $activeUserCommunityProfileListEvents,
        events: repoCollectionTargetEvents,
        reportState: $communityMemberReportStates.get(ref.community.address),
        kinds: [REACTION],
      })) {
        if (event.pubkey === $pubkey) authorizedIds.add(event.id)
      }
    }

    return repoCollectionTargetEvents.filter(event => authorizedIds.has(event.id))
  })
  const repoCollectionTargetDeleteFilters = $derived.by(() =>
    makeSameAuthorDeleteFilters(authorizedRepoCollectionTargetEvents),
  )
  const repoCollectionTargetDeleteEventsStore = $derived.by(() =>
    repoCollectionTargetDeleteFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: repoCollectionTargetDeleteFilters as any}),
        )
      : undefined,
  )
  const repoCollectionTargetDeleteEvents = $derived.by(() =>
    repoCollectionTargetDeleteEventsStore
      ? (($repoCollectionTargetDeleteEventsStore || []) as TrustedEvent[])
      : [],
  )
  const repoCollectionReactionFilterPlan = $derived.by(() =>
    makeTargetedPublicationOriginalFilterPlan(authorizedRepoCollectionTargetEvents),
  )
  const repoCollectionReactionRelayHintPlans = $derived.by(() =>
    makeTargetedPublicationOriginalRelayHintPlans(authorizedRepoCollectionTargetEvents),
  )
  const repoCollectionReactionEventsStore = $derived.by(() =>
    repoCollectionReactionFilterPlan.localFilters.length
      ? deriveEventsDesc(
          deriveEventsById({
            repository,
            filters: repoCollectionReactionFilterPlan.localFilters as any,
          }),
        )
      : undefined,
  )
  const repoCollectionReactionEvents = $derived.by(() =>
    repoCollectionReactionEventsStore
      ? (($repoCollectionReactionEventsStore || []) as TrustedEvent[])
      : [],
  )
  let repoCollectionTargetLoadKey = ""
  let repoCollectionTargetLoadRequestId = 0
  let repoCollectionTargetHistoryComplete = $state(false)
  let repoCollectionDeleteLoadKey = ""
  let repoCollectionDeleteLoadRequestId = 0
  let repoCollectionDeleteHistoryComplete = $state(false)
  let repoCollectionFollowupLoadKey = ""
  let repoCollectionFollowupLoadRequestId = 0
  let repoCollectionOriginalHistoryComplete = $state(false)
  let repoCollectionFollowupLoadTimer: ReturnType<typeof setTimeout> | null = null
  let repoCollectionRetryTimer: ReturnType<typeof setTimeout> | null = null
  let repoCollectionRetryCount = 0
  let repoCollectionRetryVersion = $state(0)
  let repoCollectionRenderedScopeKey = $state("")
  let repoCollectionRetryScopeKey = ""
  const scheduleRepoCollectionRetry = () => {
    if (repoCollectionRetryTimer || gitPageReadWorkStopped) return

    const delay = Math.min(60_000, 5000 * 2 ** Math.min(repoCollectionRetryCount, 4))
    repoCollectionRetryCount += 1
    repoCollectionRetryTimer = setTimeout(() => {
      repoCollectionRetryTimer = null
      repoCollectionRetryVersion += 1
    }, delay)
  }
  const repoCollectionState = $derived.by(
    (): RepoCollectionReadState => ({
      personalStars: $activeRepoStars,
      communityOptions: repoCollectionCommunityOptions,
      communityStars: buildRepoCommunityStarCollections({
        viewerPubkey: $pubkey || "",
        communityOptions: repoCollectionCommunityOptions,
        targetEvents: authorizedRepoCollectionTargetEvents,
        targetDeleteEvents: repoCollectionTargetDeleteEvents,
        reactionEvents: repoCollectionReactionEvents,
      }),
      communityHistoryComplete:
        repoCollectionTargetHistoryComplete &&
        repoCollectionDeleteHistoryComplete &&
        repoCollectionOriginalHistoryComplete,
    }),
  )
  $effect(() => {
    if (
      !repoCollectionTargetHistoryComplete ||
      !repoCollectionDeleteHistoryComplete ||
      !repoCollectionOriginalHistoryComplete
    ) {
      return
    }

    repoCollectionRetryCount = 0
    if (repoCollectionRetryTimer) {
      clearTimeout(repoCollectionRetryTimer)
      repoCollectionRetryTimer = null
    }
  })

  $effect(() => {
    void repoCollectionRetryVersion
    const relayFilters = repoCollectionTargetFilterPlan.relayFilters
    const localFilters = repoCollectionTargetFilterPlan.localFilters
    const relays = repoCollectionRelays
    const key = JSON.stringify({
      renderedScope: repoCollectionRenderedScopeKey,
      relays,
      relayFilters,
      localFilters,
    })

    if (!$pubkey || !repoCollectionRenderedScopeKey) {
      repoCollectionTargetLoadRequestId += 1
      repoCollectionTargetLoadKey = ""
      repoCollectionTargetHistoryComplete = true
      return
    }
    if (!$repoListHydrationReadyStore) {
      repoCollectionTargetLoadRequestId += 1
      repoCollectionTargetLoadKey = ""
      repoCollectionTargetHistoryComplete = false
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      repoCollectionTargetLoadRequestId += 1
      repoCollectionTargetLoadKey = ""
      repoCollectionTargetHistoryComplete = true
      return
    }
    if (relays.length === 0) {
      repoCollectionTargetLoadRequestId += 1
      repoCollectionTargetLoadKey = ""
      repoCollectionTargetHistoryComplete = false
      return
    }
    if (key === repoCollectionTargetLoadKey) return
    repoCollectionTargetLoadKey = key
    repoCollectionTargetHistoryComplete = false
    const requestId = ++repoCollectionTargetLoadRequestId

    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, gitPageLoadController.signal])
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      priority: RELAY_REQUEST_PRIORITY.background,
      owner: "global-git-repository-collection-targets",
      signal,
    })
      .then(result => {
        if (signal.aborted || requestId !== repoCollectionTargetLoadRequestId) return
        repoCollectionTargetHistoryComplete = result.complete
        if (!result.complete) {
          repoCollectionTargetLoadKey = ""
          scheduleRepoCollectionRetry()
        }
      })
      .catch(error => {
        if (signal.aborted || requestId !== repoCollectionTargetLoadRequestId) return
        repoCollectionTargetHistoryComplete = false
        repoCollectionTargetLoadKey = ""
        scheduleRepoCollectionRetry()
        console.warn("[git/+page] Failed to load repository collection targets", error)
      })

    return () => controller.abort()
  })

  $effect(() => {
    void repoCollectionRetryVersion
    const filters = repoCollectionTargetDeleteFilters
    const relays = repoCollectionRelays
    const key = JSON.stringify({renderedScope: repoCollectionRenderedScopeKey, relays, filters})

    if (!$pubkey || !repoCollectionRenderedScopeKey) {
      repoCollectionDeleteLoadRequestId += 1
      repoCollectionDeleteLoadKey = ""
      repoCollectionDeleteHistoryComplete = true
      return
    }
    if (!$repoListHydrationReadyStore) {
      repoCollectionDeleteLoadRequestId += 1
      repoCollectionDeleteLoadKey = ""
      repoCollectionDeleteHistoryComplete = false
      return
    }
    if (filters.length === 0) {
      repoCollectionDeleteLoadRequestId += 1
      repoCollectionDeleteLoadKey = ""
      repoCollectionDeleteHistoryComplete = true
      return
    }
    if (relays.length === 0) {
      repoCollectionDeleteLoadRequestId += 1
      repoCollectionDeleteLoadKey = ""
      repoCollectionDeleteHistoryComplete = false
      return
    }
    if (key === repoCollectionDeleteLoadKey) return
    repoCollectionDeleteLoadKey = key
    repoCollectionDeleteHistoryComplete = false
    const requestId = ++repoCollectionDeleteLoadRequestId

    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, gitPageLoadController.signal])
    void loadBoundedCommunityHistory({
      relays,
      relayFilters: filters,
      localFilters: filters,
      priority: RELAY_REQUEST_PRIORITY.background,
      owner: "global-git-repository-collection-target-deletes",
      signal,
    })
      .then(result => {
        if (signal.aborted || requestId !== repoCollectionDeleteLoadRequestId) return
        repoCollectionDeleteHistoryComplete = result.complete
        if (!result.complete) {
          repoCollectionDeleteLoadKey = ""
          scheduleRepoCollectionRetry()
        }
      })
      .catch(error => {
        if (signal.aborted || requestId !== repoCollectionDeleteLoadRequestId) return
        repoCollectionDeleteHistoryComplete = false
        repoCollectionDeleteLoadKey = ""
        scheduleRepoCollectionRetry()
        console.warn("[git/+page] Failed to load repository collection target deletes", error)
      })

    return () => controller.abort()
  })

  $effect(() => {
    void repoCollectionRetryVersion
    const plans = [
      {
        relays: repoCollectionRelays,
        relayFilters: repoCollectionReactionFilterPlan.relayFilters,
        localFilters: repoCollectionReactionFilterPlan.localFilters,
      },
      ...repoCollectionReactionRelayHintPlans,
    ].filter(plan => plan.relays.length > 0 && plan.relayFilters.length > 0)
    const key = JSON.stringify({renderedScope: repoCollectionRenderedScopeKey, plans})

    if (repoCollectionFollowupLoadTimer) {
      clearTimeout(repoCollectionFollowupLoadTimer)
      repoCollectionFollowupLoadTimer = null
    }
    if (!$pubkey || !repoCollectionRenderedScopeKey) {
      repoCollectionFollowupLoadRequestId += 1
      repoCollectionFollowupLoadKey = ""
      repoCollectionOriginalHistoryComplete = true
      return
    }
    if (!$repoListHydrationReadyStore) {
      repoCollectionFollowupLoadRequestId += 1
      repoCollectionFollowupLoadKey = ""
      repoCollectionOriginalHistoryComplete = false
      return
    }
    if (repoCollectionReactionFilterPlan.relayFilters.length === 0) {
      repoCollectionFollowupLoadRequestId += 1
      repoCollectionFollowupLoadKey = ""
      repoCollectionOriginalHistoryComplete = true
      return
    }
    if (plans.length === 0) {
      repoCollectionFollowupLoadRequestId += 1
      repoCollectionFollowupLoadKey = ""
      repoCollectionOriginalHistoryComplete = false
      return
    }
    if (key === repoCollectionFollowupLoadKey) return
    repoCollectionFollowupLoadKey = key
    repoCollectionOriginalHistoryComplete = false
    const requestId = ++repoCollectionFollowupLoadRequestId
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, gitPageLoadController.signal])

    repoCollectionFollowupLoadTimer = setTimeout(() => {
      repoCollectionFollowupLoadTimer = null
      if (gitPageReadWorkStopped) return
      const originalLoads = plans.map(plan =>
        loadBoundedCommunityHistory({
          ...plan,
          priority: RELAY_REQUEST_PRIORITY.background,
          owner: "global-git-repository-collection-originals",
          signal,
        }),
      )
      void Promise.all(originalLoads)
        .then(results => {
          if (signal.aborted || requestId !== repoCollectionFollowupLoadRequestId) return
          repoCollectionOriginalHistoryComplete = results.every(result => result.complete)
          if (!repoCollectionOriginalHistoryComplete) {
            repoCollectionFollowupLoadKey = ""
            scheduleRepoCollectionRetry()
          }
        })
        .catch(error => {
          if (signal.aborted || requestId !== repoCollectionFollowupLoadRequestId) return
          repoCollectionOriginalHistoryComplete = false
          repoCollectionFollowupLoadKey = ""
          scheduleRepoCollectionRetry()
          console.warn("[git/+page] Failed to load repository collection state", error)
        })
    }, REPO_CARD_HYDRATION_DELAY_MS)

    return () => {
      controller.abort()
      if (repoCollectionFollowupLoadTimer) {
        clearTimeout(repoCollectionFollowupLoadTimer)
        repoCollectionFollowupLoadTimer = null
      }
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

  const accountSearch = $derived.by(
    (): {
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
    },
  )

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

  const getRepositoryOwnerProfileMatches = (query: string) => {
    try {
      const searchStore = getStore(repositoryOwnerProfileSearch)
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
        display_name: typeof content.display_name === "string" ? content.display_name : undefined,
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
      activeRepoSearchQuery = ""
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

  const starredRepoOwners = $derived.by(() =>
    Array.from(new Set(repoStarAddresses.map(star => star.author).filter(Boolean))),
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
    repoStarAddresses.forEach(star => owners.add(star.author))
    ;(($repoAnnouncements as RepoAnnouncementEvent[]) || []).forEach(event => {
      owners.add(event.pubkey)
    })

    return Array.from(owners).filter(Boolean)
  })

  const buildDiscoveryCommunityTrustScores = (candidatePubkeys: string[]) => {
    if (!selectedCommunityDefinition || candidatePubkeys.length === 0) {
      return new Map<string, number>()
    }

    const assessments = buildCommunityTrustAssessments({
      viewerPubkey: $pubkey || "",
      candidatePubkeys,
      context: {
        scope: "active_community",
        communityPubkey: selectedCommunityPubkey,
        communityAddress: selectedCommunityAddress,
      },
      definitions: [selectedCommunityDefinition],
      profileListEvents: $selectedCommunityProfileListEvents
        ? ($selectedCommunityProfileListEvents as TrustedEvent[])
        : [],
      reportStates:
        selectedCommunityAddress && selectedCommunityReportState
          ? new Map([[selectedCommunityAddress, selectedCommunityReportState]])
          : undefined,
      renouncedCommunityAddresses: $userRenouncedCommunityAddresses,
    })

    return new Map(
      Array.from(assessments.entries())
        .filter(([, assessment]) => !assessment.suppressed && assessment.score > 0)
        .map(([pubkey, assessment]) => [pubkey, assessment.score]),
    )
  }

  $effect(() => {
    const {pubkey, relayHints} = accountSearch
    if (!pubkey) return

    const filter = {
      kinds: [GIT_REPO_ANNOUNCEMENT],
      authors: [pubkey],
      limit: repoResultsVisibleLimit,
    } as any
    const initialRelays = getAccountSearchRelays(pubkey, relayHints)
    const loadKey = `${pubkey}|${initialRelays.slice().sort().join(",")}|${repoResultsVisibleLimit}`

    if (attemptedAccountSearchLoads.has(loadKey)) return

    attemptedAccountSearchLoads.add(loadKey)
    const controller = new AbortController()

    void refreshPubkeyOutboxRelays(pubkey, initialRelays)
      .then(outboxRelays => {
        if (controller.signal.aborted) return
        const relaysToQuery = getAccountSearchRelays(pubkey, [...relayHints, ...outboxRelays])
        if (relaysToQuery.length > 0) {
          return requestRepoAnnouncements({
            relays: relaysToQuery,
            filters: [filter],
            signal: controller.signal,
            owner: "git-list:account-search",
          })
        }
      })
      .catch(() => undefined)

    return () => {
      controller.abort()
      attemptedAccountSearchLoads.delete(loadKey)
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
  const trimmedActiveRepoSearchQuery = $derived.by(() => activeRepoSearchQuery.trim())
  const accountSearchContext = $derived.by(() =>
    JSON.stringify([
      accountSearch.mode,
      accountSearch.pubkey,
      accountSearch.identifier,
      accountSearch.invalid,
      accountSearch.relayHints.slice().sort(),
    ]),
  )
  const repoCardsScopeContext = $derived.by(() =>
    JSON.stringify([
      activeMode,
      activeTab,
      activeMode === "community" ? selectedCommunityAddress : "",
      $pubkey || "",
      accountSearchContext,
    ]),
  )
  const repoCardsSourceContext = $derived.by(() =>
    JSON.stringify([repoCardsScopeContext, trimmedActiveRepoSearchQuery]),
  )
  const repoCardsContext = $derived.by(() =>
    JSON.stringify([repoCardsSourceContext, repoResultsVisibleLimit]),
  )

  const hasRawRepoSearchInput = $derived.by(
    () => activeTab !== "snippets" && !isAccountSearch && trimmedSearchQuery.length > 0,
  )

  const hasRepoSearchInput = $derived.by(
    () => activeTab !== "snippets" && !isAccountSearch && trimmedActiveRepoSearchQuery.length > 0,
  )

  $effect(() => {
    const query = trimmedSearchQuery

    if (activeTab === "snippets" || isAccountSearch || !query) {
      activeRepoSearchQuery = ""
      return
    }

    const timeout = setTimeout(() => {
      activeRepoSearchQuery = query
    }, REPO_SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  })

  const loadedRepoSearchCandidates = $derived.by(() => {
    if (activeTab === "snippets") return []

    return mergeLoadedRepoSearchItems(
      mergeLoadedRepoSearchItems(latestCommunityRepos, loadedCommunityStarRepos),
      mergeLoadedRepoSearchItems(latestMyRepos, loadedStarredRepos),
    )
  })

  const repoSearchScopeAddressGroups = $derived.by(() => {
    const communityRepos = latestCommunityRepos.map(repo => repo.address)
    const communityStars = loadedCommunityStarRepos.map(repo => repo.address)
    const personalRepos = latestMyRepos.map(repo => repo.address)
    const personalStars = loadedStarredRepos.map(repo => repo.address)

    if (activeMode === "community") {
      return activeTab === "bookmarks"
        ? [communityStars, communityRepos, personalStars, personalRepos]
        : [communityRepos, communityStars, personalRepos, personalStars]
    }

    return activeTab === "bookmarks"
      ? [personalStars, personalRepos, communityStars, communityRepos]
      : [personalRepos, personalStars, communityRepos, communityStars]
  })

  const localSearchFilteredRepos = $derived.by(() => {
    const query = trimmedActiveRepoSearchQuery
    if (activeTab === "snippets" || isAccountSearch || !query) return []

    return loadedRepoSearchCandidates.filter(repo =>
      repoMatchesSearchQuery({
        repo,
        query,
        profile: getSearchProfile(repo.event.pubkey),
      }),
    )
  })

  const matchedDiscoveredSearchRepos = $derived.by(() => {
    if (!hasRepoSearchInput) return [] as typeof discoveredSearchRepoPool

    return discoveredSearchRepoPool.filter(item =>
      repoMatchesSearchQuery({
        repo: item,
        query: trimmedActiveRepoSearchQuery,
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
    repoItemsByAddress: Map<
      string,
      {address: string; event: RepoAnnouncementEvent; relayHint: string}
    >
    nextRepoEvents?: RepoAnnouncementEvent[]
  }) => {
    for (const event of nextRepoEvents) {
      if (isDeletedRepoAnnouncement(event)) continue

      const item = toLoadedRepoSearchItem(
        event,
        Router.get().getRelaysForPubkey(event.pubkey)?.[0] || "",
      )
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

  const repoDiscoveryStatusLabel = $derived.by(() => {
    if (!hasRawRepoSearchInput) return ""
    if (trimmedSearchQuery.length < 2) {
      return "Type at least 2 characters to search beyond local repositories."
    }
    if (repoDiscoveryStatus.loading) {
      return repoDiscoveryRunMode === "exhaustive"
        ? "Continuing search..."
        : "Searching repositories..."
    }
    if (repoDiscoveryStatus.phase === "typing" || trimmedSearchQuery !== activeTextSearchQuery) {
      return "Searching..."
    }
    if (repoDiscoveryStatus.timedOut) return "Search timed out. Showing current results."
    if (repoDiscoveryStatus.phase === "aborted") return "Search stopped. Showing current results."
    if (repoDiscoveryStatus.phase === "complete" && activeTextSearchQuery) return "Search complete."

    return ""
  })
  const repoDiscoveryStatusSpinning = $derived(
    repoDiscoveryStatus.loading ||
      (trimmedSearchQuery.length >= 2 &&
        (repoDiscoveryStatus.phase === "typing" || trimmedSearchQuery !== activeTextSearchQuery)),
  )

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
    }, 350)

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
    void repoDiscoveryRunNonce

    if (!query || activeTab === "snippets" || isAccountSearch) {
      return
    }

    const discoveryInputs = untrack(() => {
      const profileMatches = getRepositoryOwnerProfileMatches(query)
      const activeCommunityPubkeys = [...selectedCommunityRepoWriterPubkeys]
      const communityAssociatedPubkeys = latestCommunityRepos.map(repo => repo.event.pubkey)
      const communityTrustCandidates = Array.from(
        new Set(
          [
            ...starredRepoOwners,
            ...followedPubkeys,
            ...knownRepoOwners,
            ...profileMatches,
            ...activeCommunityPubkeys,
            ...communityAssociatedPubkeys,
          ].filter(Boolean),
        ),
      )

      return {
        settings: repoDiscoveryPrioritySettings.map(setting => ({...setting})),
        viewerPubkey: $pubkey,
        starredOwners: [...starredRepoOwners],
        activeCommunityPubkeys,
        communityTrustScores: buildDiscoveryCommunityTrustScores(communityTrustCandidates),
        communityAssociatedPubkeys,
        followPubkeys: [...followedPubkeys],
        knownOwners: [...knownRepoOwners],
        profileMatches,
        existingRepoPool: [...discoveredSearchRepoPool],
        runMode,
      }
    })

    const previousSnapshot = untrack(() => repoDiscoverySnapshot)

    let snapshot: RepoDiscoverySnapshot

    if (
      previousSnapshot?.query === query &&
      previousSnapshot.nextBucketIndex < previousSnapshot.buckets.length
    ) {
      snapshot = {
        ...previousSnapshot,
      }
    } else {
      const buckets = dedupeRepoDiscoveryBuckets(
        buildRepoDiscoveryBuckets({
          settings: discoveryInputs.settings,
          viewerPubkey: discoveryInputs.viewerPubkey,
          starredOwners: discoveryInputs.starredOwners,
          activeCommunityPubkeys: discoveryInputs.activeCommunityPubkeys,
          communityTrustScores: discoveryInputs.communityTrustScores,
          communityAssociatedPubkeys: discoveryInputs.communityAssociatedPubkeys,
          followPubkeys: discoveryInputs.followPubkeys,
          knownOwners: discoveryInputs.knownOwners,
          profileMatches: discoveryInputs.profileMatches,
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
    let pageFilled = discoveryInputs.runMode === "smart" && matchedRepos >= repoResultsVisibleLimit
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

        outer: for (
          let bucketIndex = snapshot.nextBucketIndex;
          bucketIndex < buckets.length;
          bucketIndex += 1
        ) {
          if (pageFilled) break
          const bucket = buckets[bucketIndex]
          finalBucketKey = bucket.key
          finalBucketLabel = bucket.label
          finalBucketIndex = bucketIndex + 1
          finalBucketTotalAuthors = bucket.pubkeys.length

          const initialOffset =
            bucketIndex === snapshot.nextBucketIndex ? snapshot.nextBucketOffset : 0

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
                isolated: true,
              })

              if (controller.signal.aborted) return

              fetchedProfileAuthors += authors.length
              untrack(() => updateDiscoveredOwnerProfiles(profileEvents))

              const profileSync = untrack(() =>
                syncDiscoveredSearchRepos({
                  query,
                  repoItemsByAddress,
                }),
              )
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
                filters: [
                  {
                    kinds: [GIT_REPO_ANNOUNCEMENT],
                    authors,
                    limit: Math.max(1, repoResultsVisibleLimit - matchedRepos),
                  },
                ],
                timeoutMs: Math.min(5000, remainingMs),
                signal: controller.signal,
                isolated: true,
              })

              if (controller.signal.aborted) return

              fetchedRepoAuthors += authors.length

              const repoSync = untrack(() =>
                syncDiscoveredSearchRepos({
                  query,
                  repoItemsByAddress,
                  nextRepoEvents: repoEvents,
                }),
              )
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
                finalBucketProcessedAuthors < bucket.pubkeys.length
                  ? finalBucketProcessedAuthors
                  : 0,
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

            if (discoveryInputs.runMode === "smart" && matchedRepos >= repoResultsVisibleLimit) {
              pageFilled = true
              break outer
            }
          }
        }

        if (controller.signal.aborted) return

        if (!timedOut && !pageFilled) {
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

  // Search spans community and personal sources; the active scope remains the first priority.
  const searchFilteredRepos = $derived.by(() => {
    const repos = filteredRepos
    const query = trimmedActiveRepoSearchQuery
    if (isAccountSearch) return []

    if (!query) return repos

    return sortRepoSearchResults({
      items: mergeLoadedRepoSearchItems(localSearchFilteredRepos, matchedDiscoveredSearchRepos),
      query,
      viewerPubkey: $pubkey,
      starredOwners: [...starredRepoOwners],
      starredAddresses: repoStarAddresses.map(star => star.address),
      scopeAddressGroups: repoSearchScopeAddressGroups,
      priorityPubkeyGroups:
        repoDiscoverySnapshot?.query === activeTextSearchQuery
          ? repoDiscoverySnapshot.buckets.map(bucket => bucket.pubkeys)
          : [],
      getProfile: getSearchProfile,
    })
  })

  const repoResultsVisibleContext = $derived(repoCardsSourceContext)
  let lastRepoResultsVisibleContext = ""
  $effect(() => {
    if (repoResultsVisibleContext === lastRepoResultsVisibleContext) return

    lastRepoResultsVisibleContext = repoResultsVisibleContext
    repoResultsVisibleLimit = REPO_SEARCH_PAGE_SIZE
  })
  const visibleSearchFilteredRepos = $derived.by(() =>
    searchFilteredRepos.slice(0, repoResultsVisibleLimit),
  )
  const hasMoreRepoResults = $derived(
    searchFilteredRepos.length > visibleSearchFilteredRepos.length ||
      (activeMode === "personal" &&
        activeTab === "bookmarks" &&
        repoStarAddresses.length > repoResultsVisibleLimit) ||
      (!trimmedActiveRepoSearchQuery && searchFilteredRepos.length >= repoResultsVisibleLimit) ||
      (trimmedActiveRepoSearchQuery && canContinueRepoDiscovery),
  )
  const loadMoreRepoResults = () => {
    repoResultsVisibleLimit += REPO_SEARCH_PAGE_SIZE
    if (
      trimmedActiveRepoSearchQuery &&
      repoDiscoverySnapshot?.query === activeTextSearchQuery &&
      repoDiscoverySnapshot.nextBucketIndex < repoDiscoverySnapshot.buckets.length
    ) {
      repoDiscoveryRunMode = "smart"
      repoDiscoveryRunNonce += 1
    }
  }

  // Store for account search (naddr/npub) repo cards
  let accountSearchRepoCards = $state<any[]>([])
  let accountSearchCardsComputeTimer: ReturnType<typeof setTimeout> | null = null
  let accountSearchCardsComputeRequestId = 0
  let renderedAccountSearchContext = $state("")
  const accountSearchRenderedContext = $derived.by(() =>
    JSON.stringify([accountSearchContext, repoResultsVisibleLimit]),
  )
  const sortedAccountSearchRepoCards = $derived.by(() =>
    prioritizeFreshRepoCards(accountSearchRepoCards),
  )
  const hasMoreAccountSearchRepos = $derived(
    accountSearchVisibleRepos.length >= repoResultsVisibleLimit,
  )

  // Update account search repo cards
  $effect(() => {
    const context = accountSearchRenderedContext
    if (!isAccountSearch) {
      if (accountSearchCardsComputeTimer) {
        clearTimeout(accountSearchCardsComputeTimer)
        accountSearchCardsComputeTimer = null
      }
      accountSearchCardsComputeRequestId += 1
      accountSearchRepoCards = []
      renderedAccountSearchContext = ""
      return
    }

    if (renderedAccountSearchContext !== context) accountSearchRepoCards = []

    const repos = accountSearchVisibleRepos.slice(0, repoResultsVisibleLimit)
    if (repos.length > 0) {
      if (accountSearchCardsComputeTimer) {
        clearTimeout(accountSearchCardsComputeTimer)
      }
      const requestId = ++accountSearchCardsComputeRequestId
      const timer = setTimeout(() => {
        if (
          requestId !== accountSearchCardsComputeRequestId ||
          !isAccountSearch ||
          accountSearchRenderedContext !== context
        ) {
          return
        }
        const cards = repositoriesStore.computeCards(repos, {
          parseRepoAnnouncementEvent,
        })
        accountSearchRepoCards = cards
        renderedAccountSearchContext = context
        if (accountSearchCardsComputeTimer === timer) accountSearchCardsComputeTimer = null
      }, 0)
      accountSearchCardsComputeTimer = timer
    } else {
      if (accountSearchCardsComputeTimer) {
        clearTimeout(accountSearchCardsComputeTimer)
        accountSearchCardsComputeTimer = null
      }
      accountSearchCardsComputeRequestId += 1
      accountSearchRepoCards = []
      renderedAccountSearchContext = context
    }
  })

  // Memoize card computation to prevent jitter
  type RepoCardsCacheEntry = {cardsKey: string; cards: any[]}
  const repoCardsByContext = new Map<string, RepoCardsCacheEntry>()
  const cacheRepoCardsForContext = (context: string, entry: RepoCardsCacheEntry) => {
    repoCardsByContext.delete(context)
    repoCardsByContext.set(context, entry)
    while (repoCardsByContext.size > REPO_CARDS_CONTEXT_CACHE_LIMIT) {
      repoCardsByContext.delete(repoCardsByContext.keys().next().value as string)
    }
  }
  const getCachedRepoCardsForContext = (context: string) => {
    const entry = repoCardsByContext.get(context)
    if (entry) cacheRepoCardsForContext(context, entry)
    return entry
  }
  let cachedCards: any[] = []
  let cachedCardsKey = ""
  let cardsComputeTimer: ReturnType<typeof setTimeout> | null = null
  let cardsComputeRequestId = 0
  let renderedRepoCardsContext = $state("")
  let renderedRepoCardsScopeContext = $state("")
  let lastRepoCardsScopeContext = ""
  let repoCardsComputing = $state(false)
  const sortedRepoCards = $derived.by(() => {
    const cards = $repositoriesStore as any[]
    return trimmedActiveRepoSearchQuery ? cards : prioritizeFreshRepoCards(cards)
  })
  const sortedRepoCardModels = $derived.by(() =>
    sortedRepoCards
      .map(card => projectRepoListCard(card))
      .filter((model): model is RepoListCardModel => Boolean(model)),
  )
  const sortedAccountSearchRepoCardModels = $derived.by(() =>
    sortedAccountSearchRepoCards
      .map(card => projectRepoListCard(card))
      .filter((model): model is RepoListCardModel => Boolean(model)),
  )
  const personalStarredReposLoading = $derived(
    activeMode === "personal" &&
      activeTab === "bookmarks" &&
      Boolean($pubkey) &&
      (!$repoListHydrationReadyStore ||
        !repoStarsHydrationSettled ||
        $repoStarsLoading ||
        starredRepoAnnouncementsLoading),
  )
  const activeRepoDataLoading = $derived.by(() => {
    if (activeTab === "snippets" || isAccountSearch) return false

    if (activeMode === "personal") {
      if (!$pubkey) return false
      if (activeTab === "my-repos") {
        return !$repoListHydrationReadyStore || !personalRepoAnnouncementsSettled
      }
      if (activeTab === "bookmarks") return personalStarredReposLoading
      return false
    }

    if (activeMode === "community") {
      if (!selectedCommunityAddress) return false
      if (activeTab === "my-repos") {
        return !$repoListHydrationReadyStore || !communityRepoAnnouncementsSettled
      }
      if (activeTab === "bookmarks") {
        return (
          !communityTargetsSettled ||
          !communityTargetDeletesSettled ||
          !communityOriginalsSettled ||
          !communityStarReposSettled
        )
      }
    }

    return false
  })
  const hasRenderedRepoCardsForCurrentContext = $derived(
    renderedRepoCardsScopeContext === repoCardsScopeContext &&
      renderedRepoCardsContext === repoCardsContext &&
      sortedRepoCards.length > 0,
  )
  const hasRenderedRepoCardsForCurrentScope = $derived(
    renderedRepoCardsScopeContext === repoCardsScopeContext && sortedRepoCards.length > 0,
  )
  const repoSearchUpdating = $derived(
    hasRenderedRepoCardsForCurrentScope &&
      (!hasRenderedRepoCardsForCurrentContext ||
        repoCardsComputing ||
        (hasRepoSearchInput && repoDiscoveryStatus.loading)),
  )
  const repoListLoading = $derived.by(() => {
    if (activeTab === "snippets" || isAccountSearch) return false
    if (hasRenderedRepoCardsForCurrentScope) return false
    return Boolean(loading || repoCardsComputing || activeRepoDataLoading)
  })
  const canShowRepoEmpty = $derived(
    activeTab !== "snippets" &&
      !isAccountSearch &&
      !repoListLoading &&
      !repoSearchUpdating &&
      searchFilteredRepos.length === 0,
  )
  let performanceRunId = ""
  const performanceMilestones = new Set<string>()
  const PERFORMANCE_BACKGROUND_TAIL_MS = 10_000
  let performanceForegroundKey = ""
  let performancePaintGeneration = 0
  let performanceBackgroundTimer: ReturnType<typeof setTimeout> | undefined
  const markPerformanceMilestone = (name: string, detail?: unknown) => {
    const active = $activePerformanceDiagnosticsRun
    if (!PERFORMANCE_DIAGNOSTICS_ENABLED || !active || active.route !== $page.url.pathname) return
    if (active.id !== performanceRunId) {
      performanceRunId = active.id
      performanceMilestones.clear()
    }
    if (performanceMilestones.has(name)) return
    performanceMilestones.add(name)
    markPerformanceDiagnosticsMilestone(active.id, name, detail)
  }
  const getPerformanceBackgroundDetail = () => ({
    mode: activeMode,
    tab: activeTab,
    hydrationReady: $repoListHydrationReadyStore,
    personalRepoAnnouncementsSettled,
    personalStarredReposLoading,
    communityRepoAnnouncementsSettled,
    communityTargetsSettled,
    communityTargetDeletesSettled,
    communityOriginalsSettled,
    communityStarReposSettled,
    cards: repoCardModelsForEnrichment.length,
    scopeContext: repoCardsScopeContext,
  })
  const completePerformanceAfterBackgroundTail = (runId: string) => {
    if (performanceBackgroundTimer) clearTimeout(performanceBackgroundTimer)
    if (!activeRepoDataLoading) {
      recordPerformanceDiagnostics(
        runId,
        "git-background-terminal",
        getPerformanceBackgroundDetail(),
      )
      markPerformanceMilestone("background-data-terminal")
      markPerformanceMilestone("capture-complete", {background: "terminal"})
      completeAutomaticPerformanceDiagnosticsCapture(runId)
      return
    }
    recordPerformanceDiagnostics(runId, "git-background-pending", getPerformanceBackgroundDetail())
    performanceBackgroundTimer = setTimeout(() => {
      const active = $activePerformanceDiagnosticsRun
      if (!active || active.id !== runId) return
      recordPerformanceDiagnostics(
        runId,
        "git-background-tail-expired",
        {tailMs: PERFORMANCE_BACKGROUND_TAIL_MS, ...getPerformanceBackgroundDetail()},
        "warnings",
      )
      markPerformanceMilestone("capture-complete", {background: "tail-expired"})
      completeAutomaticPerformanceDiagnosticsCapture(runId)
    }, PERFORMANCE_BACKGROUND_TAIL_MS)
  }
  $effect(() => {
    const active = $activePerformanceDiagnosticsRun
    if (!active || active.route !== $page.url.pathname) return

    markPerformanceMilestone("route-mounted", {mode: activeMode, tab: activeTab})
    recordPerformanceDiagnostics(active.id, "git-state", {
      mode: activeMode,
      tab: activeTab,
      scopeContext: repoCardsScopeContext,
      sourceCount: sortedRepoCards.length,
      renderedCount: repoCardModelsForEnrichment.length,
      loading,
      dataLoading: activeRepoDataLoading,
      cardsComputing: repoCardsComputing,
      listLoading: repoListLoading,
      searchUpdating: repoSearchUpdating,
    })
    if (!loading) markPerformanceMilestone("cache-released")
    if (sortedRepoCards.length > 0) {
      markPerformanceMilestone("repositories-available", {count: sortedRepoCards.length})
    }
    if (hasRenderedRepoCardsForCurrentContext) {
      markPerformanceMilestone("cards-rendered", {count: repoCardModelsForEnrichment.length})
    }
    const hasPositiveResult =
      hasRenderedRepoCardsForCurrentContext && !repoCardsComputing && !repoSearchUpdating
    const hasAuthoritativeEmptyResult =
      canShowRepoEmpty && !repoListLoading && !repoSearchUpdating && !activeRepoDataLoading
    if (!hasPositiveResult && !hasAuthoritativeEmptyResult) return

    const foregroundKey = JSON.stringify([
      active.id,
      activeMode,
      activeTab,
      repoCardsScopeContext,
      repoCardsContext,
      repoCardModelsForEnrichment.map(model => model.address),
    ])
    if (performanceForegroundKey === foregroundKey) return
    performanceForegroundKey = foregroundKey
    const generation = ++performancePaintGeneration
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const current = $activePerformanceDiagnosticsRun
        if (!current || current.id !== active.id || generation !== performancePaintGeneration)
          return
        const currentKey = JSON.stringify([
          current.id,
          activeMode,
          activeTab,
          repoCardsScopeContext,
          repoCardsContext,
          repoCardModelsForEnrichment.map(model => model.address),
        ])
        if (currentKey !== foregroundKey) return
        markPerformanceMilestone("foreground-painted", {
          cards: repoCardModelsForEnrichment.length,
          result: hasPositiveResult ? "cards" : "authoritative-empty",
        })
        if (hasPositiveResult) {
          markPerformanceMilestone("cards-painted", {cards: repoCardModelsForEnrichment.length})
        }
        markPerformanceMilestone("loading-settled")
        markPerformanceMilestone("foreground-settled", {
          mode: activeMode,
          tab: activeTab,
          cards: repoCardModelsForEnrichment.length,
          foreground: hasPositiveResult ? "stable-rendered-cards" : "authoritative-empty",
          backgroundDataLoading: activeRepoDataLoading,
        })
        completePerformanceAfterBackgroundTail(active.id)
      })
    })
  })
  $effect(() => {
    const active = $activePerformanceDiagnosticsRun
    if (!active || active.id !== performanceRunId || !performanceForegroundKey) return
    if (!activeRepoDataLoading && performanceBackgroundTimer) {
      completePerformanceAfterBackgroundTail(active.id)
    }
  })

  const repoCardModelsForEnrichment = $derived.by(() =>
    isAccountSearch
      ? renderedAccountSearchContext === accountSearchRenderedContext
        ? sortedAccountSearchRepoCardModels
        : []
      : hasRenderedRepoCardsForCurrentContext
        ? sortedRepoCardModels
        : [],
  )
  $effect(() => {
    const nextScopeKey = repoCardModelsForEnrichment.length
      ? JSON.stringify(repoCardModelsForEnrichment.map(model => model.address))
      : ""
    if (nextScopeKey !== repoCollectionRetryScopeKey) {
      repoCollectionRetryScopeKey = nextScopeKey
      repoCollectionRetryCount = 0
      if (repoCollectionRetryTimer) {
        clearTimeout(repoCollectionRetryTimer)
        repoCollectionRetryTimer = null
      }
    }
    repoCollectionRenderedScopeKey = nextScopeKey
  })
  let repoCardStarHydrationKey = ""
  let repoCardStarsHydratedUser = ""
  const repoCardStarHydratedScopes = new Map<string, string>()
  $effect(() => {
    const models = repoCardModelsForEnrichment
    const user = $pubkey || ""
    if (user !== repoCardStarsHydratedUser) {
      repoCardStarsHydratedUser = user
      repoCardStarHydratedScopes.clear()
    }
    const relays = Array.from(
      new Set(
        [
          ...models.flatMap(model => model.declaredRelays),
          ...bookmarkListRelays,
          ...getRelaysFromList($userRelayList),
        ]
          .map(relay => safeNormalizeRelay(relay))
          .filter(Boolean),
      ),
    )
    const relayScope = relays.slice().sort().join(",")
    const addresses = models
      .map(model => model.address)
      .filter(address => address && repoCardStarHydratedScopes.get(address) !== relayScope)
    const key = JSON.stringify([user, addresses, relays])
    if (
      !$pubkey ||
      addresses.length === 0 ||
      (activeMode === "personal" && activeTab === "bookmarks")
    ) {
      repoCardStarHydrationKey = ""
      return
    }
    if (key === repoCardStarHydrationKey) return
    repoCardStarHydrationKey = key
    const controller = new AbortController()
    void hydrateRepoStars({
      repoAddresses: addresses,
      relayHints: relays,
      signal: controller.signal,
    })
      .then(completed => {
        if (completed && !controller.signal.aborted) {
          for (const address of addresses) repoCardStarHydratedScopes.set(address, relayScope)
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.warn("[git/+page] Failed to hydrate rendered repository stars", error)
        }
      })

    return () => {
      controller.abort()
      if (repoCardStarHydrationKey === key) repoCardStarHydrationKey = ""
    }
  })
  const repoCardVerificationTargets = $derived.by(() =>
    repoCardModelsForEnrichment
      .filter(model => model.maintainers.length > 0)
      .map(model => ({
        event: model.event,
        relays: Array.from(
          new Set(
            [
              ...model.declaredRelays,
              ...Array.from(tracker.getRelays(model.event.id) || []),
              getRepoCardRelayHint(model.event, model.address),
            ]
              .map(relay => safeNormalizeRelay(relay))
              .filter(Boolean),
          ),
        ),
      })),
  )
  let repoCardVerifiedMaintainersByAddress = $state(new Map<string, Set<string>>())
  const getRepoCardVerifiedMaintainers = (model: RepoListCardModel) => {
    const verified = model.address
      ? repoCardVerifiedMaintainersByAddress.get(model.address)
      : undefined
    if (!verified) return EMPTY_VERIFIED_REPO_MAINTAINERS
    return new Set(model.maintainers.filter(pubkey => verified.has(pubkey)))
  }
  let repoCardProfileLoadKey = ""
  let repoCardEvidenceLoadKey = ""
  let repoCardEvidenceRetryKey = ""
  let repoCardEvidenceRetryCount = 0
  let repoCardEvidenceRetryVersion = $state(0)
  let repoCardEvidenceLoadTimer: ReturnType<typeof setTimeout> | null = null
  let repoCardEvidenceLoadController: AbortController | null = null
  let repoCardProfileLoadTimer: ReturnType<typeof setTimeout> | null = null
  let repoCardProfileLoadController: AbortController | null = null

  const cancelRepoCardEvidenceLoad = () => {
    if (repoCardEvidenceLoadTimer) {
      clearTimeout(repoCardEvidenceLoadTimer)
      repoCardEvidenceLoadTimer = null
    }
    repoCardEvidenceLoadController?.abort()
    repoCardEvidenceLoadController = null
  }

  const cancelRepoCardProfileLoad = () => {
    if (repoCardProfileLoadTimer) {
      clearTimeout(repoCardProfileLoadTimer)
      repoCardProfileLoadTimer = null
    }
    repoCardProfileLoadController?.abort()
    repoCardProfileLoadController = null
  }

  const scheduleRepoCardEvidenceRetry = (key: string) => {
    if (repoCardEvidenceRetryCount >= 2 || gitPageReadWorkStopped) return

    repoCardEvidenceRetryCount += 1
    repoCardEvidenceLoadTimer = setTimeout(() => {
      repoCardEvidenceLoadTimer = null
      if (repoCardEvidenceRetryKey !== key) return
      repoCardEvidenceRetryVersion += 1
    }, 5000 * repoCardEvidenceRetryCount)
  }

  $effect(() => {
    void repoCardEvidenceRetryVersion
    const targets = repoCardVerificationTargets
    const key = targets
      .map(target => `${target.event.id}:${target.relays.slice().sort().join(",")}`)
      .sort()
      .join("|")

    if (!key || targets.length === 0) {
      repoCardEvidenceLoadKey = ""
      repoCardEvidenceRetryKey = ""
      repoCardEvidenceRetryCount = 0
      cancelRepoCardEvidenceLoad()
      repoCardVerifiedMaintainersByAddress = new Map()
      return
    }

    if (repoCardEvidenceRetryKey !== key) {
      repoCardEvidenceRetryKey = key
      repoCardEvidenceRetryCount = 0
    }

    if (key === repoCardEvidenceLoadKey) return
    repoCardEvidenceLoadKey = key

    cancelRepoCardEvidenceLoad()
    const controller = new AbortController()
    repoCardEvidenceLoadController = controller
    repoCardEvidenceLoadTimer = setTimeout(() => {
      repoCardEvidenceLoadTimer = null
      if (gitPageReadWorkStopped || controller.signal.aborted) return

      loadRepoCardVerification(targets, controller.signal)
        .then(result => {
          if (!controller.signal.aborted && repoCardEvidenceLoadKey === key) {
            const next = new Map<string, Set<string>>()
            for (const target of targets) {
              const address = getRepoAddressFromEvent(target.event)
              const verified = result.verifiedByAddress.get(address)
              const previous = repoCardVerifiedMaintainersByAddress.get(address)
              next.set(address, verified?.size ? verified : previous || new Set())
            }
            repoCardVerifiedMaintainersByAddress = next
            repoCardEvidenceLoadController = null
            if (result.completion === "partial") {
              repoCardEvidenceLoadKey = ""
              scheduleRepoCardEvidenceRetry(key)
            } else {
              repoCardEvidenceRetryCount = 0
            }
          }
        })
        .catch(error => {
          if (!controller.signal.aborted) {
            repoCardEvidenceLoadController = null
            repoCardEvidenceLoadKey = ""
            scheduleRepoCardEvidenceRetry(key)
            console.warn(
              "[git/+page] Failed to load repo card maintainer verification evidence",
              error,
            )
          }
        })
    }, REPO_CARD_HYDRATION_DELAY_MS)
  })

  $effect(() => {
    if (activeTab === "snippets") {
      repoCardProfileLoadKey = ""
      cancelRepoCardProfileLoad()
      return
    }

    const ownerTargets = new Map<string, Set<string>>()
    const secondaryTargets = new Map<string, Set<string>>()
    const addTarget = (targets: Map<string, Set<string>>, pubkey: string, relays: string[]) => {
      if (!pubkey) return
      const mergedRelays = targets.get(pubkey) || new Set<string>()
      for (const relay of relays) {
        if (mergedRelays.size >= REPO_LIST_MAX_RELAYS) break
        mergedRelays.add(relay)
      }
      targets.set(pubkey, mergedRelays)
    }
    for (const model of repoCardModelsForEnrichment) {
      const relays = getRepoCardProfileRelays(model)
      addTarget(ownerTargets, model.owner, relays)
      const communityPubkey = repoViewCommunityOptions.find(
        option => option.address === model.communityAddress,
      )?.ownerPubkey
      if (communityPubkey && !ownerTargets.has(communityPubkey)) {
        addTarget(secondaryTargets, communityPubkey, relays)
      }
      for (const pubkey of model.maintainers.slice(0, 3)) {
        if (!ownerTargets.has(pubkey)) addTarget(secondaryTargets, pubkey, relays)
      }
    }
    const owners = Array.from(ownerTargets, ([pubkey, relays]) => ({
      pubkey,
      relays: Array.from(relays),
    }))
    const secondary = Array.from(secondaryTargets, ([pubkey, relays]) => ({
      pubkey,
      relays: Array.from(relays),
    })).filter(({pubkey}) => !ownerTargets.has(pubkey))
    const requests = [...owners, ...secondary]

    const key = requests
      .map(({pubkey, relays}) => `${pubkey}:${relays.join(",")}`)
      .sort()
      .join("|")

    if (!key) {
      repoCardProfileLoadKey = ""
      cancelRepoCardProfileLoad()
      return
    }

    if (key === repoCardProfileLoadKey) return
    repoCardProfileLoadKey = key
    cancelRepoCardProfileLoad()
    const controller = new AbortController()
    repoCardProfileLoadController = controller

    repoCardProfileLoadTimer = setTimeout(() => {
      repoCardProfileLoadTimer = null
      if (gitPageReadWorkStopped || controller.signal.aborted) return

      void loadBudabitProfileBatch(owners, controller.signal)
        .then(() => loadBudabitProfileBatch(secondary, controller.signal))
        .catch(error => {
          if (!controller.signal.aborted) {
            console.warn("[git/+page] Failed to load repo card profiles", error)
          }
        })
    }, REPO_CARD_HYDRATION_DELAY_MS)
  })

  // Update repositoriesStore whenever repos change
  // Uses debouncing to wait for all repos to load before showing cards
  $effect(() => {
    const scopeContext = repoCardsScopeContext
    if (scopeContext !== lastRepoCardsScopeContext) {
      lastRepoCardsScopeContext = scopeContext
      if (cardsComputeTimer) {
        clearTimeout(cardsComputeTimer)
        cardsComputeTimer = null
      }
      cardsComputeRequestId += 1
      repoCardsComputing = false
      cachedCards = []
      cachedCardsKey = ""
      renderedRepoCardsContext = ""
      renderedRepoCardsScopeContext = ""
      untrack(() => repositoriesStore.clear())
    }

    if (activeTab === "snippets") {
      if (cardsComputeTimer) {
        clearTimeout(cardsComputeTimer)
        cardsComputeTimer = null
      }
      cardsComputeRequestId += 1
      repoCardsComputing = false
      return
    }

    if (isAccountSearch) {
      if (cardsComputeTimer) {
        clearTimeout(cardsComputeTimer)
        cardsComputeTimer = null
      }
      cardsComputeRequestId += 1
      repoCardsComputing = false
      return
    }

    const reposToShow = visibleSearchFilteredRepos
    const context = repoCardsContext
    const cachedEntry = getCachedRepoCardsForContext(context)
    const searchResultsPending = hasRepoSearchInput && repoDiscoveryStatus.loading

    if ((activeRepoDataLoading || searchResultsPending) && reposToShow.length === 0) {
      if (cachedEntry?.cards.length) {
        cachedCards = cachedEntry.cards
        cachedCardsKey = cachedEntry.cardsKey
        repositoriesStore.set(cachedEntry.cards)
        renderedRepoCardsContext = context
        renderedRepoCardsScopeContext = scopeContext
        repoCardsComputing = false
        loading = false
      } else {
        loading = true
      }
      return
    }

    const shouldResolveEmpty =
      activeMode === "community" || activeMode === "personal" || activeTab === "bookmarks"
    if (reposToShow.length > 0 || !loading || shouldResolveEmpty) {
      loading = false
      if (reposToShow.length > 0) {
        // Preserve visible order so search relevance changes invalidate the card cache.
        const repoIds = reposToShow.map((r: any) => (r.event ?? r).id).join(",")
        const cardsKey = `${context}:${repoIds}`

        // Only recompute and push cards when the key has actually changed
        if (cachedEntry?.cardsKey === cardsKey) {
          cachedCards = cachedEntry.cards
          cachedCardsKey = cachedEntry.cardsKey
          repositoriesStore.set(cachedEntry.cards)
          renderedRepoCardsContext = context
          renderedRepoCardsScopeContext = scopeContext
          repoCardsComputing = false
        } else if (cardsKey !== cachedCardsKey || renderedRepoCardsContext !== context) {
          if (cardsComputeTimer) {
            clearTimeout(cardsComputeTimer)
            cardsComputeTimer = null
          }
          repoCardsComputing = true
          const requestId = ++cardsComputeRequestId
          const timer = setTimeout(() => {
            if (
              requestId !== cardsComputeRequestId ||
              repoCardsContext !== context ||
              repoCardsScopeContext !== scopeContext
            ) {
              return
            }
            const cards = repositoriesStore.computeCards(reposToShow, {
              parseRepoAnnouncementEvent,
            })
            cachedCards = cards
            cachedCardsKey = cardsKey
            cacheRepoCardsForContext(context, {cardsKey, cards})
            repositoriesStore.set(cachedCards)
            renderedRepoCardsContext = context
            renderedRepoCardsScopeContext = scopeContext
            repoCardsComputing = false
            if (cardsComputeTimer === timer) cardsComputeTimer = null
          }, 0)
          cardsComputeTimer = timer
        }
      } else {
        if (cardsComputeTimer) {
          clearTimeout(cardsComputeTimer)
          cardsComputeTimer = null
        }
        cardsComputeRequestId += 1
        repoCardsComputing = false
        cachedCards = []
        cachedCardsKey = ""
        repoCardsByContext.delete(context)
        untrack(() => {
          repositoriesStore.clear()
        })
        renderedRepoCardsContext = context
        renderedRepoCardsScopeContext = scopeContext
      }
    }
  })

  const stopGitPageReadWork = () => {
    if (gitPageReadWorkStopped) return
    gitPageReadWorkStopped = true
    gitPageLoadController.abort()
    cardsComputeRequestId += 1
    accountSearchCardsComputeRequestId += 1
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
    if (repoCollectionFollowupLoadTimer) {
      clearTimeout(repoCollectionFollowupLoadTimer)
      repoCollectionFollowupLoadTimer = null
    }
    if (repoCollectionRetryTimer) {
      clearTimeout(repoCollectionRetryTimer)
      repoCollectionRetryTimer = null
    }
    cancelRepoCardEvidenceLoad()
    cancelRepoCardProfileLoad()
    for (const timer of repoLoadSettleTimers) {
      clearTimeout(timer)
    }
    repoLoadSettleTimers.clear()
    for (const timer of repoLoadTimeoutTimers) {
      clearTimeout(timer)
    }
    repoLoadTimeoutTimers.clear()
  }

  onDestroy(() => {
    performancePaintGeneration++
    if (performanceBackgroundTimer) clearTimeout(performanceBackgroundTimer)
    stopGitPageReadWork()
    for (const transport of activeRepoPublishTransports) transport.dispose()
    activeRepoPublishTransports.clear()
  })

  const back = () => history.back()

  const shouldShowRepoCardBookmark = (event?: RepoAnnouncementEvent | null) =>
    Boolean(event && $pubkey)

  const getRepoCardRelayHint = (
    event: RepoAnnouncementEvent,
    address = getRepoAddressFromEvent(event),
  ) => {
    const fromLoadedStars =
      loadedStarredRepos.find(repo => repo.address === address)?.relayHint || ""
    const fromTracker = Array.from(tracker.getRelays(event.id) || [])[0] || ""
    const fromPubkey = Router.get().getRelaysForPubkey(event.pubkey)?.[0] || ""
    const relayTag = (event.tags || []).find((tag: string[]) => tag[0] === "relays")?.[1] || ""

    return fromLoadedStars || fromTracker || fromPubkey || relayTag || ""
  }

  const getCommunityRepoStargazerPubkeys = (model: RepoListCardModel) => {
    if (activeMode !== "community" || activeTab !== "bookmarks" || !$communityStarReactionEvents) {
      return []
    }

    const candidateAddresses = new Set([model.address])
    const latestByPubkey = new Map<string, {pubkey: string; createdAt: number}>()

    for (const reaction of $communityStarReactionEvents as TrustedEvent[]) {
      const star = parseRepoStarReaction(reaction)
      if (!star || !reaction.pubkey) continue
      if (
        !isAnyBookmarked([repoStarToBookmarkAddress(star)], candidateAddresses, {
          candidateRepoKeys: model.canonicalKeys,
          getCachedEvent: address =>
            repository.getEvent(address) as RepoAnnouncementEvent | undefined,
        })
      ) {
        continue
      }

      const current = latestByPubkey.get(reaction.pubkey)
      if (!current || reaction.created_at > current.createdAt) {
        latestByPubkey.set(reaction.pubkey, {
          pubkey: reaction.pubkey,
          createdAt: reaction.created_at,
        })
      }
    }

    return Array.from(latestByPubkey.values())
      .sort((a, b) => b.createdAt - a.createdAt || a.pubkey.localeCompare(b.pubkey))
      .map(item => item.pubkey)
  }

  const defaultRepoRelays = $state<string[]>([])

  const getUserOutboxRelays = (): string[] => {
    try {
      return Router.get().FromUser().getUrls() || []
    } catch {
      return []
    }
  }

  const resolveRepoEventPublishRelays = (
    event: any,
    fallbackRelays: string[] = defaultRepoRelays,
  ) => {
    const policy = resolveRepoRelayPolicy({
      event,
      fallbackRepoRelays: fallbackRelays,
    })

    if (policy.isGrasp && policy.repoRelays.length === 0) {
      throw new Error("GRASP repository event is missing explicit relay targets")
    }

    if (event?.kind === GIT_REPO_ANNOUNCEMENT) {
      return getRepoAnnouncementPublishRelays({
        repoEvent: event,
        repoRelays: policy.repoRelays,
        userOutboxRelays: getUserOutboxRelays(),
        gitIndexerRelays: GIT_RELAYS,
      })
    }

    return policy.repoRelays
  }

  const deleteExactRepoEvent = async (event: NostrEvent, relayUrls: string[]) => {
    const repoAddress = getRepoPublicationAddress(event)
    const targetRelays =
      event.kind === GIT_REPO_ANNOUNCEMENT ? getDeclaredRepoRelays(event) : relayUrls
    const relays = Array.from(new Set(targetRelays.map(relay => normalizeRelayUrl(relay))))
    if (relays.length === 0) throw new Error("Exact event deletion requires relay destinations")
    const result = await publishRepoEventWithRelayOutcomes(
      makeExactEventDelete({event: event as any}) as any,
      relays,
      {repoAddress},
    )
    if (result.successCount !== relays.length) {
      throw new Error(`Exact event deletion failed on: ${result.failedRelays.join(", ")}`)
    }
  }

  let recoveredPendingCreationsFor = ""
  $effect(() => {
    const ownerPubkey = $pubkey || ""
    if (!ownerPubkey || recoveredPendingCreationsFor === ownerPubkey) return
    recoveredPendingCreationsFor = ownerPubkey

    void (async () => {
      let recoveredCount = 0
      let pendingRecords: ReturnType<typeof getPendingRepoCreationTransactions>
      try {
        pendingRecords = getPendingRepoCreationTransactions().filter(
          pending => pending.ownerPubkey === ownerPubkey,
        )
      } catch (error) {
        console.warn("[repo-creation] Failed to read recovery journals:", error)
        return
      }
      if (pendingRecords.length === 0) return

      let recoveryWorkerApi: any
      try {
        recoveryWorkerApi = (await getInitializedGitWorker()).api
      } catch (error) {
        console.warn("[repo-creation] Git worker is unavailable for recovery:", error)
        return
      }

      for (const record of pendingRecords) {
        try {
          const recovery = await recoverRepoCreationRecord(record, {
            workerApi: recoveryWorkerApi,
            publisher: (event, context) =>
              publishRepoEventWithRelayOutcomes(event, context?.relays || []),
            fetchRelayEvents,
            onDeleteEvent: deleteExactRepoEvent,
          })
          if (recovery.status === "recovered") recoveredCount += 1
        } catch (error) {
          console.warn(`[repo-creation] Recovery remains pending for ${record.repoName}:`, error)
        }
      }

      if (recoveredCount > 0) {
        loadRepoAnnouncements(repoAnnouncementRelays)
        pushToast({message: `Recovered ${recoveredCount} pending repository operation(s).`})
      }
    })()
  })

  const buildRepoNaddrFromAnnouncement = (
    event: any,
    fallbackPubkey: string,
    fallbackRelays: string[] = [],
  ): string => {
    const naddr = makeRepoNaddrFromEvent(event, {
      fallbackPubkey,
      fallbackRelays: [...getTaggedRelaysFromRepoEvent(event), ...(fallbackRelays || [])],
    })

    if (!naddr) {
      throw new Error("Repository announcement is missing required naddr fields")
    }

    return naddr
  }

  const getRepoBrowseHref = (event: RepoAnnouncementEvent) =>
    makeGitPath(url, buildRepoNaddrFromAnnouncement(event, event.pubkey || ""))

  const getRepoCardNavigationKey = (announcement: RepoAnnouncementEvent) =>
    announcement.id || getRepoBrowseHref(announcement)

  const navigateToRepoCard = (announcement: RepoAnnouncementEvent) => {
    const navigationKey = getRepoCardNavigationKey(announcement)
    if (navigatingRepoCardKey === navigationKey) return

    navigatingRepoCardKey = navigationKey
    void (async () => {
      try {
        await goto(getRepoBrowseHref(announcement))
      } catch (error) {
        if (navigatingRepoCardKey === navigationKey) navigatingRepoCardKey = ""
        console.error("[+page.svelte] Failed to navigate to repository:", error)
        pushToast({
          message: `Failed to navigate to repository: ${String(error)}`,
          theme: "error",
        })
      }
    })()
  }

  const handleRepoCardNeutralClick = (event: MouseEvent, announcement: RepoAnnouncementEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    if (navigatingRepoCardKey) return
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return

    navigateToRepoCard(announcement)
  }

  const handleRepoCardNeutralKeydown = (
    event: KeyboardEvent,
    announcement: RepoAnnouncementEvent,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return
    if (navigatingRepoCardKey) return
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return

    event.preventDefault()
    navigateToRepoCard(announcement)
  }

  const hydrateRepoEvents = (
    result: Pick<ImportResult | NewRepoResult, "announcementEvent" | "stateEvent">,
  ) => {
    for (const event of [result.announcementEvent, result.stateEvent]) {
      const publishedEvent = event as TrustedEvent | undefined
      if (publishedEvent?.id && !repository.getEvent(publishedEvent.id)) {
        repository.publish(publishedEvent)
      }
    }
  }

  const withCurrentModalHash = (destination: string) => {
    if (typeof window === "undefined" || !window.location.hash) return destination
    return `${destination}${window.location.hash}`
  }

  const navigateToCreatedRepo = async (
    result: Pick<ImportResult | NewRepoResult, "announcementEvent" | "stateEvent">,
    failureContext: string,
  ): Promise<void> => {
    try {
      const naddr = buildRepoNaddrFromAnnouncement(result.announcementEvent as any, $pubkey || "")
      const destination = makeGitPath(url, naddr)

      hydrateRepoEvents(result)
      await goto(withCurrentModalHash(destination))
      clearModals()
    } catch (error) {
      console.error(`[+page.svelte] Failed to navigate to ${failureContext}:`, error)
      pushToast({
        message: `Failed to navigate to repository: ${String(error)}`,
        theme: "error",
      })
      throw error
    }
  }

  const fetchRelayEvents = async (params: {
    relays: string[]
    filters: NostrFilter[]
    timeoutMs?: number
    throwOnTimeout?: boolean
  }): Promise<NostrEvent[]> =>
    fetchRelayEventsWithTimeout<NostrEvent>({
      relays: params.relays,
      filters: params.filters as any,
      timeoutMs: params.timeoutMs,
      throwOnTimeout: params.throwOnTimeout,
      isolated: true,
    })

  const activeRepoPublishTransports = new Set<RepoPublishTransport>()

  const createTrackedRepoPublishTransport = () => {
    const transport = createRepoPublishTransport()
    const trackedTransport: RepoPublishTransport = {
      publish: transport.publish,
      dispose: () => {
        transport.dispose()
        activeRepoPublishTransports.delete(trackedTransport)
      },
    }
    activeRepoPublishTransports.add(trackedTransport)
    return trackedTransport
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

      await loadBudabitProfile(pubkey, {
        communityRelays: activeMode === "community" ? selectedCommunityProfileRelays : [],
      })
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

  const searchProfilesForWizard = async (
    query: string,
    {communityAddress}: ProfileSearchContext = {},
  ) => {
    try {
      if (!$pubkey) return []
      const communityOption = repoPublishCommunityOptions.find(
        option => option.address === communityAddress,
      )

      const pubkeys = getStore(peopleDiscoverySearch).searchValues(query, {
        context: {
          scope: "repo",
          authority: {source: "draft", ownerPubkey: $pubkey},
          ...(communityOption
            ? {
                community: {
                  scope: "community" as const,
                  communityAddress: communityOption.address,
                  communityPubkey: communityOption.ownerPubkey,
                },
              }
            : {}),
        },
        allowEmptyQuery: true,
        scanLimit: query.trim() ? undefined : 320,
        resultLimit: 10,
      })
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

    if (!$session || !$pubkey) {
      pushModal(LogIn)
      return
    }

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

    let publishTransport: RepoPublishTransport | undefined
    try {
      publishTransport = createTrackedRepoPublishTransport()
      const operationPublishTransport = publishTransport
      const modalId = pushModal(
        NewRepoWizard,
        {
          workerApi, // Pass initialized worker API
          workerInstance, // Pass worker instance for event signing
          subscribeGitProgress: subscribeGitWorkerProgress,
          onRepoCreated: (result: NewRepoResult) => {
            operationPublishTransport.dispose()
            setTimeout(() => hydrateRepoEvents(result), 0)
          },
          onNavigateToRepo: (result: NewRepoResult) => navigateToCreatedRepo(result, "new repo"),
          onCancel: () => {
            operationPublishTransport.dispose()
            back()
          },
          onDispose: () => operationPublishTransport.dispose(),
          defaultRelays: [...defaultRepoRelays],
          platformRelays: [...GIT_RELAYS],
          platformUrl: $APP_URL,
          makeRepoPath: makeGitPath,
          userPubkey: $pubkey,
          communityOptions: repoPublishCommunityOptions,
          onPublishEvent: async (repoEvent: NostrEvent, context?: {relays: string[]}) => {
            const explicitRelays = context?.relays || []
            const targetRelays =
              (repoEvent.kind === GIT_REPO_STATE && context?.relays !== undefined) ||
              explicitRelays.length > 0
                ? explicitRelays
                : resolveRepoEventPublishRelays(repoEvent, defaultRepoRelays)
            return operationPublishTransport.publish(repoEvent, targetRelays)
          },
          onDeleteEvent: async (event: NostrEvent, relays: string[]) => {
            await deleteExactRepoEvent(event, relays)
          },
          onFetchRelayEvents: fetchRelayEvents,
          getProfile: getProfileForWizard,
          searchProfiles: searchProfilesForWizard,
          searchProfilesUpdateSignal: peopleDiscoverySearch,
          searchRelays: searchRelaysForWizard,
        },
        {fullscreen: true, noEscape: true},
      )
      if (!modalId) operationPublishTransport.dispose()
      console.log("[+page.svelte] NewRepoWizard modal pushed with ID:", modalId)
    } catch (error) {
      publishTransport?.dispose()
      console.error("[+page.svelte] Failed to push NewRepoWizard modal:", error)
      pushToast({message: `Failed to open New Repo wizard: ${String(error)}`, theme: "error"})
    }
  }

  const onImportRepo = async () => {
    if (!IMPORT_REPO_ENABLED) return

    console.log("[+page.svelte] onImportRepo called")

    if (!$session || !$pubkey) {
      pushModal(LogIn)
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

    let publishTransport: RepoPublishTransport | undefined
    try {
      const rollbackPublishedRepoEvents = async (params: {
        repoName: string
        relays: string[]
        events?: NostrEvent[]
      }): Promise<void> => {
        if (!$pubkey) return

        const rollbackRelays = Array.from(
          new Set(params.relays.map(r => normalizeRelayUrl(r)).filter(Boolean)),
        )

        if (rollbackRelays.length === 0) return

        if (params.events) {
          const exactEvents = new Map(
            params.events.filter(event => event?.id).map(event => [event.id, event]),
          )
          for (const event of exactEvents.values()) {
            if (event.pubkey !== $pubkey) continue
            await deleteExactRepoEvent(event, rollbackRelays)
          }
          return
        }

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

          await deleteExactRepoEvent(event, rollbackRelays)
        }
      }

      publishTransport = createTrackedRepoPublishTransport()
      const operationPublishTransport = publishTransport
      const modalId = pushModal(
        ImportRepoDialog,
        {
          pubkey: $pubkey!,
          workerApi,
          subscribeGitProgress: subscribeGitWorkerProgress,
          onSignEvent: onSignEvent, // Primary signing method (works with all signers)
          onFetchEvents: async (filters: NostrFilter[]) => {
            const events: NostrEvent[] = []
            await load({
              relays: Router.get().FromUser().getUrls(),
              filters: filters as any,
              onEvent: e => events.push(e as NostrEvent),
            })
            return events
          },
          onFetchRelayEvents: fetchRelayEvents,
          onClose: () => {
            operationPublishTransport.dispose()
            clearModals()
          },
          onDispose: () => operationPublishTransport.dispose(),
          onPublishEvent: async (repoEvent: NostrEvent, context?: {relays: string[]}) => {
            const explicitRelays = context?.relays || []
            const targetRelays =
              (repoEvent.kind === GIT_REPO_STATE && context?.relays !== undefined) ||
              explicitRelays.length > 0
                ? explicitRelays
                : resolveRepoEventPublishRelays(repoEvent, defaultRepoRelays)
            return operationPublishTransport.publish(repoEvent, targetRelays)
          },
          onDeleteEvent: async (event: NostrEvent, relays: string[]) => {
            await deleteExactRepoEvent(event, relays)
          },
          onRollbackPublishedRepoEvents: rollbackPublishedRepoEvents,
          onImportComplete: (result: ImportResult) => {
            operationPublishTransport.dispose()
            hydrateRepoEvents(result)
            // Reload repos by forcing bookmarks refresh and announcements
            loadRepoAnnouncements(repoAnnouncementRelays)
            pushToast({
              message: `Successfully imported repository! Imported ${result.issuesImported} issues, ${result.commentsImported} comments, ${result.prsImported} PRs, and created ${result.profilesCreated} profiles.`,
            })
          },
          onNavigateToRepo: (result: ImportResult) =>
            navigateToCreatedRepo(result, "imported repo"),
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
          communityOptions: repoPublishCommunityOptions,
          defaultCommunityPubkey:
            activeMode === "community" &&
            repoPublishCommunityOptions.some(
              option => option.address === $activeExactCommunityPointer?.address,
            )
              ? $activeExactCommunityPointer?.address
              : "",
        },
        {fullscreen: true, noEscape: true},
      )
      if (!modalId) operationPublishTransport.dispose()
      console.log("[+page.svelte] ImportRepoDialog modal pushed with ID:", modalId)
    } catch (error) {
      publishTransport?.dispose()
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

<PageBar class={gitPageWidthClass}>
  {#snippet icon()}
    <div class="center">
      <Icon icon={Git} />
    </div>
  {/snippet}
  {#snippet title()}
    <div class="flex min-w-0 flex-col leading-tight">
      <strong>Git Repositories</strong>
      {#if activeMode === "community" && selectedCommunityLabel}
        <span class="truncate text-xs font-normal text-muted-foreground">
          Viewing {selectedCommunityLabel}
        </span>
      {:else if activeMode === "personal"}
        <span class="truncate text-xs font-normal text-muted-foreground">Personal Git</span>
      {/if}
    </div>
  {/snippet}
  {#snippet action()}
    <PerformanceDiagnosticsStatus route={$page.url.pathname} />
    <div class="hidden items-center gap-2 sm:flex">
      <Button class="btn btn-primary btn-sm" onclick={() => onNewRepo()}>
        <Icon icon={AddCircle} />
        New Repo
      </Button>
      {#if IMPORT_REPO_ENABLED}
        <Button
          class="btn btn-secondary btn-sm !text-primary-content"
          onclick={() => onImportRepo()}>
          <Icon icon={Download} />
          Import Repo
        </Button>
      {/if}
    </div>
    <GitCommunityMenuButton />
  {/snippet}
</PageBar>

<PageContent
  class={`${gitPageWidthClass} mt-4 flex flex-grow flex-col gap-4 overflow-auto p-2`}
  data-perf="git-root"
  data-perf-mode={activeMode}
  data-perf-tab={activeTab}
  data-perf-loading={repoListLoading || repoSearchUpdating ? "true" : "false"}
  data-perf-cards={repoCardModelsForEnrichment.length}>
  <div class="flex flex-col gap-2 sm:hidden">
    <Button class="btn btn-primary btn-sm w-full" onclick={() => onNewRepo()}>
      <Icon icon={AddCircle} />
      New Repo
    </Button>
    {#if IMPORT_REPO_ENABLED}
      <Button
        class="btn btn-secondary btn-sm w-full !text-primary-content"
        onclick={() => onImportRepo()}>
        <Icon icon={Download} />
        Import Repo
      </Button>
    {/if}
  </div>
  <!-- Tabs and Search Bar -->
  <div class="flex flex-col gap-3">
    <div
      class="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="grid grid-cols-2 gap-2 sm:flex">
        <button
          type="button"
          class={`btn btn-sm ${activeMode === "community" ? "btn-primary" : "btn-ghost"}`}
          onclick={() => (activeMode = "community")}>
          Community Curated
        </button>
        <button
          type="button"
          class={`btn btn-sm ${activeMode === "personal" ? "btn-primary" : "btn-ghost"}`}
          onclick={() => (activeMode = "personal")}>
          Personal
        </button>
      </div>
      {#if activeMode === "community"}
        <label class="flex min-w-0 flex-col gap-1 text-sm sm:min-w-80">
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >Community</span>
          <select
            value={selectedCommunityAddress}
            onchange={event => selectGitCommunity((event.currentTarget as HTMLSelectElement).value)}
            class="select select-bordered select-sm w-full">
            {#if repoViewCommunityOptions.length === 0}
              <option value="">No communities</option>
            {:else}
              <option value="" disabled>Select a community</option>
              {#each repoViewCommunityOptions as option (option.address)}
                <option value={option.address}
                  >{option.name || option.label || option.communityId}</option>
              {/each}
            {/if}
          </select>
        </label>
      {/if}
    </div>
    <Tabs bind:value={activeTab} class="w-full">
      <div class="flex flex-col gap-3">
        <div
          class="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 xl:flex-row xl:items-center xl:justify-between">
          <TabsList
            class="grid !h-auto w-full grid-cols-3 gap-2 !bg-transparent !p-0 sm:flex sm:w-fit sm:max-w-full sm:self-start">
            <TabsTrigger
              value="my-repos"
              class="btn btn-sm min-w-0 justify-center whitespace-nowrap !rounded-lg !border-0 !px-2 text-xs font-bold leading-tight {activeTab ===
              'my-repos'
                ? 'btn-primary !bg-primary !text-primary-content'
                : 'btn-ghost !bg-transparent !text-base-content'} sm:flex-none sm:!px-3 sm:text-sm">
              <span class="flex min-w-0 items-center gap-1 sm:gap-2">
                <Folder class="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2} />
                <span class="min-w-0 truncate">Repos</span>
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="bookmarks"
              class="btn btn-sm min-w-0 justify-center whitespace-nowrap !rounded-lg !border-0 !px-2 text-xs font-bold leading-tight {activeTab ===
              'bookmarks'
                ? 'btn-primary !bg-primary !text-primary-content'
                : 'btn-ghost !bg-transparent !text-base-content'} sm:flex-none sm:!px-3 sm:text-sm">
              <span class="flex min-w-0 items-center gap-1 sm:gap-2">
                <Star class="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2} />
                <span class="min-w-0 truncate">Starred</span>
                {#if hasStarredRepoNotifications}
                  <span
                    class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary sm:h-2 sm:w-2"
                    aria-label="Unread updates"></span>
                {/if}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="snippets"
              class="btn btn-sm min-w-0 justify-center whitespace-nowrap !rounded-lg !border-0 !px-2 text-xs font-bold leading-tight {activeTab ===
              'snippets'
                ? 'btn-primary !bg-primary !text-primary-content'
                : 'btn-ghost !bg-transparent !text-base-content'} sm:flex-none sm:!px-3 sm:text-sm">
              <span class="flex min-w-0 items-center gap-1 sm:gap-2">
                <CodeXml class="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2} />
                <span class="min-w-0 truncate">Snippets</span>
              </span>
            </TabsTrigger>
          </TabsList>
          <div class="flex w-full items-center gap-2 xl:w-[30rem] xl:max-w-[45vw] xl:shrink-0">
            <label
              class="input input-bordered flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <Icon icon={Magnifier} />
              <input
                bind:value={searchQuery}
                class="min-w-0 grow"
                type="text"
                placeholder={activeTab === "snippets"
                  ? "Search snippets..."
                  : "Repo, owner, npub, or naddr"} />
              {#if searchQuery}
                <button
                  type="button"
                  class="btn btn-circle btn-ghost btn-xs h-7 min-h-7 w-7 shrink-0"
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
                  class="btn btn-outline btn-error btn-sm shrink-0 gap-1"
                  aria-label="Stop repository discovery"
                  title="Stop repository discovery"
                  onclick={stopRepoDiscovery}>
                  <X class="h-4 w-4" />
                  <span>Stop</span>
                </button>
              {:else if canContinueRepoDiscovery}
                <button
                  type="button"
                  class="btn btn-outline btn-primary btn-sm shrink-0"
                  aria-label="Continue searching"
                  title="Continue searching"
                  onclick={continueRepoDiscovery}>
                  <span>Continue searching</span>
                </button>
              {/if}
              <button
                type="button"
                class="btn btn-square btn-ghost btn-sm shrink-0"
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
    <div class="flex min-w-0 flex-col gap-3" in:fade={{duration: 150}}>
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-muted-foreground">
          {activeMode === "community" ? "Community Snippets" : "Your Snippets"}
        </h3>
        {#if $pubkey}
          <span class="text-xs text-muted-foreground">{filteredSnippets.length}</span>
        {/if}
      </div>
      {#if activeMode === "community" && !selectedCommunityPubkey}
        <div
          class="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {#if communityOptionsLoading}
            <Spinner loading>Looking for your communities...</Spinner>
          {:else}
            <strong class="block text-base text-foreground">
              {repoViewCommunityOptions.length === 0 ? "No communities yet" : "Choose a community"}
            </strong>
            <p class="mx-auto mt-2 max-w-md">
              {repoViewCommunityOptions.length === 0
                ? "Join or create a community to view curated snippets."
                : "Select a community above to view its curated snippets."}
            </p>
            {#if repoViewCommunityOptions.length === 0}
              <div class="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
                <Button class="btn btn-primary btn-sm" onclick={openExploreCommunities}>
                  Explore communities
                </Button>
                <Button class="btn btn-outline btn-sm" onclick={openCreateCommunity}>
                  Create community
                </Button>
              </div>
            {/if}
          {/if}
        </div>
      {:else if !$pubkey && activeMode === "personal"}
        <p class="text-sm text-muted-foreground">Sign in to view your snippets.</p>
      {:else if filteredSnippets.length === 0}
        <p class="text-sm text-muted-foreground">
          {activeMode === "community"
            ? "No curated snippets found for this community."
            : "No snippets yet. Create a permalink from a code file or diff."}
        </p>
      {:else}
        <div class="flex min-w-0 flex-col gap-3">
          {#each filteredSnippets as snippet (snippet.id)}
            <EventRenderer event={snippet as any} relays={getSnippetShareRelays(snippet)} />
          {/each}
        </div>
      {/if}
    </div>
  {:else if isAccountSearch}
    <div class="flex min-w-0 flex-col gap-2" in:fade={{duration: 200}}>
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
        <p class="text-sm text-muted-foreground">Found repository. Showing this repository only.</p>
      {:else if accountSearch.mode === "npub"}
        <p class="text-sm text-muted-foreground">Repositories published by this account.</p>
      {/if}

      {#if sortedAccountSearchRepoCards.length > 0}
        <div class="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {#each sortedAccountSearchRepoCardModels as model (model.stableKey)}
            {@const g = model.card}
            {@const cardProfileRelays = getRepoCardProfileRelays(model)}
            {@const repoCardMaintainers = model.maintainers}
            {@const repoCardVerifiedMaintainers = getRepoCardVerifiedMaintainers(model)}
            {@const repoCardNavigationKey = g.first
              ? getRepoCardNavigationKey(g.first as RepoAnnouncementEvent)
              : ""}
            {@const repoCardNavigating = Boolean(
              repoCardNavigationKey && navigatingRepoCardKey === repoCardNavigationKey,
            )}
            <div
              class="relative flex min-w-0 flex-col rounded-md border border-border bg-card p-2 text-sm transition {repoCardNavigating
                ? 'cursor-wait opacity-70 ring-2 ring-primary/40'
                : 'cursor-pointer'}"
              role="link"
              tabindex="0"
              aria-busy={repoCardNavigating}
              onclick={g.first
                ? event => handleRepoCardNeutralClick(event, g.first as RepoAnnouncementEvent)
                : undefined}
              onkeydown={g.first
                ? event => handleRepoCardNeutralKeydown(event, g.first as RepoAnnouncementEvent)
                : undefined}>
              {#if repoCardNavigating}
                <span
                  class="z-10 pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-sm backdrop-blur-sm">
                  Opening...
                </span>
              {/if}
              {#if g.first}
                <GitItem
                  {url}
                  event={g.first as any}
                  profileRelays={cardProfileRelays}
                  tabbable={false}
                  showCollectionButton={shouldShowRepoCardBookmark(
                    g.first as RepoAnnouncementEvent,
                  )}
                  showActions={false}
                  collectionState={repoCollectionState}
                  loadProfiles={false}
                  compact={true} />
              {/if}
              {#if repoCardMaintainers.length > 0}
                <div class="mt-auto flex min-w-0 items-center justify-between gap-2 pt-2">
                  <div class="min-w-0 flex-1">
                    <RepoMaintainerList
                      maintainers={repoCardMaintainers}
                      relays={cardProfileRelays}
                      verifiedMaintainers={repoCardVerifiedMaintainers}
                      loadProfiles={false}
                      repoName={g.title || ""}
                      label="Co-maintainers" />
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#if hasMoreAccountSearchRepos}
          <div class="mt-4 flex flex-col items-center gap-2">
            <button type="button" class="btn btn-outline btn-sm" onclick={loadMoreRepoResults}>
              Show more repositories
            </button>
            <p class="text-xs text-muted-foreground">
              Showing {sortedAccountSearchRepoCardModels.length} repositories
            </p>
          </div>
        {/if}
      {/if}
    </div>
  {:else}
    <!-- Tab-filtered Repos Grid -->
    <div class="min-w-0">
      {#if repoDiscoveryStatusLabel}
        <div class="mb-3 rounded-md border border-border bg-card/70 p-3">
          <div class="flex items-center gap-2 text-sm font-medium text-foreground">
            {#if repoDiscoveryStatusSpinning}
              <Spinner loading={repoDiscoveryStatusSpinning}>{repoDiscoveryStatusLabel}</Spinner>
            {:else}
              <span>{repoDiscoveryStatusLabel}</span>
            {/if}
          </div>
        </div>
      {/if}
      {#if activeMode === "community" && !selectedCommunityPubkey}
        <div
          class="mx-auto max-w-xl rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {#if communityOptionsLoading}
            <Spinner loading>Looking for your communities...</Spinner>
          {:else}
            <strong class="block text-base text-foreground">
              {repoViewCommunityOptions.length === 0 ? "No communities yet" : "Choose a community"}
            </strong>
            <p class="mx-auto mt-2 max-w-md">
              {repoViewCommunityOptions.length === 0
                ? "Join or create a community to view curated repositories."
                : "Select a community above to view its curated repositories."}
            </p>
            {#if repoViewCommunityOptions.length === 0}
              <div class="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
                <Button class="btn btn-primary btn-sm" onclick={openExploreCommunities}>
                  Explore communities
                </Button>
                <Button class="btn btn-outline btn-sm" onclick={openCreateCommunity}>
                  Create community
                </Button>
              </div>
            {/if}
          {/if}
        </div>
      {:else if repoListLoading}
        <p class="flex h-10 items-center justify-center py-20">
          <Spinner loading={repoListLoading}>
            {activeMode === "community"
              ? "Looking for community Git repos..."
              : "Looking for Your Git Repos..."}
          </Spinner>
        </p>
      {:else if canShowRepoEmpty}
        <p class="mx-auto max-w-full break-words px-4 py-20 text-center text-muted-foreground">
          {#if searchQuery.trim()}
            No repositories found matching
            <span class="inline max-w-full break-all">"{searchQuery}"</span>.
          {:else if !$pubkey && activeMode === "personal"}
            Sign in to view your repositories.
          {:else if activeMode === "community" && !selectedCommunityPubkey}
            Select a community to view curated repositories.
          {:else if activeTab === "my-repos"}
            {activeMode === "community"
              ? "No repositories are bound to this community yet."
              : "You haven't created any repositories yet."}
          {:else}
            {activeMode === "community"
              ? "No community-curated starred repositories found."
              : "No starred repositories found."}
          {/if}
        </p>
      {:else if hasRenderedRepoCardsForCurrentScope}
        <div
          data-testid="repo-card-grid"
          class="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
          aria-busy={repoSearchUpdating}>
          {#each sortedRepoCardModels as model (model.stableKey)}
            {@const g = model.card}
            {@const cardProfileRelays = getRepoCardProfileRelays(model)}
            {@const communityStargazers = getCommunityRepoStargazerPubkeys(model)}
            {@const repoCardMaintainers = model.maintainers}
            {@const repoCardVerifiedMaintainers = getRepoCardVerifiedMaintainers(model)}
            {@const repoCardNavigationKey = g.first
              ? getRepoCardNavigationKey(g.first as RepoAnnouncementEvent)
              : ""}
            {@const repoCardNavigating = Boolean(
              repoCardNavigationKey && navigatingRepoCardKey === repoCardNavigationKey,
            )}
            <div
              data-testid="repo-card"
              data-repo-key={model.stableKey}
              class="relative flex min-w-0 flex-col rounded-md border border-border bg-card p-2 text-sm transition {repoCardNavigating
                ? 'cursor-wait opacity-70 ring-2 ring-primary/40'
                : 'cursor-pointer'}"
              role="link"
              tabindex="0"
              aria-busy={repoCardNavigating}
              onclick={g.first
                ? event => handleRepoCardNeutralClick(event, g.first as RepoAnnouncementEvent)
                : undefined}
              onkeydown={g.first
                ? event => handleRepoCardNeutralKeydown(event, g.first as RepoAnnouncementEvent)
                : undefined}>
              {#if repoCardNavigating}
                <span
                  class="z-10 pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-sm backdrop-blur-sm">
                  Opening...
                </span>
              {/if}
              <!-- Use GitItem for consistent repo card rendering -->
              {#if g.first}
                <GitItem
                  {url}
                  event={g.first as any}
                  profileRelays={cardProfileRelays}
                  tabbable={false}
                  showCollectionButton={shouldShowRepoCardBookmark(
                    g.first as RepoAnnouncementEvent,
                  )}
                  showActions={false}
                  collectionState={repoCollectionState}
                  loadProfiles={false}
                  compact={true} />
              {/if}

              <!-- Maintainers and community stargazers -->
              {#if repoCardMaintainers.length > 0 || communityStargazers.length > 0}
                <div
                  class="mt-auto flex min-w-0 flex-col gap-1.5 pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                    <RepoMaintainerList
                      maintainers={repoCardMaintainers}
                      relays={cardProfileRelays}
                      verifiedMaintainers={repoCardVerifiedMaintainers}
                      loadProfiles={false}
                      repoName={g.title || ""}
                      label="Co-maintainers" />
                    {#if communityStargazers.length > 0}
                      <div class="flex min-w-0 items-center gap-2">
                        <div class="flex shrink-0 -space-x-2">
                          {#each communityStargazers.slice(0, 5) as pk (pk)}
                            <Button
                              class="rounded-full border border-background p-0"
                              aria-label="View community stargazer profile"
                              title="View community stargazer profile"
                              onclick={stopPropagation(
                                preventDefault(() => openRepoCardProfile(pk, cardProfileRelays)),
                              )}>
                              <ProfileCircle
                                pubkey={pk}
                                relays={cardProfileRelays}
                                loadProfile={false}
                                size={6} />
                            </Button>
                          {/each}
                        </div>
                        <span class="min-w-0 truncate text-[11px] opacity-60">
                          {#if communityStargazers.length > 5}
                            + {communityStargazers.length - 5} others
                          {:else}
                            {communityStargazers.length} community star{communityStargazers.length !==
                            1
                              ? "s"
                              : ""}
                          {/if}
                        </span>
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#if hasRenderedRepoCardsForCurrentContext && hasMoreRepoResults}
          <div class="mt-4 flex flex-col items-center gap-2">
            <button type="button" class="btn btn-outline btn-sm" onclick={loadMoreRepoResults}>
              Show more repositories
            </button>
            <p class="text-xs text-muted-foreground">
              {#if searchFilteredRepos.length > visibleSearchFilteredRepos.length}
                Showing {visibleSearchFilteredRepos.length} of {searchFilteredRepos.length}
              {:else}
                Showing {visibleSearchFilteredRepos.length} repositories
              {/if}
            </p>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</PageContent>
