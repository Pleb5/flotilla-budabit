<script lang="ts">
  import {
    RepoHeader,
    RepoTab,
    toast,
    bookmarksStore,
    Repo,
    AvatarImage,
    WorkerManager,
  } from "@nostr-git/ui"
  import {ConfigProvider} from "@nostr-git/ui"
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
  import Profile from "@src/app/components/Profile.svelte"
  import ProfileLink from "@src/app/components/ProfileLink.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import SpaceMenuButton from "@lib/budabit/components/SpaceMenuButton.svelte"
  import Input from "@lib/components/Field.svelte"
  import Dialog from "@lib/components/Dialog.svelte"
  import {pushToast} from "@src/app/util/toast"
  import {notifications} from "@app/util/notifications"
  import {notifyCorsProxyIssue} from "@app/util/git-cors-proxy"
  import EventActions from "@src/app/components/EventActions.svelte"
  import ReactionSummary from "@src/app/components/ReactionSummary.svelte"
  import Markdown from "@src/lib/components/Markdown.svelte"
  import {pushModal} from "@app/util/modal"
  import DeleteRepoConfirm from "@app/components/DeleteRepoConfirm.svelte"
  import {EditRepoPanel, ForkRepoDialog} from "@nostr-git/ui"
  import {postRepoAnnouncement} from "@lib/budabit/commands.js"
  import RepoWatchModal from "@lib/budabit/components/RepoWatchModal.svelte"
  import {nip19} from "nostr-tools"
  
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
  import {GIT_REPO_BOOKMARK_DTAG, GRASP_SET_KIND, DEFAULT_GRASP_SET_ID, parseGraspServersEvent, GIT_REPO_ANNOUNCEMENT, GIT_REPO_STATE, GIT_PULL_REQUEST, parseRepoAnnouncementEvent, isCommentEvent} from "@nostr-git/core/events"
  import {normalizeRelayUrl as normalizeRelayUrlShared, parseRepoId} from "@nostr-git/core/utils"
  import {derived, get as getStore, type Readable} from "svelte/store"
  import {repository, pubkey, profilesByPubkey, profileSearch, loadProfile, relaySearch, publishThunk, deriveProfile} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {load} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {goto, beforeNavigate} from "$app/navigation"
  import {
    normalizeRelayUrl,
    NAMED_BOOKMARKS,
    makeEvent,
    Address,
    GIT_ISSUE,
    GIT_PATCH,
    GIT_STATUS_OPEN,
    GIT_STATUS_DRAFT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    getTagValue,
    COMMENT,
    type TrustedEvent
  } from "@welshman/util"
  import {nthEq} from "@welshman/lib"
  import {setContext, onDestroy} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY, STATUS_EVENTS_BY_ROOT_KEY, PULL_REQUESTS_KEY, activeRepoClass, GIT_RELAYS} from "@lib/budabit/state"
  import {userRepoWatchValues} from "@lib/budabit/repo-watch"
  import {extensionSettings} from "@app/extensions/settings"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  
  const {id, relay} = $page.params

  let {data, children} = $props()
  // Type assertion needed because TypeScript infers old layout return type
  const layoutData = data as unknown as {repoId: string, repoName: string, repoPubkey: string, fallbackRelays: string[], naddrRelays: string[], url: string}
  const {repoId, repoName, repoPubkey, fallbackRelays, naddrRelays, url} = layoutData
  
  // Derive repoClass from activeRepoClass store
  const repoClass = $derived($activeRepoClass)

  $effect(() => {
    if (!repoClass) return
    if (!repoClass.name && repoName) {
      repoClass.name = repoName
    }
    if (!repoClass.key && repoPubkey && repoName) {
      try {
        repoClass.key = parseRepoId(`${repoPubkey}:${repoName}`)
      } catch {}
    }
    if (!repoClass.address && repoPubkey && repoName) {
      repoClass.address = `${GIT_REPO_ANNOUNCEMENT}:${repoPubkey}:${repoName}`
    }
  })

  // Get enabled extensions with repo-tab slots
  const repoTabExtensions = $derived.by(() => {
    const settings = $extensionSettings
    const enabledIds = settings.enabled
    const extensions: Array<{id: string; label: string; path: string; icon?: string; builtinRoute?: string}> = []
    
    // Check NIP-89 extensions
    for (const [extId, manifest] of Object.entries(settings.installed.nip89)) {
      if (enabledIds.includes(extId) && manifest.slot?.type === "repo-tab") {
        extensions.push({
          id: extId,
          label: manifest.slot.label,
          path: manifest.slot.path,
          icon: manifest.icon,
          builtinRoute: manifest.slot.builtinRoute,
        })
      }
    }
    
    return extensions
  })

  // Make activeTab reactive to avoid lag on navigation - memoize the calculation
  const activeTab = $derived.by(() => {
    // Only recalculate if pathname actually changed
    const pathname = $page.url.pathname
    const lastSegment = pathname.split("/").pop() || undefined
    // Handle empty path (root) - default to undefined which maps to overview
    return lastSegment === id ? undefined : lastSegment
  })
  
  // Memoize encodedRelay - it only changes if relay param changes
  const encodedRelay = $derived(encodeURIComponent(relay ?? ""))
  
  // Memoize base path to avoid recalculating on every render
  const basePath = $derived(`/spaces/${encodedRelay}/git/${id}`)
  const issuesPath = $derived.by(() => `${basePath}/issues`)
  const patchesPath = $derived.by(() => `${basePath}/patches`)
  const hasIssuesNotification = $derived.by(() => $notifications.has(issuesPath))
  const hasPatchesNotification = $derived.by(() => $notifications.has(patchesPath))

  const repoAddress = $derived.by(() => {
    if (repoClass?.address) return repoClass.address
    if (repoPubkey && repoId) return `30617:${repoPubkey}:${repoId}`
    return ""
  })

  const watchOptions = $derived.by(() => (repoAddress ? $userRepoWatchValues.repos[repoAddress] : undefined))
  const isWatching = $derived(Boolean(watchOptions))

  const openWatchModal = () => {
    if (!repoAddress) return
    pushModal(RepoWatchModal, {
      repoAddr: repoAddress,
      repoName: repoClass?.name || repoName,
    })
  }

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
      (events: TrustedEvent[]) => events[0] as RepoAnnouncementEvent | undefined,
    ) as Readable<RepoAnnouncementEvent | undefined>
  }

  function deriveRepoStateEvent(repoPubkey: string, repoName: string) {
    return derived(
      deriveEventsAsc(
        deriveEventsById({
          repository,
          filters: [
            {
              authors: [repoPubkey],
              kinds: [GIT_REPO_STATE],
              "#d": [repoName],
            },
          ],
        }),
      ),
      (events: TrustedEvent[]) => events?.[0] as RepoStateEvent | undefined,
    ) as Readable<RepoStateEvent | undefined>
  }

  function deriveRepoAuthors(repoEvent: Readable<RepoAnnouncementEvent | undefined>, fallbackPubkey: string) {
    return derived(repoEvent, (repo: RepoAnnouncementEvent | undefined) => {
      if (!repo) {
        return [fallbackPubkey]
      }
      try {
        const parsed = parseRepoAnnouncementEvent(repo)
        const authors = new Set<string>()
        authors.add(repo.pubkey)
        if (parsed.maintainers) {
          parsed.maintainers.forEach((m: string) => authors.add(m))
        }
        return Array.from(authors)
      } catch {
        return [fallbackPubkey]
      }
    })
  }

  function deriveRepoRelays(repoEvent: Readable<RepoAnnouncementEvent | undefined>, naddrRelays: string[], fallbackRelays: string[]) {
    return derived(repoEvent, (re: RepoAnnouncementEvent | undefined) => {
      if (re) {
        const relaysTag = re.tags.find(nthEq(0, "relays"))
        if (relaysTag) {
          const [_, ...relaysList] = relaysTag
          const validRelays = relaysList.filter((relay: string) => {
            try {
              const url = new URL(relay)
              return url.protocol === 'ws:' || url.protocol === 'wss:'
            } catch {
              return false
            }
          }).map((u: string) => normalizeRelayUrlShared(u)).filter(Boolean) as string[]
          if (validRelays.length > 0) {
            return validRelays
          }
        }
      }
      // Fallback to naddr relays or final fallback
      const relays = naddrRelays.length > 0 ? naddrRelays : fallbackRelays
      return relays.map((u: string) => normalizeRelayUrlShared(u)).filter(Boolean) as string[]
    })
  }

  function deriveIssues(repoAuthors: Readable<string[]>, repoName: string) {
    const allIssueEvents = deriveEventsAsc(
      deriveEventsById({repository, filters: [{kinds: [GIT_ISSUE]}]}),
    )

    return derived(
      [allIssueEvents, repoAuthors],
      ([events, authors]: [TrustedEvent[], string[]]) => {
        const authorAddresses = new Set(authors.map((a: string) => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`))
        return (events || []).filter((event: TrustedEvent) => {
          const addressTag = event.tags.find((t: string[]) => t[0] === "a")
          return addressTag && authorAddresses.has(addressTag[1])
        }) as IssueEvent[]
      },
    ) as Readable<IssueEvent[]>
  }

  function derivePatches(repoAuthors: Readable<string[]>, repoName: string) {
    const allPatchEvents = deriveEventsAsc(
      deriveEventsById({repository, filters: [{kinds: [GIT_PATCH]}]}),
    )

    return derived(
      [allPatchEvents, repoAuthors],
      ([events, authors]: [TrustedEvent[], string[]]) => {
        const authorAddresses = new Set(authors.map((a: string) => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`))
        return (events || []).filter((event: TrustedEvent) => {
          const addressTag = event.tags.find((t: string[]) => t[0] === "a")
          return addressTag && authorAddresses.has(addressTag[1])
        }) as PatchEvent[]
      },
    ) as Readable<PatchEvent[]>
  }

  function derivePullRequests(repoAuthors: Readable<string[]>, repoName: string) {
    const allPullRequestEvents = deriveEventsAsc(
      deriveEventsById({repository, filters: [{kinds: [GIT_PULL_REQUEST]}]}),
    )

    return derived(
      [allPullRequestEvents, repoAuthors],
      ([events, authors]: [TrustedEvent[], string[]]) => {
        const authorAddresses = new Set(authors.map((a: string) => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`))
        return (events || []).filter((event: TrustedEvent) => {
          const addressTag = event.tags.find((t: string[]) => t[0] === "a")
          return addressTag && authorAddresses.has(addressTag[1])
        }) as PullRequestEvent[]
      },
    ) as Readable<PullRequestEvent[]>
  }

  function deriveStatusEvents(repoAuthors: Readable<string[]>, repoName: string) {
    const allStatusEvents = deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [
          {kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE]},
        ],
      }),
    )

    return derived(
      [allStatusEvents, repoAuthors],
      ([events, authors]: [TrustedEvent[], string[]]) => {
        const authorAddresses = new Set(authors.map((a: string) => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`))
        return (events || []).filter((event: TrustedEvent) => {
          const addressTag = event.tags.find((t: string[]) => t[0] === "a")
          return addressTag && authorAddresses.has(addressTag[1])
        }) as StatusEvent[]
      },
    ) as Readable<StatusEvent[]>
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

  function deriveComments(allRootIds: Readable<string[]>) {
    const allCommentEvents = deriveEventsAsc(
      deriveEventsById({repository, filters: [{kinds: [COMMENT]}]}),
    )

    return derived(
      [allCommentEvents, allRootIds],
      ([events, rootIds]: [TrustedEvent[], string[]]) => {
        if (rootIds.length === 0) return []
        return (events || []).filter((event: TrustedEvent) => {
          const eTags = event.tags.filter((t: string[]) => t[0] === "E" || t[0] === "e")
          return eTags.some((tag: string[]) => rootIds.includes(tag[1]))
        }).filter(isCommentEvent) as CommentEvent[]
      },
    ) as Readable<CommentEvent[]>
  }

  // Create stores at top level (not inside effect to avoid infinite loops)
  const repoEventStore = deriveRepoEvent(repoPubkey, repoName)
  const repoStateEventStore = deriveRepoStateEvent(repoPubkey, repoName)
  const repoAuthorsStore = deriveRepoAuthors(repoEventStore, repoPubkey)
  const repoRelaysStore = deriveRepoRelays(repoEventStore, naddrRelays, fallbackRelays)
  const issuesStore = deriveIssues(repoAuthorsStore, repoName)
  const patchesStore = derivePatches(repoAuthorsStore, repoName)
  const pullRequestsStore = derivePullRequests(repoAuthorsStore, repoName)
  const statusEventsStore = deriveStatusEvents(repoAuthorsStore, repoName)
  const statusEventsByRootStore = deriveStatusEventsByRoot(statusEventsStore)
  const allRootIdsStore = deriveAllRootIds(issuesStore, patchesStore, pullRequestsStore)
  const commentEventsStore = deriveComments(allRootIdsStore)

  // Create empty stores for Repo class
  const emptyRepoStateEvents = derived([], () => [] as RepoStateEvent[])
  const emptyLabelEvents = derived([], () => [] as LabelEvent[])

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
      repoStateEvents: emptyRepoStateEvents as unknown as Readable<RepoStateEvent[]>,
      statusEvents: statusEventsStore,
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
    console.log('isDifferentRepo', isDifferentRepo)
    if (isDifferentRepo) {
      existingRepo.dispose()
      $activeRepoClass = new Repo({
        repoEvent: repoEventStore as Readable<RepoAnnouncementEvent>,
        repoStateEvent: repoStateEventStore as Readable<RepoStateEvent>,
        issues: issuesStore,
        patches: patchesStore,
        repoStateEvents: emptyRepoStateEvents as unknown as Readable<RepoStateEvent[]>,
        statusEvents: statusEventsStore,
        commentEvents: commentEventsStore,
        labelEvents: emptyLabelEvents as unknown as Readable<LabelEvent[]>,
        viewerPubkey: viewerPubkeyStore,
        workerManager: sharedWorkerManager,
        authorName,
        authorEmail,
      })
    } else {
      console.log("♻️  [LAYOUT INIT] REUSING existing Repo instance")
    }
  }
    
  // Set context for child components (only once, not in effect)
  setContext(REPO_KEY, $activeRepoClass)
  setContext(REPO_RELAYS_KEY, repoRelaysStore)
  setContext(STATUS_EVENTS_BY_ROOT_KEY, statusEventsByRootStore)
  setContext(PULL_REQUESTS_KEY, pullRequestsStore)

  // Initialize tracking for data loading
  let unsubscribers: (() => void)[] = []
  let lastLoadedIds = new Set<string>()
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
        kinds: [GIT_REPO_STATE, GIT_REPO_ANNOUNCEMENT],
      },
    ]

    const relayListFromUrl = getStore(repoRelaysStore)
    const repoLoadPromise = load({relays: relayListFromUrl, filters: repoFilters})

    const allReposFilter = {
      kinds: [GIT_REPO_ANNOUNCEMENT],
      "#d": [repoName],
    }

    // Start loading with initial authors
    Promise.all([
      repoLoadPromise,
      load({
        relays: relayListFromUrl,
        filters: [allReposFilter],
      }),
      load({
        relays: relayListFromUrl,
        filters: [
          {
            kinds: [GIT_ISSUE],
            "#a": [`${GIT_REPO_ANNOUNCEMENT}:${repoPubkey}:${repoName}`],
          },
          {
            kinds: [GIT_PATCH],
            "#a": [`${GIT_REPO_ANNOUNCEMENT}:${repoPubkey}:${repoName}`],
          },
          {
            kinds: [GIT_PULL_REQUEST],
            "#a": [`${GIT_REPO_ANNOUNCEMENT}:${repoPubkey}:${repoName}`],
          },
          {
            kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
            "#a": [`${GIT_REPO_ANNOUNCEMENT}:${repoPubkey}:${repoName}`],
          },
        ],
      }),
    ]).then(() => {
      // Reactively load data when authors change
      const repoAuthorsUnsubscribe = repoAuthorsStore.subscribe((authors: string[]) => {
        if (authors.length > 1) {
          const currentRelays = getStore(repoRelaysStore)
          load({
            relays: currentRelays,
            filters: [
              {
                kinds: [GIT_ISSUE],
                "#a": authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
              },
              {
                kinds: [GIT_PATCH],
                "#a": authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
              },
              {
                kinds: [GIT_PULL_REQUEST],
                "#a": authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
              },
              {
                kinds: [GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE],
                "#a": authors.map(a => `${GIT_REPO_ANNOUNCEMENT}:${a}:${repoName}`),
              },
            ],
          }).catch(() => {})
        }
      })
      unsubscribers.push(repoAuthorsUnsubscribe)
    }).catch(() => {})

    // Load comments reactively when root IDs are available
    const commentLoadTrigger = derived(allRootIdsStore, (rootIds: string[]) => {
      if (rootIds.length > 0) {
        const idsKey = rootIds.sort().join(',')
        if (!lastLoadedIds.has(idsKey)) {
          lastLoadedIds.add(idsKey)
          const currentRelays = getStore(repoRelaysStore)
          load({
            relays: currentRelays,
            filters: [{
              kinds: [COMMENT],
              "#E": rootIds,
            }],
          }).catch(() => {})
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

  // Cleanup on component destroy
  onDestroy(() => {
    unsubscribers.forEach(unsub => unsub())
    unsubscribers = []
    lastLoadedIds.clear()
  })

  // Refresh state
  let isRefreshing = $state(false)
  
  // Bookmark state
  let isTogglingBookmark = $state(false)
  let isBookmarked = $state(false)
  let relaysWarningKey = $state("")
  let suppressRelaysWarning = $state(false)
  
  // Subscribe to bookmarks store to update bookmark status reactively
  $effect(() => {
    if (!repoClass || !repoClass.repoEvent) {
      isBookmarked = false
      return
    }
    
    const unsubscribe = bookmarksStore.subscribe(() => {
    if (!repoClass || !repoClass.repoEvent) return
    try {
      const address = repoClass.address || Address.fromEvent(repoClass.repoEvent).toString()
      const bookmarks = getStore(bookmarksStore)
      isBookmarked = bookmarks.some((b) => b.address === address)
    } catch {
      isBookmarked = false
    }
  })
  
    // Initial check
      try {
        const address = repoClass.address || Address.fromEvent(repoClass.repoEvent).toString()
        const bookmarks = getStore(bookmarksStore)
        isBookmarked = bookmarks.some((b) => b.address === address)
      } catch {
        isBookmarked = false
      }
    
    return unsubscribe
  })
  

  // --- GRASP servers (user profile) ---
  const graspServersFilter = {
    kinds: [GRASP_SET_KIND],
    authors: [pubkey.get()!],
    "#d": [DEFAULT_GRASP_SET_ID],
  }

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
  const graspServersEventStore = derived(
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

  // GRASP servers subscription - track for cleanup
  $effect(() => {
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
      const repoName = parsed.name
      
      if (!repoName || !$pubkey) {
        console.warn("Cannot navigate: missing repo name or pubkey", { repoName, $pubkey })
        return
      }

      // Extract relays from announcement event or use current relay
      const relays = parsed.relays && parsed.relays.length > 0 
        ? parsed.relays 
        : relay 
          ? [relay] 
          : []

      // Use current relay or first relay from announcement
      const effectiveRelay = relay || relays[0]
      if (!effectiveRelay) {
        console.warn("Cannot navigate: no relay URL available")
        pushToast({ message: "Fork completed, but cannot navigate without a relay URL.", theme: "error" })
        return
      }

      // Create naddr
      const naddr = nip19.naddrEncode({
        kind: 30617, // GIT_REPO_ANNOUNCEMENT
        pubkey: $pubkey || "",
        identifier: repoName,
        relays: relays.length > 0 ? relays : undefined,
      })

      // Encode relay URL for the route
      const encodedRelay = encodeURIComponent(effectiveRelay)
      
      // Navigate to the forked repo page
      const targetPath = `/spaces/${encodedRelay}/git/${naddr}`
      console.log("🚀 Navigating to forked repo:", targetPath)
      
      goto(targetPath)
    } catch (error) {
      console.error("Failed to navigate to forked repo:", error)
      pushToast({ 
        message: "Fork completed, but navigation failed. Please manually navigate to the repository.", 
        theme: "error" 
      })
    }
  }

  const getRepoRelaysForModal = () => getStore(repoRelaysStore) || (repoClass?.relays || [])

  const getRepoAnnouncementRelays = () => {
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

  function forkRepo() {
    if (!repoClass) return

    const repoRelays = getRepoAnnouncementRelays()
    const defaultRelays = repoRelays.length > 0 ? repoRelays : GIT_RELAYS

    pushModal(ForkRepoDialog, {
      repo: repoClass,
      pubkey: $pubkey || "",
      onPublishEvent: (event: any) => {
        // Handle event publishing
        postRepoAnnouncement(event, [])
      },
      graspServerUrls: graspServerUrls,
      navigateToForkedRepo: navigateToForkedRepo,
      defaultRelays,
      getProfile: getRepoProfile,
      searchProfiles: searchRepoProfiles,
      searchRelays: searchRepoRelays,
    })
  }

  function settingsRepo() {
    if (!repoClass) return
    
    const repoRelays = getStore(repoRelaysStore)
    const relaysForPublish = repoRelays.length > 0 ? repoRelays : GIT_RELAYS
    if (relaysForPublish.length === 0) {
      pushToast({
        message: "Repository relays not ready. Please wait...",
        theme: "error",
      })
      return
    }
    
    pushModal(EditRepoPanel, {
      repo: repoClass,
      onPublishEvent: (event: RepoAnnouncementEvent) => {
        postRepoAnnouncement(event, relaysForPublish)
      },
      canDelete: !!$pubkey && repoPubkey === $pubkey,
      onRequestDelete: () => openDeleteRepoModal(),
      getProfile: getRepoProfile,
      searchProfiles: searchRepoProfiles,
      searchRelays: searchRepoRelays,
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
      backPath: `/spaces/${encodedRelay}/git`,
      onClose: () => {
        suppressRelaysWarning = false
      },
    })
  }

  $effect(() => {
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
    relaysWarningKey = key
    pushToast({
      message:
        "This repository announcement has no relays defined. Add preferred relays so others can discover updates.",
      theme: "warning",
      timeout: 0,
      action: {message: "Repo settings", onclick: () => settingsRepo()},
    })
  })

  async function bookmarkRepo() {
    if (!repoClass || !$pubkey || isTogglingBookmark) return

    isTogglingBookmark = true

    try {
      if (!repoClass.repoEvent) {
        throw new Error("Repository event not available")
      }
      
      const repoRelays = getStore(repoRelaysStore) || (repoClass?.relays || [])
      
      // Get repo address
      const address = repoClass.address || Address.fromEvent(repoClass.repoEvent).toString()
      
      // Get current bookmarks
      const currentBookmarks = getStore(bookmarksStore)
      
      // Determine relay hint
      const relayHint = repoRelays[0] || Router.get().getRelaysForPubkey(repoClass.repoEvent.pubkey)?.[0] || ""
      const normalizedRelayHint = relayHint ? normalizeRelayUrl(relayHint) : ""
      
      // Build tags array
      const tags: string[][] = [["d", GIT_REPO_BOOKMARK_DTAG]]
      
      if (isBookmarked) {
        // Remove bookmark: keep all bookmarks except this one
        currentBookmarks
          .filter((b) => b.address !== address)
          .forEach((b) => {
            const aTag: string[] = ["a", b.address]
            if (b.relayHint) {
              aTag.push(b.relayHint)
            }
            tags.push(aTag)
          })
      } else {
        // Add bookmark: keep all existing bookmarks and add this one
        currentBookmarks.forEach((b) => {
          const aTag: string[] = ["a", b.address]
          if (b.relayHint) {
            aTag.push(b.relayHint)
          }
          tags.push(aTag)
        })
        
        // Add the new bookmark
        const newATag: string[] = ["a", address]
        if (normalizedRelayHint) {
          newATag.push(normalizedRelayHint)
        }
        tags.push(newATag)
      }
      
      // Create and publish bookmark event
      const bookmarkEvent = makeEvent(NAMED_BOOKMARKS, { tags, content: "" })
      
      // Capture the action before updating store (for toast message)
      const wasRemoving = isBookmarked
      
      // Update store immediately for responsive UI
      if (isBookmarked) {
        bookmarksStore.remove(address)
      } else {
        bookmarksStore.add({
          address,
          relayHint: normalizedRelayHint,
          author: repoClass.repoEvent.pubkey,
          identifier: GIT_REPO_BOOKMARK_DTAG,
        })
      }
      
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
      // Use the current isBookmarked state for error message (before any changes)
      const action = isBookmarked ? "remove" : "add"
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

<PageContent class="flex flex-grow flex-col gap-2 overflow-auto p-4 sm:p-6 lg:p-8">
  {#if repoClass === undefined}
    <div class="p-4 text-center">Loading repository...</div>
  {:else if !repoClass}
    <div class="p-4 text-center text-red-500">Repository not found.</div>
  {:else}
    <RepoHeader
      {repoClass}
      {activeTab}
      {refreshRepo}
      {isRefreshing}
      {forkRepo}
      {settingsRepo}
      {overviewRepo}
      {bookmarkRepo}
      {isBookmarked}
      isTogglingBookmark={isTogglingBookmark}
      watchRepo={openWatchModal}
      isWatching={isWatching}
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
        {#each repoTabExtensions as ext (ext.id)}
        <RepoTab
          tabValue={ext.builtinRoute ?? ext.path}
          label={ext.label}
          href={ext.builtinRoute ? `${basePath}/${ext.builtinRoute}` : `${basePath}/extensions/${ext.id}`}
          {activeTab}>
          {#snippet icon()}
            <ExtensionIcon icon={ext.icon} size={16} class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        {/each}
      {/snippet}
    </RepoHeader>
    <ConfigProvider
      components={{
        AvatarImage: AvatarImage as typeof import("@nostr-git/ui").AvatarImage,
        Separator: Divider as typeof import("@nostr-git/ui").Separator,
        Input: Input as typeof import("@nostr-git/ui").Input,
        Alert: Dialog as typeof import("@nostr-git/ui").Alert,
        ProfileComponent: Profile as typeof import("@nostr-git/ui").Profile,
        ProfileLink: ProfileLink as typeof import("@nostr-git/ui").ProfileLink,
        EventActions: EventActions as typeof import("@nostr-git/ui").EventActions,
        ReactionSummary: ReactionSummary as typeof import("@nostr-git/ui").ReactionSummary,
        Markdown: Markdown as any,
      } as any}>
      {@render children()}
    </ConfigProvider>
  {/if}
</PageContent>
