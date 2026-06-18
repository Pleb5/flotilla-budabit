<script lang="ts">
  import {
    normalizeRelayUrl,
    Address,
    getTagValue,
    DELETE,
    REACTION,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {
    repository,
    publishThunk,
    profilesByPubkey,
    tracker,
    profileSearch,
    getFollows,
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
  import {publishDelete} from "@app/core/commands"
  import {goto} from "$app/navigation"
  import {onMount, onDestroy, tick, untrack} from "svelte"
  import {derived as _derived, get as getStore} from "svelte/store"
  import {nip19, type NostrEvent} from "nostr-tools"
  import {ListFilter, X} from "@lucide/svelte"
  import {
    GIT_PULL_REQUEST,
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_STATE,
    GIT_STATUS_APPLIED,
    parseRepoCommunityBinding,
    parseRepoAnnouncementEvent,
    type PullRequestEvent,
    type BookmarkAddress,
    type RepoAnnouncementEvent,
    type StatusEvent,
  } from "@nostr-git/core/events"
  import {getTaggedRelaysFromRepoEvent, resolveRepoRelayPolicy} from "@nostr-git/core/utils"
  import {GIT_PERMALINK} from "@nostr-git/core/types"
  import {
    repositoriesStore,
    Tabs,
    TabsList,
    TabsTrigger,
    EventRenderer,
    toast,
    NewRepoWizard,
    ImportRepoDialog,
  } from "@nostr-git/ui"
  import type {ImportResult, NewRepoResult, RepoCommunityOption} from "@nostr-git/ui"
  import type {NostrFilter} from "@nostr-git/core"
  import {
    loadRepoAnnouncements,
    GIT_RELAYS,
    getRepoDeclaredMaintainers,
    getVerifiedRepoMaintainers,
    groupStatusEventsByRoot,
    getRepoAnnouncementPublishRelays,
    repoAnnouncementRelaysStore,
    repoAnnouncements,
  } from "@app/core/git-state"
  import {getInitializedGitWorker, terminateGitWorker} from "@app/core/worker-singleton"
  import {
    activeCommunityDefinition,
    activeCommunitySession,
    activePreferredCommunities,
    activeUserCommunityRefs,
    communityPreferencesLoading,
    hydratePreferredCommunities,
    makeCommunityDefinitionFilter,
    makeCommunityProfileListFilters,
    makeCommunityReportDeleteFilters,
    makeCommunityReportFilters,
    selectLatestCommunityDefinition,
    setActiveCommunityInput,
  } from "@app/core/community-state"
  import {parseTargetedPublication, TARGETED_PUBLICATION_KIND} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    communityWritableSectionsSupportTarget,
    getCommunityTargetWriterPubkeys,
    type CommunityWriteTarget,
  } from "@app/core/community-permissions"
  import {getEffectiveCommunityReportState} from "@app/core/community-reports"
  import {
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilters,
  } from "@app/core/community-feeds"
  import {getPublicationTargetingId} from "@app/core/community-targeting"
  import {fetchRelayEventsWithTimeout} from "@app/util/fetch-relay-events"
  import {createNip98AuthHeader} from "@app/core/event-io"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Star from "@assets/icons/star.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import FolderWithFiles from "@assets/icons/folder-with-files.svg?dataurl"
  import Download from "@assets/icons/download.svg?dataurl"
  import Code from "@assets/icons/code.svg?dataurl"
  import {makeGitPath} from "@app/util/routes"
  import {makeRepoNaddrFromEvent} from "@app/util/repo-links"
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
    getCanonicalRepoKeyFromEvent,
    getRepoAddressFromEvent,
    isAnyBookmarked,
    matchBookmarkedRepoEvents,
  } from "@app/util/bookmarks"
  import {activeRepoStars, hydrateRepoStars, repoStarsLoading} from "@app/core/repo-stars-state"
  import {makeCommunityInputValue} from "@app/util/community-stars"
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
  import {loadBudabitProfile} from "@app/core/profile-resolver"

  const url = GIT_RELAYS[0] || ""

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

  const getRepoCardStableKey = (card: any) => {
    const event = card?.first
    const euc = card?.euc || ""
    const eventId = event?.id || ""

    if (event?.kind && event?.pubkey && Array.isArray(event?.tags)) {
      const d = getTagValue("d", event.tags)
      if (d) return `${event.kind}:${event.pubkey}:${d}:${euc}:${eventId}`

      const eucTag = event.tags.find((t: string[]) => t[0] === "r" && t[2] === "euc")?.[1] || ""
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

  const REPO_SEARCH_DEBOUNCE_MS = 300
  const REPO_SEARCH_PAGE_SIZE = 18
  const REPO_LOAD_SETTLE_DELAY_MS = 75
  const REPO_LIST_LOAD_TIMEOUT_MS = 8_000
  const REPO_CARD_HYDRATION_DELAY_MS = 250

  const repoLoadSettleTimers = new Set<ReturnType<typeof setTimeout>>()
  const repoLoadTimeoutTimers = new Set<ReturnType<typeof setTimeout>>()
  let gitPageDestroyed = false

  const afterRepoLoadSettle = (callback: () => void) => {
    const timer = setTimeout(() => {
      repoLoadSettleTimers.delete(timer)
      if (gitPageDestroyed) return
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
    let timeout: ReturnType<typeof setTimeout>

    const settle = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      repoLoadTimeoutTimers.delete(timeout)
      if (gitPageDestroyed) return
      afterRepoLoadSettle(onSettled)
    }

    timeout = setTimeout(settle, timeoutMs)
    repoLoadTimeoutTimers.add(timeout)
    void promise.finally(settle).catch(() => {})
  }

  const getInitialGitModeForContext = (): GitMode =>
    getStore(activeCommunitySession)?.communityPubkey ? getInitialGitMode() : "personal"

  let loading = $state(true)
  let activeMode = $state<GitMode>(getInitialGitModeForContext())
  let activeTab = $state<GitTab>(getInitialGitTab())
  let selectedCommunityPubkey = $state("")
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
  const waitForNavigationIntentPaint = async () => {
    await tick()
    if (typeof requestAnimationFrame !== "function") return
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  let discoveredSearchRepoPool = $state<
    Array<{address: string; event: RepoAnnouncementEvent; relayHint: string}>
  >([])
  let discoveredOwnerProfiles = $state<Record<string, RepoOwnerProfile>>({})
  let repoDiscoveryStatus = $state<RepoDiscoveryStatus>(createEmptyRepoDiscoveryStatus())
  let repoDiscoveryController: AbortController | null = null
  let repoDiscoveryDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let snippetsLoadedFor = $state<string | null>(null)

  const hasActiveCommunityContext = $derived(Boolean($activeCommunitySession?.communityPubkey))
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
    if (!$pubkey) {
      personalRepoLoadRequestId += 1
      personalRepoAnnouncementsSettled = true
      lastLoadedPersonalRepoKey = ""
      return
    }

    if (!repoAnnouncementRelays.length) {
      personalRepoLoadRequestId += 1
      personalRepoAnnouncementsSettled = true
      lastLoadedPersonalRepoKey = ""
      return
    }

    // Prevent duplicate loads with same relay set
    const relayKey = repoAnnouncementRelays.slice().sort().join(",")
    const loadKey = `${$pubkey}:${relayKey}`
    if (loadKey === lastLoadedPersonalRepoKey) return
    lastLoadedPersonalRepoKey = loadKey
    personalRepoAnnouncementsSettled = false
    const requestId = ++personalRepoLoadRequestId

    const filter = {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [$pubkey]}
    settleRepoLoad({
      promise: load({relays: repoAnnouncementRelays, filters: [filter]}).catch(error => {
        console.warn("[git/+page] Failed to load personal repos", error)
      }),
      onSettled: () => {
        if (requestId === personalRepoLoadRequestId) personalRepoAnnouncementsSettled = true
      },
    })
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

  $effect(() => {
    if (!$pubkey) return
    hydratePreferredCommunities({relayHints: bookmarkRelays}).catch(error => {
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
        pubkey: ref.communityPubkey,
        label: getCommunityOptionLabel(ref.communityPubkey),
        relays: ref.relayHints.length ? ref.relayHints : ref.definition.relays,
      })),
  )

  const repoViewCommunityOptions = $derived.by((): RepoCommunityOption[] => {
    const options = new Map<string, RepoCommunityOption>()
    const session = $activeCommunitySession

    if (session?.communityPubkey) {
      options.set(session.communityPubkey, {
        pubkey: session.communityPubkey,
        label: getCommunityOptionLabel(session.communityPubkey),
        relays: [
          ...session.communityRelayHints,
          ...($activeCommunityDefinition?.pubkey === session.communityPubkey
            ? $activeCommunityDefinition.relays
            : []),
        ],
      })
    }

    for (const community of $activePreferredCommunities) {
      const current = options.get(community.communityPubkey)
      options.set(community.communityPubkey, {
        pubkey: community.communityPubkey,
        label: getCommunityOptionLabel(community.communityPubkey),
        relays: Array.from(new Set([...(current?.relays || []), ...community.relayHints])),
      })
    }

    return Array.from(options.values())
  })

  $effect(() => {
    if (activeMode !== "community") return
    const activeCommunityPubkey = $activeCommunitySession?.communityPubkey || ""

    if (activeCommunityPubkey && selectedCommunityPubkey !== activeCommunityPubkey) {
      selectedCommunityPubkey = activeCommunityPubkey
      return
    }

    if (
      selectedCommunityPubkey &&
      !repoViewCommunityOptions.some(c => c.pubkey === selectedCommunityPubkey)
    ) {
      selectedCommunityPubkey = ""
    }
  })

  const selectedCommunityOption = $derived.by(() =>
    repoViewCommunityOptions.find(option => option.pubkey === selectedCommunityPubkey),
  )
  const selectedCommunityLabel = $derived(
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

  const selectGitCommunity = (communityPubkey: string) => {
    selectedCommunityPubkey = communityPubkey
    if (!communityPubkey) return

    const option = repoViewCommunityOptions.find(item => item.pubkey === communityPubkey)
    const communityInput = makeCommunityInputValue({
      pubkey: communityPubkey,
      relayHints: getCommunityOptionRelayHints(option),
    })

    setActiveCommunityInput(communityInput || communityPubkey)
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

  const getRepoCardProfileRelays = (event?: RepoAnnouncementEvent | null) => {
    if (!event) return []

    const community = event ? parseRepoCommunityBinding(event) : undefined
    const address = getRepoAddressFromEvent(event)
    const trackedRelays = Array.from(tracker.getRelays(event.id) || [])
    const pubkeyRelays = Router.get().getRelaysForPubkey(event.pubkey) || []
    const repoRelays = (() => {
      try {
        return parseRepoAnnouncementEvent(event)?.relays || []
      } catch {
        return []
      }
    })()

    return Array.from(
      new Set(
        [
          ...(activeMode === "community" ? selectedCommunityProfileRelays : []),
          community?.relay || "",
          getRepoCardRelayHint(event, address),
          ...trackedRelays,
          ...pubkeyRelays,
          ...repoRelays,
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

  const getRepoCardMaintainers = (event?: RepoAnnouncementEvent | null) =>
    getRepoDeclaredMaintainers(event)

  const getRepoCardAddress = (event?: RepoAnnouncementEvent | null) => {
    if (!event) return ""

    try {
      return getRepoAddressFromEvent(event)
    } catch {
      return ""
    }
  }

  const hasRepoAddressTag = (event: Pick<NostrEvent, "tags">, address: string) =>
    Boolean(address && (event.tags || []).some(tag => tag[0] === "a" && tag[1] === address))

  const REPO_CARD_EVIDENCE_FILTER_CHUNK_SIZE = 80
  const EMPTY_VERIFIED_REPO_MAINTAINERS = new Set<string>()

  const chunkBySize = <T,>(items: T[], size: number) => {
    const chunks: T[][] = []

    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size))
    }

    return chunks
  }

  const selectedCommunityRef = $derived.by(() =>
    $activeUserCommunityRefs.find(ref => ref.communityPubkey === selectedCommunityPubkey),
  )
  const selectedCommunityDefinitionFilters = $derived.by(() =>
    selectedCommunityPubkey ? [makeCommunityDefinitionFilter(selectedCommunityPubkey)] : [],
  )
  const selectedCommunityDefinitionEvents = $derived.by(() =>
    selectedCommunityDefinitionFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: selectedCommunityDefinitionFilters as any}),
        )
      : undefined,
  )
  const selectedCommunityDefinition = $derived.by(
    () =>
      selectedCommunityRef?.definition ||
      ($activeCommunityDefinition?.pubkey === selectedCommunityPubkey
        ? $activeCommunityDefinition
        : undefined) ||
      ($selectedCommunityDefinitionEvents
        ? selectLatestCommunityDefinition(
            $selectedCommunityDefinitionEvents as TrustedEvent[],
            selectedCommunityPubkey,
          )
        : undefined),
  )

  let selectedCommunityDefinitionLoadKey = ""
  $effect(() => {
    if (
      activeMode !== "community" ||
      selectedCommunityRelays.length === 0 ||
      selectedCommunityDefinitionFilters.length === 0
    ) {
      selectedCommunityDefinitionLoadKey = ""
      return
    }

    const key = `${selectedCommunityPubkey}:${selectedCommunityRelays.join(",")}:definition`
    if (key === selectedCommunityDefinitionLoadKey) return
    selectedCommunityDefinitionLoadKey = key
    load({
      relays: selectedCommunityRelays,
      filters: selectedCommunityDefinitionFilters as any,
    }).catch(error => {
      console.warn("[git/+page] Failed to load selected community definition", error)
    })
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
    selectedCommunityDefinition ? makeCommunityReportFilters(selectedCommunityDefinition) : [],
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
  const selectedCommunityPermalinkWriterPubkeys = $derived.by(() =>
    getSelectedCommunityTargetWriterPubkeys(COMMUNITY_WRITE_TARGETS.permalink),
  )

  let selectedCommunityAuthorityLoadKey = ""
  $effect(() => {
    if (activeMode !== "community" || selectedCommunityRelays.length === 0) {
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
      activeMode !== "community" ||
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
    ) as string[]

  const repoStarAddresses = $derived.by((): BookmarkAddress[] =>
    $activeRepoStars.map(repoStarToBookmarkAddress),
  )

  const hasRepoStarAddresses = $derived(repoStarAddresses.length > 0)
  const starredRepoRelaysToQuery = $derived.by(() => getStarredRepoLoadRelays(repoStarAddresses))
  const starredRepoLoadKey = $derived.by(() =>
    hasRepoStarAddresses
      ? `${buildBookmarkRepoLoadKey(repoStarAddresses)}:${starredRepoRelaysToQuery.slice().sort().join(",")}`
      : "",
  )

  let repoStarsHydrationRequestId = 0
  let repoStarsHydrationSettled = $state(false)

  $effect(() => {
    if (!$pubkey) {
      repoStarsHydrationRequestId += 1
      repoStarsHydrationSettled = true
      return
    }

    const requestId = ++repoStarsHydrationRequestId
    repoStarsHydrationSettled = false
    hydrateRepoStars({relayHints: bookmarkRelays})
      .catch(error => {
        console.warn("[git/+page] Failed to hydrate repo stars", error)
      })
      .finally(() => {
        afterRepoLoadSettle(() => {
          if (requestId === repoStarsHydrationRequestId) repoStarsHydrationSettled = true
        })
      })
  })

  // Fetch actual repo events for starred addresses
  const attemptedStarredRepoLoads = new Set<string>()
  let settledStarredRepoLoadKey = $state("")

  const repos = $derived.by(() => {
    if (!hasRepoStarAddresses) return undefined

    const addresses = repoStarAddresses
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
              : loadRepoAnnouncements()
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

    const addresses = repoStarAddresses
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
      loadedStarredRepos.length < repoStarAddresses.length &&
      settledStarredRepoLoadKey !== starredRepoLoadKey,
  )

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

  const communityRepoFilters = $derived.by(() =>
    selectedCommunityPubkey
      ? ([
          {
            kinds: [GIT_REPO_ANNOUNCEMENT],
            "#h": [selectedCommunityPubkey],
          },
        ] as Filter[])
      : [],
  )

  const communityRepoEvents = $derived.by(() =>
    communityRepoFilters.length
      ? deriveEventsDesc(deriveEventsById({repository, filters: communityRepoFilters as any}))
      : undefined,
  )

  let communityRepoLoadKey = ""
  let communityRepoLoadRequestId = 0
  let communityRepoAnnouncementsSettled = $state(false)
  $effect(() => {
    if (
      activeMode !== "community" ||
      !selectedCommunityPubkey ||
      selectedCommunityRelays.length === 0 ||
      communityRepoFilters.length === 0
    ) {
      communityRepoLoadRequestId += 1
      communityRepoLoadKey = ""
      communityRepoAnnouncementsSettled = true
      return
    }

    const key = `${selectedCommunityPubkey}:${selectedCommunityRelays.join(",")}`
    if (key === communityRepoLoadKey) return
    communityRepoLoadKey = key
    communityRepoAnnouncementsSettled = false
    const requestId = ++communityRepoLoadRequestId
    settleRepoLoad({
      promise: load({relays: selectedCommunityRelays, filters: communityRepoFilters as any}).catch(
        error => {
          console.warn("[git/+page] Failed to load community repos", error)
        },
      ),
      onSettled: () => {
        if (requestId === communityRepoLoadRequestId) communityRepoAnnouncementsSettled = true
      },
    })
  })

  const latestCommunityRepos = $derived.by(() => {
    if (!$communityRepoEvents || !selectedCommunityPubkey) return []

    const latest = new Map<string, RepoAnnouncementEvent>()
    for (const event of $communityRepoEvents as RepoAnnouncementEvent[]) {
      if (isDeletedRepoAnnouncement(event)) continue
      const community = parseRepoCommunityBinding(event)
      if (community?.pubkey !== selectedCommunityPubkey) continue
      const repoId = getTagValue("d", event.tags) || ""
      if (!repoId) continue
      const address = `${GIT_REPO_ANNOUNCEMENT}:${event.pubkey}:${repoId}`
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

  const hasMyRepoNotifications = $derived.by(() =>
    latestMyRepos.some(repo => repoHasNotifications(repo.event as RepoAnnouncementEvent)),
  )

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

  const makeTargetDeleteFilters = (events: TrustedEvent[]): Filter[] => {
    const ids = Array.from(new Set(events.map(event => event.id).filter(Boolean)))
    return ids.length ? [{kinds: [DELETE], "#e": ids, limit: ids.length}] : []
  }

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
    selectedCommunityPubkey
      ? [makeCommunityTargetingFilter(selectedCommunityPubkey, [REACTION])]
      : [],
  )
  const communityStarTargetEvents = $derived.by(() =>
    communityStarTargetFilters.length
      ? deriveEventsDesc(deriveEventsById({repository, filters: communityStarTargetFilters as any}))
      : undefined,
  )
  const communityStarTargetDeleteFilters = $derived.by(() =>
    makeTargetDeleteFilters(
      $communityStarTargetEvents ? ($communityStarTargetEvents as TrustedEvent[]) : [],
    ),
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
      $communityStarTargetEvents ? ($communityStarTargetEvents as TrustedEvent[]) : [],
      $communityStarTargetDeleteEvents ? ($communityStarTargetDeleteEvents as TrustedEvent[]) : [],
    ),
  )
  const eligibleCommunityStarTargetEvents = $derived.by(() => {
    if (!$communityStarTargetEvents) return []
    const targetEvents = ($communityStarTargetEvents as TrustedEvent[]).filter(
      event => !deletedCommunityStarTargetIds.has(event.id),
    )
    if (!selectedCommunityDefinition) return targetEvents

    const writerPubkeys = new Set(selectedCommunityStarWriterPubkeys)
    return targetEvents.filter(event => writerPubkeys.has(event.pubkey))
  })
  const communityStarReactionFilters = $derived.by(() =>
    eligibleCommunityStarTargetEvents.length
      ? makeTargetedPublicationOriginalFilters(
          eligibleCommunityStarTargetEvents,
          selectedCommunityDefinition ? selectedCommunityStarWriterPubkeys : undefined,
        )
      : [],
  )
  const communityStarReactionEvents = $derived.by(() =>
    communityStarReactionFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: communityStarReactionFilters as any}),
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
    selectedCommunityPubkey
      ? [makeCommunityTargetingFilter(selectedCommunityPubkey, [GIT_PERMALINK])]
      : [],
  )
  const communitySnippetTargetEvents = $derived.by(() =>
    communitySnippetTargetFilters.length
      ? deriveEventsDesc(
          deriveEventsById({repository, filters: communitySnippetTargetFilters as any}),
        )
      : undefined,
  )
  const communitySnippetTargetDeleteFilters = $derived.by(() =>
    makeTargetDeleteFilters(
      $communitySnippetTargetEvents ? ($communitySnippetTargetEvents as TrustedEvent[]) : [],
    ),
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
      $communitySnippetTargetEvents ? ($communitySnippetTargetEvents as TrustedEvent[]) : [],
      $communitySnippetTargetDeleteEvents
        ? ($communitySnippetTargetDeleteEvents as TrustedEvent[])
        : [],
    ),
  )
  const eligibleCommunitySnippetTargetEvents = $derived.by(() => {
    if (!$communitySnippetTargetEvents) return []
    const targetEvents = ($communitySnippetTargetEvents as TrustedEvent[]).filter(
      event => !deletedCommunitySnippetTargetIds.has(event.id),
    )
    if (!selectedCommunityDefinition) return targetEvents

    const writerPubkeys = new Set(selectedCommunityPermalinkWriterPubkeys)
    return targetEvents.filter(event => writerPubkeys.has(event.pubkey))
  })
  const communitySnippetFilters = $derived.by(() =>
    eligibleCommunitySnippetTargetEvents.length
      ? makeTargetedPublicationOriginalFilters(
          eligibleCommunitySnippetTargetEvents,
          selectedCommunityDefinition ? selectedCommunityPermalinkWriterPubkeys : undefined,
        )
      : [],
  )
  const communitySnippetEvents = $derived.by(() =>
    communitySnippetFilters.length
      ? deriveEventsDesc(deriveEventsById({repository, filters: communitySnippetFilters as any}))
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

  let communityTargetLoadKey = ""
  let communityTargetLoadRequestId = 0
  let communityTargetsSettled = $state(false)
  $effect(() => {
    if (
      activeMode !== "community" ||
      !selectedCommunityPubkey ||
      selectedCommunityRelays.length === 0
    ) {
      communityTargetLoadRequestId += 1
      communityTargetLoadKey = ""
      communityTargetsSettled = true
      return
    }

    const filters = [...communityStarTargetFilters, ...communitySnippetTargetFilters]
    if (filters.length === 0) {
      communityTargetsSettled = true
      return
    }

    const key = `${selectedCommunityPubkey}:${selectedCommunityRelays.join(",")}:targets`
    if (key === communityTargetLoadKey) return
    communityTargetLoadKey = key
    communityTargetsSettled = false
    const requestId = ++communityTargetLoadRequestId
    settleRepoLoad({
      promise: load({relays: selectedCommunityRelays, filters: filters as any}).catch(error => {
        console.warn("[git/+page] Failed to load community curation targets", error)
      }),
      onSettled: () => {
        if (requestId === communityTargetLoadRequestId) communityTargetsSettled = true
      },
    })
  })

  let communityTargetDeleteLoadKey = ""
  let communityTargetDeleteLoadRequestId = 0
  let communityTargetDeletesSettled = $state(false)
  $effect(() => {
    if (
      activeMode !== "community" ||
      !selectedCommunityPubkey ||
      selectedCommunityRelays.length === 0
    ) {
      communityTargetDeleteLoadRequestId += 1
      communityTargetDeleteLoadKey = ""
      communityTargetDeletesSettled = true
      return
    }

    const filters = [...communityStarTargetDeleteFilters, ...communitySnippetTargetDeleteFilters]
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
      promise: load({relays: selectedCommunityRelays, filters: filters as any}).catch(error => {
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
    if (
      activeMode !== "community" ||
      !selectedCommunityPubkey ||
      selectedCommunityRelays.length === 0
    ) {
      communityOriginalLoadRequestId += 1
      communityOriginalLoadKey = ""
      communityOriginalsSettled = true
      return
    }

    const filters = [...communityStarReactionFilters, ...communitySnippetFilters]
    if (filters.length === 0) {
      communityOriginalsSettled = true
      return
    }
    const key = filters.map(filter => JSON.stringify(filter)).join("|")
    if (key === communityOriginalLoadKey) return
    communityOriginalLoadKey = key
    communityOriginalsSettled = false
    const requestId = ++communityOriginalLoadRequestId
    settleRepoLoad({
      promise: load({relays: selectedCommunityRelays, filters: filters as any}).catch(error => {
        console.warn("[git/+page] Failed to load community curated originals", error)
      }),
      onSettled: () => {
        if (requestId === communityOriginalLoadRequestId) communityOriginalsSettled = true
      },
    })
  })

  let communityStarRepoLoadKey = ""
  let communityStarRepoLoadRequestId = 0
  let communityStarReposSettled = $state(false)
  $effect(() => {
    if (activeMode !== "community" || communityRepoStarAddresses.length === 0) {
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
    if (
      activeMode !== "community" ||
      !selectedCommunityDefinition ||
      candidatePubkeys.length === 0
    ) {
      return new Map<string, number>()
    }

    const assessments = buildCommunityTrustAssessments({
      viewerPubkey: $pubkey || "",
      candidatePubkeys,
      context: {scope: "active_community", communityPubkey: selectedCommunityPubkey},
      definitions: [selectedCommunityDefinition],
      profileListEvents: $selectedCommunityProfileListEvents
        ? ($selectedCommunityProfileListEvents as TrustedEvent[])
        : [],
      reportStates:
        selectedCommunityPubkey && selectedCommunityReportState
          ? new Map([[selectedCommunityPubkey, selectedCommunityReportState]])
          : undefined,
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
  const trimmedActiveRepoSearchQuery = $derived.by(() => activeRepoSearchQuery.trim())

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

  const localSearchFilteredRepos = $derived.by(() => {
    const query = trimmedActiveRepoSearchQuery
    if (activeTab === "snippets" || isAccountSearch || !query) return []

    return filteredRepos.filter(repo =>
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
      const profileMatches = getProfileSearchMatches(query)
      const activeCommunityPubkeys =
        activeMode === "community" ? [...selectedCommunityRepoWriterPubkeys] : []
      const communityAssociatedPubkeys =
        activeMode === "community" ? latestCommunityRepos.map(repo => repo.event.pubkey) : []
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
                filters: [{kinds: [GIT_REPO_ANNOUNCEMENT], authors}],
                timeoutMs: Math.min(5000, remainingMs),
                signal: controller.signal,
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
    const query = trimmedActiveRepoSearchQuery
    if (isAccountSearch) return []

    if (!query) return repos

    return sortRepoSearchResults({
      items: mergeLoadedRepoSearchItems(localSearchFilteredRepos, matchedDiscoveredSearchRepos),
      query,
      viewerPubkey: $pubkey,
      starredOwners: [...starredRepoOwners],
      starredAddresses: repoStarAddresses.map(star => star.address),
      getProfile: getSearchProfile,
    })
  })

  const repoResultsVisibleContext = $derived(
    `${activeMode}:${activeTab}:${trimmedActiveRepoSearchQuery}`,
  )
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
    searchFilteredRepos.length > visibleSearchFilteredRepos.length,
  )
  const loadMoreRepoResults = () => {
    repoResultsVisibleLimit += REPO_SEARCH_PAGE_SIZE
  }

  // Store for account search (naddr/npub) repo cards
  let accountSearchRepoCards = $state<any[]>([])
  let accountSearchCardsComputeTimer: ReturnType<typeof setTimeout> | null = null
  let accountSearchCardsComputeRequestId = 0
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
      accountSearchCardsComputeRequestId += 1
      accountSearchRepoCards = []
      return
    }

    const repos = accountSearchVisibleRepos
    if (repos.length > 0) {
      if (accountSearchCardsComputeTimer) {
        clearTimeout(accountSearchCardsComputeTimer)
      }
      const requestId = ++accountSearchCardsComputeRequestId
      const timer = setTimeout(() => {
        if (requestId !== accountSearchCardsComputeRequestId || !isAccountSearch) return
        const cards = repositoriesStore.computeCards(repos, {
          parseRepoAnnouncementEvent,
          Router,
          Address,
          gitRelays: GIT_RELAYS,
        })
        accountSearchRepoCards = cards
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
    }
  })

  // Memoize card computation to prevent jitter
  type RepoCardsCacheEntry = {cardsKey: string; cards: any[]}
  const repoCardsByContext = new Map<string, RepoCardsCacheEntry>()
  let cachedCards: any[] = []
  let cachedCardsKey = ""
  let cardsComputeTimer: ReturnType<typeof setTimeout> | null = null
  let cardsComputeRequestId = 0
  let renderedRepoCardsContext = $state("")
  let repoCardsComputing = $state(false)
  const sortedRepoCards = $derived.by(() => {
    const cards = $repositoriesStore as any[]
    return trimmedActiveRepoSearchQuery ? cards : prioritizeFreshRepoCards(cards)
  })
  const repoCardsContext = $derived(`${activeMode}:${activeTab}:${trimmedActiveRepoSearchQuery}`)
  const personalStarredReposLoading = $derived(
    activeMode === "personal" &&
      activeTab === "bookmarks" &&
      Boolean($pubkey) &&
      (!repoStarsHydrationSettled || $repoStarsLoading || starredRepoAnnouncementsLoading),
  )
  const activeRepoDataLoading = $derived.by(() => {
    if (activeTab === "snippets" || isAccountSearch) return false

    if (activeMode === "personal") {
      if (!$pubkey) return false
      if (activeTab === "my-repos") return !personalRepoAnnouncementsSettled
      if (activeTab === "bookmarks") return personalStarredReposLoading
      return false
    }

    if (activeMode === "community") {
      if (!selectedCommunityPubkey) return false
      if (activeTab === "my-repos") return !communityRepoAnnouncementsSettled
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
    renderedRepoCardsContext === repoCardsContext && sortedRepoCards.length > 0,
  )
  const repoListLoading = $derived.by(() => {
    if (activeTab === "snippets" || isAccountSearch) return false
    if (hasRenderedRepoCardsForCurrentContext) return false
    return Boolean(loading || repoCardsComputing || activeRepoDataLoading)
  })
  const canShowRepoEmpty = $derived(
    activeTab !== "snippets" &&
      !isAccountSearch &&
      !repoListLoading &&
      searchFilteredRepos.length === 0,
  )

  const repoCardsForProfileHydration = $derived.by(() =>
    isAccountSearch
      ? sortedAccountSearchRepoCards
      : hasRenderedRepoCardsForCurrentContext
        ? sortedRepoCards
        : [],
  )
  const repoCardEvidenceRepoEvents = $derived.by(() =>
    repoCardsForProfileHydration
      .map(card => card?.first as RepoAnnouncementEvent | undefined)
      .filter((event): event is RepoAnnouncementEvent => Boolean(event)),
  )
  const repoCardEvidenceAddresses = $derived.by(() =>
    Array.from(new Set(repoCardEvidenceRepoEvents.map(getRepoCardAddress).filter(Boolean))),
  )
  const repoCardEvidenceRelays = $derived.by(() =>
    Array.from(
      new Set(
        repoCardEvidenceRepoEvents
          .flatMap(event => getRepoCardProfileRelays(event))
          .map(relay => safeNormalizeRelay(relay))
          .filter(Boolean),
      ),
    ),
  )
  const repoCardPullRequestFilters = $derived.by(() =>
    chunkBySize(repoCardEvidenceAddresses, REPO_CARD_EVIDENCE_FILTER_CHUNK_SIZE).map(
      addresses => ({kinds: [GIT_PULL_REQUEST], "#a": addresses}) satisfies Filter,
    ),
  )
  const repoCardPullRequestEventsStore = $derived.by(() =>
    repoCardPullRequestFilters.length > 0
      ? deriveEventsDesc(deriveEventsById({repository, filters: repoCardPullRequestFilters as any}))
      : undefined,
  )
  const repoCardPullRequests = $derived.by(() =>
    repoCardPullRequestEventsStore
      ? (($repoCardPullRequestEventsStore || []) as PullRequestEvent[])
      : [],
  )
  const repoCardPullRequestRootIds = $derived.by(() =>
    Array.from(new Set(repoCardPullRequests.map(event => event.id).filter(Boolean))),
  )
  const repoCardStatusFilters = $derived.by(() => [
    ...chunkBySize(repoCardEvidenceAddresses, REPO_CARD_EVIDENCE_FILTER_CHUNK_SIZE).map(
      addresses => ({kinds: [GIT_STATUS_APPLIED], "#a": addresses}) satisfies Filter,
    ),
    ...chunkBySize(repoCardPullRequestRootIds, REPO_CARD_EVIDENCE_FILTER_CHUNK_SIZE).map(
      rootIds => ({kinds: [GIT_STATUS_APPLIED], "#e": rootIds}) satisfies Filter,
    ),
  ])
  const repoCardEvidenceFilters = $derived.by(() => [
    ...repoCardPullRequestFilters,
    ...repoCardStatusFilters,
  ])
  const repoCardStatusEventsStore = $derived.by(() =>
    repoCardStatusFilters.length > 0
      ? deriveEventsDesc(deriveEventsById({repository, filters: repoCardStatusFilters as any}))
      : undefined,
  )
  const repoCardStatusEvents = $derived.by(() =>
    repoCardStatusEventsStore ? (($repoCardStatusEventsStore || []) as StatusEvent[]) : [],
  )
  const repoCardStatusEventsByRoot = $derived.by(() =>
    groupStatusEventsByRoot(repoCardStatusEvents),
  )
  const repoCardVerifiedMaintainersByAddress = $derived.by(() => {
    const verifiedByAddress = new Map<string, Set<string>>()

    for (const event of repoCardEvidenceRepoEvents) {
      const address = getRepoCardAddress(event)
      if (!address) continue

      const pullRequests = repoCardPullRequests.filter(pullRequest =>
        hasRepoAddressTag(pullRequest, address),
      )

      verifiedByAddress.set(
        address,
        getVerifiedRepoMaintainers({
          repoEvent: event,
          pullRequests,
          statusEventsByRoot: repoCardStatusEventsByRoot,
        }),
      )
    }

    return verifiedByAddress
  })
  const getRepoCardVerifiedMaintainers = (event?: RepoAnnouncementEvent | null) => {
    const address = getRepoCardAddress(event)
    return address
      ? repoCardVerifiedMaintainersByAddress.get(address) || EMPTY_VERIFIED_REPO_MAINTAINERS
      : EMPTY_VERIFIED_REPO_MAINTAINERS
  }
  let repoCardProfileLoadKey = ""
  let repoCardEvidenceLoadKey = ""
  let repoCardEvidenceLoadTimer: ReturnType<typeof setTimeout> | null = null
  let repoCardEvidenceLoadController: AbortController | null = null
  let repoCardProfileLoadTimer: ReturnType<typeof setTimeout> | null = null
  let repoCardProfileLoadRequestId = 0

  const cancelRepoCardEvidenceLoad = () => {
    if (repoCardEvidenceLoadTimer) {
      clearTimeout(repoCardEvidenceLoadTimer)
      repoCardEvidenceLoadTimer = null
    }
    repoCardEvidenceLoadController?.abort()
    repoCardEvidenceLoadController = null
  }

  const cancelRepoCardProfileLoad = () => {
    repoCardProfileLoadRequestId += 1
    if (repoCardProfileLoadTimer) {
      clearTimeout(repoCardProfileLoadTimer)
      repoCardProfileLoadTimer = null
    }
  }

  $effect(() => {
    const filters = repoCardEvidenceFilters
    const relays = repoCardEvidenceRelays
    const key = `${relays.join(",")}:${filters
      .map(filter => JSON.stringify(filter))
      .sort()
      .join("|")}`

    if (filters.length === 0 || relays.length === 0) {
      repoCardEvidenceLoadKey = ""
      cancelRepoCardEvidenceLoad()
      return
    }

    if (key === repoCardEvidenceLoadKey) return
    repoCardEvidenceLoadKey = key

    cancelRepoCardEvidenceLoad()
    const controller = new AbortController()
    repoCardEvidenceLoadController = controller
    repoCardEvidenceLoadTimer = setTimeout(() => {
      repoCardEvidenceLoadTimer = null
      if (gitPageDestroyed || controller.signal.aborted) return

      load({relays, filters: filters as any, signal: controller.signal}).catch(error => {
        if (!controller.signal.aborted) {
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

    const requests = repoCardsForProfileHydration
      .flatMap(card => {
        const event = card?.first as RepoAnnouncementEvent | undefined
        const owner = String(card?.owner || event?.pubkey || "")
        const relays = event ? getRepoCardProfileRelays(event) : []
        const maintainers = getRepoCardMaintainers(event)

        return [owner, ...maintainers].filter(Boolean).map(pubkey => ({pubkey, relays}))
      })
      .filter(({pubkey}) => pubkey)

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
    const requestId = ++repoCardProfileLoadRequestId

    repoCardProfileLoadTimer = setTimeout(() => {
      repoCardProfileLoadTimer = null
      if (gitPageDestroyed || requestId !== repoCardProfileLoadRequestId) return

      for (const {pubkey, relays} of requests) {
        loadBudabitProfile(pubkey, {relays}).catch(error => {
          if (!gitPageDestroyed && requestId === repoCardProfileLoadRequestId) {
            console.warn("[git/+page] Failed to load repo card profile", error)
          }
        })
      }
    }, REPO_CARD_HYDRATION_DELAY_MS)
  })

  // Update repositoriesStore whenever repos change
  // Uses debouncing to wait for all repos to load before showing cards
  $effect(() => {
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
    const cachedEntry = repoCardsByContext.get(context)

    if (activeRepoDataLoading && reposToShow.length === 0) {
      if (cachedEntry?.cards.length) {
        cachedCards = cachedEntry.cards
        cachedCardsKey = cachedEntry.cardsKey
        repositoriesStore.set(cachedEntry.cards)
        renderedRepoCardsContext = context
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
          repoCardsComputing = false
        } else if (cardsKey !== cachedCardsKey || renderedRepoCardsContext !== context) {
          if (cardsComputeTimer) {
            clearTimeout(cardsComputeTimer)
            cardsComputeTimer = null
          }
          repoCardsComputing = true
          const requestId = ++cardsComputeRequestId
          const timer = setTimeout(() => {
            if (requestId !== cardsComputeRequestId || repoCardsContext !== context) return
            const cards = repositoriesStore.computeCards(reposToShow, {
              parseRepoAnnouncementEvent,
              Router,
              Address,
              gitRelays: GIT_RELAYS,
            })
            cachedCards = cards
            cachedCardsKey = cardsKey
            repoCardsByContext.set(context, {cardsKey, cards})
            repositoriesStore.set(cachedCards)
            renderedRepoCardsContext = context
            repoCardsComputing = false
            if (cardsComputeTimer === timer) cardsComputeTimer = null
          }, 0)
          cardsComputeTimer = timer
        } else if (renderedRepoCardsContext !== context && cachedCards.length > 0) {
          repositoriesStore.set(cachedCards)
          renderedRepoCardsContext = context
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
      }
    }
  })

  onDestroy(() => {
    gitPageDestroyed = true
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

  const getRepoCardCanonicalKeys = (event?: RepoAnnouncementEvent | null) => {
    const canonicalKey = getCanonicalRepoKeyFromEvent(event)
    return canonicalKey ? [canonicalKey] : []
  }

  const getRepoCardCandidateAddresses = (event?: RepoAnnouncementEvent | null) => {
    if (!event) return new Set<string>()

    const address = getRepoAddressFromEvent(event)
    if (!address) return new Set<string>()

    return new Set([address])
  }

  const getCommunityRepoStargazerPubkeys = (event?: RepoAnnouncementEvent | null) => {
    if (
      activeMode !== "community" ||
      activeTab !== "bookmarks" ||
      !event ||
      !$communityStarReactionEvents
    ) {
      return []
    }

    const candidateAddresses = getRepoCardCandidateAddresses(event)
    const candidateRepoKeys = getRepoCardCanonicalKeys(event)
    const latestByPubkey = new Map<string, {pubkey: string; createdAt: number}>()

    for (const reaction of $communityStarReactionEvents as TrustedEvent[]) {
      const star = parseRepoStarReaction(reaction)
      if (!star || !reaction.pubkey) continue
      if (
        !isAnyBookmarked([repoStarToBookmarkAddress(star)], candidateAddresses, {
          candidateRepoKeys,
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

  const defaultRepoRelays = $state<string[]>([...GIT_RELAYS])

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

  const resolveRepoEventPublishRelays = (
    event: any,
    fallbackRelays: string[] = defaultRepoRelays,
  ) => {
    const policy = resolveRepoRelayPolicy({
      event,
      fallbackRepoRelays: fallbackRelays,
      userOutboxRelays: getUserOutboxRelays(),
      gitRelays: GIT_RELAYS,
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

  const buildRepoNaddrFromAnnouncement = (
    event: any,
    fallbackPubkey: string,
    fallbackRelays: string[] = [],
  ): string => {
    const naddr = makeRepoNaddrFromEvent(event, {
      fallbackPubkey,
      fallbackRelays: [...getTaggedRelaysFromRepoEvent(event), ...(fallbackRelays || [])],
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

  const getRepoCardNavigationKey = (announcement: RepoAnnouncementEvent) =>
    announcement.id || getRepoBrowseHref(announcement)

  const navigateToRepoCard = (announcement: RepoAnnouncementEvent) => {
    const navigationKey = getRepoCardNavigationKey(announcement)
    if (navigatingRepoCardKey === navigationKey) return

    navigatingRepoCardKey = navigationKey
    void (async () => {
      try {
        await waitForNavigationIntentPaint()
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
      event: thunk?.event,
    }
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
          onRepoCreated: (result: NewRepoResult) => {
            setTimeout(() => hydrateRepoEvents(result), 0)
          },
          onNavigateToRepo: (result: NewRepoResult) => navigateToCreatedRepo(result, "new repo"),
          onCancel: back,
          defaultRelays: [...defaultRepoRelays],
          platformRelays: [...GIT_RELAYS],
          platformUrl: $APP_URL,
          makeRepoPath: makeGitPath,
          userPubkey: $pubkey,
          defaultAuthorName: authorName,
          defaultAuthorEmail: authorEmail,
          communityOptions: repoPublishCommunityOptions,
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
        {fullscreen: true, noEscape: true},
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
            clearModals()
          },
          onPublishEvent: async (repoEvent: NostrEvent) => {
            const targetRelays = resolveRepoEventPublishRelays(repoEvent, defaultRepoRelays)
            const thunk = await publishEventToRelays(repoEvent, targetRelays)
            return extractRelayAck(thunk)
          },
          onRollbackPublishedRepoEvents: rollbackPublishedRepoEvents,
          onImportComplete: (result: ImportResult) => {
            hydrateRepoEvents(result)
            // Reload repos by forcing bookmarks refresh and announcements
            loadRepoAnnouncements(repoAnnouncementRelays)
            pushToast({
              message: `Successfully imported repository! Imported ${result.issuesImported} issues, ${result.commentsImported} comments, ${result.prsImported} PRs, and created ${result.profilesCreated} profiles.`,
            })
          },
          onNavigateToRepo: (result: ImportResult) => navigateToCreatedRepo(result, "imported repo"),
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
        },
        {fullscreen: true, noEscape: true},
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
    <GitCommunityMenuButton />
  {/snippet}
</PageBar>

<PageContent class={`${gitPageWidthClass} mt-4 flex flex-grow flex-col gap-4 overflow-auto p-2`}>
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
            value={selectedCommunityPubkey}
            onchange={event => selectGitCommunity((event.currentTarget as HTMLSelectElement).value)}
            class="select select-bordered select-sm w-full">
            {#if repoViewCommunityOptions.length === 0}
              <option value="">No communities</option>
            {:else}
              <option value="" disabled>Select a community</option>
              {#each repoViewCommunityOptions as option (option.pubkey)}
                <option value={option.pubkey}>{option.label || option.pubkey}</option>
              {/each}
            {/if}
          </select>
        </label>
      {/if}
    </div>
    <Tabs bind:value={activeTab} class="w-full">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <TabsList
            class="grid w-full grid-cols-3 overflow-hidden sm:flex sm:w-fit sm:max-w-full sm:self-start">
            <TabsTrigger
              value="my-repos"
              class="min-w-0 justify-center whitespace-nowrap !px-1.5 text-xs leading-tight data-[state=active]:!bg-base-100 data-[state=active]:!text-base-content data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-border sm:flex-none sm:!px-3 sm:text-base">
              <span class="flex min-w-0 items-center gap-1 sm:gap-2">
                <Icon icon={FolderWithFiles} size={4} class="sm:hidden" />
                <Icon icon={FolderWithFiles} class="hidden sm:inline-block" />
                <span class="min-w-0 truncate">Repos</span>
                {#if hasMyRepoNotifications}
                  <span
                    class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary sm:h-2 sm:w-2"
                    aria-label="Unread updates"></span>
                {/if}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="bookmarks"
              class="min-w-0 justify-center whitespace-nowrap !px-1.5 text-xs leading-tight data-[state=active]:!bg-base-100 data-[state=active]:!text-base-content data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-border sm:flex-none sm:!px-3 sm:text-base">
              <span class="flex min-w-0 items-center gap-1 sm:gap-2">
                <Icon icon={Star} size={4} class="sm:hidden" />
                <Icon icon={Star} class="hidden sm:inline-block" />
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
              class="min-w-0 justify-center whitespace-nowrap !px-1.5 text-xs leading-tight data-[state=active]:!bg-base-100 data-[state=active]:!text-base-content data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-border sm:flex-none sm:!px-3 sm:text-base">
              <span class="flex min-w-0 items-center gap-1 sm:gap-2">
                <Icon icon={Code} size={4} class="sm:hidden" />
                <Icon icon={Code} class="hidden sm:inline-block" />
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
                  : "Search repo, owner, npub, or naddr"} />
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
            <EventRenderer event={snippet as any} />
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
        <div class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {#each sortedAccountSearchRepoCards as g, i (getRepoCardStableKey(g))}
            {@const cardProfileRelays = g.first
              ? getRepoCardProfileRelays(g.first as RepoAnnouncementEvent)
              : []}
            {@const repoCardMaintainers = g.first
              ? getRepoCardMaintainers(g.first as RepoAnnouncementEvent)
              : []}
            {@const repoCardVerifiedMaintainers = g.first
              ? getRepoCardVerifiedMaintainers(g.first as RepoAnnouncementEvent)
              : EMPTY_VERIFIED_REPO_MAINTAINERS}
            {@const repoCardNavigationKey = g.first
              ? getRepoCardNavigationKey(g.first as RepoAnnouncementEvent)
              : ""}
            {@const repoCardNavigating = Boolean(
              repoCardNavigationKey && navigatingRepoCardKey === repoCardNavigationKey,
            )}
            <div
              class="relative min-w-0 rounded-md border border-border bg-card p-3 transition {repoCardNavigating
                ? 'cursor-wait opacity-70 ring-2 ring-primary/40'
                : ''}"
              role="link"
              tabindex="0"
              aria-busy={repoCardNavigating}
              onclick={g.first
                ? event => handleRepoCardNeutralClick(event, g.first as RepoAnnouncementEvent)
                : undefined}
              onkeydown={g.first
                ? event => handleRepoCardNeutralKeydown(event, g.first as RepoAnnouncementEvent)
                : undefined}
              in:staggeredFade={{index: i, staggerDelay: 40, duration: 250}}>
              {#if repoCardNavigating}
                <span
                  class="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-sm backdrop-blur-sm">
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
                  showActivity={true}
                  showIssues={true}
                  showActions={true}
                  hideDate={true} />
              {/if}
              <div class="mt-3 flex min-w-0 items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <RepoMaintainerList
                    maintainers={repoCardMaintainers}
                    relays={cardProfileRelays}
                    verifiedMaintainers={repoCardVerifiedMaintainers}
                    repoName={g.title || ""} />
                </div>
                {#if g.first}
                  {@const date = new Date(g.first.created_at * 1000)}
                  <span class="text-xs opacity-60">
                    {String(date.getDate()).padStart(2, "0")}/{String(date.getMonth() + 1).padStart(
                      2,
                      "0",
                    )}/{String(date.getFullYear()).slice(-2)}
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
        <p class="flex h-10 items-center justify-center py-20" out:fly>
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
      {:else if hasRenderedRepoCardsForCurrentContext}
        <div class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {#each sortedRepoCards as g, i (getRepoCardStableKey(g))}
            {@const cardProfileRelays = g.first
              ? getRepoCardProfileRelays(g.first as RepoAnnouncementEvent)
              : []}
            {@const communityStargazers = g.first
              ? getCommunityRepoStargazerPubkeys(g.first as RepoAnnouncementEvent)
              : []}
            {@const repoCardMaintainers = g.first
              ? getRepoCardMaintainers(g.first as RepoAnnouncementEvent)
              : []}
            {@const repoCardVerifiedMaintainers = g.first
              ? getRepoCardVerifiedMaintainers(g.first as RepoAnnouncementEvent)
              : EMPTY_VERIFIED_REPO_MAINTAINERS}
            {@const repoCardNavigationKey = g.first
              ? getRepoCardNavigationKey(g.first as RepoAnnouncementEvent)
              : ""}
            {@const repoCardNavigating = Boolean(
              repoCardNavigationKey && navigatingRepoCardKey === repoCardNavigationKey,
            )}
            <div
              class="relative min-w-0 rounded-md border border-border bg-card p-3 transition {repoCardNavigating
                ? 'cursor-wait opacity-70 ring-2 ring-primary/40'
                : ''}"
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
                  class="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-sm backdrop-blur-sm">
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
                  showActivity={true}
                  showIssues={true}
                  showActions={true}
                  hideDate={true} />
              {/if}

              <!-- Maintainers, community stargazers, and date -->
              <div
                class="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                  <RepoMaintainerList
                    maintainers={repoCardMaintainers}
                    relays={cardProfileRelays}
                    verifiedMaintainers={repoCardVerifiedMaintainers}
                    repoName={g.title || ""} />
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
                            <ProfileCircle pubkey={pk} relays={cardProfileRelays} size={6} />
                          </Button>
                        {/each}
                      </div>
                      <span class="min-w-0 truncate text-xs opacity-60">
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
                {#if g.first}
                  {@const date = new Date(g.first.created_at * 1000)}
                  <span class="shrink-0 text-xs opacity-60">
                    {String(date.getDate()).padStart(2, "0")}/{String(date.getMonth() + 1).padStart(
                      2,
                      "0",
                    )}/{String(date.getFullYear()).slice(-2)}
                  </span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
        {#if hasMoreRepoResults}
          <div class="mt-4 flex flex-col items-center gap-2">
            <button type="button" class="btn btn-outline btn-sm" onclick={loadMoreRepoResults}>
              Show more repositories
            </button>
            <p class="text-xs text-muted-foreground">
              Showing {visibleSearchFilteredRepos.length} of {searchFilteredRepos.length}
            </p>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</PageContent>
