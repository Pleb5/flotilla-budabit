<script lang="ts">
  import {IssueCard, NewIssueForm, Button as GitButton, toast, pushRepoAlert} from "@nostr-git/ui"
  import {
    createStatusEvent,
    GIT_ISSUE,
    GIT_REPO_ANNOUNCEMENT,
    type CommentEvent,
    type IssueEvent,
  } from "@nostr-git/core/events"
  import type {TrustedEvent} from "@welshman/util"
  import {Eye, Plus, SearchX} from "@lucide/svelte"
  import {
    Address,
    COMMENT,
    getTagValue,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    GIT_STATUS_CLOSED,
    getTag,
  } from "@welshman/util"
  import {createSearch, pubkey, repository} from "@welshman/app"
  import {sortBy} from "@welshman/lib"
  import {request} from "@welshman/net"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import {slideAndFade} from "@lib/transition"
  import {makeFeed} from "@app/core/requests"
  import {pushModal} from "@app/util/modal"
  import {postComment, postIssue, publishEvent} from "@lib/budabit/commands.js"
  import {deriveEffectiveLabels, deriveAssignmentsFor} from "@lib/budabit/state.js"
  import FilterPanel from "@src/lib/budabit/components/FilterPanel.svelte"
  import {isMobile} from "@lib/html"
  import {onMount, onDestroy, tick} from "svelte"
  import {pushToast} from "@src/app/util/toast"
  import {normalizeEffectiveLabels, toNaturalArray, groupLabels} from "@lib/budabit/labels"
  import {page} from "$app/stores"
  import {beforeNavigate} from "$app/navigation"
  
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY, STATUS_EVENTS_BY_ROOT_KEY} from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import type {StatusEvent} from "@nostr-git/core/events"
  import { fade } from "svelte/transition"
  import { createVirtualizer } from "@tanstack/svelte-virtual"
  import { untrack } from "svelte"

  let showScrollButton = $state(false)
  let pageContainerRef: HTMLElement | undefined = $state()
  let virtualListContainerRef: HTMLElement | undefined = $state()
  let scrollParent: HTMLElement | null = $state(null)
  let lastKnownIssueIndex = $state(0)
  let lastKnownIssueOffset = $state(0)
  let lastKnownIssueId = $state("")
  let lastKnownIssueTitle = $state("")
  let pendingScrollRestore = $state<{
    index: number
    offset: number
    id: string
    title: string
  } | null>(null)
  let didRestoreScroll = $state(false)
  let restoreAttemptCount = 0
  let restoreInProgress = $state(false)

  const maxRestoreAttempts = 12
  const scrollStorageKey = $derived.by(() => `repoScroll:${$page.params.id}:issues`)

  const LABEL_PREFETCH_LIMIT = 200
  const LABEL_PREFETCH_IDLE_MS = 2000
  const LABEL_PREFETCH_DELAY_MS = 150
  const LABEL_PREFETCH_CHUNK_SIZE = 50

  // Stable key function for virtualizer - prevents issues when items reorder/filter
  const getItemKey = (index: number) => searchedIssues[index]?.id ?? `fallback-${index}`

  const virtualizerStore = createVirtualizer({
    count: 0,
    getScrollElement: () => scrollParent,
    estimateSize: () => 160, // Slightly higher estimate for cards with labels/comments
    overscan: 10, // Higher overscan for smoother scrolling with dynamic content
    gap: 16,
    getItemKey,
  })

  // Find scroll parent when page container is mounted
  $effect(() => {
    const container = pageContainerRef
    if (!container) return

    scrollParent = container.closest(".scroll-container") as HTMLElement | null
  })

  // Update virtualizer when scroll parent or count changes
  $effect(() => {
    // Access reactive dependencies OUTSIDE untrack so they're tracked
    const scrollEl = scrollParent
    const container = virtualListContainerRef
    const count = searchedIssues.length
    
    // Early return if prerequisites not met
    if (!scrollEl || !container || count === 0) return
    
    // Calculate scroll margin (offset from top of scroll container to the list)
    const scrollMargin = container.offsetTop
    
    // Update options in untrack to avoid infinite loops from store access
    untrack(() => {
      $virtualizerStore?.setOptions({
        count,
        getScrollElement: () => scrollEl,
        scrollMargin,
        getItemKey,
      })
    })
    
    // Schedule measurement after DOM updates
    tick().then(() => {
      untrack(() => {
        $virtualizerStore?.measure()
      })
    })
  })

  const updateVisibleAnchor = () => {
    const virtualizer = $virtualizerStore
    const scrollEl = scrollParent
    const currentIssues = searchedIssues
    if (!virtualizer || !scrollEl || currentIssues.length === 0) return

    const virtualItems = virtualizer.getVirtualItems()
    if (virtualItems.length === 0) return

    const scrollTop = scrollEl.scrollTop
    let bestItem = virtualItems[0]
    let bestDelta = Number.POSITIVE_INFINITY

    for (const item of virtualItems) {
      const top = item.start
      const delta = scrollTop - top
      if (delta >= 0 && delta < bestDelta) {
        bestDelta = delta
        bestItem = item
      }
    }

    const issue = currentIssues[bestItem.index]
    const anchorOffset = bestItem.start - scrollTop

    lastKnownIssueIndex = bestItem.index
    lastKnownIssueOffset = anchorOffset
    lastKnownIssueId = issue?.id ?? ""
    lastKnownIssueTitle = issue ? getTagValue("subject", issue.tags) ?? "" : ""
  }

  // Handle scroll events for showing scroll-to-top button
  $effect(() => {
    const scrollEl = scrollParent
    if (!scrollEl) return
    
    const handleScroll = () => {
      showScrollButton = scrollEl.scrollTop > 1500
      updateVisibleAnchor()
    }
    
    handleScroll()
    scrollEl.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollEl.removeEventListener('scroll', handleScroll)
  })

  $effect(() => {
    updateVisibleAnchor()
  })

  const handleIssueClick = (
    event: MouseEvent,
    issue: IssueEvent,
    virtualRow: {index: number; start: number},
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target as HTMLElement | null
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!anchor) return

    const href = anchor.getAttribute("href") || ""
    if (!href.includes(`issues/${issue.id}`)) return

    const scrollEl = scrollParent
    if (!scrollEl) return

    const title = getTagValue("subject", issue.tags) ?? ""
    const itemElement = event.currentTarget as HTMLElement | null
    const containerRect = scrollEl.getBoundingClientRect()
    const itemRect = itemElement?.getBoundingClientRect()
    const anchorOffset = itemRect ? itemRect.top - containerRect.top : virtualRow.start - scrollEl.scrollTop

    pendingScrollRestore = {
      index: virtualRow.index,
      offset: anchorOffset,
      id: issue.id,
      title,
    }

    console.debug("[IssuesList] click capture", {
      index: pendingScrollRestore.index,
      offset: pendingScrollRestore.offset,
      issueId: pendingScrollRestore.id,
      issueTitle: pendingScrollRestore.title,
    })
  }

  $effect(() => {
    const virtualizer = $virtualizerStore
    const scrollEl = scrollParent
    const count = searchedIssues.length
    const restoring = restoreInProgress

    if (didRestoreScroll || restoring || !virtualizer || !scrollEl || count === 0) return
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
    let savedIssueId = ""
    let savedIssueTitle = ""

    try {
      const parsed = JSON.parse(savedRaw) as {
        index?: number
        offset?: number
        id?: string
        title?: string
      }
      parsedIndex = Number(parsed?.index ?? 0)
      parsedOffset = Number(parsed?.offset ?? 0)
      savedIssueId = typeof parsed?.id === "string" ? parsed.id : ""
      savedIssueTitle = typeof parsed?.title === "string" ? parsed.title : ""
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

    const virtualItems = virtualizer.getVirtualItems()
    if (virtualItems.length === 0) return

    const fallbackIndex = Math.min(Math.max(parsedIndex, 0), count - 1)
    const matchIndex = savedIssueId
      ? searchedIssues.findIndex(issue => issue.id === savedIssueId)
      : -1

    if (savedIssueId && matchIndex < 0) {
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
    const targetIssue = searchedIssues[targetIndex]
    const targetIssueTitle = targetIssue ? getTagValue("subject", targetIssue.tags) ?? "" : ""
    const targetIssueId = targetIssue?.id ?? ""
    const anchorIssueId = savedIssueId || targetIssueId
    const finishRestore = () => {
      didRestoreScroll = true
      restoreAttemptCount = 0
      restoreInProgress = false
    }
    const settleToAnchor = (attempt = 0) => {
      if (!anchorIssueId) {
        finishRestore()
        return
      }
      const itemEl = scrollEl.querySelector(`[data-issue-id="${anchorIssueId}"]`) as HTMLElement | null
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
        scrollEl.scrollBy({top: delta, behavior: "smooth"})
      }
      finishRestore()
    }

    restoreInProgress = true

    console.debug("[IssuesList] restore scroll", {
      savedIndex: parsedIndex,
      savedOffset: parsedOffset,
      savedIssueId,
      savedIssueTitle,
      matchedIndex: matchIndex,
      targetIndex,
      targetIssueId,
      targetIssueTitle,
    })

    const attemptRestore = () => {
      virtualizer.scrollToIndex(targetIndex, {align: "start"})
      setTimeout(() => settleToAnchor(0), 80)
    }

    void tick().then(() => {
      virtualizer.measure()
      requestAnimationFrame(attemptRestore)
    })
  })

  beforeNavigate(({from, to}) => {
    if (from?.route.id !== "/spaces/[relay]/git/[id=naddr]/issues") return
    if (typeof sessionStorage === "undefined") return
    const relayParam = $page.params.relay ?? ""
    const basePath = `/spaces/${encodeURIComponent(relayParam)}/git/${$page.params.id}`
    const nextPath = to?.url.pathname
    if (!nextPath || !nextPath.startsWith(basePath)) {
      sessionStorage.removeItem(scrollStorageKey)
      pendingScrollRestore = null
      return
    }
    const isIssueDetailNav =
      to?.route.id === "/spaces/[relay]/git/[id=naddr]/issues/[issueid]"
    const nextIssueId = isIssueDetailNav ? (to?.params as {issueid?: string} | undefined)?.issueid : ""
    const buildPayloadForIssue = (issueId: string) => {
      const scrollEl = scrollParent
      const issueIndex = searchedIssues.findIndex(issue => issue.id === issueId)
      const issue = issueIndex >= 0 ? searchedIssues[issueIndex] : undefined
      const title = issue ? getTagValue("subject", issue.tags) ?? "" : ""
      let offset = lastKnownIssueOffset
      if (scrollEl) {
        const containerRect = scrollEl.getBoundingClientRect()
        const itemEl = scrollEl.querySelector(`[data-issue-id="${issueId}"]`) as HTMLElement | null
        const itemRect = itemEl?.getBoundingClientRect()
        if (itemRect) {
          offset = itemRect.top - containerRect.top
        }
      }
      return {
        index: issueIndex >= 0 ? issueIndex : lastKnownIssueIndex,
        offset,
        id: issueId,
        title,
      }
    }

    const payload = isIssueDetailNav && nextIssueId
      ? buildPayloadForIssue(nextIssueId)
      : pendingScrollRestore ?? {
          index: lastKnownIssueIndex,
          offset: lastKnownIssueOffset,
          id: lastKnownIssueId,
          title: lastKnownIssueTitle,
        }
    sessionStorage.setItem(scrollStorageKey, JSON.stringify(payload))
    console.debug("[IssuesList] save scroll", {
      index: payload.index,
      offset: payload.offset,
      issueId: payload.id,
      issueTitle: payload.title,
      source: isIssueDetailNav && nextIssueId ? "nav" : pendingScrollRestore ? "click" : "visible",
    })
    pendingScrollRestore = null
  })

  function measureElement(
    node: HTMLElement,
    virtualizer: { measureElement: (el: HTMLElement | null) => void } | undefined,
  ) {
    virtualizer?.measureElement(node)
    return {
      update(v: typeof virtualizer) {
        v?.measureElement(node)
      },
    }
  }



  const repoClass = getContext<Repo>(REPO_KEY)
  const statusEventsByRootStore = getContext<Readable<Map<string, StatusEvent[]>>>(STATUS_EVENTS_BY_ROOT_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  
  if (!repoClass) {
    throw new Error("Repo context not available")
  }
  
  // Get current values from stores reactively using $ rune
  const statusEventsByRoot = $derived.by(() => statusEventsByRootStore ? $statusEventsByRootStore : new Map<string, StatusEvent[]>())
  const repoRelays = $derived.by(() => repoRelaysStore ? $repoRelaysStore : [])

  const issues = $derived.by(() => repoClass.issues || [])

  const comments = $state<Record<string, CommentEvent[]>>({})

  const commentsOrdered = $derived.by(() => {
    const ret: Record<string, CommentEvent[]> = {}
    for (const [key, value] of Object.entries(comments)) {
      ret[key] = sortBy(e => -e.created_at, value)
    }
    return ret
  })

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortByOrder = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let showFilters = $state(true)
  // Label filters (NIP-32 normalized labels)
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)

  let labelsPrefetchKey = ""
  let labelsPrefetchTimeout: ReturnType<typeof setTimeout> | null = null
  let labelsPrefetchController: AbortController | null = null

  const chunkIds = (ids: string[], size: number) => {
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += size) {
      chunks.push(ids.slice(i, i + size))
    }
    return chunks
  }

  // Labels cache keyed by issue id, kept in sync with NIP-32 updates
  let labelsDataCache = $state<{
    byId: Map<string, string[]>
    groupsById: Map<string, Record<string, string[]>>
  }>({
    byId: new Map<string, string[]>(),
    groupsById: new Map<string, Record<string, string[]>>(),
  })
  const labelSubscriptions = new Map<string, () => void>()

  const updateLabelsCache = (issueId: string, effValue: any) => {
    const eff = normalizeEffectiveLabels(effValue)
    const naturals = toNaturalArray(eff.flat)
    const groups = groupLabels(eff)
    const byId = new Map(labelsDataCache.byId)
    const groupsById = new Map(labelsDataCache.groupsById)
    byId.set(issueId, naturals)
    groupsById.set(issueId, groups)
    labelsDataCache = {byId, groupsById}
  }

  const removeLabelsCache = (issueId: string) => {
    const byId = new Map(labelsDataCache.byId)
    const groupsById = new Map(labelsDataCache.groupsById)
    if (!byId.has(issueId) && !groupsById.has(issueId)) return
    byId.delete(issueId)
    groupsById.delete(issueId)
    labelsDataCache = {byId, groupsById}
  }

  $effect(() => {
    const currentIssues = issues || []
    const currentIds = new Set(currentIssues.map(i => i.id))

    for (const issue of currentIssues) {
      if (labelSubscriptions.has(issue.id)) continue
      const effStore = deriveEffectiveLabels(issue.id)
      const unsubscribe = effStore.subscribe(value => {
        updateLabelsCache(issue.id, value)
      })
      labelSubscriptions.set(issue.id, unsubscribe)
    }

    for (const [id, unsubscribe] of labelSubscriptions) {
      if (currentIds.has(id)) continue
      unsubscribe()
      labelSubscriptions.delete(id)
      removeLabelsCache(id)
    }
  })
  
  // Return cached labelsData synchronously
  const labelsData = $derived(labelsDataCache)

  const labelsByIssue = $derived.by(() => {
    const result = labelsData.byId
    console.debug("[IssuesList] labelsByIssue computed:", result)
    return result
  })

  const allNormalizedLabels = $derived.by(() =>
    Array.from(new Set(Array.from(labelsByIssue.values()).flat())),
  )

  const uniqueAuthors = $derived.by(() => {
    if (!repoClass.issues) return []

    const authors = new Set<string>()
    repoClass.issues.forEach((issue: IssueEvent) => {
      const pubkey = issue.pubkey
      if (pubkey) authors.add(pubkey)
    })

    return Array.from(authors)
  })



  let searchTerm = $state("")

  // NIP-32 labels are derived centrally via deriveEffectiveLabels(); prefetch newest labels
  $effect(() => {
    const currentIssues = repoClass.issues || []
    const currentRepoRelays = repoRelays
    const relayList = (currentRepoRelays.length ? currentRepoRelays : repoClass?.relays || []).filter(Boolean)

    if (!relayList.length || currentIssues.length === 0) {
      if (labelsPrefetchTimeout) {
        clearTimeout(labelsPrefetchTimeout)
        labelsPrefetchTimeout = null
      }
      labelsPrefetchController?.abort()
      labelsPrefetchController = null
      labelsPrefetchKey = ""
      return
    }

    const sortedIssues = [...currentIssues].sort((a, b) => {
      if (b.created_at !== a.created_at) return b.created_at - a.created_at
      return a.id.localeCompare(b.id)
    })
    const selectedIssues = sortedIssues.slice(0, LABEL_PREFETCH_LIMIT)
    const ids = selectedIssues.map(issue => issue.id).filter(Boolean)

    if (ids.length === 0) return

    const key = ids.join(",")
    if (labelsPrefetchKey === key) return

    if (labelsPrefetchTimeout) {
      clearTimeout(labelsPrefetchTimeout)
      labelsPrefetchTimeout = null
    }
    labelsPrefetchController?.abort()
    labelsPrefetchController = new AbortController()
    labelsPrefetchKey = key

    const delayMs =
      currentIssues.length >= LABEL_PREFETCH_LIMIT
        ? LABEL_PREFETCH_DELAY_MS
        : LABEL_PREFETCH_IDLE_MS

    labelsPrefetchTimeout = setTimeout(() => {
      const controller = labelsPrefetchController
      if (!controller) return

      const filters = chunkIds(ids, LABEL_PREFETCH_CHUNK_SIZE).map(chunk => ({
        kinds: [1985],
        "#e": chunk,
      }))

      request({
        relays: relayList,
        signal: controller.signal,
        filters,
        onEvent: event => {
          repository.publish(event)
        },
      })
    }, delayMs)
  })

  // Persist filters per repo (delegated to FilterPanel)
  let storageKey = repoClass ? `issuesFilters:${repoClass.key}` : ""

  // Compute statusMap asynchronously to avoid blocking UI rendering
  let statusMap = $state<Record<string, string>>({})
  let statusMapCacheKey = $state<string>("")

  $effect(() => {
    // Access reactive dependencies synchronously to ensure they're tracked
    if (!repoClass) return
    
    const currentIssues = repoClass.issues
    const currentStatusEventsByRoot = statusEventsByRoot
    const currentStatusMapCacheKey = statusMapCacheKey

    const timeout = setTimeout(() => {
      if (!currentIssues) {
        statusMap = {}
        return
      }

      // Create cache key from issue IDs and statusEventsByRoot to detect changes
      const issueIds = currentIssues.map(i => i.id).sort().join(",")
      const statusEventIds = currentStatusEventsByRoot 
        ? Array.from(currentStatusEventsByRoot.keys()).sort().join(",")
        : ""
      const currentKey = `${issueIds}|${statusEventIds}`

      if (currentStatusMapCacheKey === currentKey) return

      const map: Record<string, string> = {}

      // First, set default "open" status for all issues
      for (const issue of currentIssues) {
        map[issue.id] = "open"
      }

      // Then override with actual status events
      if (currentStatusEventsByRoot) {
        for (const [rootId, events] of currentStatusEventsByRoot) {
          // Check if this issue is mirrored
          const issue = currentIssues.find(i => i.id === rootId)
          const isMirrored = issue ? 
            (issue.tags as Array<[string, string]> | undefined)?.some((t) => t[0] === "imported") ?? false :
            false

          if (isMirrored && events && events.length > 0) {
            // For mirrored issues, use ALL status events (not just authorized ones)
            // Sort by created_at descending and take the most recent
            const sortedEvents = [...events].sort((a, b) => b.created_at - a.created_at)
            const latestEvent = sortedEvents[0]
            
            // Map status event kinds to status strings
            const statusKindToState = (kind: number): string => {
              switch (kind) {
                case GIT_STATUS_OPEN: return "open"
                case GIT_STATUS_DRAFT: return "draft"
                case GIT_STATUS_CLOSED: return "closed"
                case GIT_STATUS_COMPLETE: return "resolved"
                default: return "open"
              }
            }
            
            map[rootId] = statusKindToState(latestEvent.kind)
          } else {
            // For non-mirrored issues, use the existing authorization logic
            const statusResult = repoClass.resolveStatusFor(rootId)
            map[rootId] = statusResult?.state || "open"
          }
        }
      }

      statusMap = map
      statusMapCacheKey = currentKey
    }, 100)

    return () => {
      clearTimeout(timeout)
    }
  })

  // Compute issueList asynchronously to avoid blocking UI rendering
  let issueList = $state<any[]>([])
  let issueListCacheKey = $state<string>("")

  $effect(() => {
    // Access reactive dependencies synchronously to ensure they're tracked
    if (!repoClass) return
    
    const currentIssues = repoClass.issues
    const currentComments = comments
    const currentStatusMap = statusMap
    const currentIssueListCacheKey = issueListCacheKey

    const timeout = setTimeout(() => {
      if (!currentIssues) {
        issueList = []
        return
      }

      // Create cache key from issues, comments, and statusMap to detect changes
      const issueIds = currentIssues.map(i => i.id).sort().join(",")
      const commentIds = Object.keys(currentComments)
        .flatMap(id => currentComments[id].map(c => c.id))
        .sort()
        .join(",")
      const statusMapKeys = Object.keys(currentStatusMap).sort().join(",")
      const currentKey = `${issueIds}|${commentIds}|${statusMapKeys}`

      if (currentIssueListCacheKey === currentKey) return

      const processed = currentIssues.map((issue: IssueEvent) => {
        const commentEvents = currentComments[issue.id] || []
        const currentState = currentStatusMap[issue.id] || "open"

        return {
          ...issue,
          comments: commentEvents,
          status: {kind: currentState},
          currentState,
        }
      })

      issueList = processed
      issueListCacheKey = currentKey
    }, 100)

    return () => {
      clearTimeout(timeout)
    }
  })

  // Compute searchedIssues asynchronously to avoid blocking UI rendering
  // This is the most critical optimization as it includes search, filtering, and sorting
  let searchedIssues = $state<any[]>([])
  let searchedIssuesCacheKey = $state<string>("")

  $effect(() => {
    // Access all reactive dependencies synchronously to ensure they're tracked
    const currentIssueList = issueList
    const currentSearchTerm = searchTerm
    const currentStatusFilter = statusFilter
    const currentAuthorFilter = authorFilter
    const currentSelectedLabels = selectedLabels
    const currentMatchAllLabels = matchAllLabels
    const currentSortByOrder = sortByOrder
    const currentLabelsByIssue = labelsByIssue
    const currentStatusMap = statusMap
    const currentCacheKey = searchedIssuesCacheKey

    const timeout = setTimeout(() => {
      if (!currentIssueList || currentIssueList.length === 0) {
        searchedIssues = []
        return
      }

      // Create cache key from issueList, searchTerm, filters, and sort options
      const issueIds = currentIssueList.map(i => i.id).sort().join(",")
      const labelsKey = Array.from(currentLabelsByIssue.values())
        .flat()
        .sort()
        .join(",")
      const currentKey = [
        issueIds,
        currentSearchTerm,
        currentStatusFilter,
        currentAuthorFilter,
        [...currentSelectedLabels].sort().join(","),
        currentMatchAllLabels.toString(),
        currentSortByOrder,
        labelsKey,
      ].join("|")

      if (currentCacheKey === currentKey) return

      const issuesToSearch = currentIssueList.map(issue => {
        return {
          id: issue.id,
          subject: getTagValue("subject", issue.tags) ?? "",
          desc: issue.content,
        }
      })
      const issueSearch = createSearch(issuesToSearch, {
        getValue: (issue: {id: string; subject: string; desc: string}) => issue.id,
        fuseOptions: {
          keys: [
            {name: "subject", weight: 0.8},
            {name: "desc", weight: 0.2},
          ],
          includeScore: true,
          threshold: 0.3,
          isCaseSensitive: false,
          // When true, search will ignore location and distance, so it won't
          // matter where in the string the pattern appears
          ignoreLocation: true,
        },
        sortFn: ({score, item}) => {
          if (score && score > 0.3) return -score!
          return item.subject
        },
      })
      const searchResults = issueSearch.searchOptions(currentSearchTerm)
      const result = currentIssueList
        .filter(r => searchResults.find(res => res.id === r.id))
        .filter(issue => {
          if (currentAuthorFilter) {
            return issue.pubkey === currentAuthorFilter
          }
          return true
        })
        .filter(issue => {
          if (currentSelectedLabels.length === 0) return true
          const labs = currentLabelsByIssue.get(issue.id) || []
          return currentMatchAllLabels
            ? currentSelectedLabels.every(l => labs.includes(l))
            : currentSelectedLabels.some(l => labs.includes(l))
        })
        .filter(issue => {
          if (currentStatusFilter === "all") return true
          const state = currentStatusMap[issue.id] || "open"
          if (currentStatusFilter === "open") return state === "open"
          if (currentStatusFilter === "draft") return state === "draft"
          if (currentStatusFilter === "closed") return state === "closed"
          if (currentStatusFilter === "resolved") return state === "resolved"
          return true
        })
        .sort((a, b) =>
          currentSortByOrder === "newest" ? b.created_at - a.created_at : a.created_at - b.created_at,
        )

      searchedIssues = result
      searchedIssuesCacheKey = currentKey
    }, 100)

    return () => {
      clearTimeout(timeout)
    }
  })

  const roleAssignments = $derived.by(() => {
    const ids = repoClass.issues?.map((i: any) => i.id) || []
    return deriveAssignmentsFor(ids)
  })

  $effect(() => {
    // Access reactive dependencies synchronously to ensure they're tracked
    const currentIssues = issues
    const currentRepoRelays = repoRelays
    const currentComments = comments
    
    // Create abort controller for this effect run BEFORE the timeout
    // to ensure it can be properly cleaned up if the effect re-runs
    const controller = new AbortController()
    abortControllers.push(controller)
    
    // Defer comment loading to avoid blocking initial render
    const timeout = setTimeout(() => {
      for (const issue of currentIssues) {
        // Check synchronously using captured comments state to avoid race conditions
        // Only request if comments haven't been loaded yet (key doesn't exist in comments)
        if (!(issue.id in currentComments)) {
          // Initialize empty array immediately to prevent duplicate requests
          comments[issue.id] = []
          requestComments(issue, currentRepoRelays, controller)
        }
      }
    }, 100)
    
    // Cleanup: cancel timeout and abort controller when effect re-runs
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  const requestComments = async (
    issue: TrustedEvent,
    relays: string[],
    controller: AbortController,
  ) => {
    request({
      relays,
      signal: controller.signal,
      filters: [{kinds: [COMMENT], "#E": [issue.id], since: issue.created_at}],
      onEvent: e => {
        // Access comments reactively - this will get the current value
        const currentComments = comments[issue.id] || []
        if (!currentComments.some(c => c.id === e.id)) {
          // Create a new array to trigger reactivity
          comments[issue.id] = [...currentComments, e as CommentEvent]
        }
      },
    })
  }

  // Set loading to false immediately if we have data - don't wait for makeFeed
  let loading = $state(false)
  let feedInitialized = $state(false)
  let feedCleanup: (() => void) | undefined = $state(undefined)
  // Use non-reactive array to avoid infinite loops when pushing in effects
  const abortControllers: AbortController[] = []

  // Create combined filter for issues and status events
  const combinedFilter = $derived.by(() => ({
    kinds: [
      GIT_ISSUE,
      GIT_STATUS_OPEN,
      GIT_STATUS_DRAFT,
      GIT_STATUS_CLOSED,
      GIT_STATUS_COMPLETE,
    ],
    "#a": repoClass?.maintainers?.map(m => `${GIT_REPO_ANNOUNCEMENT}:${m}:${repoClass.name}`) || [],
  }))

  // Initialize feed asynchronously - don't block render
  onMount(() => {
    if (repoClass && repoClass.issues && !feedInitialized) {
      // Defer makeFeed to avoid blocking initial render
      const timeout = setTimeout(() => {
        const tryStart = () => {
          if (pageContainerRef && !feedInitialized) {
            feedInitialized = true
            const feed = makeFeed({
              element: pageContainerRef,
              relays: repoClass.relays,
              feedFilters: [combinedFilter],
              subscriptionFilters: [combinedFilter],
              initialEvents: issueList,
              onExhausted: () => {
                // Feed exhausted, but we already showed content
              },
            })
            feedCleanup = feed.cleanup
          } else if (!pageContainerRef) {
            requestAnimationFrame(tryStart)
          }
        }
        tryStart()
      }, 100)
      
      return () => {
        clearTimeout(timeout)
      }
    }
  })

  // CRITICAL: Cleanup on destroy to prevent memory leaks and blocking navigation
  onDestroy(() => {
    // Cleanup makeFeed (aborts network requests, stops scroll observers, unsubscribes)
    feedCleanup?.()

    labelSubscriptions.forEach(unsubscribe => unsubscribe())
    labelSubscriptions.clear()

    if (labelsPrefetchTimeout) {
      clearTimeout(labelsPrefetchTimeout)
      labelsPrefetchTimeout = null
    }
    labelsPrefetchController?.abort()
    labelsPrefetchController = null
    labelsPrefetchKey = ""
    
    // Abort all network requests
    abortControllers.forEach(controller => controller.abort())
    abortControllers.length = 0 // Clear array without reassignment
  })

  const onIssueCreated = async (issue: IssueEvent) => {
    console.log("repo relays", repoRelays)
    const relaysToUse = repoRelays
    if (!relaysToUse || relaysToUse.length === 0) {
      console.warn("onIssueCreated: no relays available", {relaysToUse})
      toast.push({
        message: "No relays available to publish issue.",
        variant: "destructive",
      })
      return
    }
    console.debug("onIssueCreated: publishing issue", {
      relays: relaysToUse,
      repoAddr: getTag("a", issue.tags),
    })
    const postIssueEvent = postIssue(issue, relaysToUse)
    console.debug("onIssueCreated: publish result", postIssueEvent)
    pushToast({message: "Issue created"})
    try {
      pushRepoAlert({
        repoKey: repoClass.key,
        kind: "new-patch",
        title: "New issue",
        body: getTagValue("subject", issue.tags) || "",
      })
    } catch {}
    const evt: any = (repoClass as any).repoEvent

    const statusEvent = createStatusEvent({
      kind: GIT_STATUS_OPEN,
      content: "",
      rootId: postIssueEvent.event.id,
      recipients: [$pubkey!, evt?.pubkey].filter(Boolean) as string[],
      repoAddr: evt ? Address.fromEvent(evt as any).toString() : "",
      relays: relaysToUse,
    })
    console.log("publishing status event", statusEvent)
    publishEvent(statusEvent, relaysToUse)
  }

  const onNewIssue = () => {
    const evt: any = (repoClass as any).repoEvent
    const aTag = evt ? (getTag("d", evt.tags) as string[]) : undefined
    const repoDtag = aTag ? aTag[1] : ""

    pushModal(NewIssueForm, {
      repoId: repoDtag,
      repoOwnerPubkey: evt?.pubkey,
      onIssueCreated,
    })
  }

  const onCommentCreated = async (comment: CommentEvent) => {
    postComment(comment, repoRelays)
  }

  const scrollToTop = () => {
    // Use virtualizer's scrollToIndex for consistent behavior
    $virtualizerStore?.scrollToIndex(0, { align: "start", behavior: "smooth" })
    // Also scroll the parent container
    scrollParent?.scrollTo({ top: 0, behavior: "smooth" })
  }
</script>

<svelte:head>
  <title>{repoClass?.name || 'Repository'} - Issues</title>
</svelte:head>

<div bind:this={pageContainerRef}>
  <div class="my-4 max-w-full space-y-2">
    <div class=" flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Issues</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Track bugs and feature requests</p>
      </div>
      <div class="flex items-center gap-2">
        <GitButton class="gap-2" variant="git" size="sm" onclick={onNewIssue}>
          <Plus class="h-4 w-4" />
          <span class="">New Issue</span>
        </GitButton>
      </div>
    </div>
    <div class="row-2 input mt-4 grow overflow-x-hidden">
      <Icon icon={Magnifer} />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus={!isMobile}
        class="w-full"
        bind:value={searchTerm}
        type="text"
        placeholder="Search issues..." />
      <GitButton size="sm" class="gap-2" onclick={() => (showFilters = !showFilters)}>
        <Eye class="h-4 w-4" />
        {showFilters ? "Hide Filters" : "Filter"}
      </GitButton>
    </div>
  </div>

  {#if showFilters}
    <FilterPanel
      {storageKey}
      authors={uniqueAuthors}
      authorFilter={authorFilter}
      allLabels={allNormalizedLabels}
      labelSearchEnabled={false}
      on:statusChange={(e) => (statusFilter = e.detail)}
      on:sortChange={(e) => (sortByOrder = e.detail)}
      on:authorChange={(e) => (authorFilter = e.detail)}
      on:labelsChange={(e) => (selectedLabels = e.detail)}
      on:matchAllChange={(e) => (matchAllLabels = e.detail)}
      showReset={true}
    />
  {/if}

  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading issues….
        {:else}
          End of message history
        {/if}
      </Spinner>
    </div>
  {:else if repoClass.issues.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No issues found.
    </div>
  {:else}
    <!-- Virtualized list container - uses parent scroll container for window-based scrolling -->
    <div bind:this={virtualListContainerRef}>
      {#if $virtualizerStore}
        {@const totalSize = $virtualizerStore.getTotalSize()}
        {@const virtualItems = $virtualizerStore.getVirtualItems()}
        {@const scrollMargin = $virtualizerStore.options.scrollMargin ?? 0}
        <div
          class="relative w-full"
          style="height: {totalSize}px;"
          data-virtualized="true"
          data-visible-count={virtualItems.length}
          data-total-count={searchedIssues.length}
        >
          {#each virtualItems as virtualRow (virtualRow.key)}
            {@const issue = searchedIssues[virtualRow.index]}
            {#if issue}
              <div
                data-index={virtualRow.index}
                data-issue-id={issue.id}
                use:measureElement={$virtualizerStore}
                class="absolute top-0 left-0 w-full pr-2"
                style="transform: translateY({virtualRow.start - scrollMargin}px);"
                onclick={(event) => handleIssueClick(event, issue, virtualRow)}
              >
                <IssueCard
                  event={issue}
                  comments={commentsOrdered[issue.id]}
                  currentCommenter={$pubkey!}
                  {onCommentCreated}
                  extraLabels={labelsByIssue.get(issue.id) || []}
                  repo={repoClass}
                  statusEvents={statusEventsByRoot?.get(issue.id) || []}
                  actorPubkey={$pubkey}
                  assignees={Array.from($roleAssignments.get(issue.id)?.assignees || [])}
                assigneeCount={$roleAssignments.get(issue.id)?.assignees?.size || 0}
                  relays={repoRelays}
                />
              </div>
            {/if}
          {/each}
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
