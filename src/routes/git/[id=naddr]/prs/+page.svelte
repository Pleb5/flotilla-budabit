<script lang="ts">
  import {Button as GitButton, NewPRForm, Status, toast} from "@nostr-git/ui"
  import {Eye, GitPullRequest, SearchX} from "@lucide/svelte"
  import {createSearch, pubkey} from "@welshman/app"
  import {
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    getTagValue,
    type TrustedEvent,
  } from "@welshman/util"
  import {
    createStatusEvent,
    GIT_PULL_REQUEST,
    parsePullRequestEvent,
    type CommentEvent,
    type PullRequestEvent,
    type StatusEvent,
  } from "@nostr-git/core/events"
  import {fade, slideAndFade} from "@lib/transition"
  import {normalizeEffectiveLabels, toNaturalArray, groupLabels} from "@app/util/labels"
  import {
    getInteractiveCardTarget,
    isMobile,
    preventDefault,
    stopPropagation,
  } from "@src/lib/html.js"
  import {postComment, publishEvent} from "@app/core/git-commands.js"
  import {pushModal} from "@app/util/modal"
  import {
    checked,
    notifications,
    setCheckedAt,
    setCheckedForRepoNotifications,
  } from "@app/util/notifications"
  import FilterPanel from "@app/components/FilterPanel.svelte"
  import {pushToast} from "@src/app/util/toast"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@src/lib/components/Icon.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import {getContext, onDestroy, tick} from "svelte"
  import {page} from "$app/stores"
  import {beforeNavigate, goto} from "$app/navigation"
  import {canEnforceNip70, publishDelete, publishReaction} from "@app/core/commands"
  import {makeFeed} from "@src/app/core/requests"
  import {
    PULL_REQUESTS_KEY,
    COMMENT_EVENTS_KEY,
    REPO_KEY,
    REPO_RELAYS_KEY,
    STATUS_EVENTS_BY_ROOT_KEY,
    deriveAssignmentsFor,
    deriveEffectiveLabels,
    getRepoMaintainers,
  } from "@app/core/git-state"
  import {
    REPO_TRUST_METRICS_KEY,
    defaultRepoTrustMetrics,
    type RepoTrustMetrics,
  } from "@app/core/repo-trust-metrics"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  type LabelGroups = {
    Status: string[]
    Type: string[]
    Area: string[]
    Tags: string[]
    Other: string[]
  }

  type PrStatusKey = "open" | "merged" | "closed" | "draft"
  type TrustFilterKey = "all" | "community" | "community-author" | "community-maintainer"

  type PrListItem = {
    id: string
    created_at: number
    pubkey: string
    event: PullRequestEvent
    title: string
    body: string
    branchName: string
    tipCommitOid: string
    comments: CommentEvent[]
    groups: LabelGroups
  }

  const PR_STATUS_ORDER: PrStatusKey[] = ["open", "merged", "draft", "closed"]
  const PR_STATUS_LABELS: Record<PrStatusKey, string> = {
    open: "Open",
    merged: "Merged",
    closed: "Closed",
    draft: "Draft",
  }

  const createPrStatusCounts = (): Record<PrStatusKey, number> => ({
    open: 0,
    merged: 0,
    closed: 0,
    draft: 0,
  })

  const repoClass = getContext<Repo>(REPO_KEY)
  const statusEventsByRootStore =
    getContext<Readable<Map<string, StatusEvent[]>>>(STATUS_EVENTS_BY_ROOT_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)
  const commentEventsStore = getContext<Readable<CommentEvent[]>>(COMMENT_EVENTS_KEY)
  const repoTrustMetricsStore = getContext<Readable<RepoTrustMetrics>>(REPO_TRUST_METRICS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const statusEventsByRoot = $derived.by(() =>
    statusEventsByRootStore ? $statusEventsByRootStore : new Map<string, StatusEvent[]>(),
  )
  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []))
  const pullRequests = $derived.by(() => (pullRequestsStore ? $pullRequestsStore : []))
  const repoTrustMetrics = $derived.by(() =>
    repoTrustMetricsStore ? $repoTrustMetricsStore : defaultRepoTrustMetrics,
  )
  const prsPath = $derived.by(() => `/git/${$page.params.id}/prs`)
  const scrollStorageKey = $derived.by(() => `repoScroll:${$page.params.id}:prs`)
  const relayUrl = $derived.by(() => (($page.data as any)?.url || "") as string)
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

  const prsSeenKey = $derived.by(() => `${prsPath}:seen`)
  const normalizeChecked = (value: number) =>
    value > 10_000_000_000 ? Math.round(value / 1000) : value
  const lastPrsSeen = $derived.by(() => normalizeChecked($checked[prsSeenKey] || 0))
  const repoAddress = $derived.by(() => repoClass?.address || "")
  const repoAddresses = $derived.by((): string[] => (repoAddress ? [repoAddress] : []))
  const repoMaintainers = $derived.by((): string[] => {
    const owner = (repoClass as any)?.repoEvent?.pubkey as string | undefined
    const fallback = Array.from(
      new Set(
        [...(repoClass?.maintainers || []), owner].filter((value): value is string =>
          Boolean(value),
        ),
      ),
    )
    const maintainers = getRepoMaintainers((repoClass as any)?.repoEvent)
    return maintainers.length > 0 ? maintainers : fallback
  })

  const withPullRequestRepoContext = (
    event: PullRequestEvent,
    recipients: string[],
    repoAddress: string,
  ): PullRequestEvent => {
    const dedupedRecipients = Array.from(new Set(recipients.filter(Boolean)))
    const tags = (event.tags || []).filter((tag: string[]) => tag[0] !== "p" && tag[0] !== "a")
    if (repoAddress) tags.unshift(["a", repoAddress] as ["a", string])
    tags.push(...dedupedRecipients.map((recipient: string) => ["p", recipient] as ["p", string]))
    return {
      ...event,
      tags,
    }
  }

  const layoutComments = $derived.by(() => (commentEventsStore ? $commentEventsStore : []))
  const comments = $derived.by(() => layoutComments || [])
  const mergedStatusEventsByRoot = $derived.by(
    () => statusEventsByRoot || new Map<string, StatusEvent[]>(),
  )

  const getPrCommentRootId = (comment: CommentEvent) => {
    const rootTag = (comment.tags || []).find(
      (tag: string[]) => tag[0] === "E" || (tag[0] === "e" && tag[3] === "root"),
    )

    return rootTag?.[1] || getTagValue("E", comment.tags) || getTagValue("e", comment.tags) || ""
  }

  const commentsByPr = $derived.by(() => {
    const byRoot = new Map<string, CommentEvent[]>()
    for (const comment of comments) {
      const rootId = getPrCommentRootId(comment)
      if (!rootId) continue
      if (!byRoot.has(rootId)) byRoot.set(rootId, [])
      byRoot.get(rootId)!.push(comment)
    }
    return byRoot
  })

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

  $effect(() => {
    const currentPullRequests = pullRequests
    const currentKey = currentPullRequests
      .map(pr => pr.id)
      .sort()
      .join(",")

    if (labelsDataCacheKey === currentKey) return

    const timeout = setTimeout(() => {
      const byId = new Map<string, string[]>()
      const groupsById = new Map<string, Record<string, string[]>>()

      for (const pr of currentPullRequests) {
        try {
          const parsed = parsePullRequestEvent(pr)
          const effStore = deriveEffectiveLabels(pr.id)
          const effValue = effStore.get()
          const eff = normalizeEffectiveLabels(effValue)
          const naturals = toNaturalArray(eff?.flat)
          const eventLabels = toNaturalArray(parsed.labels)
          const labels = Array.from(new Set([...eventLabels, ...naturals]))
          byId.set(pr.id, labels)
          const grouped = eff
            ? groupLabels(eff)
            : {Status: [], Type: [], Area: [], Tags: labels, Other: []}
          groupsById.set(pr.id, grouped)
        } catch {
          byId.set(pr.id, [])
          groupsById.set(pr.id, {Status: [], Type: [], Area: [], Tags: [], Other: []})
        }
      }

      const allLabels = Array.from(new Set(Array.from(byId.values()).flat()))
      labelsDataCache = {byId, groupsById, allLabels}
      labelsDataCacheKey = currentKey
    })

    return () => clearTimeout(timeout)
  })

  const labelsData = $derived(labelsDataCache)
  const labelsByPr = $derived.by(() => labelsData.byId)
  const labelGroupsFor = (id: string): LabelGroups =>
    (labelsData.groupsById.get(id) as LabelGroups | undefined) || {
      Status: [],
      Type: [],
      Area: [],
      Tags: [],
      Other: [],
    }

  const storageKey = repoClass?.key ? `prsFilters:${repoClass.key}` : ""
  const allNormalizedLabels = $derived.by(() =>
    Array.from(new Set(Array.from(labelsByPr.values()).flat())),
  )
  const uniqueAuthors = $derived.by(() =>
    Array.from(new Set(pullRequests.map((pr: PullRequestEvent) => pr.pubkey).filter(Boolean))),
  )

  let statusFilter = $state<string>("open")
  let sortBy = $state<string>("newest")
  let authorFilter = $state<string>("")
  let trustFilter = $state<TrustFilterKey>("all")
  let trustSortFirst = $state(false)
  let showFilters = $state(true)
  let searchTerm = $state("")
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)

  const trustFilterOptions: Array<{value: TrustFilterKey; label: string}> = [
    {value: "all", label: "All activity"},
    {value: "community", label: "Community-aligned only"},
    {value: "community-author", label: "Community-aligned authors"},
    {value: "community-maintainer", label: "Community-aligned merges"},
  ]
  const trustFilterStatus = $derived.by(() => {
    if (repoTrustMetrics.status === "loading") {
      return "Refreshing community-aligned metrics for this repository..."
    }

    if (repoTrustMetrics.status === "error") {
      return repoTrustMetrics.error || "Unable to compute trust metrics right now."
    }

    if (repoTrustMetrics.totalPullRequests === 0) {
      return "No pull requests loaded yet for community activity metrics."
    }

    return "Community evidence from PR authors and maintainer merges."
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

    goto(`${prsPath}${params.toString() ? `?${params.toString()}` : ""}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
      invalidateAll: false,
    })
  })

  const maintainerPubkeys = $derived.by(() => new Set(repoMaintainers))
  const currentPrStateFor = (rootId: string): PrStatusKey => {
    try {
      const events = (mergedStatusEventsByRoot?.get(rootId) || []) as StatusEvent[]
      const rootAuthor = (pullRequests || []).find(
        (pr: PullRequestEvent) => pr.id === rootId,
      )?.pubkey
      const authorized = events.filter(
        event => event.pubkey === rootAuthor || maintainerPubkeys.has(event.pubkey),
      )
      if (authorized.length === 0) return "open"
      const latest = [...authorized].sort((a, b) => b.created_at - a.created_at)[0]
      switch (latest.kind) {
        case GIT_STATUS_OPEN:
          return "open"
        case GIT_STATUS_DRAFT:
          return "draft"
        case GIT_STATUS_CLOSED:
          return "closed"
        case GIT_STATUS_COMPLETE:
          return "merged"
        default:
          return "open"
      }
    } catch {
      return "open"
    }
  }

  let allPrItems = $state<PrListItem[]>([])
  let prList = $state<PrListItem[]>([])
  let prListCacheKey = ""

  $effect(() => {
    const currentPullRequests = pullRequests
    const currentCommentsByPr = commentsByPr
    const currentStatusFilter = statusFilter
    const currentAuthorFilter = authorFilter
    const currentTrustFilter = trustFilter
    const currentTrustSortFirst = trustSortFirst
    const currentSortBy = sortBy
    const currentPrListCacheKey = prListCacheKey
    const currentMergedStatusEventsByRoot = mergedStatusEventsByRoot
    const currentRepoTrustMetrics = repoTrustMetrics
    const currentMaintainers = [...repoMaintainers].sort()

    const timeout = setTimeout(() => {
      if (!currentPullRequests || currentPullRequests.length === 0) {
        allPrItems = []
        prList = []
        prListCacheKey = ""
        return
      }

      const statusKey = [...(currentMergedStatusEventsByRoot?.entries() || [])]
        .map(
          ([id, events]) =>
            `${id}:${events
              .map(event => `${event.id}:${event.kind}:${event.created_at}:${event.pubkey}`)
              .join("~")}`,
        )
        .sort()
        .join(",")
      const commentsKey = [...currentCommentsByPr.entries()]
        .map(
          ([id, events]) =>
            `${id}:${events
              .map(event => event.id)
              .sort()
              .join("~")}`,
        )
        .sort()
        .join(",")
      const currentKey = [
        currentPullRequests
          .map(pr => pr.id)
          .sort()
          .join(","),
        commentsKey,
        currentStatusFilter,
        currentAuthorFilter,
        currentTrustFilter,
        currentTrustSortFirst ? "trust-first" : "trust-normal",
        currentSortBy,
        statusKey,
        Array.from(currentRepoTrustMetrics.byRootId.entries())
          .map(
            ([id, metric]) =>
              `${id}:${metric.communityAlignedActorCount}:${metric.communityAlignedAuthor ? 1 : 0}:${metric.communityAlignedMaintainerMerge ? 1 : 0}`,
          )
          .sort()
          .join(","),
        currentMaintainers.join(","),
      ].join("|")

      if (currentPrListCacheKey === currentKey) return

      const items = currentPullRequests.map((pr: PullRequestEvent) => {
        const parsed = parsePullRequestEvent(pr)
        return {
          id: pr.id,
          created_at: pr.created_at,
          pubkey: pr.pubkey,
          event: pr,
          title: parsed.subject || "(no title)",
          body: parsed.content || pr.content || "",
          branchName: parsed.branchName || "",
          tipCommitOid: parsed.tipCommitOid || "",
          comments: currentCommentsByPr.get(pr.id) || [],
          groups: labelGroupsFor(pr.id),
        } satisfies PrListItem
      })

      allPrItems = items
      let filteredPrs = [...items]

      if (currentStatusFilter !== "all") {
        filteredPrs = filteredPrs.filter(pr => currentPrStateFor(pr.id) === currentStatusFilter)
      }

      if (currentAuthorFilter) {
        filteredPrs = filteredPrs.filter(pr => pr.pubkey === currentAuthorFilter)
      }

      if (currentTrustFilter !== "all") {
        filteredPrs = filteredPrs.filter(pr => {
          const metric = currentRepoTrustMetrics.byRootId.get(pr.id)

          if (!metric) return false

          if (currentTrustFilter === "community") return metric.communityAlignedActorCount > 0
          if (currentTrustFilter === "community-author") return metric.communityAlignedAuthor
          if (currentTrustFilter === "community-maintainer") {
            return metric.communityAlignedMaintainerMerge
          }

          return true
        })
      }

      const sortedPrs = [...filteredPrs]
      if (currentSortBy === "newest") {
        sortedPrs.sort((a, b) => b.created_at - a.created_at)
      } else if (currentSortBy === "oldest") {
        sortedPrs.sort((a, b) => a.created_at - b.created_at)
      } else if (currentSortBy === "status") {
        const priority = (id: string) => {
          const state = currentPrStateFor(id)
          return state === "open" ? 0 : state === "draft" ? 1 : state === "merged" ? 2 : 3
        }
        sortedPrs.sort((a, b) => priority(a.id) - priority(b.id))
      }

      if (currentTrustSortFirst) {
        sortedPrs.sort((a, b) => {
          const trustA = currentRepoTrustMetrics.byRootId.get(a.id)
          const trustB = currentRepoTrustMetrics.byRootId.get(b.id)
          const actorCountA = trustA?.communityAlignedActorCount || 0
          const actorCountB = trustB?.communityAlignedActorCount || 0
          const authorA = trustA?.communityAlignedAuthor ? 1 : 0
          const authorB = trustB?.communityAlignedAuthor ? 1 : 0
          const maintainerA = trustA?.communityAlignedMaintainerMerge ? 1 : 0
          const maintainerB = trustB?.communityAlignedMaintainerMerge ? 1 : 0

          if (actorCountA !== actorCountB) return actorCountB - actorCountA
          if (authorA !== authorB) return authorB - authorA
          if (maintainerA !== maintainerB) return maintainerB - maintainerA

          return b.created_at - a.created_at
        })
      }

      prList = sortedPrs
      prListCacheKey = currentKey
    }, 100)

    return () => clearTimeout(timeout)
  })

  const loading = false
  const ITEMS_PER_PAGE = 20
  let visiblePrCount = $state(ITEMS_PER_PAGE)
  let element: HTMLElement | undefined = $state()
  let showScrollButton = $state(false)
  let scrollParent: HTMLElement | null = $state(null)
  let lastKnownPrIndex = $state(0)
  let lastKnownPrOffset = $state(0)
  let lastKnownPrId = $state("")
  let lastKnownPrTitle = $state("")
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

  const getPrAnchorPayload = (prId: string) => {
    const prIndex = searchedPrs.findIndex(pr => pr.id === prId)
    const pr = prIndex >= 0 ? searchedPrs[prIndex] : undefined
    const title = pr?.title || ""

    let offset = lastKnownPrOffset
    if (scrollParent) {
      const containerRect = scrollParent.getBoundingClientRect()
      const itemEl = scrollParent.querySelector(`[data-pr-id="${prId}"]`) as HTMLElement | null
      const itemRect = itemEl?.getBoundingClientRect()
      if (itemRect) {
        offset = itemRect.top - containerRect.top
      }
    }

    return {
      index: prIndex >= 0 ? prIndex : lastKnownPrIndex,
      offset,
      id: prId,
      title,
      visibleCount: prIndex >= 0 ? Math.max(visiblePrCount, prIndex + 1) : visiblePrCount,
    }
  }

  const updateVisibleAnchor = () => {
    const scrollEl = scrollParent
    if (!scrollEl || searchedPrs.length === 0) return

    const items = Array.from(scrollEl.querySelectorAll("[data-pr-id]")) as HTMLElement[]
    if (items.length === 0) return

    const containerRect = scrollEl.getBoundingClientRect()
    const anchor =
      items.find(item => item.getBoundingClientRect().bottom > containerRect.top) ?? items[0]

    if (!anchor) return

    const prId = anchor.dataset.prId ?? ""
    const parsedIndex = Number(anchor.dataset.index)
    const index = Number.isFinite(parsedIndex)
      ? parsedIndex
      : searchedPrs.findIndex(pr => pr.id === prId)
    if (index < 0) return

    const pr = searchedPrs[index]
    const anchorOffset = anchor.getBoundingClientRect().top - containerRect.top

    lastKnownPrIndex = index
    lastKnownPrOffset = anchorOffset
    lastKnownPrId = pr?.id ?? ""
    lastKnownPrTitle = pr?.title || ""
  }

  const setPendingPrRestore = (pr: PrListItem, index: number, itemElement?: HTMLElement | null) => {
    const scrollEl = scrollParent
    if (!scrollEl) return

    const containerRect = scrollEl.getBoundingClientRect()
    const itemRect = itemElement?.getBoundingClientRect()
    const anchorOffset = itemRect ? itemRect.top - containerRect.top : lastKnownPrOffset

    pendingScrollRestore = {
      index,
      offset: anchorOffset,
      id: pr.id,
      title: pr.title || "",
      visibleCount: Math.max(visiblePrCount, index + 1),
    }
  }

  const handlePrClick = (event: MouseEvent, pr: PrListItem, index: number) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return

    const interactive = getInteractiveCardTarget(event.target, event.currentTarget)
    if (interactive) {
      const href = interactive.closest("a[href]")?.getAttribute("href") || ""
      if (!href.includes(`prs/${pr.id}`)) return

      setPendingPrRestore(pr, index, event.currentTarget as HTMLElement | null)
      return
    }

    setPendingPrRestore(pr, index, event.currentTarget as HTMLElement | null)
    void goto(`${prsPath}/${pr.id}`)
  }

  const handlePrKeydown = (event: KeyboardEvent, pr: PrListItem, index: number) => {
    if (event.key !== "Enter" && event.key !== " ") return
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return

    event.preventDefault()
    setPendingPrRestore(pr, index, event.currentTarget as HTMLElement | null)
    void goto(`${prsPath}/${pr.id}`)
  }

  $effect(() => {
    const scrollEl = scrollParent
    const count = searchedPrs.length
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
    let savedPrId = ""

    try {
      const parsed = JSON.parse(savedRaw) as {
        index?: number
        offset?: number
        id?: string
        visibleCount?: number
      }
      parsedIndex = Number(parsed?.index ?? 0)
      parsedOffset = Number(parsed?.offset ?? 0)
      savedPrId = typeof parsed?.id === "string" ? parsed.id : ""

      const parsedVisibleCount = Number(parsed?.visibleCount ?? ITEMS_PER_PAGE)
      if (
        !Number.isNaN(parsedVisibleCount) &&
        parsedVisibleCount > 0 &&
        visiblePrCount < parsedVisibleCount
      ) {
        visiblePrCount = Math.min(Math.max(parsedVisibleCount, ITEMS_PER_PAGE), count)
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
    const matchIndex = savedPrId ? searchedPrs.findIndex(pr => pr.id === savedPrId) : -1

    if (savedPrId && matchIndex < 0) {
      restoreAttemptCount += 1
      if (restoreAttemptCount < maxRestoreAttempts) return

      sessionStorage.removeItem(scrollStorageKey)
      didRestoreScroll = true
      restoreAttemptCount = 0
      return
    }

    const targetIndex = matchIndex >= 0 ? matchIndex : fallbackIndex
    const requiredVisibleCount = Math.max(targetIndex + 1, ITEMS_PER_PAGE)
    if (visiblePrCount < requiredVisibleCount) {
      visiblePrCount = Math.min(requiredVisibleCount, count)
      return
    }

    const targetPr = searchedPrs[targetIndex]
    const targetPrId = targetPr?.id ?? ""
    const anchorPrId = savedPrId || targetPrId

    restoreInProgress = true

    const finishRestore = () => {
      didRestoreScroll = true
      restoreAttemptCount = 0
      restoreInProgress = false
    }

    const settleToAnchor = (attempt = 0) => {
      if (!anchorPrId) {
        finishRestore()
        return
      }

      const itemEl = scrollEl.querySelector(`[data-pr-id="${anchorPrId}"]`) as HTMLElement | null
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
      const targetElement = scrollEl.querySelector(
        `[data-pr-id="${anchorPrId}"]`,
      ) as HTMLElement | null
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
    if (from?.route.id !== "/git/[id=naddr]/prs") return
    if (typeof sessionStorage === "undefined") return

    const basePath = `/git/${$page.params.id}`
    const nextPath = to?.url.pathname
    if (!nextPath || !nextPath.startsWith(basePath)) {
      sessionStorage.removeItem(scrollStorageKey)
      pendingScrollRestore = null
      return
    }

    const isPrDetailNav = to?.route.id === "/git/[id=naddr]/prs/[prid]"
    const nextPrId = isPrDetailNav ? (to?.params as {prid?: string} | undefined)?.prid : ""

    const payload =
      isPrDetailNav && nextPrId
        ? getPrAnchorPayload(nextPrId)
        : (pendingScrollRestore ?? {
            index: lastKnownPrIndex,
            offset: lastKnownPrOffset,
            id: lastKnownPrId,
            title: lastKnownPrTitle,
            visibleCount: visiblePrCount,
          })

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
    if (!evt) {
      toast.push({
        message: "No repository event found to publish pull request.",
        variant: "destructive",
      })
      return
    }

    const maintainers = Array.from(new Set([...repoMaintainers, evt.pubkey].filter(Boolean)))
    const prEventWithRecipients = withPullRequestRepoContext(prEvent, maintainers, repoAddress)
    const publishedPR = publishEvent(prEventWithRecipients, relaysToUse)
    const rootId = publishedPR.event.id
    const statusEvent = createStatusEvent({
      kind: GIT_STATUS_OPEN,
      content: "",
      rootId,
      recipients: Array.from(
        new Set([...maintainers, $pubkey].filter((value): value is string => Boolean(value))),
      ),
      repoAddr: repoClass.address,
      relays: relaysToUse,
    })
    publishEvent(statusEvent as any, relaysToUse)
    pushToast({message: "Pull request created"})
  }

  const onNewPR = () => {
    const evt = repoClass.repoEvent
    if (!evt) {
      toast.push({
        message: "No repository event found to publish pull request.",
        variant: "destructive",
      })
      return
    }

    const repoDtag = getTagValue("d", evt.tags)
    if (!repoDtag) return

    pushModal(NewPRForm, {
      repo: repoClass,
      onPRCreated,
    })
  }

  const openProfile = (profilePubkey: string) =>
    pushModal(ProfileDetail, {pubkey: profilePubkey, url: relayUrl})

  const getLatestPrActivityAt = (pr: {
    id: string
    created_at?: number
    comments?: CommentEvent[]
  }) => {
    let commentAt = 0
    for (const comment of pr.comments || []) {
      if (comment.created_at > commentAt) commentAt = comment.created_at
    }
    const statusEvents = mergedStatusEventsByRoot?.get(pr.id) || []
    let statusAt = 0
    for (const event of statusEvents) {
      if (event.created_at > statusAt) statusAt = event.created_at
    }
    const createdAt = pr?.created_at || 0
    return Math.max(createdAt, commentAt, statusAt)
  }

  const getPrsSeenAt = () => {
    let latest = lastPrsSeen
    for (const pr of allPrItems) {
      latest = Math.max(latest, getLatestPrActivityAt(pr))
    }
    return latest
  }

  const unreadStatusCounts = $derived.by(() => {
    const counts = createPrStatusCounts()

    for (const pr of allPrItems) {
      if (getLatestPrActivityAt(pr) <= lastPrsSeen) continue
      counts[currentPrStateFor(pr.id)] += 1
    }

    return counts
  })

  const suggestedUnreadStatus = $derived.by(() => {
    if (searchTerm.trim()) return null
    if (authorFilter) return null
    if (selectedLabels.length > 0) return null
    if (statusFilter === "all") return null

    const currentStatus = statusFilter as PrStatusKey
    const candidates = PR_STATUS_ORDER.filter(status => status !== currentStatus)

    let nextStatus: PrStatusKey | null = null
    for (const status of candidates) {
      if (unreadStatusCounts[status] === 0) continue
      if (!nextStatus || unreadStatusCounts[status] > unreadStatusCounts[nextStatus]) {
        nextStatus = status
      }
    }

    return nextStatus
  })

  const pullRequestFilter = $derived.by(() => ({
    kinds: [GIT_PULL_REQUEST],
    "#a": repoAddresses,
  }))

  $effect(() => {
    const currentElement = element

    if (feedInitialized || feedCleanup) return
    if (!currentElement || !repoRelays.length || repoAddresses.length === 0) return

    feedInitTimer = setTimeout(() => {
      feedInitTimer = null
      if (feedInitialized || feedCleanup) return
      if (!element || !repoRelays.length || repoAddresses.length === 0) return
      feedInitialized = true
      const feed = makeFeed({
        element,
        relays: repoRelays,
        feedFilters: [pullRequestFilter],
        subscriptionFilters: [pullRequestFilter],
        initialEvents: prList.map(pr => pr.event as TrustedEvent),
        onExhausted: () => {},
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

  onDestroy(() => {
    const seenAt = getPrsSeenAt()
    setCheckedAt(prsSeenKey, seenAt)
    setCheckedAt(prsPath, seenAt)
    if (repoAddress && relayUrl) {
      setCheckedForRepoNotifications(
        $notifications,
        {
          relay: relayUrl,
          repoAddress,
          repoAddresses,
          kind: "prs",
        },
        seenAt,
      )
    }

    feedCleanup?.()
    feedCleanup = undefined
    feedInitialized = false

    if (feedInitTimer) {
      clearTimeout(feedInitTimer)
      feedInitTimer = null
    }
  })

  const searchedPrs = $derived.by(() => {
    const prsToSearch = prList.map(pr => ({id: pr.id, title: pr.title}))
    const prsSearch = createSearch(prsToSearch, {
      getValue: (pr: {id: string; title: string}) => pr.id,
      fuseOptions: {
        keys: [{name: "title"}],
        includeScore: true,
        threshold: 0.3,
        isCaseSensitive: false,
        ignoreLocation: true,
      },
      sortFn: ({score, item}) => {
        if (score && score > 0.3) return -score!
        return item.title
      },
    })
    const searchResults = prsSearch.searchOptions(searchTerm)
    return prList
      .filter(pr => searchResults.find(result => result.id === pr.id))
      .filter(pr => {
        if (selectedLabels.length === 0) return true
        const labels = labelsByPr.get(pr.id) || []
        return matchAllLabels
          ? selectedLabels.every(label => labels.includes(label))
          : selectedLabels.some(label => labels.includes(label))
      })
  })

  $effect(() => {
    void [
      searchTerm,
      statusFilter,
      authorFilter,
      trustFilter,
      trustSortFirst,
      selectedLabels,
      matchAllLabels,
      sortBy,
    ]
    visiblePrCount = ITEMS_PER_PAGE
  })

  $effect(() => {
    const total = searchedPrs.length
    if (visiblePrCount > total) {
      visiblePrCount = total
      return
    }

    if (total > 0 && visiblePrCount === 0) {
      visiblePrCount = Math.min(ITEMS_PER_PAGE, total)
    }
  })

  const visiblePrs = $derived.by(() => searchedPrs.slice(0, visiblePrCount))
  const canLoadMorePrs = $derived.by(() => visiblePrCount < searchedPrs.length)
  const roleAssignments = $derived.by(() => {
    const ids = pullRequests?.map((pr: any) => pr.id) || []
    return deriveAssignmentsFor(ids)
  })

  const loadMorePrs = () => {
    visiblePrCount = Math.min(visiblePrCount + ITEMS_PER_PAGE, searchedPrs.length)
  }

  const formatPrDate = (timestamp: number) => new Date(timestamp * 1000).toLocaleDateString()
</script>

<svelte:head>
  <title>{repoClass?.name || "Repository"} - PRs</title>
</svelte:head>

<div bind:this={element}>
  <div class="mb-2 flex flex-col gap-y-2 py-4">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-xl font-semibold">PRs</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Review and merge pull requests</p>
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
        placeholder="Search PRs..." />
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

  <div class="mb-3 rounded-box bg-base-200/30 p-2 text-xs">
    <div class="flex flex-col gap-1">
      <div>
        <div class="font-medium">Community activity</div>
        <div class="text-[11px] opacity-60">{trustFilterStatus}</div>
      </div>

      <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] opacity-80">
        <span
          ><strong>{repoTrustMetrics.communityAlignedMergedContributions}</strong>
          community-aligned PRs</span>
        <span>
          <strong>{repoTrustMetrics.communityAlignedMaintainerMerges}</strong>
          community-aligned merges</span>
        <span
          ><strong>{repoTrustMetrics.communityCollaborators}</strong> community collaborators</span>
      </div>
    </div>

    <div class="mt-2 flex flex-col gap-2 border-t border-base-300/30 pt-2">
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
          Community first
        </Button>
      </div>

      {#if trustFilter !== "all" || trustSortFirst}
        <div class="text-xs opacity-60">
          Showing {searchedPrs.length} matching item{searchedPrs.length === 1 ? "" : "s"}
          with trust filters applied.
        </div>
      {/if}
    </div>
  </div>

  {#if showFilters}
    <FilterPanel
      mode="prs"
      {storageKey}
      statusValue={statusFilter}
      statusBadgeCounts={unreadStatusCounts}
      authors={Array.from(uniqueAuthors)}
      {authorFilter}
      on:authorChange={event => (authorFilter = event.detail)}
      allLabels={allNormalizedLabels}
      labelSearchEnabled={true}
      on:statusChange={event => (statusFilter = event.detail)}
      on:sortChange={event => (sortBy = event.detail)}
      on:labelsChange={event => (selectedLabels = event.detail)}
      on:matchAllChange={event => (matchAllLabels = event.detail)} />
  {/if}

  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading PRs....
        {:else}
          End of PR history
        {/if}
      </Spinner>
    </div>
  {:else if searchedPrs.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <SearchX class="mb-2 h-8 w-8" />
      No PRs found.
      {#if suggestedUnreadStatus}
        <p class="mt-2 max-w-md text-center text-sm text-muted-foreground">
          {unreadStatusCounts[suggestedUnreadStatus]}
          new {unreadStatusCounts[suggestedUnreadStatus] === 1 ? "item is" : "items are"}
          in {PR_STATUS_LABELS[suggestedUnreadStatus]}.
        </p>
        <GitButton
          variant="outline"
          size="sm"
          class="mt-3 gap-2"
          onclick={() => (statusFilter = suggestedUnreadStatus)}>
          Show {PR_STATUS_LABELS[suggestedUnreadStatus]}
        </GitButton>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#each visiblePrs as pr, index (pr.id)}
        {@const trustMetric = repoTrustMetrics.byRootId.get(pr.id)}
        <div
          in:slideAndFade={{duration: 200}}
          class="cursor-pointer"
          data-index={index}
          data-pr-id={pr.id}
          onclick={event => handlePrClick(event, pr, index)}
          role="link"
          tabindex="0"
          onkeydown={event => handlePrKeydown(event, pr, index)}>
          <div class="relative">
            <div
              class={getLatestPrActivityAt(pr) > lastPrsSeen
                ? "border-l-2 border-primary pl-2"
                : ""}>
              <div
                class="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm transition hover:bg-base-200/40">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-start gap-2">
                      <GitPullRequest class="mt-1 h-4 w-4 shrink-0 text-primary" />
                      <div class="min-w-0">
                        <h3 class="break-words text-base font-semibold leading-tight">
                          {pr.title}
                        </h3>
                        <div
                          class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>Opened {formatPrDate(pr.created_at)}</span>
                          <span>by</span>
                          <Button
                            class="p-0"
                            onclick={stopPropagation(preventDefault(() => openProfile(pr.pubkey)))}>
                            <ProfileCircle pubkey={pr.pubkey} url={relayUrl} size={7} />
                          </Button>
                          <ProfileLink pubkey={pr.pubkey} url={relayUrl} />
                          <span
                            >{pr.comments.length} comment{pr.comments.length === 1
                              ? ""
                              : "s"}</span>
                          {#if $roleAssignments?.get(pr.id)?.reviewers?.size}
                            <span>
                              {$roleAssignments.get(pr.id)?.reviewers?.size}
                              reviewer{$roleAssignments.get(pr.id)?.reviewers?.size === 1
                                ? ""
                                : "s"}
                            </span>
                          {/if}
                        </div>
                      </div>
                    </div>

                    {#if pr.body}
                      <p class="mt-3 line-clamp-2 text-sm text-muted-foreground">{pr.body}</p>
                    {/if}

                    <div
                      class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>#{pr.id.slice(0, 8)}</span>
                      {#if pr.branchName}
                        <span>Target: {pr.branchName}</span>
                      {/if}
                      {#if pr.tipCommitOid}
                        <code>{pr.tipCommitOid.slice(0, 8)}</code>
                      {/if}
                    </div>
                  </div>

                  <div
                    class="flex shrink-0 flex-wrap items-center gap-2"
                    data-stop-link
                    data-stop-tap>
                    <Status
                      repo={repoClass}
                      rootId={pr.id}
                      rootKind={pr.event.kind}
                      rootAuthor={pr.event.pubkey}
                      statusEvents={mergedStatusEventsByRoot?.get(pr.id) || []}
                      actorPubkey={$pubkey}
                      compact={true} />
                    <ReactionSummary
                      event={pr.event as TrustedEvent}
                      url={relayUrl}
                      relays={repoRelays}
                      reactionClass="tooltip-left"
                      {deleteReaction}
                      createReaction={template =>
                        createReaction(pr.event as TrustedEvent, template)} />
                    <EventActions
                      event={pr.event as TrustedEvent}
                      url={relayUrl}
                      noun="pull request"
                      relays={repoRelays} />
                  </div>
                </div>
              </div>
            </div>
            {#if trustMetric && (trustMetric.communityAlignedAuthor || trustMetric.communityAlignedMaintainerMerge || trustMetric.communityAlignedActorCount > 0)}
              <div class="mt-2 flex flex-wrap gap-2 text-xs">
                {#if trustMetric.communityAlignedAuthor}
                  <span class="badge badge-success badge-sm">Community-aligned author</span>
                {/if}
                {#if trustMetric.communityAlignedMaintainerMerge}
                  <span class="badge badge-info badge-sm">Community-aligned merge</span>
                {/if}
                {#if trustMetric.communityAlignedActorCount > 1}
                  <span class="badge badge-neutral badge-sm">
                    {trustMetric.communityAlignedActorCount} community-aligned actors
                  </span>
                {/if}
              </div>
            {/if}
            {#if labelsByPr.get(pr.id)?.length}
              <div class="mt-2 flex flex-wrap gap-2 text-xs">
                {#if pr.groups.Status.length}
                  <span class="opacity-60">Status:</span>
                  {#each pr.groups.Status as label (label)}<span class="badge badge-ghost badge-sm"
                      >{label}</span
                    >{/each}
                {/if}
                {#if pr.groups.Type.length}
                  <span class="opacity-60">Type:</span>
                  {#each pr.groups.Type as label (label)}<span class="badge badge-ghost badge-sm"
                      >{label}</span
                    >{/each}
                {/if}
                {#if pr.groups.Area.length}
                  <span class="opacity-60">Area:</span>
                  {#each pr.groups.Area as label (label)}<span class="badge badge-ghost badge-sm"
                      >{label}</span
                    >{/each}
                {/if}
                {#if pr.groups.Tags.length}
                  <span class="opacity-60">Tags:</span>
                  {#each pr.groups.Tags as label (label)}<span class="badge badge-ghost badge-sm"
                      >{label}</span
                    >{/each}
                {/if}
                {#if pr.groups.Other.length}
                  <span class="opacity-60">Other:</span>
                  {#each pr.groups.Other as label (label)}<span class="badge badge-ghost badge-sm"
                      >{label}</span
                    >{/each}
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}

      {#if canLoadMorePrs}
        <div class="mt-2 flex flex-col items-center gap-2 pb-2">
          <GitButton variant="outline" size="sm" class="gap-2" onclick={loadMorePrs}>
            Load more
          </GitButton>
          <p class="text-xs text-muted-foreground">
            Showing {visiblePrs.length} of {searchedPrs.length}
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
