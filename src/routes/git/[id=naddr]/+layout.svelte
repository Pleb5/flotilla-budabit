<script module lang="ts">
  const repoInitialLoads = new Map<string, Promise<void>>()
</script>

<script lang="ts">
  import {
    RepoHeader,
    RepoTab,
    BranchSelector,
    toast,
    Repo,
    WorkerManager,
    ForkRepoDialog,
    type RepoCommunityOption,
  } from "@nostr-git/ui"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  // Import worker URL using Vite's ?url suffix for correct asset resolution
  // This must be done at the app level, not inside pre-built packages
  import gitWorkerUrl from "@nostr-git/core/worker/worker.js?url"
  import {
    Activity,
    GitBranch,
    CircleAlert,
    GitPullRequest,
    GitCommit,
    Settings as SettingsIcon,
    ChevronLeft,
    Home,
    Star,
    Bell,
    GitFork,
    RotateCcw,
    Globe,
  } from "@lucide/svelte"
  import ExtensionIcon from "@app/components/ExtensionIcon.svelte"
  import {page} from "$app/stores"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {pushToast, popToast} from "@src/app/util/toast"
  import {notifications, hasRepoNotification, checked, setCheckedAt} from "@app/util/notifications"
  import {notifyCorsProxyIssue} from "@app/util/git-cors-proxy"
  import {pushModal, clearModals} from "@app/util/modal"
  import DeleteRepoConfirm from "@app/components/DeleteRepoConfirm.svelte"
  import RepoCollectModal from "@app/components/RepoCollectModal.svelte"
  import BranchStateSyncModal from "@app/components/BranchStateSyncModal.svelte"
  import RemoteFixHelperModal from "@app/components/RemoteFixHelperModal.svelte"
  import GitCommunityMenuButton from "@app/components/GitCommunityMenuButton.svelte"
  import {EditRepoPanel} from "@nostr-git/ui"
  import {postRepoAnnouncement, postRepoStateEvent} from "@app/core/git-commands.js"
  import RepoWatchModal from "@app/components/RepoWatchModal.svelte"
  import {nip19} from "nostr-tools"
  import type {NostrFilter, NostrEvent} from "@nostr-git/core"

  // ForkResult type definition (matches @nostr-git/ui)
  interface ForkResult {
    repoId: string
    forkUrl: string
    defaultBranch: string
    branches: string[]
    tags: string[]
    announcementEvent: RepoAnnouncementEvent
    stateEvent: RepoStateEvent
  }
  import type {
    RepoAnnouncementEvent,
    RepoStateEvent,
    IssueEvent,
    PullRequestEvent,
    StatusEvent,
    CommentEvent,
    LabelEvent,
  } from "@nostr-git/core/events"
  import {
    GRASP_SET_KIND,
    DEFAULT_GRASP_SET_ID,
    parseGraspServersEvent,
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_STATE,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
    GIT_LABEL,
    parseRepoAnnouncementEvent,
    isCommentEvent,
    createRepoStateEvent,
    isImportedEvent,
    resolveStatus,
  } from "@nostr-git/core/events"
  import {
    parseRepoId,
    filterValidCloneUrls,
    reorderUrlsByPreference,
    resolveRepoRelayPolicy,
    getTaggedRelaysFromRepoEvent,
  } from "@nostr-git/core/utils"
  import {derived, get as getStore, readable, type Readable} from "svelte/store"
  import {
    repository,
    pubkey,
    profilesByPubkey,
    profileSearch,
    loadProfile,
    relaySearch,
    publishThunk,
    deriveProfile,
    abortThunk,
  } from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById, deriveEventsDesc, throttled} from "@welshman/store"
  import {load, request, PublishStatus} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {goto, beforeNavigate} from "$app/navigation"
  import {
    normalizeRelayUrl,
    Address,
    REPORT,
    GIT_ISSUE,
    DELETE,
    GIT_STATUS_OPEN,
    GIT_STATUS_DRAFT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    getTagValue,
    makeEvent,
    REACTION,
    COMMENT,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {publishDelete} from "@src/app/core/commands"
  import {setContext, onDestroy, tick} from "svelte"
  import {
    REPO_KEY,
    REPO_RELAYS_KEY,
    REPO_CLONE_URLS_KEY,
    STATUS_EVENTS_BY_ROOT_KEY,
    RESOLVED_STATUS_BY_ROOT_KEY,
    HIDDEN_ROOT_IDS_KEY,
    PULL_REQUESTS_KEY,
    COMMENT_EVENTS_KEY,
    REPO_FEED_ACTIVITY_KEY,
    REPO_ACTIONS_KEY,
    REPO_SETTINGS_ACTIONS_KEY,
    activeRepoClass,
    GIT_RELAYS,
    getRepoAnnouncementRelays,
    getRepoScopedRelays,
    getRepoMaintainers,
  } from "@app/core/git-state"
  import {REPO_TRUST_METRICS_KEY, createRepoTrustMetricsStore} from "@app/core/repo-trust-metrics"
  import {userRepoWatchValues} from "@app/core/repo-watch"
  import {extensionSettings} from "@app/extensions/settings"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import {makeCommunityPath, makeGitPath} from "@app/util/routes"
  import {makeRepoNaddrFromEvent} from "@app/util/repo-links"
  import {getInitializedGitWorker} from "@app/core/worker-singleton"
  import {fetchRelayEventsWithTimeout} from "@app/util/fetch-relay-events"
  import {
    diffBranchHeads,
    overlayLatestRepoStates,
    type BranchChange,
  } from "@app/util/branch-update"
  import {
    getCanonicalRepoKeyFromEvent,
    getRepoBookmarkAddressSet,
    isAnyBookmarked,
  } from "@app/util/bookmarks"
  import {activeRepoStars, getRepoStarRelays, hydrateRepoStars} from "@app/core/repo-stars-state"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeUserCommunityRefs,
  } from "@app/core/community-state"
  import {buildCommunityTrustAssessments} from "@app/core/community-trust"
  import {COMMUNITY_SECTION_REPOSITORIES, TARGETED_PUBLICATION_KIND} from "@app/core/community"
  import {
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {
    makeRepoStarReaction,
    repoStarToBookmarkAddress,
    type RepoStarRef,
  } from "@app/util/repo-stars"
  import {randomId} from "@welshman/lib"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"

  const {id} = $page.params

  const {data, children} = $props()
  // Type assertion needed because TypeScript infers old layout return type
  const layoutData = data as unknown as {
    repoId: string
    repoName: string
    repoPubkey: string
    fallbackRelays: string[]
    naddrRelays: string[]
    url: string
  }
  const {repoId, repoName, repoPubkey, fallbackRelays, naddrRelays, url} = layoutData
  const safeNormalizeRelayUrl = (relay: unknown) => {
    try {
      return normalizeRelayUrl(String(relay || "").trim())
    } catch {
      return ""
    }
  }
  const normalizedGitRelays = GIT_RELAYS.map(safeNormalizeRelayUrl).filter(Boolean)
  const isGitRelay = (relay: string) => {
    const normalized = safeNormalizeRelayUrl(relay)
    return Boolean(normalized && normalizedGitRelays.includes(normalized))
  }

  const getCommunityOptionLabel = (communityPubkey: string) => {
    const profile = $profilesByPubkey.get(communityPubkey)
    return (
      profile?.display_name ||
      profile?.name ||
      `${communityPubkey.slice(0, 8)}...${communityPubkey.slice(-6)}`
    )
  }

  const repoCommunityOptions = $derived.by((): RepoCommunityOption[] =>
    $activeUserCommunityRefs
      .filter(ref => ref.writableSections.includes(COMMUNITY_SECTION_REPOSITORIES))
      .map(ref => ({
        pubkey: ref.communityPubkey,
        label: getCommunityOptionLabel(ref.communityPubkey),
        relays: ref.relayHints.length ? ref.relayHints : ref.definition.relays,
      })),
  )

  type PublishThunkResult = {
    event?: TrustedEvent
    complete?: Promise<unknown>
    results?: Record<string, {status?: unknown}>
  }

  const repoCommunityLabel = $derived.by(() => {
    const community = repoClass?.community
    if (!community) return ""
    return getCommunityOptionLabel(community.pubkey)
  })

  const COMMENT_LOAD_DEBOUNCE_MS = 300
  const COMMENT_LOAD_CHUNK_SIZE = 100
  const PR_STATUS_ROOT_LOAD_DEBOUNCE_MS = 250
  const PR_STATUS_ROOT_LOAD_CHUNK_SIZE = 100
  const ADDRESS_LOAD_DEBOUNCE_MS = 200
  const ADDRESS_LOAD_CHUNK_SIZE = 50
  const FORK_PUBLISH_TIMEOUT_MS = 20000
  const FORK_BRANCH_FILTER_THRESHOLD = 20
  const ADDRESS_DERIVE_FILTER_CHUNK_SIZE = 50
  const COMMENT_DERIVE_FILTER_CHUNK_SIZE = 100
  const SCOPED_DERIVE_THROTTLE_MS = 120
  const GIT_COVER_LETTER_KIND = 1624
  const REPO_LIVE_FILTER_CHUNK_SIZE = 100
  const repoStatusKinds = [
    GIT_STATUS_OPEN,
    GIT_STATUS_DRAFT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
  ]

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

  type ResolvedRootStatus = {
    state: "open" | "draft" | "closed" | "merged" | "resolved"
    event?: StatusEvent
  }

  // Derive repoClass from activeRepoClass store
  const repoClass = $derived($activeRepoClass)
  const displayRepoName = $derived.by(() => repoClass?.name || repoName)
  let forkWorkerClient: {api: any; worker: Worker} | null = null
  let pageContentElement = $state<Element | undefined>()
  let repoTabsHeight = $state(0)
  let mobileCodeBreadcrumbHeight = $state(0)

  const ensureForkWorkerClient = async () => {
    if (forkWorkerClient) return forkWorkerClient
    forkWorkerClient = await getInitializedGitWorker()
    return forkWorkerClient
  }

  $effect(() => {
    if (!repoClass) return
    if (!repoClass.name && repoName) {
      repoClass.name = repoName
    }
    if (!repoClass.key && repoPubkey && repoName) {
      try {
        repoClass.key = parseRepoId(`${repoPubkey}:${repoName}`)
      } catch (error) {
        void error
      }
    }
    if (!repoClass.address && repoPubkey && repoName) {
      repoClass.address = `${GIT_REPO_ANNOUNCEMENT}:${repoPubkey}:${repoName}`
    }
  })

  // Get enabled extensions with repo-tab slots
  const repoTabExtensions = $derived.by(() => {
    const settings = $extensionSettings
    const enabledIds = settings.enabled
    const extensionsMap = new Map<
      string,
      {id: string; label: string; path: string; icon?: string}
    >()

    // Check NIP-89 extensions first
    for (const [extId, manifest] of Object.entries(settings.installed.nip89)) {
      if (enabledIds.includes(extId) && manifest.slot?.type === "repo-tab") {
        extensionsMap.set(extId, {
          id: extId,
          label: manifest.slot.label,
          path: manifest.slot.path,
          icon: manifest.icon,
        })
      }
    }

    // Check Smart Widget extensions - these override NIP-89 if same ID
    for (const [widgetId, widget] of Object.entries(settings.installed.widget || {})) {
      if (enabledIds.includes(widgetId) && widget.slot?.type === "repo-tab") {
        // Use iconUrl, but fall back to LayoutGrid for known broken URLs
        let icon = widget.iconUrl
        if (icon && icon.includes("budabit.dev")) {
          icon = "LayoutGrid" // Fallback for broken budabit.dev URLs
        }
        extensionsMap.set(widgetId, {
          id: widgetId,
          label: widget.slot.label,
          path: widget.slot.path,
          icon,
        })
      }
    }

    return Array.from(extensionsMap.values())
  })

  // Make activeTab reactive to avoid lag on navigation - memoize the calculation
  const activeTab = $derived.by(() => {
    const pathname = $page.url.pathname.replace(/\/+$/, "")
    const repoPath = basePath.replace(/\/+$/, "")

    if (pathname === repoPath) return "overview"
    if (!pathname.startsWith(`${repoPath}/`)) return undefined

    const segments = pathname
      .slice(repoPath.length + 1)
      .split("/")
      .filter(Boolean)
    if (segments.length === 0) return "overview"

    if (segments[0] === "extensions") {
      return segments[1] || "extensions"
    }

    return segments[0]
  })

  // Memoize base path to avoid recalculating on every render
  const basePath = $derived(`/git/${id}`)
  const issuesPath = $derived.by(() => `${basePath}/issues`)
  const prsPath = $derived.by(() => `${basePath}/prs`)
  const hasIssuesNotification = $derived.by(() => {
    if (repoAddress) {
      return hasRepoNotification($notifications, {
        relay: url,
        repoAddress,
        repoAddresses: $repoAddressesStore,
        kind: "issues",
      })
    }
    return $notifications.has(issuesPath)
  })
  const hasPrsNotification = $derived.by(() => {
    if (repoAddress) {
      return hasRepoNotification($notifications, {
        relay: url,
        repoAddress,
        repoAddresses: $repoAddressesStore,
        kind: "prs",
      })
    }
    return $notifications.has(prsPath)
  })

  const repoAddressStore: Readable<string> = derived(activeRepoClass, $repo => {
    if ($repo?.address) return $repo.address
    if (repoPubkey && repoName) return `30617:${repoPubkey}:${repoName}`
    return ""
  })

  const repoOwnerStore: Readable<string[]> = derived(activeRepoClass, $repo => {
    const owner = ($repo?.repoEvent as RepoAnnouncementEvent | undefined)?.pubkey || repoPubkey
    return owner ? [owner] : []
  }) as Readable<string[]>
  const repoAddressesStore: Readable<string[]> = derived(repoAddressStore, $repoAddress =>
    $repoAddress ? [$repoAddress] : [],
  ) as Readable<string[]>

  const repoCloneUrlsStore: Readable<string[]> = derived(activeRepoClass, $repo =>
    Array.from(new Set(($repo?.cloneUrls || []).filter(Boolean))),
  ) as Readable<string[]>

  $effect(() => {
    if (!repoClass) return
    repoClass.setCloneUrls($repoCloneUrlsStore || [])
  })

  const repoAddress = $derived.by(() => $repoAddressStore)

  const normalizeChecked = (value: number) =>
    value > 10_000_000_000 ? Math.round(value / 1000) : value
  const deleteSeenKey = $derived.by(() => (repoAddress ? `repoDeleteSeen:${repoAddress}` : ""))
  const lastDeleteSeen = $derived.by(() =>
    deleteSeenKey ? normalizeChecked($checked[deleteSeenKey] || 0) : 0,
  )

  const watchOptions = $derived.by(() =>
    repoAddress ? $userRepoWatchValues.repos[repoAddress] : undefined,
  )
  const isWatching = $derived(Boolean(watchOptions))

  const openWatchModal = () => {
    if (!repoAddress) return
    pushModal(RepoWatchModal, {
      repoAddr: repoAddress,
      repoName: repoClass?.name || repoName,
    })
  }

  const isOwnedRepo = $derived.by(() => !!$pubkey && repoPubkey === $pubkey)

  let myRepoStateEvents = $state<RepoStateEvent[]>([])
  let optimisticRepoStates = $state<Record<string, RepoStateEvent>>({})
  let pendingBranchUpdates = $state<RepoBranchUpdate[]>([])
  let branchUpdateCheckDone = $state(false)
  let branchUpdateChecking = $state(false)
  let updateStateActionChecking = $state(false)
  let repoStateSettled = $state(false)
  let repoStateLoadKey = $state("")
  let repoStateSettleTimer: ReturnType<typeof setTimeout> | null = null
  let stateUpdateWorkerApi: any = null

  const ensureStateUpdateWorkerApi = async () => {
    if (stateUpdateWorkerApi) return stateUpdateWorkerApi
    const {api} = await getInitializedGitWorker()
    stateUpdateWorkerApi = api
    return stateUpdateWorkerApi
  }

  const isDeletedRepoAnnouncement = (event?: {tags?: string[][]} | null) =>
    (event?.tags || []).some(tag => tag[0] === "deleted")

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

  const isNotFoundError = (error: unknown) => {
    const anyError = error as {
      status?: number
      code?: number
      data?: {status?: number}
      message?: string
    }
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
    const workerApi = await ensureStateUpdateWorkerApi()
    const candidates = buildCloneCandidates(cloneUrl)
    let lastError: unknown = null
    let sawNotFound = false
    for (const candidate of candidates) {
      try {
        const result = await workerApi.listServerRefs({url: candidate, symrefs: true})
        if (Array.isArray(result)) {
          return result as ServerRef[]
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          sawNotFound = true
          continue
        }
        lastError = error
      }
    }
    if (lastError) throw lastError
    if (sawNotFound) return []
    return []
  }

  const myReposEvents = $derived.by(() => {
    if (!isOwnedRepo || !$pubkey) return undefined
    const filter = {kinds: [GIT_REPO_ANNOUNCEMENT], authors: [$pubkey]} as Filter
    return derived(deriveEventsDesc(deriveEventsById({repository, filters: [filter]})), events =>
      getVisibleRepositoryEvents(events as RepoAnnouncementEvent[]),
    )
  })

  const latestMyRepos = $derived.by(() => {
    if (!isOwnedRepo || !$myReposEvents || !$pubkey) return []
    const repoIds = new Set<string>()
    for (const repo of $myReposEvents as RepoAnnouncementEvent[]) {
      const parsedRepoId = getTagValue("d", repo.tags) || ""
      if (parsedRepoId) repoIds.add(parsedRepoId)
    }

    const latest: RepoAnnouncementEvent[] = []
    for (const myRepoId of repoIds) {
      const address = `${GIT_REPO_ANNOUNCEMENT}:${$pubkey}:${myRepoId}`
      const event = repository.getEvent(address) as RepoAnnouncementEvent | undefined
      if (!event) continue
      if (isDeletedRepoAnnouncement(event)) continue
      latest.push(event)
    }

    return latest
  })

  const myRepoIds = $derived.by(() => {
    if (!isOwnedRepo || latestMyRepos.length === 0) return []
    const ids = new Set<string>()
    for (const repo of latestMyRepos) {
      try {
        const parsed = parseRepoAnnouncementEvent(repo)
        if (parsed.repoId) ids.add(parsed.repoId)
      } catch {
        const fallbackRepoId = getTagValue("d", repo.tags) || ""
        if (fallbackRepoId) ids.add(fallbackRepoId)
      }
    }
    return Array.from(ids)
  })

  const myRepoRelays = $derived.by(() => {
    if (!isOwnedRepo || latestMyRepos.length === 0) return []
    const relays = new Set<string>()
    for (const repo of latestMyRepos) {
      try {
        const parsed = parseRepoAnnouncementEvent(repo)
        for (const relay of parsed.relays || []) {
          const normalized = safeNormalizeRelayUrl(relay)
          if (normalized) relays.add(normalized)
        }
      } catch {
        // pass
      }
    }
    return Array.from(relays)
  })

  const branchStateRelays = $derived.by(() => {
    if (!isOwnedRepo) return []
    const relays = new Set<string>()
    for (const relay of [...myRepoRelays, ...GIT_RELAYS]) {
      const normalized = safeNormalizeRelayUrl(relay)
      if (normalized) relays.add(normalized)
    }
    return Array.from(relays)
  })

  $effect(() => {
    if (!isOwnedRepo || !$pubkey || myRepoIds.length === 0) {
      myRepoStateEvents = []
      optimisticRepoStates = {}
      return
    }
    const filter = {kinds: [GIT_REPO_STATE], authors: [$pubkey], "#d": myRepoIds} as Filter
    const store = deriveEventsDesc(deriveEventsById({repository, filters: [filter]}))
    const unsubscribe = store.subscribe(events => {
      myRepoStateEvents = getVisibleRepositoryEvents(events as RepoStateEvent[])
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
    if (!isOwnedRepo || !$pubkey) return
    if (myRepoIds.length === 0) {
      repoStateSettled = false
      return
    }
    const ids = [...myRepoIds].sort()
    const relayKey = [...branchStateRelays].sort().join(",")
    const key = `${$pubkey}:${ids.join(",")}:${relayKey}`
    if (repoStateLoadKey === key) return
    repoStateLoadKey = key
    repoStateSettled = false
    if (repoStateSettleTimer) {
      clearTimeout(repoStateSettleTimer)
      repoStateSettleTimer = null
    }
    repoStateSettleTimer = setTimeout(() => {
      repoStateSettled = true
      repoStateSettleTimer = null
    }, 2500)
    const filter = {kinds: [GIT_REPO_STATE], authors: [$pubkey], "#d": ids} as Filter
    load({relays: branchStateRelays, filters: [filter]}).catch(() => {})
  })

  const buildRepoBranchUpdate = async (repoEvent: RepoAnnouncementEvent) => {
    let parsed
    try {
      parsed = parseRepoAnnouncementEvent(repoEvent)
    } catch {
      return null
    }

    const currentRepoId = parsed.repoId
    if (!currentRepoId) return null

    const repoLabel = parsed.name || currentRepoId
    const validCloneUrls = filterValidCloneUrls(parsed.clone || [])
    const orderedCloneUrls = reorderUrlsByPreference(validCloneUrls, currentRepoId)
    const cloneUrl = orderedCloneUrls[0]
    if (!cloneUrl) return null

    const relays = parsed.relays || []
    const latestState = latestMyRepoStates.get(currentRepoId)
    if (latestState && !hasRepoStateRefs(latestState)) return null

    let refs: ServerRef[] = []
    try {
      refs = await listServerRefsWithFallback(cloneUrl)
    } catch {
      return null
    }

    const {heads, headBranch} = parseRemoteHeads(refs)
    if (heads.size === 0) return null

    const currentHeads = getRepoStateHeads(latestState)
    const changes = diffBranchHeads(currentHeads, heads)
    if (changes.length === 0) return null

    const refsForEvent = Array.from(heads.entries()).map(([ref, commit]) => ({
      type: "heads" as const,
      name: ref.replace("refs/heads/", ""),
      commit,
    }))

    return {
      repoId: currentRepoId,
      repoName: repoLabel,
      cloneUrl,
      relays,
      headBranch,
      updates: changes,
      refs: refsForEvent,
    } satisfies RepoBranchUpdate
  }

  const checkRepoBranchUpdates = async () => {
    if (!isOwnedRepo || !$pubkey) return
    if (branchUpdateChecking) return
    if (latestMyRepos.length === 0) return

    branchUpdateChecking = true
    try {
      const updates: RepoBranchUpdate[] = []
      for (const repoEvent of latestMyRepos) {
        const update = await buildRepoBranchUpdate(repoEvent)
        if (update) updates.push(update)
      }
      pendingBranchUpdates = updates
    } finally {
      branchUpdateChecking = false
    }
  }

  const checkCurrentRepoBranchUpdate = async (): Promise<boolean> => {
    if (!isOwnedRepo || !$pubkey) return false

    const repoEvent = $repoEventStore as RepoAnnouncementEvent | undefined
    if (!repoEvent) return false

    const update = await buildRepoBranchUpdate(repoEvent)
    const next = pendingBranchUpdates.filter(
      item => item.repoId !== repoName && item.repoId !== repoId,
    )
    if (update) {
      next.push(update)
    }
    pendingBranchUpdates = next
    return Boolean(update)
  }

  const openBranchSyncModal = (preferredRepoId?: string) => {
    if (!pendingBranchUpdates.length) return
    pushModal(BranchStateSyncModal, {
      repos: pendingBranchUpdates,
      preferredRepoId,
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
            const baseRelays =
              repo.relays && repo.relays.length > 0 ? repo.relays : getRepoAnnouncementRelays()
            if (!baseRelays || baseRelays.length === 0) {
              throw new Error(`No relays configured for ${repo.repoName || repo.repoId}`)
            }
            const targetRelays = Array.from(new Set([...baseRelays, ...GIT_RELAYS]))
              .map(safeNormalizeRelayUrl)
              .filter(Boolean) as string[]
            const stateEvent = createRepoStateEvent({
              repoId: repo.repoId,
              head: repo.headBranch,
              refs: repo.refs,
            })
            const thunk = publishThunk({event: stateEvent, relays: targetRelays})
            if (thunk?.complete) {
              await thunk.complete
            }
            if (thunk.event) {
              const published = thunk.event as RepoStateEvent
              optimisticRepoStates = {
                ...optimisticRepoStates,
                [repo.repoId]: published,
              }
              myRepoStateEvents = [
                published,
                ...myRepoStateEvents.filter(event => event.id !== published.id),
              ]
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

  const refreshBranchUpdatesAndOpen = async () => {
    if (!isOwnedRepo) return

    if (hasCurrentRepoBranchUpdate) {
      openBranchSyncModal(repoName)
      return
    }

    updateStateActionChecking = true
    let foundUpdate = false
    try {
      foundUpdate = await checkCurrentRepoBranchUpdate()
    } finally {
      updateStateActionChecking = false
    }

    if (!foundUpdate) {
      pushToast({message: "No repository state updates found."})
    }
  }

  const hasCurrentRepoBranchUpdate = $derived.by(() =>
    pendingBranchUpdates.some(update => update.repoId === repoName || update.repoId === repoId),
  )

  const isOverviewPage = $derived.by(() => {
    const pathname = $page.url.pathname.replace(/\/+$/, "")
    const repoPath = basePath.replace(/\/+$/, "")
    return pathname === repoPath
  })

  let wasOnOverview = $state(false)

  $effect(() => {
    if (!isOwnedRepo) {
      wasOnOverview = false
      return
    }

    const onOverview = isOverviewPage
    const shouldCheckCurrentRepo = onOverview && !wasOnOverview
    wasOnOverview = onOverview

    if (!shouldCheckCurrentRepo) return
    void checkCurrentRepoBranchUpdate()
  })

  $effect(() => {
    const key = `${repoPubkey}:${repoName}:${$pubkey || ""}`
    if (!key) return
    branchUpdateCheckDone = false
    pendingBranchUpdates = []
    repoStateLoadKey = ""
    repoStateSettled = false
    if (repoStateSettleTimer) {
      clearTimeout(repoStateSettleTimer)
      repoStateSettleTimer = null
    }
  })

  $effect(() => {
    if (!isOwnedRepo) return
    if (!repoStateSettled) return
    if (branchUpdateCheckDone || branchUpdateChecking) return
    void (async () => {
      try {
        await checkRepoBranchUpdates()
      } finally {
        branchUpdateCheckDone = true
      }
    })()
  })

  const normalizePath = (value: string | null | undefined) =>
    (value ?? "").replace(/^\/+/, "").replace(/\/+$/, "")

  const dirFromPath = (value: string) => value.split("/").slice(0, -1).join("/")

  const codeFileParam = $derived.by(() => normalizePath($page.url.searchParams.get("path")))
  const codeDirParam = $derived.by(() => normalizePath($page.url.searchParams.get("dir")))
  const codeCurrentDir = $derived.by(() =>
    codeFileParam ? dirFromPath(codeFileParam) : codeDirParam,
  )
  const codeBreadcrumbPath = $derived.by(() => codeFileParam || codeDirParam)
  const codeBreadcrumbSegments = $derived.by(() =>
    codeBreadcrumbPath ? codeBreadcrumbPath.split("/") : [],
  )
  const codeCanGoUp = $derived.by(() => codeCurrentDir.length > 0)
  const codeParentPath = $derived.by(() => (codeCurrentDir ? dirFromPath(codeCurrentDir) : ""))

  const setCodeDirectory = (dir: string) => {
    const normalized = normalizePath(dir)
    const next = new URL($page.url)
    if (normalized) next.searchParams.set("dir", normalized)
    else next.searchParams.delete("dir")
    next.searchParams.delete("path")
    const nextUrl = `${next.pathname}${next.search}${next.hash}`
    const currentUrl = `${$page.url.pathname}${$page.url.search}${$page.url.hash}`
    if (nextUrl !== currentUrl) {
      goto(nextUrl, {replaceState: true, keepFocus: true, noScroll: true})
    }
  }

  const syncMobileStickyHeights = () => {
    const root = pageContentElement as HTMLElement | undefined
    if (!root) {
      repoTabsHeight = 0
      mobileCodeBreadcrumbHeight = 0
      return {tabsEl: null as HTMLElement | null, breadcrumbEl: null as HTMLElement | null}
    }

    const tabsEl = root.querySelector("[data-repo-tabs]") as HTMLElement | null
    const breadcrumbEl = root.querySelector("[data-mobile-code-breadcrumb]") as HTMLElement | null

    repoTabsHeight = tabsEl?.offsetHeight || 0
    mobileCodeBreadcrumbHeight = activeTab === "code" ? breadcrumbEl?.offsetHeight || 0 : 0

    return {tabsEl, breadcrumbEl}
  }

  const alignMobileCodeStack = () => {
    const root = pageContentElement as HTMLElement | undefined
    if (!root || root.clientWidth >= 768) return

    const tabsEl = root.querySelector("[data-repo-tabs]") as HTMLElement | null
    if (!tabsEl) return

    const rootRect = root.getBoundingClientRect()
    const tabsRect = tabsEl.getBoundingClientRect()
    const delta = tabsRect.top - rootRect.top

    if (Math.abs(delta) <= 1) return

    root.scrollTo({top: root.scrollTop + delta, behavior: "auto"})
  }

  $effect(() => {
    void activeTab
    void codeBreadcrumbPath
    void repoHeaderKey

    const root = pageContentElement
    if (!root) {
      repoTabsHeight = 0
      mobileCodeBreadcrumbHeight = 0
      return
    }

    if (typeof ResizeObserver === "undefined") {
      syncMobileStickyHeights()
      return
    }

    let observer: ResizeObserver | null = null
    let cancelled = false

    void tick().then(() => {
      if (cancelled) return

      const {tabsEl, breadcrumbEl} = syncMobileStickyHeights()

      observer = new ResizeObserver(() => {
        syncMobileStickyHeights()
      })

      if (tabsEl) observer.observe(tabsEl)
      if (breadcrumbEl) observer.observe(breadcrumbEl)
    })

    return () => {
      cancelled = true
      observer?.disconnect()
    }
  })

  $effect(() => {
    void activeTab
    void codeBreadcrumbPath
    void repoHeaderKey

    const root = pageContentElement as HTMLElement | undefined
    if (!root || activeTab !== "code") return

    let cancelled = false

    void tick().then(() => {
      if (!cancelled) {
        alignMobileCodeStack()
      }
    })

    return () => {
      cancelled = true
    }
  })

  function deriveRepoEvent(repoPubkey: string, repoName: string) {
    return derived(
      deriveEventsAsc(
        deriveEventsById({
          repository,
          filters: [
            {
              authors: [repoPubkey],
              kinds: [GIT_REPO_ANNOUNCEMENT],
              "#d": [repoName],
            },
          ],
        }),
      ),
      (events: TrustedEvent[]) => {
        const visibleEvents = getVisibleRepositoryEvents(events)

        return (visibleEvents.length > 0 ? visibleEvents[visibleEvents.length - 1] : undefined) as
          | RepoAnnouncementEvent
          | undefined
      },
    ) as Readable<RepoAnnouncementEvent | undefined>
  }

  function deriveRepoStateEvents(repoName: string, owners: Readable<string[]>) {
    return readable<RepoStateEvent[]>([], set => {
      let previousKey = ""
      let unsubscribeScoped: (() => void) | undefined

      const unsubscribeOwners = owners.subscribe(($owners: string[]) => {
        const authors = normalizeScopeValues($owners)
        const key = authors.join("|")

        if (key === previousKey) return
        previousKey = key

        if (unsubscribeScoped) {
          unsubscribeScoped()
          unsubscribeScoped = undefined
        }

        if (authors.length === 0) {
          set([])
          return
        }

        const scopedEvents = throttled(
          SCOPED_DERIVE_THROTTLE_MS,
          deriveEventsAsc(
            deriveEventsById({
              repository,
              filters: [
                {
                  authors,
                  kinds: [GIT_REPO_STATE],
                  "#d": [repoName],
                },
              ],
            }),
          ),
        )

        unsubscribeScoped = scopedEvents.subscribe(events => {
          set(getVisibleRepositoryEvents((events as RepoStateEvent[]) || []).slice())
        })
      })

      return () => {
        if (unsubscribeScoped) unsubscribeScoped()
        unsubscribeOwners()
      }
    }) as Readable<RepoStateEvent[]>
  }

  function deriveRepoRelays(
    repoEvent: Readable<RepoAnnouncementEvent | undefined>,
    naddrRelays: string[],
  ) {
    return derived(repoEvent, (re: RepoAnnouncementEvent | undefined) => {
      return getRepoScopedRelays(re, naddrRelays)
    })
  }

  function deriveIssues(repoAddresses: Readable<string[]>) {
    const scopedIssueEvents = deriveAddressScopedEvents(repoAddresses, [GIT_ISSUE])

    return derived(
      [scopedIssueEvents, repoAddresses],
      ([events, addresses]: [TrustedEvent[], string[]]) => {
        return (events || []) as IssueEvent[]
      },
    ) as Readable<IssueEvent[]>
  }

  function derivePullRequests(repoAddresses: Readable<string[]>) {
    const scopedPullRequestEvents = deriveAddressScopedEvents(repoAddresses, [GIT_PULL_REQUEST])

    return derived(
      [scopedPullRequestEvents, repoAddresses],
      ([events, addresses]: [TrustedEvent[], string[]]) => {
        return (events || []) as PullRequestEvent[]
      },
    ) as Readable<PullRequestEvent[]>
  }

  function deriveStatusEvents(repoAddresses: Readable<string[]>) {
    const scopedStatusEvents = deriveAddressScopedEvents(repoAddresses, [
      GIT_STATUS_OPEN,
      GIT_STATUS_DRAFT,
      GIT_STATUS_CLOSED,
      GIT_STATUS_COMPLETE,
    ])

    return derived(
      [scopedStatusEvents, repoAddresses],
      ([events, addresses]: [TrustedEvent[], string[]]) => {
        return (events || []) as StatusEvent[]
      },
    ) as Readable<StatusEvent[]>
  }

  function deriveRootScopedEvents<T extends TrustedEvent>(rootIds: Readable<string[]>, kinds: number[]) {
    return readable<T[]>([], set => {
      let previousKey = ""
      let unsubscribeScoped: (() => void) | undefined

      const unsubscribeRootIds = rootIds.subscribe((ids: string[]) => {
        const normalized = normalizeScopeValues(ids)
        const key = normalized.join("|")

        if (key === previousKey) return
        previousKey = key

        if (unsubscribeScoped) {
          unsubscribeScoped()
          unsubscribeScoped = undefined
        }

        if (normalized.length === 0) {
          set([])
          return
        }

        const filters: Filter[] = chunkBySize(normalized, COMMENT_DERIVE_FILTER_CHUNK_SIZE).map(
          ids => ({kinds, "#e": ids}),
        )
        const scopedEvents = throttled(
          SCOPED_DERIVE_THROTTLE_MS,
          deriveEventsAsc(deriveEventsById({repository, filters})),
        )
        unsubscribeScoped = scopedEvents.subscribe(events => {
          set(getVisibleRepositoryEvents(events as T[]))
        })
      })

      return () => {
        if (unsubscribeScoped) unsubscribeScoped()
        unsubscribeRootIds()
      }
    })
  }

  function deriveRootScopedStatusEvents(rootIds: Readable<string[]>) {
    return deriveRootScopedEvents<StatusEvent>(rootIds, [
      GIT_STATUS_OPEN,
      GIT_STATUS_DRAFT,
      GIT_STATUS_CLOSED,
      GIT_STATUS_COMPLETE,
    ])
  }

  function deriveStatusEventsByRoot(statusEvents: Readable<StatusEvent[]>) {
    return derived(statusEvents, (events: StatusEvent[]) => {
      const map = new Map<string, StatusEvent[]>()
      for (const event of events) {
        const rootTag = (event.tags || []).find(
          (tag: string[]) => tag[0] === "e" && tag[1] && tag[3] === "root",
        )
        const rootId = rootTag?.[1] || getTagValue("e", event.tags)
        if (rootId) {
          if (!map.has(rootId)) {
            map.set(rootId, [])
          }
          map.get(rootId)!.push(event)
        }
      }
      return map
    }) as Readable<Map<string, StatusEvent[]>>
  }

  function deriveRootScopedReportEvents(rootIds: Readable<string[]>) {
    return deriveRootScopedEvents<TrustedEvent>(rootIds, [REPORT])
  }

  const isRelayHint = (value: string | undefined) => /^wss?:\/\//i.test(value?.trim() || "")

  const getReportReason = (tag: string[]) => {
    const markerReason = tag[3]?.trim()
    if (markerReason) return markerReason.toLowerCase()
    const maybeReason = tag[2]?.trim()
    return maybeReason && !isRelayHint(maybeReason) ? maybeReason.toLowerCase() : ""
  }

  const getOwnerSpamReportRootId = (event: TrustedEvent, repoOwner: string) => {
    if (event.kind !== REPORT || !repoOwner || event.pubkey !== repoOwner) return ""

    const targetTag = (event.tags || []).find(
      (tag: string[]) => tag[0] === "e" && tag[1] && getReportReason(tag) === "spam",
    )

    return targetTag?.[1] || ""
  }

  function deriveHiddenRootIds(
    reportEvents: Readable<TrustedEvent[]>,
    repoOwner: Readable<string[]>,
  ) {
    return derived([reportEvents, repoOwner], ([$reports, $owners]) => {
      const owner = $owners[0] || repoPubkey
      const hidden = new Set<string>()
      for (const report of $reports || []) {
        const rootId = getOwnerSpamReportRootId(report, owner)
        if (rootId) hidden.add(rootId)
      }
      return hidden
    }) as Readable<Set<string>>
  }

  function deriveResolvedStatusByRoot(
    issues: Readable<IssueEvent[]>,
    pullRequests: Readable<PullRequestEvent[]>,
    statusEventsByRoot: Readable<Map<string, StatusEvent[]>>,
    repoEvent: Readable<RepoAnnouncementEvent | undefined>,
  ) {
    return derived(
      [issues, pullRequests, statusEventsByRoot, repoEvent],
      ([$issues, $pullRequests, $statusEventsByRoot, $repoEvent]) => {
        const map = new Map<string, ResolvedRootStatus>()
        const repoOwner = $repoEvent?.pubkey || repoPubkey
        const maintainers = new Set(getRepoMaintainers($repoEvent || null))

        const resolveRoot = (root: IssueEvent | PullRequestEvent) => {
          const statusEvents = $statusEventsByRoot.get(root.id) || []
          const {final} = resolveStatus({
            statuses: statusEvents as any,
            rootAuthor: root.pubkey,
            maintainers,
            repoOwner,
            importedRoot: isImportedEvent(root as any),
          })
          const state = (() => {
            switch (final?.kind) {
              case GIT_STATUS_DRAFT:
                return "draft"
              case GIT_STATUS_CLOSED:
                return "closed"
              case GIT_STATUS_COMPLETE:
                return root.kind === GIT_ISSUE ? "resolved" : "merged"
              case GIT_STATUS_OPEN:
              default:
                return "open"
            }
          })()
          map.set(root.id, {state, event: final as StatusEvent | undefined})
        }

        for (const issue of $issues || []) resolveRoot(issue)
        for (const pullRequest of $pullRequests || []) resolveRoot(pullRequest)
        return map
      },
    ) as Readable<Map<string, ResolvedRootStatus>>
  }

  function deriveAllRootIds(
    issues: Readable<IssueEvent[]>,
    pullRequests: Readable<PullRequestEvent[]>,
  ) {
    return derived(
      [issues, pullRequests],
      ([issueEvents, prEvents]: [IssueEvent[], PullRequestEvent[]]) => {
        const ids: string[] = []
        if (issueEvents) ids.push(...issueEvents.map((issue: IssueEvent) => issue.id))
        if (prEvents) ids.push(...prEvents.map((pr: PullRequestEvent) => pr.id))
        return ids
      },
    )
  }

  const chunkBySize = (items: string[], size: number) => {
    const chunks: string[][] = []
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size))
    }
    return chunks
  }

  const isDeletedRepositoryEvent = (event: TrustedEvent | undefined) =>
    Boolean(event && (repository as any).isDeleted?.(event))

  const getVisibleRepositoryEvents = <T extends TrustedEvent>(events: T[] | undefined | null) =>
    (events || []).filter(event => !isDeletedRepositoryEvent(event)) as T[]

  const normalizeScopeValues = (values: string[]) =>
    [...new Set((values || []).filter(Boolean))].sort()

  function deriveAddressScopedEvents(repoAddresses: Readable<string[]>, kinds: number[]) {
    return readable<TrustedEvent[]>([], set => {
      let previousKey = ""
      let unsubscribeScoped: (() => void) | undefined

      const unsubscribeAddresses = repoAddresses.subscribe((addresses: string[]) => {
        const normalized = normalizeScopeValues(addresses)
        const key = normalized.join("|")

        if (key === previousKey) return
        previousKey = key

        if (unsubscribeScoped) {
          unsubscribeScoped()
          unsubscribeScoped = undefined
        }

        if (normalized.length === 0) {
          set([])
          return
        }

        const filters: Filter[] = chunkBySize(normalized, ADDRESS_DERIVE_FILTER_CHUNK_SIZE).map(
          addresses => ({
            kinds,
            "#a": addresses,
          }),
        )
        const scopedEvents = throttled(
          SCOPED_DERIVE_THROTTLE_MS,
          deriveEventsAsc(deriveEventsById({repository, filters})),
        )
        unsubscribeScoped = scopedEvents.subscribe(events => {
          set(getVisibleRepositoryEvents(events as TrustedEvent[]))
        })
      })

      return () => {
        if (unsubscribeScoped) unsubscribeScoped()
        unsubscribeAddresses()
      }
    })
  }

  function deriveCommentScopedEvents(allRootIds: Readable<string[]>) {
    return readable<TrustedEvent[]>([], set => {
      let previousKey = ""
      let unsubscribeScoped: (() => void) | undefined

      const unsubscribeRootIds = allRootIds.subscribe((rootIds: string[]) => {
        const normalized = normalizeScopeValues(rootIds)
        const key = normalized.join("|")

        if (key === previousKey) return
        previousKey = key

        if (unsubscribeScoped) {
          unsubscribeScoped()
          unsubscribeScoped = undefined
        }

        if (normalized.length === 0) {
          set([])
          return
        }

        const rootIdChunks = chunkBySize(normalized, COMMENT_DERIVE_FILTER_CHUNK_SIZE)
        const filters: Filter[] = []
        for (const ids of rootIdChunks) {
          filters.push({
            kinds: [COMMENT],
            "#e": ids,
          })
          filters.push({
            kinds: [COMMENT],
            "#E": ids,
          })
        }

        const scopedEvents = throttled(
          SCOPED_DERIVE_THROTTLE_MS,
          deriveEventsAsc(deriveEventsById({repository, filters})),
        )
        unsubscribeScoped = scopedEvents.subscribe(events => {
          set(getVisibleRepositoryEvents(events as TrustedEvent[]))
        })
      })

      return () => {
        if (unsubscribeScoped) unsubscribeScoped()
        unsubscribeRootIds()
      }
    })
  }

  function deriveComments(allRootIds: Readable<string[]>) {
    const scopedCommentEvents = deriveCommentScopedEvents(allRootIds)

    return derived(
      [scopedCommentEvents, allRootIds],
      ([events, rootIds]: [TrustedEvent[], string[]]) => {
        return (events || []).filter(isCommentEvent) as CommentEvent[]
      },
    ) as Readable<CommentEvent[]>
  }

  // Create stores at top level (not inside effect to avoid infinite loops)
  const repoEventStore = deriveRepoEvent(repoPubkey, repoName)
  const repoStateEventsStore = deriveRepoStateEvents(repoName, repoOwnerStore)
  const repoStateEventStore: Readable<RepoStateEvent | undefined> = derived(
    repoStateEventsStore,
    $events => ($events.length > 0 ? $events[$events.length - 1] : undefined),
  )
  const repoHeaderKey = $derived.by(() => {
    const eventId = $repoEventStore?.id || "no-event"
    const stateId = $repoStateEventStore?.id || "no-state"
    const refsCount = repoClass?.refs?.length || 0
    const editable = repoClass?.editable ? "1" : "0"
    return `repo:${eventId}:${stateId}:${refsCount}:${editable}`
  })
  const rootRepoRelaysStore = deriveRepoRelays(repoEventStore, naddrRelays)
  const repoRelaysStore: Readable<string[]> = rootRepoRelaysStore
  const issuesStore = deriveIssues(repoAddressesStore)
  const pullRequestsStore = derivePullRequests(repoAddressesStore)
  const statusEventsStore = deriveStatusEvents(repoAddressesStore)
  const allRootIdsStore = deriveAllRootIds(issuesStore, pullRequestsStore)
  const rootStatusEventsStore = deriveRootScopedStatusEvents(allRootIdsStore)
  const mergedStatusEventsStore: Readable<StatusEvent[]> = derived(
    [statusEventsStore, rootStatusEventsStore],
    ([$addressScopedEvents, $rootScopedEvents]) => {
      const byId = new Map<string, StatusEvent>()

      for (const event of [...($addressScopedEvents || []), ...($rootScopedEvents || [])]) {
        const existing = byId.get(event.id)

        if (!existing || event.created_at > existing.created_at) {
          byId.set(event.id, event)
        }
      }

      return Array.from(byId.values()).sort(
        (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
      )
    },
  )
  const rootReportEventsStore = deriveRootScopedReportEvents(allRootIdsStore)
  const hiddenRootIdsStore = deriveHiddenRootIds(rootReportEventsStore, repoOwnerStore)
  const appliedStatusEventsStore: Readable<StatusEvent[]> = derived(
    mergedStatusEventsStore,
    $events => ($events || []).filter(event => event.kind === GIT_STATUS_COMPLETE) as StatusEvent[],
  )
  const communityAlignedScoresStore: Readable<Map<string, number>> = derived(
    [
      pullRequestsStore,
      appliedStatusEventsStore,
      activeCommunityDefinition,
      activeCommunityProfileListEvents,
      activeCommunityReportState,
      pubkey,
    ],
    ([
      $pullRequests,
      $appliedStatuses,
      $activeCommunityDefinition,
      $activeCommunityProfileListEvents,
      $activeCommunityReportState,
      $viewerPubkey,
    ]) => {
      const repoCommunityPubkey =
        (repoClass as any)?.community?.pubkey ||
        getTagValue("h", (repoClass as any)?.repoEvent?.tags || [])
      if (
        !$activeCommunityDefinition ||
        $activeCommunityDefinition.pubkey !== repoCommunityPubkey
      ) {
        return new Map<string, number>()
      }

      const candidatePubkeys = Array.from(
        new Set(
          [
            ...($pullRequests || []).map(event => event.pubkey),
            ...($appliedStatuses || []).map(event => event.pubkey),
          ].filter(Boolean),
        ),
      )
      if (candidatePubkeys.length === 0) return new Map<string, number>()

      const assessments = buildCommunityTrustAssessments({
        viewerPubkey: $viewerPubkey || "",
        candidatePubkeys,
        context: {
          scope: "repo",
          communityPubkey: repoCommunityPubkey,
          repoAddress: repoClass?.address || "",
        },
        definitions: [$activeCommunityDefinition],
        profileListEvents: $activeCommunityProfileListEvents || [],
        reportStates: $activeCommunityReportState
          ? new Map([[repoCommunityPubkey, $activeCommunityReportState]])
          : undefined,
      })

      return new Map(
        Array.from(assessments.entries())
          .filter(([, assessment]) => !assessment.suppressed && assessment.score > 0)
          .map(([actor, assessment]) => [actor, assessment.score]),
      )
    },
  )
  const statusEventsByRootStore = deriveStatusEventsByRoot(mergedStatusEventsStore)
  const resolvedStatusByRootStore = deriveResolvedStatusByRoot(
    issuesStore,
    pullRequestsStore,
    statusEventsByRootStore,
    repoEventStore,
  )
  const isItemOpen = (item: {id: string}) => {
    if ($hiddenRootIdsStore?.has(item.id)) return false
    return ($resolvedStatusByRootStore?.get(item.id)?.state || "open") === "open"
  }
  const issuesCount = $derived.by(() => (repoClass?.issues ?? []).filter(isItemOpen).length)
  const prsCount = $derived.by(() => ($pullRequestsStore ?? []).filter(isItemOpen).length)
  const commentEventsStore = deriveComments(allRootIdsStore)
  const repoFeedActivityStore: Readable<TrustedEvent[]> = derived(
    [issuesStore, pullRequestsStore, hiddenRootIdsStore],
    ([$issues, $pullRequests, $hiddenRootIds]) => {
      const deduped = new Map<string, TrustedEvent>()

      for (const event of [...($issues || []), ...($pullRequests || [])]) {
        if ($hiddenRootIds.has(event.id)) continue
        deduped.set(event.id, event)
      }

      return Array.from(deduped.values()).sort(
        (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
      )
    },
  )
  const repoTrustMetricsStore = createRepoTrustMetricsStore({
    repoAddresses: repoAddressesStore,
    pullRequests: pullRequestsStore,
    appliedStatuses: appliedStatusEventsStore,
    communityAlignedScores: communityAlignedScoresStore,
  })
  const forkBranchCopyFilter = $derived.by(() => {
    const status = $repoTrustMetricsStore?.status || "idle"

    const branchNames = Array.from(
      new Set(
        ($repoTrustMetricsStore?.maintainerTargetBranches || [])
          .map(branch => branch.trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b))

    return {
      branchNames,
      status,
      label: "Copy only maintainer branches",
      description:
        "For repositories with many branches, limit the fork to the default branch plus branches targeted by accepted merges from repo maintainers.",
      tooltip:
        "Maintainer branches are branches targeted by merged pull requests merged by repo maintainers. When none are found, Budabit includes all branches in the fork.",
      minBranchCount: FORK_BRANCH_FILTER_THRESHOLD,
    }
  })

  const DELETE_LOOKBACK_SECONDS = 60 * 60 * 24 * 30
  const DELETE_SINCE_BUFFER_SECONDS = 60
  const deleteKinds = [
    GIT_ISSUE,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
    GIT_LABEL,
    GIT_COVER_LETTER_KIND,
    GIT_STATUS_OPEN,
    GIT_STATUS_DRAFT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    COMMENT,
    REPORT,
  ]
  let deleteLoadKey = ""
  let latestDeleteSeen = 0

  const hydrateRepoDeleteEvents = async ({
    relays,
    since,
    signal,
  }: {
    relays: string[]
    since: number
    signal?: AbortSignal
  }) => {
    if (relays.length === 0) return []

    return await request({
      relays,
      autoClose: true,
      threshold: 0.5,
      signal,
      filters: [
        {
          kinds: [DELETE],
          "#k": deleteKinds.map(String),
          since,
        },
      ],
      onEvent: event => {
        if (!repository.getEvent(event.id)) {
          repository.publish(event as TrustedEvent)
        }
        if (event.created_at > latestDeleteSeen) {
          latestDeleteSeen = event.created_at
        }
      },
    }).catch(() => [])
  }

  $effect(() => {
    const relays = $repoRelaysStore || []
    if (relays.length === 0 || !repoAddress) return
    const since =
      lastDeleteSeen > 0
        ? Math.max(0, lastDeleteSeen - DELETE_SINCE_BUFFER_SECONDS)
        : Math.floor(Date.now() / 1000) - DELETE_LOOKBACK_SECONDS
    const key = `${relays.slice().sort().join("|")}::${since}`
    if (deleteLoadKey === key) return
    deleteLoadKey = key
    const controller = new AbortController()
    void hydrateRepoDeleteEvents({relays, since, signal: controller.signal})
    return () => controller.abort()
  })

  const emptyLabelEvents = derived([], () => [] as LabelEvent[])

  let repoLoadKey = ""
  let repoAnnouncementLoadKey = ""
  let repoAnnouncementSettled = $state(false)
  let repoAnnouncementSettleTimer: ReturnType<typeof setTimeout> | null = null
  let repoLoadRetryTimer: ReturnType<typeof setTimeout> | null = null

  $effect(() => {
    const eventId = $repoEventStore?.id || ""

    if (fallbackRelays.length === 0 || !eventId) {
      repoAnnouncementLoadKey = ""
      repoAnnouncementSettled = false
      if (repoAnnouncementSettleTimer) {
        clearTimeout(repoAnnouncementSettleTimer)
        repoAnnouncementSettleTimer = null
      }
      return
    }

    const key = `${repoPubkey}:${repoName}:${fallbackRelays.slice().sort().join(",")}:${eventId}`
    if (repoAnnouncementLoadKey === key) return

    repoAnnouncementLoadKey = key
    repoAnnouncementSettled = false

    if (repoAnnouncementSettleTimer) {
      clearTimeout(repoAnnouncementSettleTimer)
    }

    repoAnnouncementSettleTimer = setTimeout(() => {
      repoAnnouncementSettled = true
      repoAnnouncementSettleTimer = null
    }, 2500)
  })

  $effect(() => {
    const relays = $repoRelaysStore || []
    const announcementRelays = fallbackRelays
    if (relays.length === 0 || announcementRelays.length === 0) return
    const owners = $repoOwnerStore || []
    const ownerList = owners.length > 0 ? owners : [repoPubkey]
    const key = `${ownerList.slice().sort().join(",")}::${relays.slice().sort().join(",")}`
    if (repoLoadKey === key) return
    repoLoadKey = key
    load({
      relays: announcementRelays,
      filters: [
        {
          authors: [repoPubkey],
          kinds: [GIT_REPO_ANNOUNCEMENT],
          "#d": [repoName],
        },
      ],
    }).catch(() => {})
    load({
      relays,
      filters: [
        {
          authors: ownerList,
          kinds: [GIT_REPO_STATE],
          "#d": [repoName],
        },
      ],
    }).catch(() => {})
    if (!repoLoadRetryTimer) {
      repoLoadRetryTimer = setTimeout(() => {
        repoLoadRetryTimer = null
        const currentRepoEvent = getStore(repoEventStore)
        const currentRepoStateEvent = getStore(repoStateEventStore)
        if (currentRepoEvent && currentRepoStateEvent) return
        const announcementRelaysRetry = getRepoAnnouncementRelays(naddrRelays)
        const relaysRetry = getStore(repoRelaysStore)
        if (announcementRelaysRetry.length === 0 || relaysRetry.length === 0) return
        const ownersRetry = getStore(repoOwnerStore)
        const ownerListRetry = ownersRetry && ownersRetry.length > 0 ? ownersRetry : [repoPubkey]
        load({
          relays: announcementRelaysRetry,
          filters: [
            {
              authors: [repoPubkey],
              kinds: [GIT_REPO_ANNOUNCEMENT],
              "#d": [repoName],
            },
          ],
        }).catch(() => {})
        load({
          relays: relaysRetry,
          filters: [
            {
              authors: ownerListRetry,
              kinds: [GIT_REPO_STATE],
              "#d": [repoName],
            },
          ],
        }).catch(() => {})
      }, 2500)
    }
  })

  // Convert pubkey store to the type expected by Repo (Readable<string | null>)
  const viewerPubkeyStore: Readable<string | null> = derived(pubkey, $p => $p ?? null)

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

  // Get user profile for git author info
  const userProfileStore = $pubkey ? deriveProfile($pubkey) : null
  const userProfile = userProfileStore ? getStore(userProfileStore) : null
  const authorName = getAuthorName(userProfile)
  const authorEmail = getAuthorEmail(userProfile, $pubkey)

  // Get or create Repo instance (reuse existing instance if available)
  // This ensures branch selection and other state persists across navigations
  // The store-based cache persists across component re-initializations
  // Create a shared WorkerManager to avoid duplicate workers
  // This is created once and reused across all Repo instances
  const sharedWorkerManager = new WorkerManager(
    undefined, // progress callback - will be set by Repo instances
    {workerUrl: gitWorkerUrl},
  )

  if (!$activeRepoClass) {
    $activeRepoClass = new Repo({
      repoEvent: repoEventStore as Readable<RepoAnnouncementEvent>,
      repoStateEvent: repoStateEventStore as Readable<RepoStateEvent>,
      issues: issuesStore,
      repoStateEvents: repoStateEventsStore,
      statusEvents: mergedStatusEventsStore,
      commentEvents: commentEventsStore,
      labelEvents: emptyLabelEvents as unknown as Readable<LabelEvent[]>,
      viewerPubkey: viewerPubkeyStore,
      workerManager: sharedWorkerManager,
      authorName,
      authorEmail,
    })
  } else {
    // Check if the existing repoInstance is for a different repository
    // Compare repoPubkey:repoName to determine if it's a different repoInstance
    const existingRepo = $activeRepoClass

    const expectedAddress = `${GIT_REPO_ANNOUNCEMENT}:${repoPubkey}:${repoName}`
    const isDifferentRepo = existingRepo.address !== expectedAddress
    if (isDifferentRepo) {
      existingRepo.dispose()
      $activeRepoClass = new Repo({
        repoEvent: repoEventStore as Readable<RepoAnnouncementEvent>,
        repoStateEvent: repoStateEventStore as Readable<RepoStateEvent>,
        issues: issuesStore,
        repoStateEvents: repoStateEventsStore,
        statusEvents: mergedStatusEventsStore,
        commentEvents: commentEventsStore,
        labelEvents: emptyLabelEvents as unknown as Readable<LabelEvent[]>,
        viewerPubkey: viewerPubkeyStore,
        workerManager: sharedWorkerManager,
        authorName,
        authorEmail,
      })
    }
    // Repo instance reused when navigating within same repo
  }

  // Set context for child components (only once, not in effect)
  setContext(REPO_KEY, $activeRepoClass)
  setContext(REPO_RELAYS_KEY, repoRelaysStore)
  setContext(REPO_CLONE_URLS_KEY, repoCloneUrlsStore)
  setContext(STATUS_EVENTS_BY_ROOT_KEY, statusEventsByRootStore)
  setContext(RESOLVED_STATUS_BY_ROOT_KEY, resolvedStatusByRootStore)
  setContext(HIDDEN_ROOT_IDS_KEY, hiddenRootIdsStore)
  setContext(PULL_REQUESTS_KEY, pullRequestsStore)
  setContext(COMMENT_EVENTS_KEY, commentEventsStore)
  setContext(REPO_FEED_ACTIVITY_KEY, repoFeedActivityStore)
  setContext(REPO_TRUST_METRICS_KEY, repoTrustMetricsStore)
  setContext(REPO_ACTIONS_KEY, {
    refreshRepo: () => refreshRepo(),
    forkRepo: () => forkRepo(),
    bookmarkRepo: () => bookmarkRepo(),
    openWatchModal: () => openWatchModal(),
    openRemoteFixModal: () => openRemoteFixModal(),
    get isRefreshing() {
      return isRefreshing
    },
    get isBookmarked() {
      return isBookmarked
    },
    get isTogglingBookmark() {
      return isTogglingBookmark
    },
    get isWatching() {
      return isWatching
    },
  })
  setContext(REPO_SETTINGS_ACTIONS_KEY, {
    publishRepoEvent: async (event: RepoAnnouncementEvent | RepoStateEvent) => {
      if (!$pubkey || repoPubkey !== $pubkey) {
        throw new Error("Only the owner can edit this repo announcement")
      }

      const repoRelays = getStore(repoRelaysStore)
      const relaysForPublish = repoRelays.length > 0 ? repoRelays : GIT_RELAYS
      if (relaysForPublish.length === 0) {
        throw new Error("Repository relays not ready. Please wait...")
      }

      const thunk = await publishRepoEventWithRelayPolicy(event, relaysForPublish)

      if (thunk?.event && !repository.getEvent(thunk.event.id)) {
        repository.publish(thunk.event as TrustedEvent)
      }

      if (event.kind === GIT_REPO_STATE && thunk?.event) {
        const published = thunk.event as RepoStateEvent
        optimisticRepoStates = {
          ...optimisticRepoStates,
          [repoName]: published,
        }
      }
    },
    onSaveComplete: async ({
      renamed,
      nextName,
      relays,
    }: {
      renamed: boolean
      nextName: string
      relays: string[]
    }) => {
      if (!renamed) {
        await refreshRepo()
        return
      }
      await navigateToRenamedRepo(nextName, relays)
    },
    openDeleteRepoModal: () => openDeleteRepoModal(),
    getProfile: (pubkey: string) => getRepoProfile(pubkey),
    searchProfiles: (query: string) => searchRepoProfiles(query),
    searchRelays: (query: string) => searchRepoRelays(query),
    get canEditAnnouncement() {
      return !!$pubkey && repoPubkey === $pubkey
    },
    get canDelete() {
      return !!$pubkey && repoPubkey === $pubkey
    },
  })

  // Initialize tracking for data loading
  let unsubscribers: (() => void)[] = []
  let requestedCommentRootIds = new Set<string>()
  let pendingCommentRootIds = new Set<string>()
  let commentLoadRelaysKey = ""
  let commentLoadFlushTimer: ReturnType<typeof setTimeout> | null = null
  let requestedPrStatusRootIds = new Set<string>()
  let pendingPrStatusRootIds = new Set<string>()
  let prStatusRootLoadRelaysKey = ""
  let prStatusRootLoadFlushTimer: ReturnType<typeof setTimeout> | null = null
  let loadedRepoAddresses = new Set<string>()
  let pendingRepoAddresses = new Set<string>()
  let repoAddressLoadRelaysKey = ""
  let repoAddressLoadFlushTimer: ReturnType<typeof setTimeout> | null = null
  let dataLoadInitialized = $state(false)
  let repoLiveSubscriptionKey = ""
  let repoLiveSubscriptionController: AbortController | null = null
  let viewerScopedLoadKey = ""

  const stopRepoLiveSubscription = () => {
    repoLiveSubscriptionController?.abort()
    repoLiveSubscriptionController = null
    repoLiveSubscriptionKey = ""
  }

  const buildRepoLiveFilters = ({
    addresses,
    rootIds,
    viewer,
  }: {
    addresses: string[]
    rootIds: string[]
    viewer: string
  }) => {
    const filters: Filter[] = []

    for (const addressChunk of chunkBySize(addresses, ADDRESS_DERIVE_FILTER_CHUNK_SIZE)) {
      filters.push({
        kinds: [GIT_ISSUE, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE, ...repoStatusKinds],
        "#a": addressChunk,
        limit: 0,
      })
    }

    for (const rootChunk of chunkBySize(rootIds, REPO_LIVE_FILTER_CHUNK_SIZE)) {
      filters.push(
        {kinds: [COMMENT], "#E": rootChunk, limit: 0},
        {kinds: [COMMENT], "#e": rootChunk, limit: 0},
        {kinds: [GIT_LABEL, GIT_COVER_LETTER_KIND], "#e": rootChunk, limit: 0},
        {kinds: repoStatusKinds, "#e": rootChunk, limit: 0},
        {kinds: [REPORT], "#e": rootChunk, limit: 0},
      )
    }

    if (viewer) {
      filters.push({
        kinds: [GIT_ISSUE, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE],
        "#p": [viewer],
        limit: 0,
      })
    }

    return filters
  }

  // Use effect only for data loading, not for store/context creation
  // Only run once when component mounts, not on every navigation
  $effect(() => {
    // Prevent re-running on navigation - only initialize once
    if (dataLoadInitialized) return

    // Mark as initialized immediately to prevent re-runs
    dataLoadInitialized = true

    // Load initial data
    const repoFilters = [
      {
        authors: [repoPubkey],
        kinds: [GIT_REPO_ANNOUNCEMENT],
        "#d": [repoName],
      },
      {
        authors: [repoPubkey],
        kinds: [GIT_REPO_STATE],
        "#d": [repoName],
      },
    ]

    const relayListFromUrl = getStore(repoRelaysStore)
    const announcementRelays = getRepoAnnouncementRelays(naddrRelays)
    const repoLoadPromise = load({relays: announcementRelays, filters: repoFilters})

    const allReposFilter = {
      kinds: [GIT_REPO_ANNOUNCEMENT],
      "#d": [repoName],
    }

    const initialAddresses = getStore(repoAddressesStore)
    const addressFilter =
      initialAddresses.length > 0
        ? initialAddresses
        : [`${GIT_REPO_ANNOUNCEMENT}:${repoPubkey}:${repoName}`]

    const sortedRelayListFromUrl = [...(relayListFromUrl || []).filter(Boolean)].sort()
    const sortedAnnouncementRelays = [...(announcementRelays || []).filter(Boolean)].sort()
    const initialLoadKey = [
      repoId,
      repoPubkey,
      repoName,
      sortedAnnouncementRelays.join(","),
      sortedRelayListFromUrl.join(","),
    ].join("::")

    let initialLoadsPromise = repoInitialLoads.get(initialLoadKey)

    if (!initialLoadsPromise) {
      const issuePrStatusLoad = load({
        relays: relayListFromUrl,
        filters: [
          {
            kinds: [GIT_ISSUE],
            "#a": addressFilter,
          },
          {
            kinds: [GIT_PULL_REQUEST],
            "#a": addressFilter,
          },
          {
            kinds: [GIT_PULL_REQUEST_UPDATE],
            "#a": addressFilter,
          },
          {
            kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
            "#a": addressFilter,
          },
          ...($pubkey
            ? [
                {
                  kinds: [GIT_ISSUE, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE],
                  "#p": [$pubkey],
                },
              ]
            : []),
        ],
      })

      initialLoadsPromise = Promise.all([
        repoLoadPromise,
        load({
          relays: announcementRelays,
          filters: [allReposFilter],
        }),
        issuePrStatusLoad,
      ])
        .then(() => {})
        .catch(error => {
          repoInitialLoads.delete(initialLoadKey)
          throw error
        })

      repoInitialLoads.set(initialLoadKey, initialLoadsPromise)
    }

    loadedRepoAddresses = new Set(addressFilter.filter(Boolean))
    pendingRepoAddresses = new Set<string>()
    repoAddressLoadRelaysKey = sortedRelayListFromUrl.join("|")

    const flushPendingRepoAddressLoads = async (relays: string[], relaysKey: string) => {
      if (relaysKey !== repoAddressLoadRelaysKey) return

      while (pendingRepoAddresses.size > 0 && relaysKey === repoAddressLoadRelaysKey) {
        const addresses = Array.from(pendingRepoAddresses).slice(0, ADDRESS_LOAD_CHUNK_SIZE)

        if (addresses.length === 0) return

        for (const address of addresses) {
          pendingRepoAddresses.delete(address)
        }

        try {
          await load({
            relays,
            filters: [
              {
                kinds: [GIT_ISSUE],
                "#a": addresses,
              },
              {
                kinds: [GIT_PULL_REQUEST],
                "#a": addresses,
              },
              {
                kinds: [GIT_PULL_REQUEST_UPDATE],
                "#a": addresses,
              },
              {
                kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
                "#a": addresses,
              },
            ],
          })

          for (const address of addresses) {
            loadedRepoAddresses.add(address)
          }
        } catch {
          for (const address of addresses) {
            pendingRepoAddresses.add(address)
          }
          break
        }
      }
    }

    const scheduleRepoAddressLoadFlush = (relays: string[], relaysKey: string) => {
      if (repoAddressLoadFlushTimer) return

      repoAddressLoadFlushTimer = setTimeout(() => {
        repoAddressLoadFlushTimer = null
        void flushPendingRepoAddressLoads(relays, relaysKey)
      }, ADDRESS_LOAD_DEBOUNCE_MS)
    }

    if (!initialLoadsPromise) {
      initialLoadsPromise = Promise.resolve()
    }

    initialLoadsPromise
      .then(() => {
        // Reactively load data when repo addresses change
        const repoAddressesUnsubscribe = repoAddressesStore.subscribe((addresses: string[]) => {
          if (addresses.length === 0) return

          const currentRelays = (getStore(repoRelaysStore) || []).filter(Boolean)
          if (currentRelays.length === 0) return

          const relaysKey = [...currentRelays].sort().join("|")
          if (repoAddressLoadRelaysKey !== relaysKey) {
            repoAddressLoadRelaysKey = relaysKey
            loadedRepoAddresses = new Set<string>()
            pendingRepoAddresses = new Set<string>()
            if (repoAddressLoadFlushTimer) {
              clearTimeout(repoAddressLoadFlushTimer)
              repoAddressLoadFlushTimer = null
            }
          }

          for (const address of new Set(addresses.filter(Boolean))) {
            if (!loadedRepoAddresses.has(address) && !pendingRepoAddresses.has(address)) {
              pendingRepoAddresses.add(address)
            }
          }

          if (pendingRepoAddresses.size > 0) {
            scheduleRepoAddressLoadFlush(currentRelays, relaysKey)
          }
        })
        unsubscribers.push(repoAddressesUnsubscribe)
      })
      .catch(() => {})

    const flushPendingPrStatusRootLoads = async (relays: string[], relaysKey: string) => {
      if (relaysKey !== prStatusRootLoadRelaysKey) return

      while (pendingPrStatusRootIds.size > 0 && relaysKey === prStatusRootLoadRelaysKey) {
        const rootIds = Array.from(pendingPrStatusRootIds).slice(0, PR_STATUS_ROOT_LOAD_CHUNK_SIZE)

        if (rootIds.length === 0) return

        for (const rootId of rootIds) {
          pendingPrStatusRootIds.delete(rootId)
        }

        try {
          await load({
            relays,
            filters: [
              {
                kinds: [
                  GIT_STATUS_OPEN,
                  GIT_STATUS_DRAFT,
                  GIT_STATUS_CLOSED,
                  GIT_STATUS_COMPLETE,
                  REPORT,
                ],
                "#e": rootIds,
              },
            ],
          })

          for (const rootId of rootIds) {
            requestedPrStatusRootIds.add(rootId)
          }
        } catch {
          for (const rootId of rootIds) {
            pendingPrStatusRootIds.add(rootId)
          }
          break
        }
      }
    }

    const schedulePrStatusRootLoadFlush = (relays: string[], relaysKey: string) => {
      if (prStatusRootLoadFlushTimer) return

      prStatusRootLoadFlushTimer = setTimeout(() => {
        prStatusRootLoadFlushTimer = null
        void flushPendingPrStatusRootLoads(relays, relaysKey)
      }, PR_STATUS_ROOT_LOAD_DEBOUNCE_MS)
    }

    const prStatusLoadTrigger = derived(allRootIdsStore, (rootIds: string[]) => {
      if (rootIds.length > 0) {
        const currentRelays = (getStore(repoRelaysStore) || []).filter(Boolean)
        if (currentRelays.length === 0) return rootIds

        const relaysKey = [...currentRelays].sort().join("|")

        if (prStatusRootLoadRelaysKey !== relaysKey) {
          prStatusRootLoadRelaysKey = relaysKey
          requestedPrStatusRootIds = new Set<string>()
          pendingPrStatusRootIds = new Set<string>()
          if (prStatusRootLoadFlushTimer) {
            clearTimeout(prStatusRootLoadFlushTimer)
            prStatusRootLoadFlushTimer = null
          }
        }

        for (const rootId of new Set(rootIds.filter(Boolean))) {
          if (!requestedPrStatusRootIds.has(rootId) && !pendingPrStatusRootIds.has(rootId)) {
            pendingPrStatusRootIds.add(rootId)
          }
        }

        if (pendingPrStatusRootIds.size > 0) {
          schedulePrStatusRootLoadFlush(currentRelays, relaysKey)
        }
      }

      return rootIds
    })

    const prStatusLoadTriggerUnsubscribe = prStatusLoadTrigger.subscribe(() => {
      // Trigger the load
    })
    unsubscribers.push(prStatusLoadTriggerUnsubscribe)

    const flushPendingCommentLoads = async (relays: string[], relaysKey: string) => {
      if (relaysKey !== commentLoadRelaysKey) return

      while (pendingCommentRootIds.size > 0 && relaysKey === commentLoadRelaysKey) {
        const rootIds = Array.from(pendingCommentRootIds).slice(0, COMMENT_LOAD_CHUNK_SIZE)
        if (rootIds.length === 0) return

        for (const rootId of rootIds) {
          pendingCommentRootIds.delete(rootId)
        }

        try {
          await load({
            relays,
            filters: [
              {
                kinds: [COMMENT],
                "#E": rootIds,
              },
              {
                kinds: [COMMENT],
                "#e": rootIds,
              },
            ],
          })

          for (const rootId of rootIds) {
            requestedCommentRootIds.add(rootId)
          }
        } catch {
          for (const rootId of rootIds) {
            pendingCommentRootIds.add(rootId)
          }
          break
        }
      }
    }

    const scheduleCommentLoadFlush = (relays: string[], relaysKey: string) => {
      if (commentLoadFlushTimer) return
      commentLoadFlushTimer = setTimeout(() => {
        commentLoadFlushTimer = null
        void flushPendingCommentLoads(relays, relaysKey)
      }, COMMENT_LOAD_DEBOUNCE_MS)
    }

    // Load comments reactively when root IDs are available
    const commentLoadTrigger = derived(allRootIdsStore, (rootIds: string[]) => {
      if (rootIds.length > 0) {
        const currentRelays = (getStore(repoRelaysStore) || []).filter(Boolean)
        if (currentRelays.length === 0) return rootIds

        const relaysKey = [...currentRelays].sort().join("|")

        if (commentLoadRelaysKey !== relaysKey) {
          commentLoadRelaysKey = relaysKey
          requestedCommentRootIds = new Set<string>()
          pendingCommentRootIds = new Set<string>()
          if (commentLoadFlushTimer) {
            clearTimeout(commentLoadFlushTimer)
            commentLoadFlushTimer = null
          }
        }

        for (const rootId of new Set(rootIds.filter(Boolean))) {
          if (!requestedCommentRootIds.has(rootId) && !pendingCommentRootIds.has(rootId)) {
            pendingCommentRootIds.add(rootId)
          }
        }

        if (pendingCommentRootIds.size > 0) {
          scheduleCommentLoadFlush(currentRelays, relaysKey)
        }
      }
      return rootIds
    })

    const commentLoadTriggerUnsubscribe = commentLoadTrigger.subscribe(() => {
      // Trigger the load
    })
    unsubscribers.push(commentLoadTriggerUnsubscribe)

    // No cleanup needed - subscriptions should persist across navigation
    // Only cleanup on component destroy (handled by onDestroy)
  })

  $effect(() => {
    const relays = normalizeScopeValues(($repoRelaysStore || []).filter(Boolean))
    const viewer = $pubkey || ""
    if (!viewer || relays.length === 0) {
      viewerScopedLoadKey = ""
      return
    }

    const key = `${viewer}::${relays.join("|")}`
    if (viewerScopedLoadKey === key) return
    viewerScopedLoadKey = key

    load({
      relays,
      filters: [
        {
          kinds: [GIT_ISSUE, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE],
          "#p": [viewer],
        },
      ],
    }).catch(() => {})
  })

  $effect(() => {
    const relays = normalizeScopeValues(($repoRelaysStore || []).filter(Boolean))
    const addresses = normalizeScopeValues(($repoAddressesStore || []).filter(Boolean))
    const rootIds = normalizeScopeValues(($allRootIdsStore || []).filter(Boolean))
    const viewer = $pubkey || ""
    const filters = buildRepoLiveFilters({addresses, rootIds, viewer})

    if (relays.length === 0 || filters.length === 0) {
      stopRepoLiveSubscription()
      return
    }

    const key = [relays.join("|"), addresses.join("|"), rootIds.join("|"), viewer].join("::")
    if (repoLiveSubscriptionKey === key) return

    repoLiveSubscriptionController?.abort()
    repoLiveSubscriptionKey = key
    const controller = new AbortController()
    repoLiveSubscriptionController = controller

    request({
      relays,
      signal: controller.signal,
      filters,
    }).catch(error => {
      if (!controller.signal.aborted) {
        console.warn("[repo-live] Failed to subscribe to repo activity", error)
      }
    })
  })

  // Cleanup on component destroy
  onDestroy(() => {
    if (deleteSeenKey) {
      setCheckedAt(deleteSeenKey, Math.max(lastDeleteSeen, latestDeleteSeen))
    }

    stopRepoLiveSubscription()
    unsubscribers.forEach(unsub => unsub())
    unsubscribers = []
    requestedPrStatusRootIds.clear()
    pendingPrStatusRootIds.clear()
    if (prStatusRootLoadFlushTimer) {
      clearTimeout(prStatusRootLoadFlushTimer)
      prStatusRootLoadFlushTimer = null
    }
    prStatusRootLoadRelaysKey = ""
    requestedCommentRootIds.clear()
    pendingCommentRootIds.clear()
    if (commentLoadFlushTimer) {
      clearTimeout(commentLoadFlushTimer)
      commentLoadFlushTimer = null
    }
    commentLoadRelaysKey = ""
    loadedRepoAddresses.clear()
    pendingRepoAddresses.clear()
    if (repoAddressLoadFlushTimer) {
      clearTimeout(repoAddressLoadFlushTimer)
      repoAddressLoadFlushTimer = null
    }
    repoAddressLoadRelaysKey = ""

    if (repoLoadRetryTimer) {
      clearTimeout(repoLoadRetryTimer)
      repoLoadRetryTimer = null
    }

    if (repoAnnouncementSettleTimer) {
      clearTimeout(repoAnnouncementSettleTimer)
      repoAnnouncementSettleTimer = null
    }

    if (repoStateSettleTimer) {
      clearTimeout(repoStateSettleTimer)
      repoStateSettleTimer = null
    }
  })

  // Refresh state
  let isRefreshing = $state(false)

  // Star state. Legacy bookmarks still populate the listing page, but this
  // button only reflects kind:7 repo stars.
  let isTogglingBookmark = $state(false)
  let isBookmarked = $state(false)
  let relaysWarningKey = $state("")
  let suppressRelaysWarning = $state(false)

  const getPrimaryBookmarkAddress = () => {
    if (repoAddress) return repoAddress
    if (repoClass?.address) return repoClass.address

    try {
      return repoClass?.repoEvent ? Address.fromEvent(repoClass.repoEvent).toString() : ""
    } catch {
      return ""
    }
  }

  const getBookmarkAddressCandidates = () =>
    getRepoBookmarkAddressSet({
      primaryAddress: getPrimaryBookmarkAddress(),
      relatedAddresses: getStore(repoAddressesStore),
    })

  const findActiveRepoStar = (): RepoStarRef | undefined => {
    if (!repoClass || !repoClass.repoEvent) return undefined

    const repoKey = getCanonicalRepoKeyFromEvent(repoClass.repoEvent as RepoAnnouncementEvent)
    const candidateAddresses = getBookmarkAddressCandidates()

    return $activeRepoStars.find(star =>
      isAnyBookmarked([repoStarToBookmarkAddress(star)], candidateAddresses, {
        candidateRepoKeys: repoKey ? [repoKey] : [],
        getCachedEvent: address =>
          repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      }),
    )
  }

  const syncBookmarkState = () => {
    try {
      isBookmarked = Boolean(findActiveRepoStar())
    } catch {
      isBookmarked = false
    }
  }

  // Keep star status in sync with kind:7 reactions and their delete events.
  $effect(() => {
    void $repoAddressesStore
    void $activeRepoStars

    if (!repoClass || !repoClass.repoEvent) {
      isBookmarked = false
      return
    }

    syncBookmarkState()

    const address = getPrimaryBookmarkAddress()
    hydrateRepoStars({relayHints: getStore(repoRelaysStore), repoAddress: address}).catch(error => {
      console.warn("[repo layout] Failed to hydrate repo stars", error)
    })
  })

  const getPublishThunkSucceeded = (thunk?: PublishThunkResult) => {
    if (!thunk) return false
    const results = Object.values(thunk.results || {})
    if (results.length === 0) return Boolean(thunk.event)
    return results.some(result => result?.status === PublishStatus.Success)
  }

  const awaitPublishThunks = async (
    thunks: Array<PublishThunkResult | undefined>,
    mode: "all" | "any" = "any",
  ) => {
    const publishThunks = thunks.filter(Boolean) as PublishThunkResult[]
    if (publishThunks.length === 0) return false

    await Promise.allSettled(publishThunks.map(thunk => thunk.complete || Promise.resolve()))

    const successes = publishThunks.map(getPublishThunkSucceeded)
    return mode === "all" ? successes.every(Boolean) : successes.some(Boolean)
  }

  const getRepoCollectionCommunityLabel = (community: RepoCommunityOption) =>
    community.label || getCommunityOptionLabel(community.pubkey)

  const publishPersonalRepoStar = ({
    event,
    address,
    relayHint,
    repoRelays,
    createdAt,
  }: {
    event: RepoAnnouncementEvent
    address: string
    relayHint: string
    repoRelays: string[]
    createdAt: number
  }) => {
    const relays = getRepoStarRelays([relayHint, ...repoRelays])
    const starEvent = {
      ...makeRepoStarReaction({event, address, relayHints: [relayHint]}),
      created_at: createdAt,
    }
    const thunk = publishThunk({event: starEvent, relays})
    if (thunk?.event) repository.publish(thunk.event as TrustedEvent)
    return thunk as PublishThunkResult | undefined
  }

  const publishCommunityRepoStar = ({
    event,
    address,
    relayHint,
    repoRelays,
    community,
    createdAt,
  }: {
    event: RepoAnnouncementEvent
    address: string
    relayHint: string
    repoRelays: string[]
    community: RepoCommunityOption
    createdAt: number
  }) => {
    const targetingId = randomId()
    const relays = getRepoStarRelays([
      relayHint,
      community.relay || "",
      ...(community.relays || []),
      ...repoRelays,
    ])
    const starEvent = withPublicationTargetingId(
      {...makeRepoStarReaction({event, address, relayHints: [relayHint]}), created_at: createdAt},
      targetingId,
    )
    const starThunk = publishThunk({event: starEvent, relays})
    if (starThunk?.event) repository.publish(starThunk.event as TrustedEvent)

    const targetingEvent = makeEvent(TARGETED_PUBLICATION_KIND, {
      ...makeTargetedPublicationForCommunity({
        targetingId,
        originalKind: REACTION,
        communityPubkey: community.pubkey,
        communityRelay: community.relay || community.relays?.[0],
      }),
      created_at: createdAt + 1,
    })
    const targetingThunk = publishThunk({event: targetingEvent, relays})
    if (targetingThunk?.event) repository.publish(targetingThunk.event as TrustedEvent)
    return [starThunk, targetingThunk] as Array<PublishThunkResult | undefined>
  }

  const openRepoCollectModal = ({
    event,
    address,
    relayHint,
    repoRelays,
  }: {
    event: RepoAnnouncementEvent
    address: string
    relayHint: string
    repoRelays: string[]
  }) => {
    const existingPersonalStar = findActiveRepoStar()

    pushModal(RepoCollectModal, {
      title: "Edit collections",
      submitLabel: "Update",
      submittingLabel: "editing collections...",
      communityOptions: repoCommunityOptions,
      allowEmpty: true,
      requireChanges: true,
      defaultPersonal: Boolean(existingPersonalStar),
      onCancel: clearModals,
      onCollect: async ({
        personal,
        communityPubkeys,
      }: {
        personal: boolean
        communityPubkeys: string[]
      }) => {
        if (isTogglingBookmark) return
        isTogglingBookmark = true

        try {
          const baseCreatedAt = Math.floor(Date.now() / 1000)
          const actions: Array<{
            thunks: Array<PublishThunkResult | undefined>
            mode: "all" | "any"
            failureMessage: string
          }> = []

          if (existingPersonalStar && !personal) {
            const relaysToPublish = getRepoStarRelays([
              relayHint,
              ...(existingPersonalStar.relayHints || []),
              ...repoRelays,
            ])
            const thunk = publishDelete({
              event: existingPersonalStar.reaction,
              relays: relaysToPublish,
              protect: false,
            })
            if (thunk?.event) repository.publish(thunk.event as TrustedEvent)
            actions.push({
              thunks: [thunk],
              mode: "any",
              failureMessage: "failed to remove personal star",
            })
          } else if (!existingPersonalStar && personal) {
            actions.push({
              thunks: [
                publishPersonalRepoStar({
                  event,
                  address,
                  relayHint,
                  repoRelays,
                  createdAt: baseCreatedAt,
                }),
              ],
              mode: "any",
              failureMessage: "failed to collect personally",
            })
          }

          for (const [index, communityPubkey] of communityPubkeys.entries()) {
            const community = repoCommunityOptions.find(option => option.pubkey === communityPubkey)
            if (!community) continue

            actions.push({
              thunks: publishCommunityRepoStar({
                event,
                address,
                relayHint,
                repoRelays,
                community,
                createdAt: baseCreatedAt + 2 + index * 2,
              }),
              mode: "all",
              failureMessage: `failed to collect into ${getRepoCollectionCommunityLabel(community)}`,
            })
          }

          const results = await Promise.all(
            actions.map(async action => ({
              action,
              succeeded: await awaitPublishThunks(action.thunks, action.mode),
            })),
          )
          const failures = results.filter(result => !result.succeeded)

          for (const failure of failures) {
            pushToast({message: failure.action.failureMessage, theme: "error"})
          }

          clearModals()
          if (actions.length > 0 && failures.length === 0) {
            pushToast({message: "Repository collections updated"})
          }
        } catch (error) {
          console.error("Failed to edit repository collections:", error)
          pushToast({
            message: `Failed to edit repository collections: ${error instanceof Error ? error.message : "Unknown error"}`,
            theme: "error",
          })
        } finally {
          isTogglingBookmark = false
        }
      },
    })
  }

  // --- GRASP servers (user profile) ---
  // Only query GRASP servers when a user is logged in to avoid relay auth errors
  const currentPubkey = pubkey.get()
  const graspServersFilter = currentPubkey
    ? {
        kinds: [GRASP_SET_KIND],
        authors: [currentPubkey],
        "#d": [DEFAULT_GRASP_SET_ID],
      }
    : null

  // Helper to compute base path for this repo scope
  function repoBasePath() {
    return `/git/${id}`
  }

  const issuesScrollStorageKey = `repoScroll:${id}:issues`

  beforeNavigate(({to}) => {
    if (!to || typeof sessionStorage === "undefined") return
    const nextPath = to.url.pathname
    if (!nextPath.startsWith(repoBasePath())) {
      sessionStorage.removeItem(issuesScrollStorageKey)
    }
  })

  let graspServerUrls = $state<string[]>([])

  // GRASP servers subscription - create derived store once, subscribe in effect
  // Skip entirely for guests (no pubkey) to avoid relay auth errors
  const graspServersEventStore = graspServersFilter
    ? derived(
        deriveEventsAsc(deriveEventsById({repository, filters: [graspServersFilter]})),
        (events: TrustedEvent[]) => {
          if (events.length === 0) {
            const relays = Router.get()
              .FromUser()
              .getUrls()
              .map(safeNormalizeRelayUrl)
              .filter(Boolean)
            load({relays: relays as string[], filters: [graspServersFilter]})
          }
          return events[0]
        },
      )
    : null

  // GRASP servers subscription - track for cleanup
  $effect(() => {
    if (!graspServersEventStore) return

    const graspServersUnsubscribe = graspServersEventStore.subscribe(
      (ev: TrustedEvent | undefined) => {
        try {
          graspServerUrls = ev ? (parseGraspServersEvent(ev as any) as string[]) : []
        } catch {
          graspServerUrls = []
        }
      },
    )

    return () => {
      graspServersUnsubscribe()
    }
  })

  // Refresh repository function
  async function refreshRepo() {
    if (!repoClass || isRefreshing) return

    isRefreshing = true

    try {
      // Get clone URLs from the repo event
      const cloneUrls =
        getStore(repoCloneUrlsStore).length > 0 ? getStore(repoCloneUrlsStore) : repoClass.cloneUrls
      if (cloneUrls.length === 0) {
        throw new Error("No clone URLs found for repository")
      }

      // Call syncWithRemote through the repo's worker manager
      const result = await repoClass.workerManager.smartInitializeRepo({
        repoId: repoClass.key,
        cloneUrls,
        forceUpdate: true,
        // timeoutMs: 2 * 60 * 1000, // 2 minutes
      })

      if (result.success) {
        if (result.usedUrl) {
          repoClass.recordCloneUrlSuccess(result.usedUrl)
        }
        const primaryCloneUrl = getStore(repoCloneUrlsStore)[0]
        const usedFallback = result.usedUrl && primaryCloneUrl && result.usedUrl !== primaryCloneUrl
        // Show success toast
        pushToast({
          message: usedFallback
            ? `Repository synced from fallback remote ${result.usedUrl}`
            : `Repository synced with remote (${result.headCommit?.slice(0, 8)})`,
          theme: usedFallback ? "warning" : undefined,
        })

        // Reset the repo to refresh all cached data
        await repoClass.reset()
      } else {
        throw new Error(result.error || "Sync failed")
      }
    } catch (error) {
      console.error("Failed to refresh repository:", error)
      notifyCorsProxyIssue(error)
      pushToast({
        message: `Failed to sync repository: ${error instanceof Error ? error.message : "Unknown error"}`,
        theme: "error",
      })
    } finally {
      isRefreshing = false
    }
  }

  function navigateToForkedRepo(result: ForkResult) {
    try {
      const parsed = parseRepoAnnouncementEvent(result.announcementEvent)

      const fallbackRelay = url

      const userOutboxRelays = (() => {
        try {
          return Router.get().FromUser().getUrls() || []
        } catch {
          return []
        }
      })()

      const policy = resolveRepoRelayPolicy({
        event: result.announcementEvent,
        fallbackRepoRelays: parsed.relays || [],
        userOutboxRelays,
        gitRelays: GIT_RELAYS,
      })

      const naddr = makeRepoNaddrFromEvent(result.announcementEvent, {
        fallbackPubkey: $pubkey || "",
        fallbackRelays: policy.repoRelays,
        userOutboxRelays,
        gitRelays: GIT_RELAYS,
      })

      if (!naddr) {
        console.warn("Cannot navigate: unable to build repo naddr")
        pushToast({message: "Fork completed, but repository address was invalid.", theme: "error"})
        return
      }

      const policyRelays = policy.naddrRelays

      const effectiveRelay =
        (fallbackRelay && isGitRelay(fallbackRelay) ? fallbackRelay : "") ||
        policyRelays.find(isGitRelay) ||
        GIT_RELAYS[0] ||
        ""

      if (!effectiveRelay) {
        console.warn("Cannot navigate: no platform relay available")
        pushToast({
          message: "Fork completed, but cannot navigate without a platform relay.",
          theme: "error",
        })
        return
      }

      // Encode relay URL for the route
      // Navigate to the forked repo page
      const targetPath = `/git/${naddr}`
      clearModals()
      void goto(targetPath).catch(error => {
        console.error("Failed to navigate to forked repo:", error)
        pushToast({
          message:
            "Fork completed, but navigation failed. Please manually navigate to the repository.",
          theme: "error",
        })
      })
    } catch (error) {
      console.error("Failed to navigate to forked repo:", error)
      pushToast({
        message:
          "Fork completed, but navigation failed. Please manually navigate to the repository.",
        theme: "error",
      })
    }
  }

  const getRepoRelaysForModal = () => getStore(repoRelaysStore) || repoClass?.relays || []

  const getRepoAnnouncementRelaysFromEvent = () => {
    if (!repoClass?.repoEvent) return []
    try {
      const parsed = parseRepoAnnouncementEvent(repoClass.repoEvent)
      return parsed.relays || []
    } catch {
      return []
    }
  }

  const getRepoProfile = async (pubkey: string) => {
    const profile = $profilesByPubkey.get(pubkey)
    if (profile) {
      return {
        name: profile.name,
        picture: profile.picture,
        nip05: profile.nip05,
        display_name: profile.display_name,
      }
    }
    const relays = getRepoRelaysForModal()
    await loadProfile(pubkey, relays)
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
  }

  const searchRepoProfiles = async (query: string) => {
    const pubkeys = $profileSearch.searchValues(query)
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
  }

  const searchRepoRelays = async (query: string) => $relaySearch.searchValues(query)

  async function navigateToRenamedRepo(nextName: string, relays: string[]) {
    if (!nextName || !repoPubkey) return

    const fallbackRelay = url

    const targetRelays = relays.length > 0 ? relays : getRepoRelaysForModal()
    const effectiveRelay =
      (fallbackRelay && isGitRelay(fallbackRelay) ? fallbackRelay : "") ||
      targetRelays.find(isGitRelay) ||
      GIT_RELAYS[0] ||
      ""

    if (!effectiveRelay) {
      pushToast({
        message: "Repository renamed, but no platform relay was available for navigation.",
        theme: "error",
      })
      return
    }

    const naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: repoPubkey,
      identifier: nextName,
      relays: targetRelays.length > 0 ? targetRelays : undefined,
    })

    const targetPath = makeGitPath(effectiveRelay, naddr)
    await goto(targetPath)
  }

  const getUserOutboxRelays = (): string[] => {
    try {
      return Router.get().FromUser().getUrls() || []
    } catch {
      return []
    }
  }

  function getEventRelayTargets(event: any): string[] {
    return getTaggedRelaysFromRepoEvent(event)
  }

  async function awaitPublishThunk(
    thunk: {complete?: Promise<unknown>} | undefined,
    {
      timeoutMs = 0,
      label = "Publish",
    }: {
      timeoutMs?: number
      label?: string
    } = {},
  ) {
    if (!thunk?.complete) return

    if (!timeoutMs || timeoutMs <= 0) {
      await thunk.complete
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        try {
          abortThunk(thunk as any)
        } catch {
          // pass
        }

        reject(new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)}s`))
      }, timeoutMs)
    })

    try {
      await Promise.race([thunk.complete, timeoutPromise])
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  async function publishRepoEventWithRelayPolicy(
    event: RepoAnnouncementEvent | RepoStateEvent,
    fallbackRelays: string[] = [],
    options: {
      timeoutMs?: number
      label?: string
    } = {},
  ) {
    const policy = resolveRepoRelayPolicy({
      event,
      fallbackRepoRelays: fallbackRelays,
      userOutboxRelays: getUserOutboxRelays(),
      gitRelays: GIT_RELAYS,
    })

    if (policy.isGrasp) {
      if (policy.repoRelays.length === 0) {
        throw new Error("GRASP repo event is missing explicit relay targets")
      }

      const thunk = publishThunk({event, relays: policy.publishRelays})
      await awaitPublishThunk(thunk, options)
      return thunk
    }

    const thunk =
      event.kind === GIT_REPO_STATE
        ? postRepoStateEvent(event as RepoStateEvent, policy.publishRelays)
        : postRepoAnnouncement(event as RepoAnnouncementEvent, policy.publishRelays)

    await awaitPublishThunk(thunk, options)

    return thunk
  }

  const extractPublishedRelayAck = (thunk: any) => {
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
      hasRelayOutcomes: ackedRelays.length + failedRelays.length > 0,
    }
  }

  const fetchRepoRelayEvents = async (params: {
    relays: string[]
    filters: NostrFilter[]
    timeoutMs?: number
  }): Promise<NostrEvent[]> =>
    fetchRelayEventsWithTimeout<NostrEvent>({
      relays: params.relays,
      filters: params.filters as any,
      timeoutMs: params.timeoutMs,
    })

  async function forkRepo() {
    if (!repoClass) return

    let workerApi: any = null
    let workerInstance: Worker | null = null
    try {
      const forkWorker = await ensureForkWorkerClient()
      workerApi = forkWorker.api
      workerInstance = forkWorker.worker
    } catch (error) {
      console.warn("[repo/+layout] Failed to initialize shared git worker for fork flow:", error)
    }

    const repoRelays = getRepoAnnouncementRelaysFromEvent()
    const defaultRelays = repoRelays.length > 0 ? repoRelays : GIT_RELAYS
    const sourceCloneUrls = getStore(repoCloneUrlsStore)
    const defaultMaintainers = (() => {
      try {
        if (!repoClass.repoEvent) return []
        return Array.from(
          new Set(parseRepoAnnouncementEvent(repoClass.repoEvent).maintainers || []),
        )
      } catch {
        return []
      }
    })()

    const rollbackPublishedRepoEvents = async (params: {
      repoName: string
      relays: string[]
    }): Promise<void> => {
      if (!$pubkey) return

      const rollbackRelays = Array.from(
        new Set(params.relays.map(safeNormalizeRelayUrl).filter(Boolean)),
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

    pushModal(ForkRepoDialog, {
      repo: repoClass,
      pubkey: $pubkey || "",
      branchCopyFilter: forkBranchCopyFilter,
      workerApi,
      workerInstance,
      onPublishEvent: async (event: any) => {
        const taggedRelays = getEventRelayTargets(event)
        const thunk = await publishRepoEventWithRelayPolicy(
          event,
          taggedRelays.length > 0 ? taggedRelays : defaultRelays,
          {
            timeoutMs: FORK_PUBLISH_TIMEOUT_MS,
            label:
              event.kind === GIT_REPO_STATE
                ? "Fork repo state publish"
                : "Fork repo announcement publish",
          },
        )
        return extractPublishedRelayAck(thunk)
      },
      onFetchRelayEvents: fetchRepoRelayEvents,
      onRollbackPublishedRepoEvents: rollbackPublishedRepoEvents,
      graspServerUrls: graspServerUrls,
      navigateToForkedRepo: navigateToForkedRepo,
      defaultRelays,
      sourceCloneUrls,
      defaultMaintainers,
      communityOptions: repoCommunityOptions,
      getProfile: getRepoProfile,
      searchProfiles: searchRepoProfiles,
      searchRelays: searchRepoRelays,
    })
  }

  function settingsRepo(replaceState = false) {
    if (!repoClass) return
    if (!$pubkey || repoPubkey !== $pubkey) {
      pushToast({
        message: "Only the owner can edit this repo announcement",
        theme: "error",
      })
      return
    }

    const repoRelays = getStore(repoRelaysStore)
    const relaysForPublish = repoRelays.length > 0 ? repoRelays : GIT_RELAYS
    if (relaysForPublish.length === 0) {
      pushToast({
        message: "Repository relays not ready. Please wait...",
        theme: "error",
      })
      return
    }

    pushModal(
      EditRepoPanel,
      {
        repo: repoClass,
        onPublishEvent: async (event: RepoAnnouncementEvent | RepoStateEvent) => {
          const thunk = await publishRepoEventWithRelayPolicy(event, relaysForPublish)

          if (thunk?.event && !repository.getEvent(thunk.event.id)) {
            repository.publish(thunk.event as TrustedEvent)
          }

          if (event.kind === GIT_REPO_STATE && thunk?.event) {
            const published = thunk.event as RepoStateEvent
            optimisticRepoStates = {
              ...optimisticRepoStates,
              [repoName]: published,
            }
          }
        },
        onSaveComplete: async ({
          renamed,
          nextName,
          relays,
        }: {
          renamed: boolean
          nextName: string
          relays: string[]
        }) => {
          if (!renamed) {
            await refreshRepo()
            return
          }
          await navigateToRenamedRepo(nextName, relays)
        },
        canDelete: !!$pubkey && repoPubkey === $pubkey,
        onRequestDelete: () => openDeleteRepoModal(),
        getProfile: getRepoProfile,
        searchProfiles: searchRepoProfiles,
        searchRelays: searchRepoRelays,
        communityOptions: repoCommunityOptions,
      },
      replaceState ? {replaceState: true} : {},
    )
  }

  async function syncRepoBranchStateFromRemote({
    remoteUrl,
    headBranch,
  }: {
    remoteUrl: string
    headBranch?: string
  }) {
    if (!repoClass) {
      throw new Error("Repository context is not ready")
    }

    if (!$pubkey || repoPubkey !== $pubkey) {
      throw new Error("Only the owner can publish repository state updates")
    }

    const workerApi = await ensureStateUpdateWorkerApi()
    const refs = (await workerApi.listServerRefs({url: remoteUrl, symrefs: true})) as ServerRef[]
    const {heads, headBranch: remoteHeadBranch} = parseRemoteHeads(refs)

    if (heads.size === 0) {
      throw new Error("The selected remote did not return any branch heads")
    }

    const refsForEvent = refs
      .filter(ref => {
        if (!ref?.ref || typeof ref.ref !== "string") return false
        if (!ref?.oid || typeof ref.oid !== "string") return false
        if (!(ref.ref.startsWith("refs/heads/") || ref.ref.startsWith("refs/tags/"))) return false
        if (ref.ref.startsWith("refs/tags/") && ref.ref.endsWith("^{}")) return false
        return true
      })
      .map(ref => ({
        type: ref.ref!.startsWith("refs/tags/") ? ("tags" as const) : ("heads" as const),
        name: ref.ref!.replace(/^refs\/(heads|tags)\//, ""),
        commit: ref.oid!,
      }))

    const preferredHead =
      headBranch && heads.has(`refs/heads/${headBranch}`) ? headBranch : undefined
    const currentMain =
      repoClass.mainBranch && heads.has(`refs/heads/${repoClass.mainBranch}`)
        ? repoClass.mainBranch
        : undefined
    const nextHead = preferredHead || remoteHeadBranch || currentMain || refsForEvent[0]?.name

    if (!nextHead) {
      throw new Error("Could not determine a default branch from the selected remote")
    }

    const baseRelays = getRepoAnnouncementRelaysFromEvent()
    const relaysForPublish = Array.from(
      new Set([...(baseRelays.length > 0 ? baseRelays : GIT_RELAYS), ...GIT_RELAYS]),
    )
      .map(safeNormalizeRelayUrl)
      .filter(Boolean) as string[]

    if (relaysForPublish.length === 0) {
      throw new Error("Repository relays are not ready")
    }

    const stateEvent = createRepoStateEvent({
      repoId: repoName,
      head: nextHead,
      refs: refsForEvent,
    })

    const thunk = await publishRepoEventWithRelayPolicy(stateEvent, relaysForPublish)

    if (thunk?.event && !repository.getEvent(thunk.event.id)) {
      repository.publish(thunk.event as TrustedEvent)
    }

    if (thunk?.event) {
      const published = thunk.event as RepoStateEvent
      optimisticRepoStates = {
        ...optimisticRepoStates,
        [repoName]: published,
      }
      myRepoStateEvents = [
        published,
        ...myRepoStateEvents.filter(event => event.id !== published.id),
      ]
    }

    pendingBranchUpdates = pendingBranchUpdates.filter(
      update => update.repoId !== repoName && update.repoId !== repoId,
    )

    await refreshRepo()
  }

  function openRemoteFixModal() {
    if (!repoClass) return
    pushModal(RemoteFixHelperModal, {
      repoClass,
      cloneUrls: getStore(repoCloneUrlsStore),
      onOpenSettings: () => settingsRepo(true),
      onRefresh: refreshRepo,
      onPublishEvent: async (event: any) => {
        const taggedRelays = getEventRelayTargets(event)
        const relaysForPublish = taggedRelays.length > 0 ? taggedRelays : getRepoRelaysForModal()
        const thunk = await publishRepoEventWithRelayPolicy(event, relaysForPublish, {
          timeoutMs: FORK_PUBLISH_TIMEOUT_MS,
          label:
            event.kind === GIT_REPO_STATE
              ? "Remote backfill state publish"
              : "Remote backfill publish",
        })
        return extractPublishedRelayAck(thunk)
      },
      onFetchRelayEvents: fetchRepoRelayEvents,
      onSyncBranchStateFromRemote:
        $pubkey && repoPubkey === $pubkey ? syncRepoBranchStateFromRemote : undefined,
    })
  }

  function openDeleteRepoModal() {
    if (!repoClass) return
    const repoEvent = getStore(repoEventStore)
    if (!repoEvent) {
      pushToast({
        message: "Repository event not available. Please try again.",
        theme: "error",
      })
      return
    }
    const relays = getRepoRelaysForModal()
    suppressRelaysWarning = true
    pushModal(DeleteRepoConfirm, {
      repoClass,
      repoEvent,
      repoName,
      repoRelays: relays,
      repoAddresses: $repoAddressesStore,
      backPath: `/git`,
      onClose: () => {
        suppressRelaysWarning = false
      },
    })
  }

  let relaysWarningDebounce: ReturnType<typeof setTimeout> | null = null
  let relaysWarningToastId: string | null = null

  $effect(() => {
    const clearWarningDebounce = () => {
      if (relaysWarningDebounce) {
        clearTimeout(relaysWarningDebounce)
        relaysWarningDebounce = null
      }
    }

    const dismissWarningToast = () => {
      if (relaysWarningToastId) {
        popToast(relaysWarningToastId)
        relaysWarningToastId = null
      }
    }

    clearWarningDebounce()

    if (!$pubkey || suppressRelaysWarning || !repoAnnouncementSettled || !repoClass?.repoEvent) {
      dismissWarningToast()
      return
    }

    let parsed
    try {
      parsed = parseRepoAnnouncementEvent(repoClass.repoEvent)
    } catch {
      dismissWarningToast()
      return
    }
    const relays = parsed.relays || []
    if (relays.length > 0) {
      dismissWarningToast()
      return
    }
    const key = repoClass.repoEvent.id
    if (relaysWarningKey === key) return

    relaysWarningDebounce = setTimeout(() => {
      relaysWarningKey = key
      relaysWarningToastId = pushToast({
        message:
          "This repository announcement has no relays defined. Add preferred relays so others can discover updates.",
        theme: "warning",
        timeout: 8000, // 8 seconds - visible but eventually dismisses
        action: {message: "Repo settings", onclick: () => settingsRepo()},
      })
      relaysWarningDebounce = null
    }, 100)

    return () => {
      clearWarningDebounce()
    }
  })

  async function bookmarkRepo() {
    if (!repoClass || !$pubkey || isTogglingBookmark) return

    isTogglingBookmark = true
    let wasRemoving = false

    try {
      if (!repoClass.repoEvent) {
        throw new Error("Repository event not available")
      }

      const repoRelays = getStore(repoRelaysStore) || repoClass?.relays || []

      // Get repo address
      const address = getPrimaryBookmarkAddress()
      if (!address) {
        throw new Error("Repository address not available")
      }
      // Determine relay hint
      const relayHint =
        repoRelays[0] || Router.get().getRelaysForPubkey(repoClass.repoEvent.pubkey)?.[0] || ""
      const normalizedRelayHint = relayHint ? safeNormalizeRelayUrl(relayHint) : ""
      const activeStar = findActiveRepoStar()
      wasRemoving = Boolean(activeStar)

      isTogglingBookmark = false
      openRepoCollectModal({
        event: repoClass.repoEvent as RepoAnnouncementEvent,
        address,
        relayHint: normalizedRelayHint,
        repoRelays,
      })
      return
    } catch (error) {
      console.error("Failed to toggle repository star:", error)
      const action = wasRemoving ? "remove" : "add"
      pushToast({
        message: `Failed to ${action} star: ${error instanceof Error ? error.message : "Unknown error"}`,
        theme: "error",
      })
    } finally {
      isTogglingBookmark = false
    }
  }

  function overviewRepo() {
    if (!repoClass) return
    goto(`${basePath}/`)
  }

  // Connect the nostr-git toast store to the toast component
  $effect(() => {
    // Subscribe to toast store explicitly for proper cleanup
    const unsubscribe = toast.subscribe(toasts => {
      if (toasts.length > 0) {
        toasts.forEach(t => {
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

    return () => {
      unsubscribe()
    }
  })

  const back = () => (activeTab === "code" ? overviewRepo() : history.back())
</script>

<svelte:head>
  <title>{repoClass?.name}</title>
</svelte:head>

<PageBar class="w-full pb-0">
  {#snippet icon()}
    <div>
      <Button class="btn btn-neutral btn-sm flex-nowrap whitespace-nowrap" onclick={back}>
        <Icon icon={AltArrowLeft} />
        <span class="hidden sm:inline">Go back</span>
      </Button>
    </div>
  {/snippet}
  {#snippet title()}
    <div
      class="scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1 text-sm font-semibold leading-none sm:text-base">
      {#if repoPubkey}
        <button
          type="button"
          class="whitespace-nowrap rounded-md px-1 py-0.5 transition-colors hover:bg-secondary/40"
          onclick={() => pushModal(ProfileDetail, {pubkey: repoPubkey})}
          title="View owner profile">
          <ProfileName pubkey={repoPubkey} />
        </button>
        <span class="text-muted-foreground">/</span>
      {/if}
      <button
        type="button"
        class="whitespace-nowrap rounded-md px-1 py-0.5 transition-colors hover:bg-secondary/40"
        onclick={overviewRepo}
        title={`Go to ${displayRepoName}`}
        aria-label={`Go to ${displayRepoName}`}
        data-testid="repo-topbar-home">
        {displayRepoName}
      </button>
      {#if repoClass?.community}
        <a
          href={makeCommunityPath(repoClass.community.pubkey)}
          class="ml-1 shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/15"
          title={`Community: ${repoCommunityLabel}`}>
          {repoCommunityLabel}
        </a>
      {/if}
    </div>
  {/snippet}
  {#snippet action()}
    <GitCommunityMenuButton />
  {/snippet}
</PageBar>

<PageContent
  bind:element={pageContentElement}
  style={`--repo-tabs-height: ${repoTabsHeight}px; --mobile-code-breadcrumb-height: ${mobileCodeBreadcrumbHeight}px;`}
  class="!top-[calc(var(--sait)+3.5rem)] flex min-w-0 flex-grow flex-col gap-2 overflow-y-auto overflow-x-hidden px-2 pb-4 pt-0 sm:px-3 sm:pb-6 sm:pt-0 lg:px-4 lg:pb-8 lg:pt-0">
  {#if repoClass === undefined}
    <div class="p-4 text-center">Loading repository...</div>
  {:else if !repoClass}
    <div class="p-4 text-center text-red-500">Repository not found.</div>
  {:else}
    {#key repoHeaderKey}
      <RepoHeader
        {repoClass}
        {activeTab}
        {refreshRepo}
        {isRefreshing}
        forkRepo={undefined}
        settingsRepo={$pubkey ? () => settingsRepo() : undefined}
        {overviewRepo}
        bookmarkRepo={undefined}
        isBookmarked={false}
        isTogglingBookmark={false}
        watchRepo={undefined}
        isWatching={false}
        canEditSettings={!!$pubkey && repoPubkey === $pubkey}
        updateRepoState={isOwnedRepo ? refreshBranchUpdatesAndOpen : undefined}
        hasRepoStateUpdate={hasCurrentRepoBranchUpdate}
        isCheckingRepoStateUpdate={updateStateActionChecking}
        resolveCloneUrlIssues={undefined}>
        {#snippet children(activeTab: string)}
          <RepoTab tabValue="overview" label="Overview" href={basePath} {activeTab}>
            {#snippet icon()}
              <Home class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          <RepoTab tabValue="feed" label="Activity" href={`${basePath}/feed`} {activeTab}>
            {#snippet icon()}
              <Activity class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          <RepoTab tabValue="code" label="Code" href={`${basePath}/code`} {activeTab}>
            {#snippet icon()}
              <GitBranch class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          <RepoTab
            tabValue="issues"
            label={issuesCount > 0 ? `Issues (${issuesCount})` : "Issues"}
            href={`${basePath}/issues`}
            notification={hasIssuesNotification}
            {activeTab}>
            {#snippet icon()}
              <CircleAlert class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          <RepoTab
            tabValue="prs"
            label={prsCount > 0 ? `PRs (${prsCount})` : "PRs"}
            href={`${basePath}/prs`}
            notification={hasPrsNotification}
            {activeTab}>
            {#snippet icon()}
              <GitPullRequest class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          <RepoTab tabValue="commits" label="Commits" href={`${basePath}/commits`} {activeTab}>
            {#snippet icon()}
              <GitCommit class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          {#if isOwnedRepo}
            <RepoTab tabValue="settings" label="Settings" href={`${basePath}/settings`} {activeTab}>
              {#snippet icon()}
                <SettingsIcon class="h-4 w-4" />
              {/snippet}
            </RepoTab>
          {/if}
          {#if $pubkey}
            {#each repoTabExtensions as ext (ext.id)}
              <RepoTab
                tabValue={ext.path}
                label={ext.label}
                href={`${basePath}/extensions/${ext.id}`}
                {activeTab}>
                {#snippet icon()}
                  <ExtensionIcon icon={ext.icon} size={16} class="h-4 w-4" />
                {/snippet}
              </RepoTab>
            {/each}
          {/if}
        {/snippet}
      </RepoHeader>
    {/key}
    {#if activeTab === "code"}
      <div
        data-mobile-code-breadcrumb
        data-testid="repo-mobile-code-breadcrumb"
        class="z-10 sticky -mt-1 rounded-md border border-border/60 bg-base-100/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-base-100/80 md:px-4 md:py-2.5 md:text-sm"
        style="top: var(--repo-tabs-height, 0px);">
        <div class="flex min-w-0 items-center gap-2">
          {#if codeCanGoUp}
            <button
              type="button"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
              onclick={() => setCodeDirectory(codeParentPath)}
              title="Up one folder">
              <ChevronLeft class="h-4 w-4" />
            </button>
          {/if}
          <nav
            class="scrollbar-hide flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto whitespace-nowrap"
            aria-label="Code breadcrumb">
            <button
              type="button"
              class="shrink-0 rounded-sm font-medium transition-colors hover:text-foreground hover:underline"
              onclick={() => setCodeDirectory("")}
              title="Repository root"
              aria-label="Repository root">
              /
            </button>
            {#each codeBreadcrumbSegments as segment, i}
              {#if i > 0}
                <span class="shrink-0 text-muted-foreground/50">/</span>
              {/if}
              {#if i === codeBreadcrumbSegments.length - 1}
                <span class="font-medium text-foreground" title={segment}>
                  {segment}
                </span>
              {:else}
                <button
                  type="button"
                  class="rounded-sm transition-colors hover:text-foreground hover:underline"
                  onclick={() =>
                    setCodeDirectory(codeBreadcrumbSegments.slice(0, i + 1).join("/"))}>
                  {segment}
                </button>
              {/if}
            {/each}
          </nav>
        </div>
      </div>
    {/if}
    {@render children()}
  {/if}
</PageContent>
