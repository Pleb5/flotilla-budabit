<script lang="ts">
  import {IssueCard, NewIssueForm, Button, toast, pushRepoAlert, Status} from "@nostr-git/ui"
  import {Bell, CalendarDays, Check, Clock, Eye, GitCommit, Plus, SearchX, User, X} from "@lucide/svelte"
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
  import { getTags } from "@nostr-git/shared-types"
  import {createSearch, pubkey, repository} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {slide, slideAndFade} from "@lib/transition"
  import {pushModal} from "@app/modal"
  import {
    createStatusEvent,
    type CommentEvent,
    type IssueEvent,
    type StatusEvent,
    type TrustedEvent,
  } from "@nostr-git/shared-types"
  import {PublishStatus, request} from "@welshman/net"
  import {postComment, postIssue, postStatus} from "@src/app/git-commands"
  import {nthEq, sortBy} from "@welshman/lib"
  import Icon from "@src/lib/components/Icon.svelte"
  import { RepoPatchStatus } from "@nostr-git/ui"
  import {isMobile} from "@src/lib/html"
  import {debounce} from "throttle-debounce"
  import {deriveEvents} from "@welshman/store"
  import ProfileName from "@src/app/components/ProfileName.svelte"
  import {deriveEffectiveLabels, deriveStatus} from "@app/git-state"
  import {onMount, onDestroy} from "svelte"
  import {now} from "@welshman/lib"

  const {data} = $props()
  const {repoClass, issueFilter, statusEventFilter, repoRelays, statusEventsByRoot} = data
  const mounted = now()
  const alertedIds = new Set<string>()
  // Track previous review-needed state per issue to alert only on false -> true transitions
  const prevReviewStateByIssue: Map<string, boolean> = new Map()
  // Debounce window for comment mention alerts per issue (ms)
  const mentionWindowMs = 3000
  const lastMentionAlertAtByIssue: Map<string, number> = new Map()

  const issues = $derived.by(() => {
    return sortBy(e => -e.created_at, repoClass.issues)
  })

  const comments = $state<Record<string, CommentEvent[]>>({})

  const commentsOrdered = $derived.by(() => {
    const ret: Record<string, CommentEvent[]> = {}
    for (const [key, value] of Object.entries(comments)) {
      ret[key] = sortBy(e => -e.created_at, value)
    }

  // Alerts: watch for new status events arriving after mount and alert once
  $effect(() => {
    try {
      const arr = $statusEvents || []
      for (const e of arr) {
        if (!e || !e.id) continue
        if (alertedIds.has(e.id)) continue
        if (e.created_at <= mounted) continue
        if ([GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE].includes(e.kind as number)) {
          const body = getTagValue("t", e.tags) || ""
          pushRepoAlert({
            repoKey: repoClass.canonicalKey,
            kind: "status-change",
            title: "Status changed",
            body,
          })
          alertedIds.add(e.id)
        }
      }
    } catch {}
  })
    return ret
  })

  const statusEvents = deriveEvents(repository, {filters: [statusEventFilter]})
  // Precompute statuses and reasons in one place (Svelte 5-safe)
  const statusData = $derived.by(() => {
    const byId: Record<string, StatusEvent | undefined> = {}
    const reasons: Record<string, string | undefined> = {}
    for (const issue of issues) {
      let statusStub: StatusEvent | undefined
      let reason: string | undefined
      const r = getResolvedStateFor(issue.id)
      if (r) {
        const mapKind = (s: string) =>
          s === "open"
            ? GIT_STATUS_OPEN
            : s === "draft"
              ? GIT_STATUS_DRAFT
              : s === "closed"
                ? GIT_STATUS_CLOSED
                : /* merged | resolved */ GIT_STATUS_COMPLETE
        statusStub = {kind: mapKind(r.state)} as unknown as StatusEvent
        reason = undefined
      } else {
        const res = deriveStatus(issue.id, issue.pubkey, euc).get()
        statusStub = res?.final as StatusEvent | undefined
        reason = res?.reason
      }
      byId[issue.id] = statusStub
      reasons[issue.id] = reason
    }
    return {byId, reasons}
  })

  // Extract euc grouping key from repoEvent tags (r:euc)
  const euc = $derived.by(() => {
    try {
      const evt: any = (repoClass as any).repoEvent
      const t = ((evt?.tags || []) as any[]).find((t: string[]) => t[0] === "r" && t[2] === "euc")
      return t ? t[1] : ""
    } catch {
      return ""
    }
  })

  const statuses: Record<string, StatusEvent | undefined> = $derived.by(() => statusData.byId)
  const statusReasons: Record<string, string | undefined> = $derived.by(() => statusData.reasons)

  // Alerts: review-request based on Type labels for issues; alert on transition to true
  $effect(() => {
    try {
      const arr = repoClass.issues || []
      for (const it of arr) {
        if (!it || !it.id) continue
        const groups = labelGroupsFor(it.id)
        const typeVals = (groups?.Type || []).map(v => v.toLowerCase())
        const current = typeVals.some(v => v.includes("review"))
        const prev = prevReviewStateByIssue.get(it.id) || false
        if (!prev && current) {
          pushRepoAlert({
            repoKey: repoClass.canonicalKey,
            kind: "review-request",
            title: "Review requested",
            body: getTagValue("subject", it.tags) || "",
          })
        }
        prevReviewStateByIssue.set(it.id, current)
      }
    } catch {}
  })

  // Alerts: if current user is tagged via 'p' on an issue, treat as review request; alert on transition
  $effect(() => {
    try {
      const me = $pubkey
      if (!me) return
      const arr = repoClass.issues || []
      for (const it of arr) {
        if (!it || !it.id) continue
        const pks = getTags(it as any, "p").map((t: string[]) => t[1])
        const current = pks.includes(me)
        const prev = prevReviewStateByIssue.get(it.id) || false
        if (!prev && current) {
          pushRepoAlert({
            repoKey: repoClass.canonicalKey,
            kind: "review-request",
            title: "Review requested",
            body: getTagValue("subject", it.tags) || "",
          })
        }
        prevReviewStateByIssue.set(it.id, current)
      }
    } catch {}
  })

  // Alerts: thread/comment mentions (p-tag to me) on issue threads; alert once per comment, with debounce window per issue
  $effect(() => {
    try {
      const me = $pubkey
      if (!me) return
      for (const issue of issues) {
        const cmts = commentsOrdered[issue.id] || []
        for (const c of cmts) {
          if (!c?.id) continue
          if (alertedIds.has(`review-issue-cmnt:${c.id}`)) continue
          const pks = getTags(c as any, "p").map((t: string[]) => t[1])
          if (pks.includes(me)) {
            const nowTs = Date.now()
            const last = lastMentionAlertAtByIssue.get(issue.id) || 0
            if (nowTs - last > mentionWindowMs) {
              pushRepoAlert({
                repoKey: repoClass.canonicalKey,
                kind: "review-request",
                title: "Review requested in comments",
                body: getTagValue("subject", issue.tags) || "",
              })
              lastMentionAlertAtByIssue.set(issue.id, nowTs)
            }
            alertedIds.add(`review-issue-cmnt:${c.id}`)
          }
        }
      }
    } catch {}
  })

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortByOrder = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let showFilters = $state(true)
  // Label filters (NIP-32 normalized labels)
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)
  const toNaturalLabel = (s: string): string => {
    const idx = s.lastIndexOf(":")
    return idx >= 0 ? s.slice(idx + 1) : s.replace(/^#/, "")
  }
  // Types + helpers to normalize effective labels and resolved status
  type EffectiveLabelsView = {byNamespace: Record<string, Set<string>>; flat: Set<string>}
  const toSet = (x: unknown): Set<string> =>
    x instanceof Set
      ? x
      : new Set<string>(Array.isArray(x) ? x.filter(v => typeof v === "string") : [])
  const normalizeEff = (eff: any | undefined | null): EffectiveLabelsView | null => {
    if (!eff) return null
    const flat = toSet(eff.flat)
    const byNs: Record<string, Set<string>> = {}
    if (eff.byNamespace && typeof eff.byNamespace === "object") {
      for (const ns of Object.keys(eff.byNamespace)) {
        byNs[ns] = toSet((eff.byNamespace as any)[ns])
      }
    }
    return {byNamespace: byNs, flat}
  }
  const getResolvedStateFor = (
    id: string,
  ): {state: "open" | "draft" | "closed" | "merged" | "resolved"} | null => {
    const maybe = (
      repoClass as unknown as {
        resolveStatusFor?: (
          id: string,
        ) => {state: "open" | "draft" | "closed" | "merged" | "resolved"} | null
      }
    ).resolveStatusFor
    return typeof maybe === "function" ? maybe.call(repoClass, id) : null
  }
  const labelsData = $derived.by(() => {
    const byId = new Map<string, string[]>()
    const groupsById = new Map<string, Record<string, string[]>>()
    for (const issue of issues) {
      const getter = (repoClass as unknown as {getIssueLabels?: (id: string) => any}).getIssueLabels
      const eff = normalizeEff(
        typeof getter === "function"
          ? getter.call(repoClass, issue.id)
          : deriveEffectiveLabels(issue.id).get(),
      )
      const flat = eff ? Array.from(eff.flat) : []
      const naturals = flat.map(toNaturalLabel)
      byId.set(issue.id, naturals)
      const groups: Record<string, string[]> = {Status: [], Type: [], Area: [], Tags: [], Other: []}
      if (eff) {
        for (const ns of Object.keys(eff.byNamespace)) {
          const vals = Array.from(eff.byNamespace[ns]).map(toNaturalLabel)
          if (ns === "org.nostr.git.status") groups.Status.push(...vals)
          else if (ns === "org.nostr.git.type") groups.Type.push(...vals)
          else if (ns === "org.nostr.git.area") groups.Area.push(...vals)
          else if (ns === "#t") groups.Tags.push(...vals)
          else groups.Other.push(...vals)
        }
        for (const k of Object.keys(groups)) groups[k] = Array.from(new Set(groups[k]))
      }
      groupsById.set(issue.id, groups)
    }
    return {byId, groupsById}
  })
  const labelsByIssue = $derived.by(() => labelsData.byId)
  const labelGroupsFor = (id: string) =>
    labelsData.groupsById.get(id) || {Status: [], Type: [], Area: [], Tags: [], Other: []}
  const allNormalizedLabels = $derived.by(() =>
    Array.from(new Set(Array.from(labelsByIssue.values()).flat())),
  )

  const uniqueAuthors = $derived.by(() => {
    if (!repoClass.patches) return []

    const authors = new Set<string>()
    repoClass.issues.forEach((issue: IssueEvent) => {
      const pubkey = issue.pubkey
      if (pubkey) authors.add(pubkey)
    })

    return Array.from(authors)
  })

  let searchTerm = $state("")
  let debouncedTerm = $state("")

  // Set up the debounced update
  const updateDebouncedTerm = debounce(500, (term: string) => {
    debouncedTerm = term
  })

  // Watch searchTerm changes
  $effect(() => {
    updateDebouncedTerm(searchTerm)
  })

  // Load label events for current issues
  $effect(() => {
    if (repoClass.issues && repoClass.issues.length > 0) {
      const ids = repoClass.issues.map((i: any) => i.id)
      request({
        relays: [...repoRelays],
        filters: [{kinds: [1985], "#e": ids, since: 0}],
        onEvent: () => {},
      })
    }
  })

  // Persist filters per repo
  let storageKey = ""
  onMount(() => {
    try {
      storageKey = repoClass.repoEvent
        ? `issuesFilters:${Address.fromEvent(repoClass.repoEvent!).toString()}`
        : ""
    } catch (e) {
      storageKey = ""
    }
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const data = JSON.parse(raw)
        if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
        if (typeof data.sortByOrder === "string") sortByOrder = data.sortByOrder
        if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
        if (typeof data.showFilters === "boolean") showFilters = data.showFilters
        if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
        if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
        if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
      }
    } catch (e) {
      // ignore
    }
  })

  const persist = () => {
    if (!storageKey) return
    try {
      const data = {
        statusFilter,
        sortByOrder,
        authorFilter,
        showFilters,
        searchTerm,
        selectedLabels,
        matchAllLabels,
      }
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch (e) {
      // ignore
    }
  }

  const applyFromData = (data: any) => {
    if (!data) return
    if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
    if (typeof data.sortByOrder === "string") sortByOrder = data.sortByOrder
    if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
    if (typeof data.showFilters === "boolean") showFilters = data.showFilters
    if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
    if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
    if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
  }

  const resetFilters = () => {
    statusFilter = "open"
    sortByOrder = "newest"
    authorFilter = ""
    showFilters = true
    searchTerm = ""
    selectedLabels = []
    matchAllLabels = false
    if (storageKey) localStorage.removeItem(storageKey)
  }

  let storageListener: ((e: StorageEvent) => void) | null = null
  onMount(() => {
    storageListener = (e: StorageEvent) => {
      if (!storageKey) return
      if (e.key === storageKey) {
        try {
          const data = e.newValue ? JSON.parse(e.newValue) : null
          if (data) applyFromData(data)
        } catch {}
      }
    }
    window.addEventListener("storage", storageListener)
  })
  onDestroy(() => {
    if (storageListener) window.removeEventListener("storage", storageListener)
  })

  // Persist on changes
  $effect(() => {
    statusFilter
    persist()
  })
  $effect(() => {
    sortByOrder
    persist()
  })
  $effect(() => {
    authorFilter
    persist()
  })
  $effect(() => {
    showFilters
    persist()
  })
  $effect(() => {
    searchTerm
    persist()
  })
  $effect(() => {
    selectedLabels
    persist()
  })
  $effect(() => {
    matchAllLabels
    persist()
  })

  const searchedIssues = $derived.by(() => {
    const issuesToSearch = issues.map(issue => {
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
    const searchResults = issueSearch.searchOptions(searchTerm)
    const result = issues
      .filter(r => searchResults.find(res => res.id === r.id))
      .filter(issue => {
        if (authorFilter) {
          return issue.pubkey === authorFilter
        }
        return true
      })
      .filter(issue => {
        if (selectedLabels.length === 0) return true
        const labs = labelsByIssue.get(issue.id) || []
        return matchAllLabels
          ? selectedLabels.every(l => labs.includes(l))
          : selectedLabels.some(l => labs.includes(l))
      })
      .filter(issue => {
        if (statusFilter !== "all") {
          const status = statuses[issue.id]
          if (!status) return true // NO status = OPEN!
          switch (statusFilter) {
            case "open":
              return status.kind === GIT_STATUS_OPEN
            case "resolved":
              return status.kind === GIT_STATUS_COMPLETE
            case "closed":
              return status.kind === GIT_STATUS_CLOSED
            case "draft":
              return status.kind === GIT_STATUS_DRAFT
            default:
              return true
          }
        }
        return true
      })
      .sort((a, b) =>
        sortByOrder === "newest" ? b.created_at - a.created_at : a.created_at - b.created_at,
      )
    return result
  })

  $effect(() => {
    for (const issue of issues) {
      if (!comments[issue.id]) {
        comments[issue.id] = []
        requestComments(issue)
      }
    }
  })

  const requestComments = async (issue: TrustedEvent) => {
    request({
      relays: repoClass.relays,
      filters: [{kinds: [COMMENT], "#E": [issue.id], since: issue.created_at}],
      onEvent: e => {
        if (!comments[issue.id].some(c => c.id === e.id)) {
          // Create a new array to trigger reactivity
          comments[issue.id] = [...comments[issue.id], e as CommentEvent]
        }
      },
    })
  }

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  let initialized = $state(false)
  $effect(() => {
    if (repoClass.issues && element && !initialized) {
      initialized = true
      console.log("init. repo relays:", repoClass.relays)
      makeFeed({
        element: element,
        relays: repoClass.relays,
        feedFilters: [issueFilter],
        subscriptionFilters: [issueFilter],
        initialEvents: repoClass.issues,
        onExhausted: () => {
          loading = false
        },
      })

      loading = false
    }
  })

  const onIssueCreated = async (issue: IssueEvent) => {
    console.log("repo relays", repoClass.relays)
    const relaysToUse = repoClass.relays
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
    const thunk = postIssue(issue, relaysToUse)
    const postIssueEvent = thunk.event
    const result = await thunk.result
    console.debug("onIssueCreated: publish result", result)
    if (result.error === PublishStatus.Failure) {
      console.error(result.error)
      toast.push({
        message: `Failed to publish issue${result.reason ? `: ${result.reason}` : ". Please try again."}`,
        variant: "destructive",
      })
      return
    }
    toast.push({message: "Issue created", variant: "default"})
    try {
      pushRepoAlert({
        repoKey: repoClass.canonicalKey,
        kind: "new-patch",
        title: "New issue",
        body: getTagValue("subject", issue.tags) || "",
      })
    } catch {}
    // Optimistically add the new issue to the local list so it appears immediately
    // try {
    //   if (postIssueEvent) {
    //     repoClass.issues = [postIssueEvent as IssueEvent, ...repoClass.issues]
    //   }
    // } catch (e) {
    //   console.warn("Failed to optimistically add new issue to UI:", e)
    // }
    const evt: any = (repoClass as any).repoEvent
    const statusEvent = createStatusEvent({
      kind: GIT_STATUS_OPEN,
      content: "",
      rootId: postIssueEvent.id,
      recipients: [$pubkey!, evt?.pubkey].filter(Boolean) as string[],
      repoAddr: evt ? Address.fromEvent(evt as any).toString() : "",
      relays: relaysToUse,
    })
    await postStatus(statusEvent, relaysToUse).result
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
    await postComment(comment, repoClass.relays).result
  }
</script>

<div bind:this={element}>
  <div class="sticky -top-8 z-nav my-4 max-w-full space-y-2 backdrop-blur">
    <div class=" flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Issues</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Track bugs and feature requests</p>
      </div>
      <div class="flex items-center gap-2">
        <Button class="gap-2" variant="git" size="sm" onclick={onNewIssue}>
          <Plus class="h-4 w-4" />
          <span class="">New Issue</span>
        </Button>
      </div>
    </div>
    <div class="row-2 input mt-4 grow overflow-x-hidden">
      <Icon icon="magnifer" />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus={!isMobile}
        class="w-full"
        bind:value={searchTerm}
        type="text"
        placeholder="Search issues..." />
      <Button size="sm" class="gap-2" onclick={() => (showFilters = !showFilters)}>
        <Eye class="h-4 w-4" />
        {showFilters ? "Hide Filters" : "Filter"}
      </Button>
    </div>
  </div>

  {#if showFilters}
    <div class="mb-6 rounded-md border border-border bg-card p-4" transition:slide>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <!-- Status Filter -->
        <div>
          <h3 class="mb-2 text-sm font-medium">Status</h3>
          <div class="flex flex-wrap gap-2">
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "all")}>
              All
            </Button>
            <Button
              variant={statusFilter === "open" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "open")}
              class="gap-1">
              <GitCommit class="h-3 w-3" /> Open
            </Button>
            <Button
              variant={statusFilter === "resolved" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "resolved")}
              class="gap-1">
              <Check class="h-3 w-3" /> Resolved
            </Button>
            <Button
              variant={statusFilter === "closed" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "closed")}
              class="gap-1">
              <X class="h-3 w-3" /> Closed
            </Button>
            <Button
              variant={statusFilter === "draft" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "draft")}
              class="gap-1">
              <Clock class="h-3 w-3" /> Draft
            </Button>
          </div>
        </div>

        <!-- Sort Options -->
        <div>
          <h3 class="mb-2 text-sm font-medium">Sort By</h3>
          <div class="flex flex-wrap gap-2">
            <Button
              variant={sortByOrder === "newest" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortByOrder = "newest")}
              class="gap-1">
              <CalendarDays class="h-3 w-3" /> Newest
            </Button>
            <Button
              variant={sortByOrder === "oldest" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortByOrder = "oldest")}
              class="gap-1">
              <CalendarDays class="h-3 w-3" /> Oldest
            </Button>
            <Button
              variant={sortByOrder === "status" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortByOrder = "status")}
              class="gap-1">
              <Check class="h-3 w-3" /> Status
            </Button>
          </div>
        </div>

        <!-- Author Filter -->
        {#if uniqueAuthors.length > 1}
          <div class="md:col-span-2">
            <h3 class="mb-2 text-sm font-medium">Author</h3>
            <div class="flex flex-wrap gap-2">
              <Button
                variant={authorFilter === "" ? "default" : "outline"}
                size="sm"
                onclick={() => (authorFilter = "")}>
                All Authors
              </Button>

              {#each uniqueAuthors as author}
                <Button
                  variant={authorFilter === author ? "default" : "outline"}
                  size="sm"
                  onclick={() => (authorFilter = author)}
                  class="gap-1">
                  <User class="h-3 w-3" />
                  <span class="text-sm"><ProfileName pubkey={author} /></span>
                </Button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Label Filter -->
        {#if allNormalizedLabels.length > 0}
          <div class="md:col-span-2">
            <h3 class="mb-2 text-sm font-medium">Labels</h3>
            <div class="flex flex-wrap gap-2">
              {#each allNormalizedLabels as lbl (lbl)}
                <Button
                  variant={selectedLabels.includes(lbl) ? "default" : "outline"}
                  size="sm"
                  onclick={() => {
                    selectedLabels = selectedLabels.includes(lbl)
                      ? selectedLabels.filter(l => l !== lbl)
                      : [...selectedLabels, lbl]
                  }}>
                  {lbl}
                </Button>
              {/each}
              <Button
                variant={matchAllLabels ? "default" : "outline"}
                size="sm"
                onclick={() => (matchAllLabels = !matchAllLabels)}>
                Match all
              </Button>
              {#if selectedLabels.length > 0}
                <Button variant="ghost" size="sm" onclick={() => (selectedLabels = [])}>
                  Clear labels
                </Button>
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <div class="mt-4 flex items-center justify-end">
        <Button variant="ghost" size="sm" onclick={resetFilters}>Reset Filters</Button>
      </div>
      <div class="mt-3 flex items-center justify-end">
        <span class="text-[11px] opacity-60 inline-flex items-center gap-1" title="Bell indicates review requested (label, you are tagged, or mentioned in comments)">
          <Bell class="h-3 w-3" />
          Review indicator
        </span>
      </div>
    </div>
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
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#key repoClass.issues}
        {#each searchedIssues as issue (issue.id)}
          <div in:slideAndFade={{duration: 200}} class="space-y-1">
            <div class="relative">
              <IssueCard
                event={issue}
                comments={commentsOrdered[issue.id]}
                currentCommenter={$pubkey!}
                {onCommentCreated}
                status={statuses[issue.id] || undefined}
                extraLabels={labelsByIssue.get(issue.id) || []} />
              <!-- Status chip (Repo getter preferred) -->
              {#key statuses[issue.id]}
                {@const resolved = getResolvedStateFor(issue.id)}
                {@const badge = (
                  repoClass as unknown as {
                    getMaintainerBadge?: (pubkey: string) => "owner" | "maintainer" | null
                  }
                ).getMaintainerBadge?.call(repoClass, issue.pubkey)}
                {@const needsReview = (() => {
                  try {
                    const typeVals = (labelGroupsFor(issue.id).Type || []).map((v: string) => v.toLowerCase())
                    const hasType = typeVals.some(v => v.includes("review"))
                    const me = $pubkey
                    const pks = getTags(issue as any, "p").map((t: string[]) => t[1])
                    const hasTag = !!(me && pks.includes(me))
                    const hasMention = !!(me && (commentsOrdered[issue.id] || []).some((c: any) => getTags(c, "p").some((t: string[]) => t[1] === me)))
                    return hasType || hasTag || hasMention
                  } catch { return false }
                })()}
                <div class="absolute left-2 top-2 flex items-center gap-2">
                  <RepoPatchStatus
                    state={resolved?.state}
                    kind={statuses[issue.id]?.kind}
                    reason={statusReasons[issue.id]}
                    badgeRole={badge}
                    reviewRequested={needsReview} />
                  <!-- Compact Status Component -->
                  <Status
                    repo={repoClass}
                    rootId={issue.id}
                    rootKind={1621}
                    rootAuthor={issue.pubkey}
                    statusEvents={$statusEventsByRoot?.get(issue.id) || []}
                    actorPubkey={$pubkey}
                    compact={true} />
                </div>
              {/key}
            </div>
            {#if labelsByIssue.get(issue.id)?.length}
              <div class="mt-1 flex flex-wrap gap-2 text-xs">
                {#if labelGroupsFor(issue.id).Status.length}
                  <span class="opacity-60">Status:</span>
                  {#each labelGroupsFor(issue.id).Status as l (l)}<span
                      class="badge badge-ghost badge-sm">{l}</span
                    >{/each}
                {/if}
                {#if labelGroupsFor(issue.id).Type.length}
                  <span class="opacity-60">Type:</span>
                  {#each labelGroupsFor(issue.id).Type as l (l)}<span
                      class="badge badge-ghost badge-sm">{l}</span
                    >{/each}
                {/if}
                {#if labelGroupsFor(issue.id).Area.length}
                  <span class="opacity-60">Area:</span>
                  {#each labelGroupsFor(issue.id).Area as l (l)}<span
                      class="badge badge-ghost badge-sm">{l}</span
                    >{/each}
                {/if}
                {#if labelGroupsFor(issue.id).Tags.length}
                  <span class="opacity-60">Tags:</span>
                  {#each labelGroupsFor(issue.id).Tags as l (l)}<span
                      class="badge badge-ghost badge-sm">{l}</span
                    >{/each}
                {/if}
                {#if labelGroupsFor(issue.id).Other.length}
                  <span class="opacity-60">Other:</span>
                  {#each labelGroupsFor(issue.id).Other as l (l)}<span
                      class="badge badge-ghost badge-sm">{l}</span
                    >{/each}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/key}
    </div>
  {/if}
</div>
