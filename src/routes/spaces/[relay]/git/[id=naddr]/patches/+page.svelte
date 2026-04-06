<script lang="ts">
  import {Button as GitButton, PatchCard, NewPRForm, toast} from "@nostr-git/ui"
  import {Eye, SearchX, GitPullRequest} from "@lucide/svelte"
  import {createSearch, pubkey, repository} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import {makeFeed} from "@src/app/core/requests"
  import {
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    getTagValue,
    type TrustedEvent,
  } from "@welshman/util"
  import {fade, slideAndFade} from "@lib/transition"
  import {normalizeEffectiveLabels, toNaturalArray, groupLabels} from "@lib/budabit/labels"
  import {
    getTags,
    createStatusEvent,
    type CommentEvent,
    type PatchEvent,
    type PullRequestEvent,
    type StatusEvent,
  } from "@nostr-git/core/events"
  import {COMMENT} from "@welshman/util"
import {parseGitPatchFromEvent} from "@nostr-git/core/git"
import {request} from "@welshman/net"
import {GIT_PULL_REQUEST, parsePullRequestEvent} from "@nostr-git/core/events"
import Icon from "@src/lib/components/Icon.svelte"
import {isMobile} from "@src/lib/html.js"
  import {postComment, publishEvent} from "@lib/budabit/commands.js"
  import {pushModal} from "@app/util/modal"
  import {checked, setCheckedAt, notifications, setCheckedForRepoNotifications} from "@app/util/notifications"
  import FilterPanel from "@src/lib/budabit/components/FilterPanel.svelte"
  import {pushToast} from "@src/app/util/toast"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"

  import {getContext, onDestroy, tick} from "svelte"
  import {page} from "$app/stores"
  import {beforeNavigate, goto} from "$app/navigation"
  import {decodeRelay} from "@app/core/state"
  import {canEnforceNip70, publishDelete, publishReaction} from "@app/core/commands"
  import {
    REPO_KEY,
    REPO_RELAYS_KEY,
    STATUS_EVENTS_BY_ROOT_KEY,
    PULL_REQUESTS_KEY,
    deriveEffectiveLabels,
    deriveAssignmentsFor,
    effectiveMaintainersByRepoAddress,
    effectiveRepoAddressesByRepoAddress,
    getEffectiveRepoAddresses,
  } from "@lib/budabit/state"
  import {
    REPO_TRUST_METRICS_KEY,
    defaultRepoTrustMetrics,
    type RepoTrustMetrics,
  } from "@lib/budabit/repo-trust-metrics"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  const repoClass = getContext<Repo>(REPO_KEY)
  const statusEventsByRootStore =
    getContext<Readable<Map<string, StatusEvent[]>>>(STATUS_EVENTS_BY_ROOT_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)
  const repoTrustMetricsStore = getContext<Readable<RepoTrustMetrics>>(REPO_TRUST_METRICS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Get current values from stores reactively using $ rune
  const statusEventsByRoot = $derived.by(() =>
    statusEventsByRootStore ? $statusEventsByRootStore : new Map<string, StatusEvent[]>(),
  )
  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []))
  const pullRequests = $derived.by(() => (pullRequestsStore ? $pullRequestsStore : []))
  const repoTrustMetrics = $derived.by(() =>
    repoTrustMetricsStore ? $repoTrustMetricsStore : defaultRepoTrustMetrics,
  )
  const patchesPath = $derived.by(
    () => `/spaces/${encodeURIComponent($page.params.relay ?? "")}/git/${$page.params.id}/patches`,
  )
  const scrollStorageKey = $derived.by(() => `repoScroll:${$page.params.id}:patches`)
  const relayUrl = $derived.by(() => ($page.params.relay ? decodeRelay($page.params.relay) : ""))
  const reactionRelays = $derived.by(() => {
    const scoped = [...repoRelays].filter(Boolean)

    if (scoped.length > 0) return scoped

    return relayUrl ? [relayUrl] : []
  })

  const getReactionProtect = async () => {
    if (!relayUrl) return false

    try {
      return await canEnforceNip70(relayUrl)
    } catch {
      return false
    }
  }

  const deleteReaction = async (event: TrustedEvent) => {
    const relays = reactionRelays
    if (relays.length === 0) return

    publishDelete({
      relays,
      event,
      protect: await getReactionProtect(),
    })
  }

  const createReaction = async (
    target: TrustedEvent,
    template: {content: string; tags?: string[][]},
  ) => {
    const relays = reactionRelays
    if (relays.length === 0) return

    publishReaction({
      ...template,
      event: target,
      relays,
      protect: await getReactionProtect(),
    })
  }
  const patchesSeenKey = $derived.by(() => `${patchesPath}:seen`)
  const normalizeChecked = (value: number) =>
    value > 10_000_000_000 ? Math.round(value / 1000) : value
  const lastPatchesSeen = $derived.by(() => normalizeChecked($checked[patchesSeenKey] || 0))
  const repoAddress = $derived.by(() => repoClass?.address || "")
  const effectiveRepoAddresses = $derived.by((): string[] => {
    if (!repoAddress) return []
    return Array.from(getEffectiveRepoAddresses($effectiveRepoAddressesByRepoAddress, repoAddress))
  })
  const effectiveMaintainers = $derived.by((): string[] => {
    if (!repoAddress) {
      return Array.from(new Set((repoClass?.maintainers || []).filter(Boolean)))
    }
    const maintainers = $effectiveMaintainersByRepoAddress.get(repoAddress)
    if (maintainers && maintainers.size > 0) return Array.from(maintainers)
    return Array.from(new Set((repoClass?.maintainers || []).filter(Boolean)))
  })

  const withRecipients = (event: PullRequestEvent, recipients: string[]): PullRequestEvent => {
    const dedupedRecipients = Array.from(new Set(recipients.filter(Boolean)))
    const tags = (event.tags || []).filter((tag: string[]) => tag[0] !== "p")
    tags.push(...dedupedRecipients.map((recipient: string) => ["p", recipient] as ["p", string]))
    return {
      ...event,
      tags,
    }
  }

  type LabelGroups = {
    Status: string[]
    Type: string[]
    Area: string[]
    Tags: string[]
    Other: string[]
  }

  type PatchListItem = {
    id: string
    created_at: number
    pubkey: string
    event: PatchEvent | PullRequestEvent
    patches: PatchEvent[]
    status: {kind: number}
    parsedPatch: {
      title: string
    }
    comments: CommentEvent[]
    commitCount: number
    groups: LabelGroups
  }

  type PatchStatusKey = "open" | "applied" | "closed" | "draft"
  type TrustFilterKey = "all" | "trusted" | "trusted-author" | "trusted-maintainer"

  const PATCH_STATUS_ORDER: PatchStatusKey[] = ["open", "applied", "draft", "closed"]
  const PATCH_STATUS_LABELS: Record<PatchStatusKey, string> = {
    open: "Open",
    applied: "Applied",
    closed: "Closed",
    draft: "Draft",
  }

  const createPatchStatusCounts = (): Record<PatchStatusKey, number> => ({
    open: 0,
    applied: 0,
    closed: 0,
    draft: 0,
  })

  // Comments are managed locally, similar to issues page
  let comments = $state<CommentEvent[]>([])
  const mergedStatusEventsByRoot = $derived.by(() => statusEventsByRoot || new Map<string, StatusEvent[]>())

  // Load comments for patches and PRs - defer to avoid blocking render
  $effect(() => {
    if (!repoClass) return

    // Access reactive dependencies synchronously to ensure they're tracked
    const currentPatches = repoClass.patches
    const currentPullRequests = pullRequests
    const currentRepoRelays = repoRelays.filter(Boolean)

    if (currentRepoRelays.length === 0) return

    const controller = new AbortController()
    abortControllers.push(controller)

    // Defer comment loading to avoid blocking initial render
    const timeout = setTimeout(() => {
      const allRootIds = [
        ...currentPatches.map((p: PatchEvent) => p.id),
        ...currentPullRequests.map((pr: PullRequestEvent) => pr.id),
      ]

      if (allRootIds.length > 0) {
        request({
          relays: currentRepoRelays,
          signal: controller.signal,
          filters: [
            {kinds: [COMMENT], "#E": allRootIds},
            {kinds: [COMMENT], "#e": allRootIds},
          ],
          onEvent: e => {
            if (!comments.some(c => c.id === e.id)) {
              comments = [...comments, e as CommentEvent]
            }
            if (!repository.getEvent(e.id)) {
              repository.publish(e as CommentEvent)
            }
          },
        })
      }
    }, 100)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  // Create filters for makeFeed (needed for incremental loading)
  const patchFilter = $derived.by(() => ({
    kinds: [1617],
    "#a": effectiveRepoAddresses,
  }))

  const pullRequestFilter = $derived.by(() => ({
    kinds: [1618],
    "#a": effectiveRepoAddresses,
  }))

  const uniqueAuthors = $derived.by(() => {
    if (!repoClass) return []
    const authors = new Set(repoClass.patches.map((patch: PatchEvent) => patch.pubkey))
    return Array.from(authors)
  })

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortBy = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let trustFilter = $state<TrustFilterKey>("all")
  let trustSortFirst = $state(false)
  let showFilters = $state(true)
  let searchTerm = $state("")
  // Label filters (NIP-32)
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)
  // Centralized labels via app state

  // Optimize labelsData: compute lazily and cache results to avoid blocking render
  // Use a Map to track subscriptions and clean them up properly
  let labelsDataCache = $state<{
    byId: Map<string, string[]>
    groupsById: Map<string, Record<string, string[]>>
    allLabels: string[]
  }>({
    byId: new Map<string, string[]>(),
    groupsById: new Map<string, Record<string, string[]>>(),
    allLabels: [],
  })
  let labelsDataCacheKey = ""

  // Compute labelsData asynchronously to avoid blocking render
  $effect(() => {
    if (!repoClass) return

    // Access reactive dependency synchronously to ensure it's tracked
    const currentPatches = repoClass.patches

    // Create cache key from patch IDs to detect changes
    const currentKey = currentPatches
      .map(p => p.id)
      .sort()
      .join(",")

    // Skip if already computed for this set of patches
    if (labelsDataCacheKey === currentKey) return

    // Defer heavy computation to avoid blocking initial render
    const timeout = setTimeout(() => {
      const byId = new Map<string, string[]>()
      const groupsById = new Map<string, Record<string, string[]>>()

      for (const patch of currentPatches) {
        try {
          // Use deriveEffectiveLabels to get proper NIP-32 labels
          // Only get value once - don't subscribe to avoid memory leaks
          const effStore = deriveEffectiveLabels(patch.id)
          const effValue = effStore.get()
          const eff = normalizeEffectiveLabels(effValue)
          const naturals = toNaturalArray(eff?.flat)
          byId.set(patch.id, naturals)
          const groups = eff
            ? groupLabels(eff)
            : {Status: [], Type: [], Area: [], Tags: [], Other: []}
          groupsById.set(patch.id, groups)
        } catch (e) {
          // Fallback to empty labels if computation fails
          byId.set(patch.id, [])
          groupsById.set(patch.id, {Status: [], Type: [], Area: [], Tags: [], Other: []})
        }
      }

      const allLabels = Array.from(new Set(Array.from(byId.values()).flat()))
      labelsDataCache = {byId, groupsById, allLabels}
      labelsDataCacheKey = currentKey
    })

    // Cleanup function to cancel timeout
    return () => {
      clearTimeout(timeout)
    }
  })

  // Return cached labelsData synchronously
  const labelsData = $derived(labelsDataCache)

  const roleAssignments = $derived.by(() => {
    const ids = repoClass.patches?.map((p: any) => p.id) || []
    return deriveAssignmentsFor(ids)
  })

  const labelsByPatch = $derived.by(() => labelsData.byId)
  const labelGroupsFor = (id: string): LabelGroups =>
    (labelsData.groupsById.get(id) as LabelGroups | undefined) || {
      Status: [],
      Type: [],
      Area: [],
      Tags: [],
      Other: [],
    }

  // Persist filters per repo (delegated to FilterPanel)
  const storageKey = repoClass?.key ? `patchesFilters:${repoClass.key}` : ""
  const allNormalizedLabels = $derived.by(() =>
    Array.from(new Set(Array.from(labelsByPatch.values()).flat())),
  )
  const trustFilterOptions: Array<{value: TrustFilterKey; label: string}> = [
    {value: "all", label: "All activity"},
    {value: "trusted", label: "Trusted only"},
    {value: "trusted-author", label: "Trusted authors"},
    {value: "trusted-maintainer", label: "Trusted maintainer merges"},
  ]
  const trustFilterStatus = $derived.by(() => {
    if (repoTrustMetrics.status === "loading") {
      return `Refreshing ${repoTrustMetrics.graphLabel.toLowerCase()} metrics for this repository...`
    }

    if (repoTrustMetrics.status === "error") {
      return repoTrustMetrics.error || "Unable to compute trust metrics right now."
    }

    if (repoTrustMetrics.totalPullRequests === 0) {
      return "No pull requests loaded yet for trust activity metrics."
    }

    if (repoTrustMetrics.enabledRuleCount > 0) {
      return `Using ${repoTrustMetrics.graphLabel} across ${repoTrustMetrics.enabledRuleCount} graph rule${repoTrustMetrics.enabledRuleCount === 1 ? "" : "s"}.`
    }

    return "Using the basic WoT fallback. Add graph adjustments in Trust settings to refine these metrics."
  })

  $effect(() => {
    const searchParams = $page.url.searchParams
    const trustParam = searchParams.get("trust") || ""
    const sortParam = searchParams.get("trustSort") || ""
    trustFilter = trustFilterOptions.find(option => option.value === trustParam)?.value || "all"
    trustSortFirst = sortParam === "first"
  })

  $effect(() => {
    const currentTrust = $page.url.searchParams.get("trust") || ""
    const currentTrustSort = $page.url.searchParams.get("trustSort") || ""
    const nextTrust = trustFilter === "all" ? "" : trustFilter
    const nextTrustSort = trustSortFirst ? "first" : ""

    if (currentTrust === nextTrust && currentTrustSort === nextTrustSort) {
      return
    }

    const params = new URLSearchParams($page.url.searchParams)

    if (nextTrust) {
      params.set("trust", nextTrust)
    } else {
      params.delete("trust")
    }

    if (nextTrustSort) {
      params.set("trustSort", nextTrustSort)
    } else {
      params.delete("trustSort")
    }

    goto(`${patchesPath}${params.toString() ? `?${params.toString()}` : ""}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
      invalidateAll: false,
    })
  })

  // Precompute status via PatchManager; map state -> kind where needed (fallback)
  const statusData = $derived.by(() =>
    repoClass
      ? repoClass.patchManager.getStatusData(repoClass)
      : {stateById: {}, commentsByPatch: {}},
  )
  const kindFromState = (s?: string) =>
    s === "open"
      ? GIT_STATUS_OPEN
      : s === "draft"
        ? GIT_STATUS_DRAFT
        : s === "closed"
          ? GIT_STATUS_CLOSED
          : GIT_STATUS_COMPLETE // merged/resolved

  // Compute current status state using Status.svelte rules (authorized events)
  const patchMaintainerSet = $derived.by(() => {
    if (!repoClass) return new Set<string>()
    try {
      const maintainers = repoClass.maintainers || []
      const owner = (repoClass as any).repoEvent?.pubkey
      return new Set([...(maintainers || []), owner].filter(Boolean))
    } catch {
      return new Set<string>()
    }
  })
  const currentPatchStateFor = (rootId: string): "open" | "draft" | "closed" | "applied" => {
    if (!repoClass) return "open"
    try {
      const events = (mergedStatusEventsByRoot?.get(rootId) || []) as StatusEvent[]
      const rootAuthor =
        repoClass.patches.find((p: any) => p.id === rootId)?.pubkey ||
        (pullRequests || []).find((pr: any) => pr.id === rootId)?.pubkey
      const auth = events.filter(e => e.pubkey === rootAuthor || patchMaintainerSet.has(e.pubkey))
      if (auth.length === 0) return "open"
      const latest = [...auth].sort((a, b) => b.created_at - a.created_at)[0]
      switch (latest.kind) {
        case GIT_STATUS_OPEN:
          return "open"
        case GIT_STATUS_DRAFT:
          return "draft"
        case GIT_STATUS_CLOSED:
          return "closed"
        case GIT_STATUS_COMPLETE:
          return "applied"
        default:
          return "open"
      }
    } catch {
      return "open"
    }
  }

  const getPatchCommentRootId = (comment: CommentEvent) => {
    const rootTag = (comment.tags || []).find(
      (tag: string[]) => tag[0] === "E" || (tag[0] === "e" && tag[3] === "root"),
    )

    return rootTag?.[1] || getTagValue("E", comment.tags) || getTagValue("e", comment.tags) || ""
  }

  // Compute patchList asynchronously to avoid blocking UI rendering
  let allPatchItems = $state<PatchListItem[]>([])
  let patchList = $state<PatchListItem[]>([])
  let patchListCacheKey = ""

  $effect(() => {
    // Access all reactive dependencies synchronously to ensure they're tracked
    if (!repoClass) return

    const currentPatches = repoClass.patches
    const currentComments = comments
    const currentStatusData = statusData
    const currentPullRequests = pullRequests
    const currentStatusFilter = statusFilter
    const currentAuthorFilter = authorFilter
    const currentTrustFilter = trustFilter
    const currentTrustSortFirst = trustSortFirst
    const currentSortBy = sortBy
    const currentPatchListCacheKey = patchListCacheKey
    const currentMergedStatusEventsByRoot = mergedStatusEventsByRoot
    const currentRepoTrustMetrics = repoTrustMetrics

    const timeout = setTimeout(() => {
      const hasPatches = currentPatches && currentPatches.length > 0
      const hasPRs = currentPullRequests && currentPullRequests.length > 0
      if (!hasPatches && !hasPRs) {
        allPatchItems = []
        patchList = []
        return
      }

      // Create cache key from patch IDs, comments, status, filters, and sort to detect changes
      const statusKey = [...(currentMergedStatusEventsByRoot?.entries() || [])]
        .map(([id, evts]) => `${id}:${evts[0]?.kind ?? ""}`)
        .sort()
        .join(",")
      const currentKey = [
        currentPatches
          .map(p => p.id)
          .sort()
          .join(","),
        currentComments
          .map(c => c.id)
          .sort()
          .join(","),
        currentStatusData.stateById
          ? Object.keys(currentStatusData.stateById).sort().join(",")
          : "",
        currentPullRequests
          .map(pr => pr.id)
          .sort()
          .join(","),
        currentStatusFilter,
        currentAuthorFilter,
        currentTrustFilter,
        currentTrustSortFirst ? "trust-first" : "trust-normal",
        currentSortBy,
        statusKey,
        Array.from(currentRepoTrustMetrics.byRootId.entries())
          .map(
            ([id, metric]) =>
              `${id}:${metric.trustedActorCount}:${metric.trustedAuthor ? 1 : 0}:${metric.trustedMaintainerMerge ? 1 : 0}`,
          )
          .sort()
          .join(","),
      ].join("|")

      if (currentPatchListCacheKey === currentKey) return

      // Pre-build indexes for O(1) lookups instead of O(n) filtering per patch
      // Map of root ID -> child patches
      const childPatchesByRoot = new Map<string, PatchEvent[]>()
      for (const patch of currentPatches) {
        const rootTag = getTags(patch, "e").find((tag: string[]) => tag[1])
        if (rootTag && rootTag[1]) {
          const rootId = rootTag[1]
          if (!childPatchesByRoot.has(rootId)) {
            childPatchesByRoot.set(rootId, [])
          }
          childPatchesByRoot.get(rootId)!.push(patch)
        }
      }

      // Map of patch ID -> comments (reuse for PRs too)
      const commentsByPatch = new Map<string, CommentEvent[]>()
      for (const comment of currentComments) {
        const patchId = getPatchCommentRootId(comment)
        if (patchId) {
          if (!commentsByPatch.has(patchId)) {
            commentsByPatch.set(patchId, [])
          }
          commentsByPatch.get(patchId)!.push(comment)
        }
      }

      // Get all root patches first
      const rootPatches = currentPatches.filter((patch: PatchEvent) => {
        return getTags(patch, "t").find((tag: string[]) => tag[1] === "root")
      })

      // Process all patches at once
      const processed: PatchListItem[] = []
      for (const patch of rootPatches) {
        // Use manager-provided state and derive kind for UI
        const status = {kind: kindFromState((currentStatusData.stateById as any)[patch.id])} as any

        // O(1) lookup instead of O(n) filter
        const patches = childPatchesByRoot.get(patch.id) || []
        const parsedPatch = parseGitPatchFromEvent(patch)

        // O(1) lookup instead of O(c) filter
        const commentEvents = commentsByPatch.get(patch.id) || []

        processed.push({
          id: patch.id,
          created_at: patch.created_at,
          pubkey: patch.pubkey,
          event: patch,
          patches,
          status,
          parsedPatch: {
            title: parsedPatch?.title || "(no title)",
          },
          comments: commentEvents,
          commitCount: parsedPatch?.commitCount || 0,
          groups: labelGroupsFor(patch.id),
        })
      }

      // All patches processed, now merge PRs, filter, and sort
      const applyFiltersAndSort = (
        allPatches: PatchListItem[],
        commentsByPatch: Map<string, CommentEvent[]>,
      ) => {
        // Merge in PR roots
        const prEvents = currentPullRequests || []
        const prItems = prEvents.map((pr: PullRequestEvent) => {
          const parsedPR: any = parsePullRequestEvent(pr)
          // O(1) lookup instead of O(c) filter
          const commentEvents = commentsByPatch.get(pr.id) || []
          const status = {kind: kindFromState(currentPatchStateFor(pr.id))} as any
          return {
            id: pr.id,
            created_at: pr.created_at,
            pubkey: pr.pubkey,
            event: pr,
            patches: [],
            status,
            parsedPatch: {
              title: parsedPR.subject || parsedPR.title || "(no title)",
            },
            comments: commentEvents,
            commitCount: 0,
            groups: {Status: [], Type: [], Area: [], Tags: [], Other: []},
          } satisfies PatchListItem
        })

        // Merge PR items into the unified list
        const combinedPatches = [...allPatches, ...prItems]
        allPatchItems = combinedPatches
        let filteredPatches = [...combinedPatches]

        // Apply status filter
        if (currentStatusFilter !== "all") {
          filteredPatches = filteredPatches.filter(patch => {
            const state = currentPatchStateFor(patch.id)
            if (currentStatusFilter === "open") return state === "open"
            if (currentStatusFilter === "applied") return state === "applied"
            if (currentStatusFilter === "closed") return state === "closed"
            if (currentStatusFilter === "draft") return state === "draft"
            return true
          })
        }

        // Apply author filter
        if (currentAuthorFilter) {
          filteredPatches = filteredPatches.filter(patch => patch.pubkey === currentAuthorFilter)
        }

        // Apply trust filter
        if (currentTrustFilter !== "all") {
          filteredPatches = filteredPatches.filter(patch => {
            const metric = currentRepoTrustMetrics.byRootId.get(patch.id)

            if (!metric) return false

            if (currentTrustFilter === "trusted") {
              return metric.trustedActorCount > 0
            }

            if (currentTrustFilter === "trusted-author") {
              return metric.trustedAuthor
            }

            if (currentTrustFilter === "trusted-maintainer") {
              return metric.trustedMaintainerMerge
            }

            return true
          })
        }

        // Apply sorting
        const sortedPatches = [...filteredPatches]
        if (currentSortBy === "newest") {
          sortedPatches.sort((a, b) => b.created_at - a.created_at)
        } else if (currentSortBy === "oldest") {
          sortedPatches.sort((a, b) => a.created_at - b.created_at)
        } else if (currentSortBy === "status") {
          // Sort by current state priority using Status.svelte semantics
          const prio = (id: string) => {
            const s = currentPatchStateFor(id)
            return s === "open" ? 0 : s === "draft" ? 1 : s === "applied" ? 2 : 3
          }
          sortedPatches.sort((a, b) => prio(a.id) - prio(b.id))
        } else if (currentSortBy === "commits") {
          // Sort by commit count (highest first)
          sortedPatches.sort((a, b) => b.commitCount - a.commitCount)
        }

        if (currentTrustSortFirst) {
          sortedPatches.sort((a, b) => {
            const trustA = currentRepoTrustMetrics.byRootId.get(a.id)
            const trustB = currentRepoTrustMetrics.byRootId.get(b.id)
            const actorCountA = trustA?.trustedActorCount || 0
            const actorCountB = trustB?.trustedActorCount || 0
            const authorA = trustA?.trustedAuthor ? 1 : 0
            const authorB = trustB?.trustedAuthor ? 1 : 0
            const maintainerA = trustA?.trustedMaintainerMerge ? 1 : 0
            const maintainerB = trustB?.trustedMaintainerMerge ? 1 : 0

            if (actorCountA !== actorCountB) return actorCountB - actorCountA
            if (authorA !== authorB) return authorB - authorA
            if (maintainerA !== maintainerB) return maintainerB - maintainerA

            return b.created_at - a.created_at
          })
        }

        // Update patchList with final filtered and sorted result
        patchList = sortedPatches
        patchListCacheKey = currentKey
      }

      // Apply filters and sort
      applyFiltersAndSort(processed, commentsByPatch)
    }, 100)

    return () => {
      clearTimeout(timeout)
    }
  })


  // Set loading to false immediately - show content right away
  const loading = false
  const ITEMS_PER_PAGE = 20
  let visiblePatchCount = $state(ITEMS_PER_PAGE)
  let element: HTMLElement | undefined = $state()
  let showScrollButton = $state(false)
  let scrollParent: HTMLElement | null = $state(null)
  let lastKnownPatchIndex = $state(0)
  let lastKnownPatchOffset = $state(0)
  let lastKnownPatchId = $state("")
  let lastKnownPatchTitle = $state("")
  let pendingScrollRestore = $state<{
    index: number
    offset: number
    id: string
    title: string
    visibleCount: number
  } | null>(null)
  let didRestoreScroll = $state(false)
  let restoreAttemptCount = 0
  let restoreInProgress = $state(false)
  const maxRestoreAttempts = 12
  let feedInitialized = $state(false)
  let feedCleanup: (() => void) | undefined = $state(undefined)
  let feedInitTimer: ReturnType<typeof setTimeout> | null = null
  // Use non-reactive array to avoid infinite loops when pushing in effects
  const abortControllers: AbortController[] = []

  $effect(() => {
    const container = element
    if (!container) return

    scrollParent = container.closest(".scroll-container") as HTMLElement | null
  })

  $effect(() => {
    const scrollEl = scrollParent
    if (!scrollEl) return

    const handleScroll = () => {
      showScrollButton = scrollEl.scrollTop > 1500
      updateVisibleAnchor()
    }

    handleScroll()
    scrollEl.addEventListener("scroll", handleScroll, {passive: true})
    return () => scrollEl.removeEventListener("scroll", handleScroll)
  })

  const getPatchAnchorPayload = (patchId: string) => {
    const patchIndex = searchedPatches.findIndex(patch => patch.id === patchId)
    const patch = patchIndex >= 0 ? searchedPatches[patchIndex] : undefined
    const title = patch?.parsedPatch?.title || ""

    let offset = lastKnownPatchOffset
    if (scrollParent) {
      const containerRect = scrollParent.getBoundingClientRect()
      const itemEl = scrollParent.querySelector(`[data-patch-id="${patchId}"]`) as HTMLElement | null
      const itemRect = itemEl?.getBoundingClientRect()
      if (itemRect) {
        offset = itemRect.top - containerRect.top
      }
    }

    return {
      index: patchIndex >= 0 ? patchIndex : lastKnownPatchIndex,
      offset,
      id: patchId,
      title,
      visibleCount: patchIndex >= 0 ? Math.max(visiblePatchCount, patchIndex + 1) : visiblePatchCount,
    }
  }

  const updateVisibleAnchor = () => {
    const scrollEl = scrollParent
    if (!scrollEl || searchedPatches.length === 0) return

    const items = Array.from(scrollEl.querySelectorAll("[data-patch-id]")) as HTMLElement[]
    if (items.length === 0) return

    const containerRect = scrollEl.getBoundingClientRect()
    const anchor = items.find(item => item.getBoundingClientRect().bottom > containerRect.top) ?? items[0]

    if (!anchor) return

    const patchId = anchor.dataset.patchId ?? ""
    const parsedIndex = Number(anchor.dataset.index)
    const index = Number.isFinite(parsedIndex)
      ? parsedIndex
      : searchedPatches.findIndex(patch => patch.id === patchId)
    if (index < 0) return

    const patch = searchedPatches[index]
    const anchorOffset = anchor.getBoundingClientRect().top - containerRect.top

    lastKnownPatchIndex = index
    lastKnownPatchOffset = anchorOffset
    lastKnownPatchId = patch?.id ?? ""
    lastKnownPatchTitle = patch?.parsedPatch?.title || ""
  }

  const handlePatchClick = (event: MouseEvent, patch: PatchListItem, index: number) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target as HTMLElement | null
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!anchor) return

    const href = anchor.getAttribute("href") || ""
    if (!href.includes(`patches/${patch.id}`)) return

    const scrollEl = scrollParent
    if (!scrollEl) return

    const itemElement = event.currentTarget as HTMLElement | null
    const containerRect = scrollEl.getBoundingClientRect()
    const itemRect = itemElement?.getBoundingClientRect()
    const anchorOffset = itemRect ? itemRect.top - containerRect.top : lastKnownPatchOffset

    pendingScrollRestore = {
      index,
      offset: anchorOffset,
      id: patch.id,
      title: patch.parsedPatch?.title || "",
      visibleCount: Math.max(visiblePatchCount, index + 1),
    }
  }

  $effect(() => {
    const scrollEl = scrollParent
    const count = searchedPatches.length
    const restoring = restoreInProgress

    if (didRestoreScroll || restoring || !scrollEl || count === 0) return
    if (typeof sessionStorage === "undefined") {
      didRestoreScroll = true
      return
    }

    const savedRaw = sessionStorage.getItem(scrollStorageKey)
    if (!savedRaw) {
      didRestoreScroll = true
      return
    }

    let parsedIndex = 0
    let parsedOffset = 0
    let savedPatchId = ""

    try {
      const parsed = JSON.parse(savedRaw) as {
        index?: number
        offset?: number
        id?: string
        visibleCount?: number
      }
      parsedIndex = Number(parsed?.index ?? 0)
      parsedOffset = Number(parsed?.offset ?? 0)
      savedPatchId = typeof parsed?.id === "string" ? parsed.id : ""

      const parsedVisibleCount = Number(parsed?.visibleCount ?? ITEMS_PER_PAGE)
      if (
        !Number.isNaN(parsedVisibleCount) &&
        parsedVisibleCount > 0 &&
        visiblePatchCount < parsedVisibleCount
      ) {
        visiblePatchCount = Math.min(Math.max(parsedVisibleCount, ITEMS_PER_PAGE), count)
        return
      }
    } catch {
      sessionStorage.removeItem(scrollStorageKey)
      didRestoreScroll = true
      return
    }

    if (Number.isNaN(parsedIndex) || Number.isNaN(parsedOffset)) {
      sessionStorage.removeItem(scrollStorageKey)
      didRestoreScroll = true
      return
    }

    const fallbackIndex = Math.min(Math.max(parsedIndex, 0), count - 1)
    const matchIndex = savedPatchId ? searchedPatches.findIndex(patch => patch.id === savedPatchId) : -1

    if (savedPatchId && matchIndex < 0) {
      restoreAttemptCount += 1
      if (restoreAttemptCount < maxRestoreAttempts) {
        return
      }

      sessionStorage.removeItem(scrollStorageKey)
      didRestoreScroll = true
      restoreAttemptCount = 0
      return
    }

    const targetIndex = matchIndex >= 0 ? matchIndex : fallbackIndex
    const requiredVisibleCount = Math.max(targetIndex + 1, ITEMS_PER_PAGE)
    if (visiblePatchCount < requiredVisibleCount) {
      visiblePatchCount = Math.min(requiredVisibleCount, count)
      return
    }

    const targetPatch = searchedPatches[targetIndex]
    const targetPatchId = targetPatch?.id ?? ""
    const anchorPatchId = savedPatchId || targetPatchId

    restoreInProgress = true

    const finishRestore = () => {
      didRestoreScroll = true
      restoreAttemptCount = 0
      restoreInProgress = false
    }

    const settleToAnchor = (attempt = 0) => {
      if (!anchorPatchId) {
        finishRestore()
        return
      }

      const itemEl = scrollEl.querySelector(`[data-patch-id="${anchorPatchId}"]`) as HTMLElement | null
      if (!itemEl) {
        if (attempt < maxRestoreAttempts) {
          setTimeout(() => settleToAnchor(attempt + 1), 50)
        } else {
          finishRestore()
        }
        return
      }

      const containerRect = scrollEl.getBoundingClientRect()
      const itemRect = itemEl.getBoundingClientRect()
      const currentOffset = itemRect.top - containerRect.top
      const delta = currentOffset - parsedOffset
      if (Math.abs(delta) > 1) {
        scrollEl.scrollBy({top: delta, behavior: "auto"})
      }
      finishRestore()
    }

    const attemptRestore = () => {
      const targetElement = scrollEl.querySelector(`[data-patch-id="${anchorPatchId}"]`) as HTMLElement | null
      if (targetElement) {
        targetElement.scrollIntoView({block: "start"})
      }
      setTimeout(() => settleToAnchor(0), 40)
    }

    void tick().then(() => {
      requestAnimationFrame(attemptRestore)
    })
  })

  beforeNavigate(({from, to}) => {
    if (from?.route.id !== "/spaces/[relay]/git/[id=naddr]/patches") return
    if (typeof sessionStorage === "undefined") return

    const relayParam = $page.params.relay ?? ""
    const basePath = `/spaces/${encodeURIComponent(relayParam)}/git/${$page.params.id}`
    const nextPath = to?.url.pathname
    if (!nextPath || !nextPath.startsWith(basePath)) {
      sessionStorage.removeItem(scrollStorageKey)
      pendingScrollRestore = null
      return
    }

    const isPatchDetailNav = to?.route.id === "/spaces/[relay]/git/[id=naddr]/patches/[patchid]"
    const nextPatchId = isPatchDetailNav ? (to?.params as {patchid?: string} | undefined)?.patchid : ""

    const payload = isPatchDetailNav && nextPatchId
      ? getPatchAnchorPayload(nextPatchId)
      : pendingScrollRestore ?? {
          index: lastKnownPatchIndex,
          offset: lastKnownPatchOffset,
          id: lastKnownPatchId,
          title: lastKnownPatchTitle,
          visibleCount: visiblePatchCount,
        }

    sessionStorage.setItem(scrollStorageKey, JSON.stringify(payload))
    pendingScrollRestore = null
  })

  const onCommentCreated = async (comment: CommentEvent) => {
    postComment(comment, repoRelays)
  }

  const scrollToTop = () => {
    scrollParent?.scrollTo({top: 0, behavior: "smooth"})
  }

  const onPRCreated = async (prEvent: PullRequestEvent) => {
    const relaysToUse = repoRelays.length ? repoRelays : repoClass.relays
    if (!relaysToUse || relaysToUse.length === 0) {
      toast.push({
        message: "No relays available to publish pull request.",
        variant: "destructive",
      })
      return
    }

    const evt = repoClass.repoEvent
    if(!evt) {
      toast.push({
        message: "No repository event found to publish pull request.",
        variant: "destructive",
      })
      return
    }

    const maintainers = Array.from(new Set([
      ...effectiveMaintainers,
      evt.pubkey,
    ].filter(Boolean)))
    const prEventWithRecipients = withRecipients(prEvent, maintainers)

    const publishedPR = publishEvent(prEventWithRecipients, relaysToUse)

    const rootId = publishedPR.event.id

    const statusEvent = createStatusEvent({
      kind: GIT_STATUS_OPEN,
      content: "",
      rootId,
      recipients: Array.from(new Set([...maintainers, $pubkey].filter((v): v is string => Boolean(v)))),
      repoAddr: repoClass.address,
      relays: relaysToUse,
    })
    publishEvent(statusEvent as any, relaysToUse)
    pushToast({ message: "Pull request created" })
  }

  const onNewPR = () => {
    const evt = repoClass.repoEvent
    if(!evt) {
      toast.push({
        message: "No repository event found to publish pull request.",
        variant: "destructive",
      })
      return
    }

    const repoDtag = getTagValue("d", evt.tags)
    if(!repoDtag) return

    pushModal(NewPRForm, {
      repo: repoClass,
      onPRCreated,
    })
  }

  const getLatestPatchActivityAt = (patch: {id: string; created_at?: number; comments?: CommentEvent[]}) => {
    let commentAt = 0
    for (const comment of patch.comments || []) {
      if (comment.created_at > commentAt) commentAt = comment.created_at
    }
    const statusEvents = mergedStatusEventsByRoot?.get(patch.id) || []
    let statusAt = 0
    for (const event of statusEvents) {
      if (event.created_at > statusAt) statusAt = event.created_at
    }
    const createdAt = patch?.created_at || 0
    return Math.max(createdAt, commentAt, statusAt)
  }

  const getPatchesSeenAt = () => {
    let latest = lastPatchesSeen
    for (const patch of allPatchItems) {
      latest = Math.max(latest, getLatestPatchActivityAt(patch))
    }
    return latest
  }

  const unreadStatusCounts = $derived.by(() => {
    const counts = createPatchStatusCounts()

    for (const patch of allPatchItems) {
      if (getLatestPatchActivityAt(patch) <= lastPatchesSeen) continue
      counts[currentPatchStateFor(patch.id)] += 1
    }

    return counts
  })

  const suggestedUnreadStatus = $derived.by(() => {
    if (searchTerm.trim()) return null
    if (authorFilter) return null
    if (selectedLabels.length > 0) return null
    if (statusFilter === "all") return null

    const currentStatus = statusFilter as PatchStatusKey
    const candidates = PATCH_STATUS_ORDER.filter(status => status !== currentStatus)

    let nextStatus: PatchStatusKey | null = null
    for (const status of candidates) {
      if (unreadStatusCounts[status] === 0) continue
      if (!nextStatus || unreadStatusCounts[status] > unreadStatusCounts[nextStatus]) {
        nextStatus = status
      }
    }

    return nextStatus
  })


  // Initialize feed asynchronously - don't block render
  $effect(() => {
    // Access reactive dependencies synchronously to ensure they're tracked
    const currentRepoClass = repoClass
    const currentPatchFilter = patchFilter
    const currentPullRequestFilter = pullRequestFilter
    const currentRepoRelays = repoRelays
    const currentRepoAddresses = effectiveRepoAddresses
    const currentElement = element

    if (feedInitialized || feedCleanup) return
    if (!currentRepoClass || !currentRepoClass.patches || !currentPatchFilter || !currentPullRequestFilter)
      return
    if (!currentElement || !currentRepoRelays.length || currentRepoAddresses.length === 0) return

    // Defer makeFeed to avoid blocking initial render
    feedInitTimer = setTimeout(() => {
      feedInitTimer = null
      if (feedInitialized || feedCleanup) return
      if (!element || !repoRelays.length || effectiveRepoAddresses.length === 0) return
      feedInitialized = true
      const feed = makeFeed({
        element,
        relays: repoRelays,
        feedFilters: [patchFilter, pullRequestFilter],
        subscriptionFilters: [patchFilter, pullRequestFilter],
        initialEvents: patchList.map(patch => patch.event as TrustedEvent),
        onExhausted: () => {
          // Feed exhausted, but we already showed content
        },
      })
      feedCleanup = feed.cleanup
    }, 100)

    return () => {
      if (feedInitTimer) {
        clearTimeout(feedInitTimer)
        feedInitTimer = null
      }
    }
  })

  // CRITICAL: Cleanup on destroy to prevent memory leaks and blocking navigation
  onDestroy(() => {
    const seenAt = getPatchesSeenAt()
    setCheckedAt(patchesSeenKey, seenAt)
    setCheckedAt(patchesPath, seenAt)
    if (repoAddress && relayUrl) {
      setCheckedForRepoNotifications($notifications, {
        relay: relayUrl,
        repoAddress,
        repoAddresses: effectiveRepoAddresses,
        kind: "patches",
      }, seenAt)
    }
    // Cleanup makeFeed (aborts network requests, stops scroll observers, unsubscribes)
    feedCleanup?.()
    feedCleanup = undefined
    feedInitialized = false

    if (feedInitTimer) {
      clearTimeout(feedInitTimer)
      feedInitTimer = null
    }

    // Abort all network requests
    abortControllers.forEach(controller => controller.abort())
    abortControllers.length = 0 // Clear array without reassignment
  })

  const searchedPatches = $derived.by(() => {
    const patchesToSearch = patchList.map(patch => {
      return {
        id: patch.id,
        title: patch.parsedPatch.title,
      }
    })

    const patchesSearch = createSearch(patchesToSearch, {
      getValue: (patch: {id: string; title: string}) => patch.id,
      fuseOptions: {
        keys: [{name: "title"}],
        includeScore: true,
        threshold: 0.3,
        isCaseSensitive: false,
        // When true, search will ignore location and distance, so it won't
        // matter where in the string the pattern appears
        ignoreLocation: true,
      },
      sortFn: ({score, item}) => {
        if (score && score > 0.3) return -score!
        return item.title
      },
    })
    const searchResults = patchesSearch.searchOptions(searchTerm)
    const result = patchList
      .filter(p => searchResults.find(res => res.id === p.id))
      .filter(p => {
        if (selectedLabels.length === 0) return true
        const labs = labelsByPatch.get(p.id) || []
        return matchAllLabels
          ? selectedLabels.every(l => labs.includes(l))
          : selectedLabels.some(l => labs.includes(l))
      })
    return result
  })

  $effect(() => {
    void [searchTerm, statusFilter, authorFilter, trustFilter, trustSortFirst, selectedLabels, matchAllLabels, sortBy]
    visiblePatchCount = ITEMS_PER_PAGE
  })

  $effect(() => {
    const total = searchedPatches.length
    if (visiblePatchCount > total) {
      visiblePatchCount = total
      return
    }

    if (total > 0 && visiblePatchCount === 0) {
      visiblePatchCount = Math.min(ITEMS_PER_PAGE, total)
    }
  })

  const visiblePatches = $derived.by(() => searchedPatches.slice(0, visiblePatchCount))
  const canLoadMorePatches = $derived.by(() => visiblePatchCount < searchedPatches.length)

  const loadMorePatches = () => {
    visiblePatchCount = Math.min(visiblePatchCount + ITEMS_PER_PAGE, searchedPatches.length)
  }
</script>

<svelte:head>
  <title>{repoClass?.name || "Repository"} - Patches</title>
</svelte:head>

<div bind:this={element}>
  <div class="mb-2 flex flex-col gap-y-2 py-4">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-xl font-semibold">Patches</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Review and merge code changes</p>
      </div>
      {#if $pubkey}
        <Button class="btn btn-primary btn-sm" onclick={onNewPR}>
          <GitPullRequest class="h-4 w-4" />
          New PR
        </Button>
      {/if}
    </div>
    <div class="row-2 input grow overflow-x-hidden">
      <Icon icon={Magnifer} />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus={!isMobile}
        class="w-full"
        bind:value={searchTerm}
        type="text"
        placeholder="Search patches..." />
      <GitButton
        variant="outline"
        size="sm"
        class="gap-2"
        onclick={() => (showFilters = !showFilters)}>
        <Eye class="h-4 w-4" />
        {showFilters ? "Hide Filters" : "Filter"}
      </GitButton>
    </div>
  </div>

  <div class="mb-4 rounded-box bg-base-200/40 p-3 sm:p-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div class="text-sm font-medium">Trust activity</div>
        <div class="text-xs opacity-70">{trustFilterStatus}</div>
      </div>

      <div class="flex flex-wrap gap-2 text-xs">
        <span class="badge badge-neutral">{repoTrustMetrics.graphLabel}</span>
        {#if repoTrustMetrics.enabledRuleCount > 0}
          <span class="badge badge-neutral">
            {repoTrustMetrics.enabledRuleCount} rule{repoTrustMetrics.enabledRuleCount === 1 ? "" : "s"}
          </span>
        {/if}
      </div>
    </div>

    <div class="mt-3 grid gap-2 sm:grid-cols-3">
      <div class="rounded-box bg-base-100/40 p-3">
        <div class="text-xs uppercase tracking-wide opacity-60">Trusted merged contributions</div>
        <div class="mt-1 text-lg font-semibold">{repoTrustMetrics.trustedMergedContributions}</div>
      </div>
      <div class="rounded-box bg-base-100/40 p-3">
        <div class="text-xs uppercase tracking-wide opacity-60">Trusted maintainer merges</div>
        <div class="mt-1 text-lg font-semibold">{repoTrustMetrics.trustedMaintainerMerges}</div>
      </div>
      <div class="rounded-box bg-base-100/40 p-3">
        <div class="text-xs uppercase tracking-wide opacity-60">Trusted collaborators</div>
        <div class="mt-1 text-lg font-semibold">{repoTrustMetrics.trustedCollaborators}</div>
      </div>
    </div>

    <div class="mt-3 flex flex-col gap-3 border-t border-base-300/40 pt-3">
      <div class="flex flex-wrap gap-2 text-xs">
        {#each trustFilterOptions as option (option.value)}
          <Button
            type="button"
            class={trustFilter === option.value
              ? "btn btn-primary btn-xs"
              : "btn btn-neutral btn-xs"}
            onclick={() => (trustFilter = option.value)}>
            {option.label}
          </Button>
        {/each}

        <Button
          type="button"
          class={trustSortFirst ? "btn btn-info btn-xs" : "btn btn-neutral btn-xs"}
          onclick={() => (trustSortFirst = !trustSortFirst)}>
          Trusted first
        </Button>
      </div>

      {#if trustFilter !== "all" || trustSortFirst}
        <div class="text-xs opacity-60">
          Showing {searchedPatches.length} matching item{searchedPatches.length === 1 ? "" : "s"}
          with trust filters applied.
        </div>
      {/if}

      <div class="text-xs opacity-50">
        Trust filters currently apply to pull request roots and their maintainer-applied merges.
      </div>
    </div>
  </div>

  {#if showFilters}
    <FilterPanel
      mode="patches"
      {storageKey}
      statusValue={statusFilter}
      statusBadgeCounts={unreadStatusCounts}
      authors={Array.from(uniqueAuthors)}
      {authorFilter}
      on:authorChange={e => (authorFilter = e.detail)}
      allLabels={allNormalizedLabels}
      labelSearchEnabled={true}
      on:statusChange={e => (statusFilter = e.detail)}
      on:sortChange={e => (sortBy = e.detail)}
      on:labelsChange={e => (selectedLabels = e.detail)}
      on:matchAllChange={e => (matchAllLabels = e.detail)} />
  {/if}

  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading patches….
        {:else}
          End of patches history
        {/if}
      </Spinner>
    </div>
  {:else if searchedPatches.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No patches found.
      {#if suggestedUnreadStatus}
        <p class="mt-2 max-w-md text-center text-sm text-muted-foreground">
          {unreadStatusCounts[suggestedUnreadStatus]}
          new {unreadStatusCounts[suggestedUnreadStatus] === 1 ? "item is" : "items are"}
          in {PATCH_STATUS_LABELS[suggestedUnreadStatus]}.
        </p>
        <GitButton
          variant="outline"
          size="sm"
          class="mt-3 gap-2"
          onclick={() => (statusFilter = suggestedUnreadStatus)}>
          Show {PATCH_STATUS_LABELS[suggestedUnreadStatus]}
        </GitButton>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#each visiblePatches as patch, index (patch.id)}
        {@const trustMetric = repoTrustMetrics.byRootId.get(patch.id)}
        <div
          in:slideAndFade={{duration: 200}}
          data-index={index}
          data-patch-id={patch.id}
          onclick={event => handlePatchClick(event, patch, index)}
          role="button"
          tabindex="0"
          onkeydown={event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              handlePatchClick(event as unknown as MouseEvent, patch, index)
            }
          }}>
          <div class="relative">
            <div class={getLatestPatchActivityAt(patch) > lastPatchesSeen ? "border-l-2 border-primary pl-2" : ""}>
                <PatchCard
                  event={patch.event}
                  patches={patch.patches}
                status={patch.status as StatusEvent}
                comments={patch.comments}
                currentCommenter={$pubkey || ""}
                extraLabels={labelsByPatch.get(patch.id) || []}
                repo={repoClass}
                  statusEvents={mergedStatusEventsByRoot?.get(patch.id) || []}
                  actorPubkey={$pubkey}
                  onCommentCreated={$pubkey ? onCommentCreated : undefined}
                  relays={repoRelays}
                  reviewersCount={$roleAssignments?.get(patch.id)?.reviewers?.size || 0}
                  onDeleteReaction={deleteReaction}
                  onCreateReaction={template => createReaction(patch.event as TrustedEvent, template)}
                />
            </div>
            {#if patch.event.kind === GIT_PULL_REQUEST && trustMetric && (trustMetric.trustedAuthor || trustMetric.trustedMaintainerMerge || trustMetric.trustedActorCount > 0)}
              <div class="mt-2 flex flex-wrap gap-2 text-xs">
                {#if trustMetric.trustedAuthor}
                  <span class="badge badge-success badge-sm">Trusted author</span>
                {/if}
                {#if trustMetric.trustedMaintainerMerge}
                  <span class="badge badge-info badge-sm">Trusted maintainer merge</span>
                {/if}
                {#if trustMetric.trustedActorCount > 1}
                  <span class="badge badge-neutral badge-sm">
                    {trustMetric.trustedActorCount} trusted actors
                  </span>
                {/if}
              </div>
            {/if}
            {#if labelsByPatch.get(patch.id)?.length}
              <div class="mt-2 flex flex-wrap gap-2 text-xs">
                {#if patch.groups.Status.length}
                  <span class="opacity-60">Status:</span>
                  {#each patch.groups.Status as l (l)}<span class="badge badge-ghost badge-sm"
                      >{l}</span
                    >{/each}
                {/if}
                {#if patch.groups.Type.length}
                  <span class="opacity-60">Type:</span>
                  {#each patch.groups.Type as l (l)}<span class="badge badge-ghost badge-sm"
                      >{l}</span
                    >{/each}
                {/if}
                {#if patch.groups.Area.length}
                  <span class="opacity-60">Area:</span>
                  {#each patch.groups.Area as l (l)}<span class="badge badge-ghost badge-sm"
                      >{l}</span
                    >{/each}
                {/if}
                {#if patch.groups.Tags.length}
                  <span class="opacity-60">Tags:</span>
                  {#each patch.groups.Tags as l (l)}<span class="badge badge-ghost badge-sm"
                      >{l}</span
                    >{/each}
                {/if}
                {#if patch.groups.Other.length}
                  <span class="opacity-60">Other:</span>
                  {#each patch.groups.Other as l (l)}<span class="badge badge-ghost badge-sm"
                      >{l}</span
                    >{/each}
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}

      {#if canLoadMorePatches}
        <div class="mt-2 flex flex-col items-center gap-2 pb-2">
          <GitButton variant="outline" size="sm" class="gap-2" onclick={loadMorePatches}>
            Load more
          </GitButton>
          <p class="text-xs text-muted-foreground">
            Showing {visiblePatches.length} of {searchedPatches.length}
          </p>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if showScrollButton}
  <div in:fade class="chat__scroll-down">
    <Button class="btn btn-circle btn-neutral" onclick={scrollToTop}>
      <Icon icon={AltArrowUp} />
    </Button>
  </div>
{/if}
