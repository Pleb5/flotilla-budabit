<script lang="ts">
  import {IssueCard, NewIssueForm, Button as GitButton, toast, pushRepoAlert} from "@nostr-git/ui"
  import {
    createStatusEvent,
    GIT_ISSUE,
    type CommentEvent,
    type IssueEvent,
    type LabelEvent,
  } from "@nostr-git/core/events"
  import {Eye, Plus, SearchX} from "@lucide/svelte"
  import {
    Address,
    getTagValue,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    GIT_STATUS_CLOSED,
    getTag,
    type TrustedEvent,
  } from "@welshman/util"
  import {createSearch, pubkey, repository} from "@welshman/app"
  import {sortBy} from "@welshman/lib"
  import {request} from "@welshman/net"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Magnifer from "@assets/icons/magnifer.svg?dataurl"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import {makeFeed} from "@app/core/requests"
  import {pushModal} from "@app/util/modal"
  import {checked, setChecked, setCheckedAt, notifications, setCheckedForRepoNotifications} from "@app/util/notifications"
  import {postComment, postIssue, publishEvent} from "@lib/budabit/commands.js"
  import FilterPanel from "@src/lib/budabit/components/FilterPanel.svelte"
  import {isMobile} from "@lib/html"
  import {onMount, onDestroy, tick} from "svelte"
  import {pushToast} from "@src/app/util/toast"
  import {toNaturalArray} from "@lib/budabit/labels"
  import {page} from "$app/stores"
  import {decodeRelay} from "@app/core/state"
  import {beforeNavigate} from "$app/navigation"
  
  import {getContext} from "svelte"
  import {
    REPO_KEY,
    REPO_RELAYS_KEY,
    STATUS_EVENTS_BY_ROOT_KEY,
    deriveAssignmentsFor,
    effectiveMaintainersByRepoAddress,
    effectiveRepoAddressesByRepoAddress,
  } from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import type {StatusEvent} from "@nostr-git/core/events"
  import {fade} from "svelte/transition"
  import {resolveIssueEdits} from "@lib/budabit/issue-edits"

  let showScrollButton = $state(false)
  let pageContainerRef: HTMLElement | undefined = $state()
  let scrollParent: HTMLElement | null = $state(null)
  const ITEMS_PER_PAGE = 20
  let visibleIssueCount = $state(ITEMS_PER_PAGE)
  let lastKnownIssueIndex = $state(0)
  let lastKnownIssueOffset = $state(0)
  let lastKnownIssueId = $state("")
  let lastKnownIssueTitle = $state("")
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
  const scrollStorageKey = $derived.by(() => `repoScroll:${$page.params.id}:issues`)
  const issuesPath = $derived.by(
    () => `/spaces/${encodeURIComponent($page.params.relay ?? "")}/git/${$page.params.id}/issues`,
  )
  const relayUrl = $derived.by(() => ($page.params.relay ? decodeRelay($page.params.relay) : ""))
  const issuesSeenKey = $derived.by(() => `${issuesPath}:seen`)
  const normalizeChecked = (value: number) =>
    value > 10_000_000_000 ? Math.round(value / 1000) : value
  const lastIssuesSeen = $derived.by(() => normalizeChecked($checked[issuesSeenKey] || 0))
  const repoAddress = $derived.by(() => repoClass?.address || "")
  const effectiveRepoAddresses = $derived.by((): string[] => {
    if (!repoAddress) return []
    const addresses = $effectiveRepoAddressesByRepoAddress.get(repoAddress)
    if (addresses && addresses.size > 0) return Array.from(addresses)
    return [repoAddress]
  })
  const effectiveMaintainers = $derived.by((): string[] => {
    const owner = (repoClass as any)?.repoEvent?.pubkey as string | undefined
    const fallback = Array.from(
      new Set([...(repoClass?.maintainers || []), owner].filter((value): value is string => Boolean(value))),
    )
    if (!repoAddress) return fallback
    const maintainers = $effectiveMaintainersByRepoAddress.get(repoAddress)
    if (maintainers && maintainers.size > 0) return Array.from(maintainers)
    return fallback
  })

  const withIssueRecipients = (event: IssueEvent, recipients: string[]): IssueEvent => {
    const dedupedRecipients = Array.from(new Set(recipients.filter(Boolean)))
    const tags = (event.tags || []).filter((tag: string[]) => tag[0] !== "p")
    tags.push(...dedupedRecipients.map((recipient: string) => ["p", recipient] as ["p", string]))
    return {
      ...event,
      tags,
    }
  }

  type IssueListItem = {
    id: string
    created_at: number
    event: IssueEvent
  }

  const LABEL_PREFETCH_LIMIT = 200
  const LABEL_PREFETCH_IDLE_MS = 2000
  const LABEL_PREFETCH_DELAY_MS = 150
  const LABEL_PREFETCH_CHUNK_SIZE = 50
  const GIT_COVER_LETTER_KIND = 1624

  // Find scroll parent when page container is mounted
  $effect(() => {
    const container = pageContainerRef
    if (!container) return

    scrollParent = container.closest(".scroll-container") as HTMLElement | null
  })

  const getIssueAnchorPayload = (issueId: string) => {
    const issueIndex = searchedIssues.findIndex(issue => issue.id === issueId)
    const issue = issueIndex >= 0 ? searchedIssues[issueIndex] : undefined
    const title = issue ? getTagValue("subject", issue.event.tags) ?? "" : ""

    let offset = lastKnownIssueOffset
    if (scrollParent) {
      const containerRect = scrollParent.getBoundingClientRect()
      const itemEl = scrollParent.querySelector(`[data-issue-id="${issueId}"]`) as HTMLElement | null
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
      visibleCount: issueIndex >= 0 ? Math.max(visibleIssueCount, issueIndex + 1) : visibleIssueCount,
    }
  }

  const updateVisibleAnchor = () => {
    const scrollEl = scrollParent
    const currentIssues = searchedIssues
    if (!scrollEl || currentIssues.length === 0) return

    const items = Array.from(scrollEl.querySelectorAll("[data-issue-id]")) as HTMLElement[]
    if (items.length === 0) return

    const containerRect = scrollEl.getBoundingClientRect()
    let anchor = items.find(item => item.getBoundingClientRect().bottom > containerRect.top) ?? items[0]

    if (!anchor) return

    const issueId = anchor.dataset.issueId ?? ""
    const parsedIndex = Number(anchor.dataset.index)
    const index = Number.isFinite(parsedIndex)
      ? parsedIndex
      : currentIssues.findIndex(issue => issue.id === issueId)
    if (index < 0) return

    const issue = currentIssues[index]
    const anchorOffset = anchor.getBoundingClientRect().top - containerRect.top

    lastKnownIssueIndex = index
    lastKnownIssueOffset = anchorOffset
    lastKnownIssueId = issue?.id ?? ""
    lastKnownIssueTitle = issue ? getTagValue("subject", issue.event.tags) ?? "" : ""
  }


  // Handle scroll events for showing scroll-to-top button
  $effect(() => {
    const scrollEl = scrollParent
    if (!scrollEl) return

    const syncScrollState = () => {
      showScrollButton = scrollEl.scrollTop > 1500
      updateVisibleAnchor()
    }

    const handleScroll = () => {
      syncScrollState()
    }

    syncScrollState()
    scrollEl.addEventListener("scroll", handleScroll, {passive: true})
    return () => scrollEl.removeEventListener("scroll", handleScroll)
  })

  $effect(() => {
    updateVisibleAnchor()
  })


  const handleIssueClick = (
    event: MouseEvent,
    issue: IssueListItem,
    index: number,
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target as HTMLElement | null
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!anchor) return

    const href = anchor.getAttribute("href") || ""
    if (!href.includes(`issues/${issue.id}`)) return

    const scrollEl = scrollParent
    if (!scrollEl) return

    const title = getTagValue("subject", issue.event.tags) ?? ""
    const itemElement = event.currentTarget as HTMLElement | null
    const containerRect = scrollEl.getBoundingClientRect()
    const itemRect = itemElement?.getBoundingClientRect()
    const anchorOffset = itemRect ? itemRect.top - containerRect.top : lastKnownIssueOffset

    pendingScrollRestore = {
      index,
      offset: anchorOffset,
      id: issue.id,
      title,
      visibleCount: Math.max(visibleIssueCount, index + 1),
    }

  }

  $effect(() => {
    const scrollEl = scrollParent
    const count = searchedIssues.length
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
    let savedIssueId = ""
    let savedIssueTitle = ""

    try {
      const parsed = JSON.parse(savedRaw) as {
        index?: number
        offset?: number
        id?: string
        title?: string
        visibleCount?: number
      }
      parsedIndex = Number(parsed?.index ?? 0)
      parsedOffset = Number(parsed?.offset ?? 0)
      savedIssueId = typeof parsed?.id === "string" ? parsed.id : ""
      savedIssueTitle = typeof parsed?.title === "string" ? parsed.title : ""
      const parsedVisibleCount = Number(parsed?.visibleCount ?? ITEMS_PER_PAGE)
      if (!Number.isNaN(parsedVisibleCount) && parsedVisibleCount > 0 && visibleIssueCount < parsedVisibleCount) {
        visibleIssueCount = Math.min(Math.max(parsedVisibleCount, ITEMS_PER_PAGE), count)
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
    const requiredVisibleCount = Math.max(targetIndex + 1, ITEMS_PER_PAGE)
    if (visibleIssueCount < requiredVisibleCount) {
      visibleIssueCount = Math.min(requiredVisibleCount, count)
      return
    }

    const targetIssue = searchedIssues[targetIndex]
    const targetIssueTitle = targetIssue ? getTagValue("subject", targetIssue.event.tags) ?? "" : ""
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


    const attemptRestore = () => {
      const targetElement = scrollEl.querySelector(`[data-issue-id="${anchorIssueId}"]`) as HTMLElement | null
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

    const payload = isIssueDetailNav && nextIssueId
      ? getIssueAnchorPayload(nextIssueId)
      : pendingScrollRestore ?? {
          index: lastKnownIssueIndex,
          offset: lastKnownIssueOffset,
          id: lastKnownIssueId,
          title: lastKnownIssueTitle,
          visibleCount: visibleIssueCount,
        }
    sessionStorage.setItem(scrollStorageKey, JSON.stringify(payload))
    pendingScrollRestore = null
  })



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

  const commentsOrdered = $derived.by(() => {
    const ret: Record<string, CommentEvent[]> = {}
    for (const issue of issues) {
      if (!issue?.id) continue
      const thread = repoClass.getIssueThread(issue.id)
      ret[issue.id] = sortBy(e => -e.created_at, thread.comments || [])
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

  const issueEditFilters = $derived.by(() => {
    const ids = (issues || []).map(issue => issue.id).filter(Boolean)
    if (ids.length === 0) return []
    return chunkIds(ids, LABEL_PREFETCH_CHUNK_SIZE).map(chunk => ({
      kinds: [1985, GIT_COVER_LETTER_KIND],
      "#e": chunk,
    }))
  })

  const issueEditEvents = $derived.by(() =>
    deriveEventsAsc(deriveEventsById({repository, filters: issueEditFilters})),
  )

  let issueEditsById = $state<Map<string, {subject: string; content: string; labels: string[]}>>(
    new Map(),
  )

  $effect(() => {
    const currentIssues = issues || []
    const fallbackMaintainers = new Set(effectiveMaintainers)
    const maintainersByRepoAddress = $effectiveMaintainersByRepoAddress
    // Keep effect subscribed to any 1985/1624 event changes
    void $issueEditEvents

    const next = new Map<string, {subject: string; content: string; labels: string[]}>()
    for (const issue of currentIssues) {
      const issueRepoAddress = getTagValue("a", issue.tags) || repoAddress
      const maintainersFromAddress =
        issueRepoAddress && maintainersByRepoAddress.get(issueRepoAddress)
      const maintainersFromCurrentRepo = repoAddress && maintainersByRepoAddress.get(repoAddress)
      const maintainers =
        maintainersFromAddress && maintainersFromAddress.size > 0
          ? maintainersFromAddress
          : maintainersFromCurrentRepo && maintainersFromCurrentRepo.size > 0
            ? maintainersFromCurrentRepo
          : fallbackMaintainers

      const labelEvents = repository.query(
        [{kinds: [1985], "#e": [issue.id]}],
        {shouldSort: false},
      ) as LabelEvent[]
      const coverLetters = repository.query(
        [{kinds: [GIT_COVER_LETTER_KIND], "#e": [issue.id]}],
        {shouldSort: false},
      ) as TrustedEvent[]
      const edits = resolveIssueEdits({
        issueEvent: issue as any,
        labelEvents,
        coverLetters: coverLetters as any,
        maintainers,
      })
      next.set(issue.id, {subject: edits.subject, content: edits.content, labels: edits.labels})
    }

    issueEditsById = next
  })

  const labelsByIssue = $derived.by(() => {
    const result = new Map<string, string[]>()
    for (const issue of issues || []) {
      const edits = issueEditsById.get(issue.id)
      const labels = edits?.labels || []
      result.set(issue.id, toNaturalArray(labels))
    }
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

  // Prefetch recent issue edit events (1985 labels + 1624 cover letters)
  $effect(() => {
    const currentIssues = repoClass.issues || []
    const currentRepoRelays = repoRelays.filter(Boolean)
    if (currentRepoRelays.length === 0) return
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

    const key = `${relayList.slice().sort().join("|")}::${ids.join(",")}`
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
        kinds: [1985, GIT_COVER_LETTER_KIND],
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
  let issueList = $state<IssueListItem[]>([])
  let issueListCacheKey = $state<string>("")

  $effect(() => {
    // Access reactive dependencies synchronously to ensure they're tracked
    if (!repoClass) return
    
    const currentIssues = repoClass.issues
    const currentComments = commentsOrdered
    const currentStatusMap = statusMap
    const currentIssueEdits = issueEditsById
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
      const editsKey = Array.from(currentIssueEdits.entries())
        .map(([id, edit]) => `${id}:${edit.subject}:${edit.content.length}:${edit.labels.join(",")}`)
        .sort()
        .join("|")
      const currentKey = `${issueIds}|${commentIds}|${statusMapKeys}|${editsKey}`

      if (currentIssueListCacheKey === currentKey) return

      const processed = currentIssues.map((issue: IssueEvent) => {
        const edits = currentIssueEdits.get(issue.id)
        const subject = edits?.subject || getTagValue("subject", issue.tags) || ""
        const content = edits?.content ?? issue.content
        const labels = edits?.labels ||
          ((issue.tags || [])
            .filter((tag: string[]) => tag[0] === "t")
            .map((tag: string[]) => tag[1])
            .filter(Boolean))

        const tags = ((issue.tags || []) as string[][]).filter(
          (tag: string[]) => tag[0] !== "subject" && tag[0] !== "t",
        )
        if (subject) tags.push(["subject", subject])
        for (const label of labels) tags.push(["t", label])

        return {
          id: issue.id,
          created_at: issue.created_at,
          event: {
            ...issue,
            content,
            tags,
          } as IssueEvent,
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
  let searchedIssues = $state<IssueListItem[]>([])
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
          subject: getTagValue("subject", issue.event.tags) ?? "",
          desc: issue.event.content,
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
            return issue.event.pubkey === currentAuthorFilter
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

  $effect(() => {
    searchTerm
    statusFilter
    authorFilter
    selectedLabels
    matchAllLabels
    sortByOrder
    visibleIssueCount = ITEMS_PER_PAGE
  })

  $effect(() => {
    const total = searchedIssues.length
    if (visibleIssueCount > total) {
      visibleIssueCount = total
      return
    }

    if (total > 0 && visibleIssueCount === 0) {
      visibleIssueCount = Math.min(ITEMS_PER_PAGE, total)
    }
  })

  const visibleIssues = $derived.by(() => searchedIssues.slice(0, visibleIssueCount))
  const canLoadMoreIssues = $derived.by(() => visibleIssueCount < searchedIssues.length)

  const loadMoreIssues = () => {
    visibleIssueCount = Math.min(visibleIssueCount + ITEMS_PER_PAGE, searchedIssues.length)
  }

  const roleAssignments = $derived.by(() => {
    const ids = repoClass.issues?.map((i: any) => i.id) || []
    return deriveAssignmentsFor(ids)
  })

  // Set loading to false immediately if we have data - don't wait for makeFeed
  let loading = $state(false)
  let feedInitialized = $state(false)
  let feedCleanup: (() => void) | undefined = $state(undefined)

  // Create combined filter for issues and status events
  const combinedFilter = $derived.by(() => ({
    kinds: [
      GIT_ISSUE,
      GIT_STATUS_OPEN,
      GIT_STATUS_DRAFT,
      GIT_STATUS_CLOSED,
      GIT_STATUS_COMPLETE,
    ],
    "#a": effectiveRepoAddresses,
  }))

  // Initialize feed asynchronously - don't block render
  onMount(() => {
    if (repoClass && repoClass.issues && !feedInitialized) {
      // Defer makeFeed to avoid blocking initial render
      const timeout = setTimeout(() => {
        const tryStart = () => {
          if (pageContainerRef && !feedInitialized) {
            const currentRepoRelays = repoRelays
            const currentRepoAddresses = effectiveRepoAddresses
            const currentIssueEvents = issueList.map(issue => issue.event as TrustedEvent)
            if (!currentRepoRelays.length || currentRepoAddresses.length === 0) {
              requestAnimationFrame(tryStart)
              return
            }
            feedInitialized = true
            const feed = makeFeed({
              element: pageContainerRef,
              relays: currentRepoRelays,
              feedFilters: [combinedFilter],
              subscriptionFilters: [combinedFilter],
              initialEvents: currentIssueEvents,
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
    const seenAt = getIssuesSeenAt()
    setCheckedAt(issuesSeenKey, seenAt)
    setCheckedAt(issuesPath, seenAt)
    if (repoAddress && relayUrl) {
      setCheckedForRepoNotifications($notifications, {
        relay: relayUrl,
        repoAddress,
        kind: "issues",
      }, seenAt)
    }
    // Cleanup makeFeed (aborts network requests, stops scroll observers, unsubscribes)
    feedCleanup?.()

    if (labelsPrefetchTimeout) {
      clearTimeout(labelsPrefetchTimeout)
      labelsPrefetchTimeout = null
    }
    labelsPrefetchController?.abort()
    labelsPrefetchController = null
    labelsPrefetchKey = ""

  })

  const onIssueCreated = async (issue: IssueEvent) => {
    const relaysToUse = repoRelays
    if (!relaysToUse || relaysToUse.length === 0) {
      console.warn("onIssueCreated: no relays available", {relaysToUse})
      toast.push({
        message: "No relays available to publish issue.",
        variant: "destructive",
      })
      return
    }
    const evt: any = (repoClass as any).repoEvent
    const maintainers = Array.from(new Set([
      ...effectiveMaintainers,
      evt?.pubkey,
    ].filter(Boolean)))
    const issueWithRecipients = withIssueRecipients(issue, maintainers)

    const postIssueEvent = postIssue(issueWithRecipients, relaysToUse)
    pushToast({message: "Issue created"})
    try {
      pushRepoAlert({
        repoKey: repoClass.key,
        kind: "new-patch",
        title: "New issue",
        body: getTagValue("subject", issueWithRecipients.tags) || "",
      })
    } catch {}

    const statusEvent = createStatusEvent({
      kind: GIT_STATUS_OPEN,
      content: "",
      rootId: postIssueEvent.event.id,
      recipients: Array.from(new Set([...maintainers, $pubkey].filter(Boolean))),
      repoAddr: evt ? Address.fromEvent(evt as any).toString() : "",
      relays: relaysToUse,
    })
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
    scrollParent?.scrollTo({ top: 0, behavior: "smooth" })
  }

  const getLatestIssueActivityAt = (issue: IssueListItem) => {
    const commentAt = commentsOrdered[issue.id]?.[0]?.created_at ?? 0
    const statusEvents = statusEventsByRoot?.get(issue.id) || []
    let statusAt = 0
    for (const event of statusEvents) {
      if (event.created_at > statusAt) statusAt = event.created_at
    }
    const createdAt = issue?.created_at || 0
    return Math.max(createdAt, commentAt, statusAt)
  }

  const getIssuesSeenAt = () => {
    let latest = lastIssuesSeen
    for (const issue of issueList) {
      latest = Math.max(latest, getLatestIssueActivityAt(issue))
    }
    return latest
  }

</script>

<svelte:head>
  <title>{repoClass?.name || 'Repository'} - Issues</title>
</svelte:head>

<div bind:this={pageContainerRef}>
  <div class="my-4 max-w-full space-y-2">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-xl font-semibold">Issues</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Track bugs and feature requests</p>
      </div>
      <div class="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
        {#if $pubkey}
          <GitButton class="w-full gap-2 sm:w-auto" variant="git" size="sm" onclick={onNewIssue}>
            <Plus class="h-4 w-4" />
            <span class="">New Issue</span>
          </GitButton>
        {/if}
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
  {:else if searchedIssues.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No issues found.
    </div>
  {:else}
    <div class="flex flex-col gap-y-4">
      {#each visibleIssues as issue, index (issue.id)}
        <div
          data-index={index}
          data-issue-id={issue.id}
          class="w-full pr-2"
          onclick={event => handleIssueClick(event, issue, index)}
          role="button"
          tabindex="0"
          onkeydown={event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              handleIssueClick(event as unknown as MouseEvent, issue, index)
            }
          }}>
          <div class={getLatestIssueActivityAt(issue) > lastIssuesSeen ? "border-l-2 border-primary pl-2" : ""}>
            <IssueCard
              event={issue.event}
              comments={commentsOrdered[issue.id]}
              currentCommenter={$pubkey || ""}
              onCommentCreated={$pubkey ? onCommentCreated : undefined}
              extraLabels={labelsByIssue.get(issue.id) || []}
              repo={repoClass}
              statusEvents={statusEventsByRoot?.get(issue.id) || []}
              actorPubkey={$pubkey}
              assignees={Array.from($roleAssignments.get(issue.id)?.assignees || [])}
              assigneeCount={$roleAssignments.get(issue.id)?.assignees?.size || 0}
              relays={repoRelays}
            />
          </div>
        </div>
      {/each}

      {#if canLoadMoreIssues}
        <div class="mt-2 flex flex-col items-center gap-2 pb-2">
          <GitButton variant="outline" size="sm" class="gap-2" onclick={loadMoreIssues}>
            Load more
          </GitButton>
          <p class="text-xs text-muted-foreground">
            Showing {visibleIssues.length} of {searchedIssues.length}
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
