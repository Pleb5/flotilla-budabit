<script module lang="ts">
  const repoInitialLoads = new Map<string, Promise<void>>()
</script>

<script lang="ts">
  import {RepoHeader, RepoTab, toast, bookmarksStore, Repo, WorkerManager, ForkRepoDialog} from "@nostr-git/ui"
  // Import worker URL using Vite's ?url suffix for correct asset resolution
  // This must be done at the app level, not inside pre-built packages
  import gitWorkerUrl from "@nostr-git/core/worker/worker.js?url"
  import {
    FileCode,
    GitBranch,
    CircleAlert,
    GitPullRequest,
    GitCommit,
    ChevronLeft,
  } from "@lucide/svelte"
  import ExtensionIcon from "@app/components/ExtensionIcon.svelte"
  import {page} from "$app/stores"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import SpaceMenuButton from "@lib/budabit/components/SpaceMenuButton.svelte"
  import {pushToast} from "@src/app/util/toast"
  import {notifications, hasRepoNotification, checked, setCheckedAt} from "@app/util/notifications"
  import {notifyCorsProxyIssue} from "@app/util/git-cors-proxy"
  import {PLATFORM_RELAYS, decodeRelay, encodeRelay, isPlatformRelay} from "@app/core/state"
  import {pushModal, clearModals} from "@app/util/modal"
  import DeleteRepoConfirm from "@app/components/DeleteRepoConfirm.svelte"
  import BranchStateSyncModal from "@app/components/BranchStateSyncModal.svelte"
  import RemoteFixHelperModal from "@app/components/RemoteFixHelperModal.svelte"
  import {EditRepoPanel} from "@nostr-git/ui"
  import {postRepoAnnouncement, postRepoStateEvent} from "@lib/budabit/commands.js"
  import RepoWatchModal from "@lib/budabit/components/RepoWatchModal.svelte"
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
  import type {RepoAnnouncementEvent, RepoStateEvent, IssueEvent, PatchEvent, PullRequestEvent, StatusEvent, CommentEvent, LabelEvent} from "@nostr-git/core/events"
  import {GIT_REPO_BOOKMARK_DTAG, GRASP_SET_KIND, DEFAULT_GRASP_SET_ID, parseGraspServersEvent, GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE, GIT_LABEL, parseRepoAnnouncementEvent, isCommentEvent, createRepoStateEvent} from "@nostr-git/core/events"
  import {
    parseRepoId,
    filterValidCloneUrls,
    reorderUrlsByPreference,
    resolveRepoRelayPolicy,
    buildRepoNaddrFromEvent,
    getTaggedRelaysFromRepoEvent,
  } from "@nostr-git/core/utils"
  import {derived, get as getStore, readable, type Readable} from "svelte/store"
  import {repository, pubkey, profilesByPubkey, profileSearch, loadProfile, relaySearch, publishThunk, deriveProfile, abortThunk} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById, deriveEventsDesc, throttled} from "@welshman/store"
  import {load, request, PublishStatus} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {goto, beforeNavigate} from "$app/navigation"
  import {
    normalizeRelayUrl,
    NAMED_BOOKMARKS,
    makeEvent,
    Address,
    GIT_ISSUE,
    GIT_PATCH,
    DELETE,
    GIT_STATUS_OPEN,
    GIT_STATUS_DRAFT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    getTagValue,
    COMMENT,
    type Filter,
    type TrustedEvent
  } from "@welshman/util"
  import {publishDelete} from "@src/app/core/commands"
  import {setContext, onDestroy} from "svelte"
  import {
    REPO_KEY,
    REPO_RELAYS_KEY,
    STATUS_EVENTS_BY_ROOT_KEY,
    PULL_REQUESTS_KEY,
    activeRepoClass,
    GIT_RELAYS,
    getRepoAnnouncementRelays,
    getRepoScopedRelays,
    effectiveMaintainersByRepoAddress,
    effectiveRepoAddressesByRepoAddress,
    getEffectiveRepoAddresses,
    loadRepoMaintainerAnnouncements,
  } from "@lib/budabit/state"
  import {REPO_TRUST_METRICS_KEY, createRepoTrustMetricsStore} from "@lib/budabit/repo-trust-metrics"
  import {userRepoWatchValues} from "@lib/budabit/repo-watch"
  import {extensionSettings} from "@app/extensions/settings"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import {makeGitPath} from "@lib/budabit/routes"
  import {getInitializedGitWorker} from "@src/lib/budabit/worker-singleton"
  import {fetchRelayEventsWithTimeout} from "@lib/budabit/fetch-relay-events"
  import {diffBranchHeads, overlayLatestRepoStates, type BranchChange} from "@src/lib/budabit/branch-update"
  import {
    getCanonicalRepoKeyFromEvent,
    getRepoBookmarkAddressSet,
    isAnyBookmarked,
    toggleRepoBookmarks,
  } from "@src/lib/budabit/bookmarks"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  
  const {id, relay} = $page.params

  const {data, children} = $props()
  // Type assertion needed because TypeScript infers old layout return type
  const layoutData = data as unknown as {repoId: string, repoName: string, repoPubkey: string, fallbackRelays: string[], naddrRelays: string[], url: string}
  const {repoId, repoName, repoPubkey, fallbackRelays, naddrRelays, url} = layoutData


  const COMMENT_LOAD_DEBOUNCE_MS = 300
  const COMMENT_LOAD_CHUNK_SIZE = 100
  const PR_STATUS_ROOT_LOAD_DEBOUNCE_MS = 250
  const PR_STATUS_ROOT_LOAD_CHUNK_SIZE = 100
  const EFFECTIVE_ADDRESS_LOAD_DEBOUNCE_MS = 200
  const EFFECTIVE_ADDRESS_LOAD_CHUNK_SIZE = 50
  const FORK_PUBLISH_TIMEOUT_MS = 20000
  const FORK_BRANCH_FILTER_THRESHOLD = 20
  const ADDRESS_DERIVE_FILTER_CHUNK_SIZE = 50
  const COMMENT_DERIVE_FILTER_CHUNK_SIZE = 100
  const SCOPED_DERIVE_THROTTLE_MS = 120
  const GIT_COVER_LETTER_KIND = 1624

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

  // Derive repoClass from activeRepoClass store
  const repoClass = $derived($activeRepoClass)
  let forkWorkerClient: {api: any; worker: Worker} | null = null

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
    const extensionsMap = new Map<string, {id: string; label: string; path: string; icon?: string}>()
    
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
        if (icon && icon.includes('budabit.dev')) {
          icon = 'LayoutGrid' // Fallback for broken budabit.dev URLs
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

    if (pathname === repoPath) return undefined
    if (!pathname.startsWith(`${repoPath}/`)) return undefined

    const segments = pathname.slice(repoPath.length + 1).split("/").filter(Boolean)
    if (segments.length === 0) return undefined

    if (segments[0] === "extensions") {
      return segments[1] || "extensions"
    }

    return segments[0]
  })
  
  // Memoize encodedRelay - it only changes if relay param changes
  const encodedRelay = $derived(encodeURIComponent(relay ?? ""))
  
  // Memoize base path to avoid recalculating on every render
  const basePath = $derived(`/spaces/${encodedRelay}/git/${id}`)
  const issuesPath = $derived.by(() => `${basePath}/issues`)
  const patchesPath = $derived.by(() => `${basePath}/patches`)
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
  const hasPatchesNotification = $derived.by(() => {
    if (repoAddress) {
      return hasRepoNotification($notifications, {
        relay: url,
        repoAddress,
        repoAddresses: $repoAddressesStore,
        kind: "patches",
      })
    }
    return $notifications.has(patchesPath)
  })

  const repoAddressStore: Readable<string> = derived(activeRepoClass, $repo => {
    if ($repo?.address) return $repo.address
    if (repoPubkey && repoName) return `30617:${repoPubkey}:${repoName}`
    return ""
  })

  const repoMaintainersStore: Readable<string[]> = derived(
    [repoAddressStore, effectiveMaintainersByRepoAddress],
    ([$repoAddress, $byMaintainers]) => {
      if (!$repoAddress) return []
      const maintainers = $byMaintainers.get($repoAddress)
      if (maintainers && maintainers.size > 0) return Array.from(maintainers)
      return repoPubkey ? [repoPubkey] : []
    },
  ) as Readable<string[]>
  const repoAddressesStore: Readable<string[]> = derived(
    [repoAddressStore, effectiveRepoAddressesByRepoAddress],
    ([$repoAddress, $byAddresses]) => {
      if (!$repoAddress) return []
      return Array.from(getEffectiveRepoAddresses($byAddresses, $repoAddress))
    },
  ) as Readable<string[]>

  const repoAddress = $derived.by(() => $repoAddressStore)

  const normalizeChecked = (value: number) =>
    value > 10_000_000_000 ? Math.round(value / 1000) : value
  const deleteSeenKey = $derived.by(() => (repoAddress ? `repoDeleteSeen:${repoAddress}` : ""))
  const lastDeleteSeen = $derived.by(() =>
    deleteSeenKey ? normalizeChecked($checked[deleteSeenKey] || 0) : 0,
  )

  const watchOptions = $derived.by(() => (repoAddress ? $userRepoWatchValues.repos[repoAddress] : undefined))
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
          const normalized = normalizeRelayUrl(relay)
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
      const normalized = normalizeRelayUrl(relay)
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
    const next = pendingBranchUpdates.filter(item => item.repoId !== repoName && item.repoId !== repoId)
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
            const baseRelays = repo.relays && repo.relays.length > 0 ? repo.relays : getRepoAnnouncementRelays()
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
    codeFileParam ? dirFromPath(codeFileParam) : codeDirParam
  )
  const codeBreadcrumbPath = $derived.by(() => codeFileParam || codeDirParam)
  const codeBreadcrumbSegments = $derived.by(() =>
    codeBreadcrumbPath ? codeBreadcrumbPath.split("/") : []
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

  function deriveRepoStateEvents(
    repoName: string,
    repoPubkey: string,
    maintainers: Readable<string[]>,
  ) {
    return derived(maintainers, ($maintainers, set) => {
      const authors = Array.from(new Set([repoPubkey, ...$maintainers].filter(Boolean)))
      const store = deriveEventsAsc(
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
      )

      return store.subscribe(events => {
        set(getVisibleRepositoryEvents((events as RepoStateEvent[]) || []).slice())
      })
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

  function derivePatches(repoAddresses: Readable<string[]>) {
    const scopedPatchEvents = deriveAddressScopedEvents(repoAddresses, [GIT_PATCH])

    return derived(
      [scopedPatchEvents, repoAddresses],
      ([events, addresses]: [TrustedEvent[], string[]]) => {
        return (events || []) as PatchEvent[]
      },
    ) as Readable<PatchEvent[]>
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
    const scopedStatusEvents = deriveAddressScopedEvents(
      repoAddresses,
      [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
    )

    return derived(
      [scopedStatusEvents, repoAddresses],
      ([events, addresses]: [TrustedEvent[], string[]]) => {
        return (events || []) as StatusEvent[]
      },
    ) as Readable<StatusEvent[]>
  }

  function deriveRootScopedStatusEvents(rootIds: Readable<string[]>) {
    return readable<StatusEvent[]>([], set => {
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

        const filters: Filter[] = chunkBySize(normalized, COMMENT_DERIVE_FILTER_CHUNK_SIZE).map(ids => ({
          kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
          "#e": ids,
        }))
        const scopedEvents = throttled(
          SCOPED_DERIVE_THROTTLE_MS,
          deriveEventsAsc(deriveEventsById({repository, filters})),
        )
        unsubscribeScoped = scopedEvents.subscribe(events => {
          set(getVisibleRepositoryEvents(events as StatusEvent[]))
        })
      })

      return () => {
        if (unsubscribeScoped) unsubscribeScoped()
        unsubscribeRootIds()
      }
    })
  }

  function deriveStatusEventsByRoot(statusEvents: Readable<StatusEvent[]>) {
    return derived(
      statusEvents,
      (events: StatusEvent[]) => {
        const map = new Map<string, StatusEvent[]>()
        for (const event of events) {
          const rootId = getTagValue("e", event.tags)
          if (rootId) {
            if (!map.has(rootId)) {
              map.set(rootId, [])
            }
            map.get(rootId)!.push(event)
          }
        }
        return map
      }
    ) as Readable<Map<string, StatusEvent[]>>
  }

  function deriveAllRootIds(issues: Readable<IssueEvent[]>, patches: Readable<PatchEvent[]>, pullRequests: Readable<PullRequestEvent[]>) {
    return derived([issues, patches, pullRequests], ([issueEvents, patchEvents, prEvents]: [IssueEvent[], PatchEvent[], PullRequestEvent[]]) => {
      const ids: string[] = []
      if (issueEvents) ids.push(...issueEvents.map((issue: IssueEvent) => issue.id))
      if (patchEvents) ids.push(...patchEvents.map((patch: PatchEvent) => patch.id))
      if (prEvents) ids.push(...prEvents.map((pr: PullRequestEvent) => pr.id))
      return ids
    })
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
    ((events || []).filter(event => !isDeletedRepositoryEvent(event)) as T[])

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

        const filters: Filter[] = chunkBySize(normalized, ADDRESS_DERIVE_FILTER_CHUNK_SIZE).map(addresses => ({
          kinds,
          "#a": addresses,
        }))
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
  const repoStateEventsStore = deriveRepoStateEvents(repoName, repoPubkey, repoMaintainersStore)
  const repoStateEventStore: Readable<RepoStateEvent | undefined> = derived(
    repoStateEventsStore,
    $events => ($events.length > 0 ? $events[$events.length - 1] : undefined),
  )
  const maintainerAnnouncementLoads = new Set<string>()
  $effect(() => {
    const event = $repoEventStore
    if (event) {
      const key = `${repoPubkey}:${repoName}:${event.id}`
      if (!maintainerAnnouncementLoads.has(key)) {
        maintainerAnnouncementLoads.add(key)
        loadRepoMaintainerAnnouncements(event)
      }
    }
  })
  const repoHeaderKey = $derived.by(() => {
    const eventId = $repoEventStore?.id || "no-event"
    const stateId = $repoStateEventStore?.id || "no-state"
    const refsCount = repoClass?.refs?.length || 0
    const editable = repoClass?.editable ? "1" : "0"
    return `repo:${eventId}:${stateId}:${refsCount}:${editable}`
  })
  const repoRelaysStore = deriveRepoRelays(repoEventStore, naddrRelays)
  const issuesStore = deriveIssues(repoAddressesStore)
  const patchesStore = derivePatches(repoAddressesStore)
  const pullRequestsStore = derivePullRequests(repoAddressesStore)
  const statusEventsStore = deriveStatusEvents(repoAddressesStore)
  const pullRequestRootIdsStore: Readable<string[]> = derived(pullRequestsStore, $pullRequests =>
    [...new Set(($pullRequests || []).map(pullRequest => pullRequest.id).filter(Boolean))].sort(),
  )
  const rootStatusEventsStore = deriveRootScopedStatusEvents(pullRequestRootIdsStore)
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
  const appliedStatusEventsStore: Readable<StatusEvent[]> = derived(
    mergedStatusEventsStore,
    $events => ($events || []).filter(event => event.kind === GIT_STATUS_COMPLETE) as StatusEvent[],
  )
  const statusEventsByRootStore = deriveStatusEventsByRoot(mergedStatusEventsStore)
  const allRootIdsStore = deriveAllRootIds(issuesStore, patchesStore, pullRequestsStore)
  const commentEventsStore = deriveComments(allRootIdsStore)
  const repoTrustMetricsStore = createRepoTrustMetricsStore({
    repoAddresses: repoAddressesStore,
    pullRequests: pullRequestsStore,
    appliedStatuses: appliedStatusEventsStore,
  })
  const forkBranchCopyFilter = $derived.by(() => {
    const status = $repoTrustMetricsStore?.status || "idle"

    const branchNames = Array.from(
      new Set(
        ($repoTrustMetricsStore?.trustedTargetBranches || [])
          .map(branch => branch.trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b))

    return {
      branchNames,
      status,
      label: "Copy only branches with trusted maintainer merges",
      description:
        "For repositories with many branches, limit the fork to the default branch plus branches that have accepted merges from trusted maintainers in your active web of trust.",
      tooltip:
        "Trusted branches are branches targeted by merged pull requests whose applying maintainer is in your active web of trust. When none are found, Budabit includes all branches in the fork.",
      minBranchCount: FORK_BRANCH_FILTER_THRESHOLD,
    }
  })

  const DELETE_LOOKBACK_SECONDS = 60 * 60 * 24 * 30
  const DELETE_SINCE_BUFFER_SECONDS = 60
  const deleteKinds = [
    GIT_ISSUE,
    GIT_PATCH,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
    GIT_LABEL,
    GIT_COVER_LETTER_KIND,
    GIT_STATUS_OPEN,
    GIT_STATUS_DRAFT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    COMMENT,
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
  let repoLoadRetryTimer: ReturnType<typeof setTimeout> | null = null
  $effect(() => {
    const relays = $repoRelaysStore || []
    const announcementRelays = fallbackRelays
    if (relays.length === 0 || announcementRelays.length === 0) return
    const maintainers = $repoMaintainersStore || []
    const maintainerList = maintainers.length > 0 ? maintainers : [repoPubkey]
    const key = `${maintainerList.slice().sort().join(",")}::${relays.slice().sort().join(",")}`
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
          authors: maintainerList,
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
        const announcementRelaysRetry = getRepoAnnouncementRelays()
        const relaysRetry = getStore(repoRelaysStore)
        if (announcementRelaysRetry.length === 0 || relaysRetry.length === 0) return
        const maintainersRetry = getStore(repoMaintainersStore)
        const maintainerListRetry =
          maintainersRetry && maintainersRetry.length > 0 ? maintainersRetry : [repoPubkey]
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
              authors: maintainerListRetry,
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
    { workerUrl: gitWorkerUrl }
  )
  
  if (!$activeRepoClass) {
    $activeRepoClass = new Repo({
      repoEvent: repoEventStore as Readable<RepoAnnouncementEvent>,
      repoStateEvent: repoStateEventStore as Readable<RepoStateEvent>,
      issues: issuesStore,
      patches: patchesStore,
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
        patches: patchesStore,
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
  setContext(STATUS_EVENTS_BY_ROOT_KEY, statusEventsByRootStore)
  setContext(PULL_REQUESTS_KEY, pullRequestsStore)
  setContext(REPO_TRUST_METRICS_KEY, repoTrustMetricsStore)

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
  let loadedEffectiveAddresses = new Set<string>()
  let pendingEffectiveAddresses = new Set<string>()
  let effectiveAddressLoadRelaysKey = ""
  let effectiveAddressLoadFlushTimer: ReturnType<typeof setTimeout> | null = null
  let dataLoadInitialized = $state(false)
  
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
    const announcementRelays = getRepoAnnouncementRelays()
    const repoLoadPromise = load({relays: announcementRelays, filters: repoFilters})

    const allReposFilter = {
      kinds: [GIT_REPO_ANNOUNCEMENT],
      "#d": [repoName],
    }

    const initialAddresses = getStore(repoAddressesStore)
    const addressFilter = initialAddresses.length > 0
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
      const issuePatchPrStatusLoad = load({
        relays: relayListFromUrl,
        filters: [
          {
            kinds: [GIT_ISSUE],
            "#a": addressFilter,
          },
          {
            kinds: [GIT_PATCH],
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
        issuePatchPrStatusLoad,
      ])
        .then(() => {})
        .catch(error => {
          repoInitialLoads.delete(initialLoadKey)
          throw error
        })

      repoInitialLoads.set(initialLoadKey, initialLoadsPromise)
    }

    loadedEffectiveAddresses = new Set(addressFilter.filter(Boolean))
    pendingEffectiveAddresses = new Set<string>()
    effectiveAddressLoadRelaysKey = sortedRelayListFromUrl.join("|")

    const flushPendingEffectiveAddressLoads = async (relays: string[], relaysKey: string) => {
      if (relaysKey !== effectiveAddressLoadRelaysKey) return

      while (pendingEffectiveAddresses.size > 0 && relaysKey === effectiveAddressLoadRelaysKey) {
        const addresses = Array.from(pendingEffectiveAddresses).slice(
          0,
          EFFECTIVE_ADDRESS_LOAD_CHUNK_SIZE,
        )

        if (addresses.length === 0) return

        for (const address of addresses) {
          pendingEffectiveAddresses.delete(address)
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
                kinds: [GIT_PATCH],
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
            loadedEffectiveAddresses.add(address)
          }
        } catch {
          for (const address of addresses) {
            pendingEffectiveAddresses.add(address)
          }
          break
        }
      }
    }

    const scheduleEffectiveAddressLoadFlush = (relays: string[], relaysKey: string) => {
      if (effectiveAddressLoadFlushTimer) return

      effectiveAddressLoadFlushTimer = setTimeout(() => {
        effectiveAddressLoadFlushTimer = null
        void flushPendingEffectiveAddressLoads(relays, relaysKey)
      }, EFFECTIVE_ADDRESS_LOAD_DEBOUNCE_MS)
    }

    if (!initialLoadsPromise) {
      initialLoadsPromise = Promise.resolve()
    }

    initialLoadsPromise
      .then(() => {
      // Reactively load data when effective addresses change
      const repoAddressesUnsubscribe = repoAddressesStore.subscribe((addresses: string[]) => {
        if (addresses.length === 0) return

        const currentRelays = (getStore(repoRelaysStore) || []).filter(Boolean)
        if (currentRelays.length === 0) return

        const relaysKey = [...currentRelays].sort().join("|")
        if (effectiveAddressLoadRelaysKey !== relaysKey) {
          effectiveAddressLoadRelaysKey = relaysKey
          loadedEffectiveAddresses = new Set<string>()
          pendingEffectiveAddresses = new Set<string>()
          if (effectiveAddressLoadFlushTimer) {
            clearTimeout(effectiveAddressLoadFlushTimer)
            effectiveAddressLoadFlushTimer = null
          }
        }

        for (const address of new Set(addresses.filter(Boolean))) {
          if (!loadedEffectiveAddresses.has(address) && !pendingEffectiveAddresses.has(address)) {
            pendingEffectiveAddresses.add(address)
          }
        }

        if (pendingEffectiveAddresses.size > 0) {
          scheduleEffectiveAddressLoadFlush(currentRelays, relaysKey)
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
                kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
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

    const prStatusLoadTrigger = derived(pullRequestRootIdsStore, (rootIds: string[]) => {
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
    const relays = ($repoRelaysStore || []).filter(Boolean)
    const viewer = $pubkey
    if (!viewer || relays.length === 0) return

    const filters: Filter[] = [
      {
        kinds: [GIT_ISSUE, GIT_PULL_REQUEST, GIT_PULL_REQUEST_UPDATE],
        "#p": [viewer],
      },
    ]

    load({relays, filters}).catch(() => {})

    const controller = new AbortController()
    const since = Math.floor(Date.now() / 1000) - 600
    request({
      relays,
      signal: controller.signal,
      filters: filters.map(filter => ({...filter, since})),
      onEvent: event => {
        if (!repository.getEvent(event.id)) {
          repository.publish(event as TrustedEvent)
        }
      },
    })

    return () => controller.abort()
  })

  // Cleanup on component destroy
  onDestroy(() => {
    if (deleteSeenKey) {
      setCheckedAt(deleteSeenKey, Math.max(lastDeleteSeen, latestDeleteSeen))
    }

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
    loadedEffectiveAddresses.clear()
    pendingEffectiveAddresses.clear()
    if (effectiveAddressLoadFlushTimer) {
      clearTimeout(effectiveAddressLoadFlushTimer)
      effectiveAddressLoadFlushTimer = null
    }
    effectiveAddressLoadRelaysKey = ""

    if (repoLoadRetryTimer) {
      clearTimeout(repoLoadRetryTimer)
      repoLoadRetryTimer = null
    }

    if (repoStateSettleTimer) {
      clearTimeout(repoStateSettleTimer)
      repoStateSettleTimer = null
    }
  })

  // Refresh state
  let isRefreshing = $state(false)
  
  // Bookmark state
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

  const syncBookmarkState = () => {
    try {
      const repoKey = getCanonicalRepoKeyFromEvent(repoClass?.repoEvent as RepoAnnouncementEvent | null)
      isBookmarked = isAnyBookmarked(getStore(bookmarksStore), getBookmarkAddressCandidates(), {
        candidateRepoKeys: repoKey ? [repoKey] : [],
        getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      })
    } catch {
      isBookmarked = false
    }
  }
  
  // Subscribe to bookmarks store to update bookmark status reactively
  $effect(() => {
    void $repoAddressesStore

    if (!repoClass || !repoClass.repoEvent) {
      isBookmarked = false
      return
    }
    
    const unsubscribe = bookmarksStore.subscribe(() => {
      if (!repoClass || !repoClass.repoEvent) return
      syncBookmarkState()
    })
   
    // Initial check
      syncBookmarkState()
    
    return unsubscribe
  })
  

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
    return `/spaces/${encodeURIComponent(relay ?? "")}/git/${id}`
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
              .map(u => normalizeRelayUrl(u))
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

    const graspServersUnsubscribe = graspServersEventStore.subscribe((ev: TrustedEvent | undefined) => {
      try {
        graspServerUrls = ev ? (parseGraspServersEvent(ev as any) as string[]) : []
      } catch {
        graspServerUrls = []
      }
    })

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
      const cloneUrls = repoClass.cloneUrls
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

      let fallbackRelay = ""
      if (relay) {
        try {
          fallbackRelay = decodeRelay(relay)
        } catch {
          fallbackRelay = relay
        }
      }

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

      const naddr = buildRepoNaddrFromEvent({
        event: result.announcementEvent,
        fallbackPubkey: $pubkey || "",
        fallbackRepoRelays: policy.repoRelays,
        userOutboxRelays,
        gitRelays: GIT_RELAYS,
      })

      if (!naddr) {
        console.warn("Cannot navigate: unable to build repo naddr")
        pushToast({ message: "Fork completed, but repository address was invalid.", theme: "error" })
        return
      }

      const policyRelays = policy.naddrRelays

      // Only use platform relays for the space URL prefix
      const effectiveRelay =
        (fallbackRelay && isPlatformRelay(fallbackRelay) ? fallbackRelay : "") ||
        policyRelays.find(isPlatformRelay) ||
        PLATFORM_RELAYS[0] ||
        ""

      if (!effectiveRelay) {
        console.warn("Cannot navigate: no platform relay available")
        pushToast({ message: "Fork completed, but cannot navigate without a platform relay.", theme: "error" })
        return
      }

      // Encode relay URL for the route
      const encodedRelay = encodeRelay(effectiveRelay)
      
      // Navigate to the forked repo page
      const targetPath = `/spaces/${encodedRelay}/git/${naddr}`
      clearModals()
      void goto(targetPath).catch(error => {
        console.error("Failed to navigate to forked repo:", error)
        pushToast({ 
          message: "Fork completed, but navigation failed. Please manually navigate to the repository.", 
          theme: "error" 
        })
      })
    } catch (error) {
      console.error("Failed to navigate to forked repo:", error)
      pushToast({ 
        message: "Fork completed, but navigation failed. Please manually navigate to the repository.", 
        theme: "error" 
      })
    }
  }

  const getRepoRelaysForModal = () => getStore(repoRelaysStore) || (repoClass?.relays || [])

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

    let fallbackRelay = ""
    if (relay) {
      try {
        fallbackRelay = decodeRelay(relay)
      } catch {
        fallbackRelay = relay
      }
    }

    const targetRelays = relays.length > 0 ? relays : getRepoRelaysForModal()
    const effectiveRelay =
      (fallbackRelay && isPlatformRelay(fallbackRelay) ? fallbackRelay : "") ||
      targetRelays.find(isPlatformRelay) ||
      PLATFORM_RELAYS[0] ||
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

    const rollbackPublishedRepoEvents = async (params: {
      repoName: string
      relays: string[]
    }): Promise<void> => {
      if (!$pubkey) return

      const rollbackRelays = Array.from(new Set(params.relays.map(r => normalizeRelayUrl(r)).filter(Boolean)))
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
      .map(relay => normalizeRelayUrl(relay))
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
      myRepoStateEvents = [published, ...myRepoStateEvents.filter(event => event.id !== published.id)]
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
      onOpenSettings: () => settingsRepo(true),
      onRefresh: refreshRepo,
      onPublishEvent: async (event: any) => {
        const taggedRelays = getEventRelayTargets(event)
        const relaysForPublish = taggedRelays.length > 0 ? taggedRelays : getRepoRelaysForModal()
        const thunk = await publishRepoEventWithRelayPolicy(event, relaysForPublish, {
          timeoutMs: FORK_PUBLISH_TIMEOUT_MS,
          label: event.kind === GIT_REPO_STATE ? "Remote backfill state publish" : "Remote backfill publish",
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
      backPath: `/spaces/${encodedRelay}/git`,
      onClose: () => {
        suppressRelaysWarning = false
      },
    })
  }

  let relaysWarningDebounce: ReturnType<typeof setTimeout> | null = null
  
  $effect(() => {
    if (!$pubkey) return
    if (suppressRelaysWarning) return
    if (!repoClass?.repoEvent) return
    let parsed
    try {
      parsed = parseRepoAnnouncementEvent(repoClass.repoEvent)
    } catch {
      return
    }
    const relays = parsed.relays || []
    if (relays.length > 0) return
    const key = repoClass.repoEvent.id
    if (relaysWarningKey === key) return
    
    // Debounce to prevent duplicate toasts during initialization
    if (relaysWarningDebounce) {
      clearTimeout(relaysWarningDebounce)
    }
    
    relaysWarningDebounce = setTimeout(() => {
      relaysWarningKey = key
      pushToast({
        message:
          "This repository announcement has no relays defined. Add preferred relays so others can discover updates.",
        theme: "warning",
        timeout: 8000, // 8 seconds - visible but eventually dismisses
        action: {message: "Repo settings", onclick: () => settingsRepo()},
      })
    }, 100)
  })

  async function bookmarkRepo() {
    if (!repoClass || !$pubkey || isTogglingBookmark) return

    isTogglingBookmark = true
    let wasRemoving = false

    try {
      if (!repoClass.repoEvent) {
        throw new Error("Repository event not available")
      }
      
      const repoRelays = getStore(repoRelaysStore) || (repoClass?.relays || [])
      
      // Get repo address
      const address = getPrimaryBookmarkAddress()
      if (!address) {
        throw new Error("Repository address not available")
      }
      const candidateAddresses = getBookmarkAddressCandidates()
      
      // Get current bookmarks
      const currentBookmarks = getStore(bookmarksStore)
      
      // Determine relay hint
      const relayHint = repoRelays[0] || Router.get().getRelaysForPubkey(repoClass.repoEvent.pubkey)?.[0] || ""
      const normalizedRelayHint = relayHint ? normalizeRelayUrl(relayHint) : ""
      const bookmarkEntry = {
        address,
        relayHint: normalizedRelayHint,
        author: repoClass.repoEvent.pubkey,
        identifier: address.split(":").slice(2).join(":") || getTagValue("d", repoClass.repoEvent.tags) || "",
      }
      const repoKey = getCanonicalRepoKeyFromEvent(repoClass.repoEvent)

      const toggleResult = toggleRepoBookmarks({
        bookmarks: currentBookmarks,
        candidateAddresses,
        candidateRepoKeys: repoKey ? [repoKey] : [],
        nextBookmark: bookmarkEntry,
        getCachedEvent: address => repository.getEvent(address) as RepoAnnouncementEvent | undefined,
      })
      wasRemoving = toggleResult.isRemoving

      const tags: string[][] = [["d", GIT_REPO_BOOKMARK_DTAG]]
      toggleResult.nextBookmarks.forEach(bookmark => {
        const aTag: string[] = ["a", bookmark.address]
        if (bookmark.relayHint) {
          aTag.push(bookmark.relayHint)
        }
        tags.push(aTag)
      })
      
      // Create and publish bookmark event
      const bookmarkEvent = makeEvent(NAMED_BOOKMARKS, { tags, content: "" })

      // Update store immediately for responsive UI
      bookmarksStore.set(toggleResult.nextBookmarks)
      
      // Publish to relays
      const relaysToPublish = repoRelays.length > 0 
        ? repoRelays.map(normalizeRelayUrl).filter(Boolean)
        : Router.get().FromUser().getUrls().map(normalizeRelayUrl).filter(Boolean)
      
      publishThunk({ event: bookmarkEvent, relays: relaysToPublish })
      
      pushToast({
        message: wasRemoving ? "Bookmark removed" : "Repository bookmarked",
      })
    } catch (error) {
      console.error("Failed to toggle bookmark:", error)
      const action = wasRemoving ? "remove" : "add"
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
    goto(`${basePath}/`)
  }

  // Connect the nostr-git toast store to the toast component
  $effect(() => {
    // Subscribe to toast store explicitly for proper cleanup
    const unsubscribe = toast.subscribe((toasts) => {
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

<PageBar class="w-full my-2">
  {#snippet icon()}
    <div>
      <Button class="btn btn-neutral btn-sm flex-nowrap whitespace-nowrap" onclick={back}>
        <Icon icon={AltArrowLeft} />
        <span class="hidden sm:inline">Go back</span>
      </Button>
    </div>
  {/snippet}
  {#snippet title()}
    {#if activeTab === "code"}
      <div class="flex min-w-0 items-center gap-2 md:hidden">
        {#if codeCanGoUp}
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-2 py-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
            onclick={() => setCodeDirectory(codeParentPath)}
            title="Up"
          >
            <ChevronLeft class="h-4 w-4" />
            <span class="hidden sm:inline">Up</span>
          </button>
        {/if}
        <nav
          class="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto text-xs sm:text-sm text-muted-foreground whitespace-nowrap"
          aria-label="Breadcrumb"
        >
          <button
            type="button"
            class="hover:text-foreground hover:underline transition-colors flex-shrink-0 whitespace-nowrap"
            onclick={() => setCodeDirectory("")}
          >
            {repoClass?.name || repoName}
          </button>
          {#each codeBreadcrumbSegments as segment, i}
            <span class="text-muted-foreground/50 flex-shrink-0">/</span>
            {#if i === codeBreadcrumbSegments.length - 1}
              <span class="text-foreground font-medium whitespace-nowrap" title={segment}>
                {segment}
              </span>
            {:else}
              <button
                type="button"
                class="hover:text-foreground hover:underline transition-colors whitespace-nowrap"
                onclick={() => setCodeDirectory(codeBreadcrumbSegments.slice(0, i + 1).join("/"))}
              >
                {segment}
              </button>
            {/if}
          {/each}
        </nav>
      </div>
      <h1 class="hidden md:block text-xl">{""}</h1>
    {:else}
      <h1 class="text-xl">{""}</h1>
    {/if}
  {/snippet}
  {#snippet action()}
    {#if activeTab !== "code"}
      <div>
        <SpaceMenuButton url={url} />
      </div>
    {:else}
      <div class="lg:hidden">
        <SpaceMenuButton url={url} />
      </div>
    {/if}
  {/snippet}
</PageBar>

<PageContent class="flex min-w-0 flex-grow flex-col gap-2 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8">
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
        forkRepo={$pubkey ? forkRepo : undefined}
        settingsRepo={$pubkey ? () => settingsRepo() : undefined}
        {overviewRepo}
        bookmarkRepo={$pubkey ? bookmarkRepo : undefined}
        isBookmarked={$pubkey ? isBookmarked : false}
        isTogglingBookmark={$pubkey ? isTogglingBookmark : false}
        watchRepo={$pubkey ? openWatchModal : undefined}
        isWatching={$pubkey ? isWatching : false}
        canEditSettings={!!$pubkey && repoPubkey === $pubkey}
        updateRepoState={isOwnedRepo ? refreshBranchUpdatesAndOpen : undefined}
        hasRepoStateUpdate={hasCurrentRepoBranchUpdate}
        isCheckingRepoStateUpdate={updateStateActionChecking}
        resolveCloneUrlIssues={openRemoteFixModal}
        >
        {#snippet children(activeTab: string)}
          <RepoTab
            tabValue="feed"
            label="Feed"
            href={`${basePath}/feed`}
            {activeTab}>
            {#snippet icon()}
              <FileCode class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          <RepoTab
            tabValue="code"
            label="Code"
            href={`${basePath}/code`}
            {activeTab}>
            {#snippet icon()}
              <GitBranch class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          <RepoTab
            tabValue="issues"
            label="Issues"
            href={`${basePath}/issues`}
            notification={hasIssuesNotification}
            {activeTab}>
            {#snippet icon()}
              <CircleAlert class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          <RepoTab
            tabValue="patches"
            label="Patches"
            href={`${basePath}/patches`}
            notification={hasPatchesNotification}
            {activeTab}>
            {#snippet icon()}
              <GitPullRequest class="h-4 w-4" />
            {/snippet}
          </RepoTab>
          <RepoTab
            tabValue="commits"
            label="Commits"
            href={`${basePath}/commits`}
            {activeTab}>
            {#snippet icon()}
              <GitCommit class="h-4 w-4" />
            {/snippet}
          </RepoTab>
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
    {@render children()}
  {/if}
</PageContent>
