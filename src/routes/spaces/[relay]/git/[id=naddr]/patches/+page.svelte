<script lang="ts">
  import {Button, PatchCard, pushRepoAlert} from "@nostr-git/ui"
  import {Bell, CalendarDays, Check, Clock, Eye, GitCommit, SearchX, User, X} from "@lucide/svelte"
  import {createSearch, pubkey} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
  } from "@welshman/util"
  import {fly, slide, slideAndFade} from "@lib/transition"
  import {load} from "@welshman/net"
  import {
    getTags,
    type CommentEvent,
    type PatchEvent,
    type StatusEvent,
  } from "@nostr-git/shared-types"
  import {parseGitPatchFromEvent} from "@nostr-git/core"
  import Icon from "@src/lib/components/Icon.svelte"
  import {PatchDagSummary} from "@nostr-git/ui"
  import {RepoPatchStatus} from "@nostr-git/ui"
  import {isMobile} from "@src/lib/html.js"
  import {postComment} from "@src/app/commands"
  import {Address} from "@welshman/util"
  import ProfileName from "@src/app/components/ProfileName.svelte"
  import {deriveEffectiveLabels, deriveStatus} from "@app/state"
  import {onMount, onDestroy} from "svelte"
  import {now} from "@welshman/lib"

  const {data} = $props()
  const {repoClass, comments, statusEvents, patchFilter, repoRelays, uniqueAuthors} = data
  const mounted = now()
  const alertedIds = new Set<string>()
  // Track previous review-needed state to only alert on false -> true transitions
  const prevReviewStateByPatch: Map<string, boolean> = new Map()
  // Debounce window for comment mention alerts per patch (ms)
  const mentionWindowMs = 3000
  const lastMentionAlertAtByPatch: Map<string, number> = new Map()

  // Filter and sort options
  let statusFilter = $state<string>("open") // all, open, applied, closed, draft
  let sortBy = $state<string>("newest") // newest, oldest, status, commits
  let authorFilter = $state<string>("") // empty string means all authors
  let showFilters = $state(true)
  let searchTerm = $state("")
  // Label filters (NIP-32)
  let selectedLabels = $state<string[]>([])
  let matchAllLabels = $state(false)
  let labelSearch = $state("")
  // Centralized labels via app state; render as natural values (no FQN, no '#')
  const toNaturalLabel = (s: string): string => {
    const idx = s.lastIndexOf(":")
    return idx >= 0 ? s.slice(idx + 1) : s.replace(/^#/, "")
  }

  // Types + helpers to normalize effective labels and resolved status
  type EffectiveLabelsView = {byNamespace: Record<string, Set<string>>; flat: Set<string>}
  const isSetOfString = (x: unknown): x is Set<string> =>
    x instanceof Set && Array.from(x).every(v => typeof v === "string")
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
    for (const p of repoClass.patches || []) {
      const getter = (repoClass as unknown as {getPatchLabels?: (id: string) => any}).getPatchLabels
      const eff = normalizeEff(
        typeof getter === "function"
          ? getter.call(repoClass, p.id)
          : deriveEffectiveLabels(p.id).get(),
      )
      const flat = eff ? Array.from(eff.flat) : []
      const naturals = flat.map(toNaturalLabel)
      byId.set(p.id, naturals)
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
      groupsById.set(p.id, groups)
    }
    return {byId, groupsById}
  })

  // Alerts: if current user is explicitly tagged via 'p' on a root patch, treat as review request
  $effect(() => {
    try {
      const me = $pubkey
      if (!me) return
      const arr = repoClass.patches || []
      for (const p of arr) {
        if (!p || !p.id) continue
        // only root patches
        const isRoot = getTags(p, "t").some((t: string[]) => t[1] === "root")
        if (!isRoot) continue
        const pTags = getTags(p, "p").map((t: string[]) => t[1])
        const current = pTags.includes(me)
        const prev = prevReviewStateByPatch.get(p.id) || false
        if (!prev && current) {
          pushRepoAlert({
            repoKey: repoClass.canonicalKey,
            kind: "review-request",
            title: "Review requested",
            body: parseGitPatchFromEvent(p)?.title || "",
          })
        }
        prevReviewStateByPatch.set(p.id, current)
      }
    } catch {}
  })

  // Alerts: thread/comment mentions (p-tag to me) on patch threads; alert once per comment, with debounce window per patch
  $effect(() => {
    try {
      const me = $pubkey
      if (!me) return
      const arr = repoClass.patches || []
      for (const p of arr) {
        if (!p || !p.id) continue
        const thread = repoClass.getIssueThread(p.id)
        const comments = thread?.comments || []
        for (const c of comments) {
          if (!c?.id) continue
          if (alertedIds.has(`review-cmnt:${c.id}`)) continue
          const pks = getTags(c as any, "p").map((t: string[]) => t[1])
          if (pks.includes(me)) {
            const nowTs = Date.now()
            const last = lastMentionAlertAtByPatch.get(p.id) || 0
            if (nowTs - last > mentionWindowMs) {
              pushRepoAlert({
                repoKey: repoClass.canonicalKey,
                kind: "review-request",
                title: "Review requested in comments",
                body: parseGitPatchFromEvent(p)?.title || "",
              })
              lastMentionAlertAtByPatch.set(p.id, nowTs)
            }
            alertedIds.add(`review-cmnt:${c.id}`)
          }
        }
      }
    } catch {}
  })

  // Alerts: review-request based on Type labels; alert on transition to true
  $effect(() => {
    try {
      const arr = repoClass.patches || []
      for (const p of arr) {
        if (!p || !p.id) continue
        const groups = labelGroupsFor(p.id)
        const typeVals = (groups?.Type || []).map(v => v.toLowerCase())
        const current = typeVals.some(v => v.includes("review"))
        const prev = prevReviewStateByPatch.get(p.id) || false
        if (!prev && current) {
          pushRepoAlert({
            repoKey: repoClass.canonicalKey,
            kind: "review-request",
            title: "Review requested",
            body: parseGitPatchFromEvent(p)?.title || "",
          })
        }
        prevReviewStateByPatch.set(p.id, current)
      }
    } catch {}
  })

  // Optional: Patch DAG summary using Repo getter if available
  const patchDag = $derived.by(() => {
    try {
      const rc: any = repoClass as any
      if (rc && typeof rc.getPatchGraph === "function") {
        const g = rc.getPatchGraph()
        return {
          roots: Array.isArray(g?.roots) ? g.roots : [],
          rootRevisions: Array.isArray(g?.rootRevisions) ? g.rootRevisions : [],
          nodeCount: g?.nodes ? (g.nodes.size ?? 0) : 0,
          edgesCount: typeof g?.edgesCount === "number" ? g.edgesCount : undefined,
          topParents: Array.isArray(g?.topParents) ? g.topParents : undefined,
          parentOutDegree:
            typeof g?.parentOutDegree === "object"
              ? (g.parentOutDegree as Record<string, number>)
              : undefined,
          parentChildren:
            typeof g?.parentChildren === "object"
              ? (g.parentChildren as Record<string, string[]>)
              : undefined,
        }
      }
    } catch {}
    return null
  })
  const labelsByPatch = $derived.by(() => labelsData.byId)
  const labelGroupsFor = (id: string) =>
    labelsData.groupsById.get(id) || {Status: [], Type: [], Area: [], Tags: [], Other: []}

  // Persist filters per repo
  let storageKey = ""
  onMount(() => {
    try {
      storageKey = repoClass.repoEvent
        ? `patchesFilters:${Address.fromEvent(repoClass.repoEvent!).toString()}`
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
        if (typeof data.sortBy === "string") sortBy = data.sortBy
        if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
        if (typeof data.showFilters === "boolean") showFilters = data.showFilters
        if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
        if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
        if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
        if (typeof data.labelSearch === "string") labelSearch = data.labelSearch
      }
    } catch (e) {
      // ignore
    }
  })

  // Alerts: watch for new status events since mount and push alerts
  $effect(() => {
    try {
      const arr = $statusEvents || []
      for (const e of arr) {
        if (!e || !e.id) continue
        if (alertedIds.has(e.id)) continue
        if (e.created_at <= mounted) continue
        const k = e.kind as number
        if ([GIT_STATUS_OPEN, GIT_STATUS_DRAFT, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE].includes(k)) {
          const title =
            k === GIT_STATUS_COMPLETE
              ? "Patch merged"
              : k === GIT_STATUS_CLOSED
                ? "Patch closed"
                : k === GIT_STATUS_DRAFT
                  ? "Patch draft"
                  : "Patch opened"
          pushRepoAlert({
            repoKey: repoClass.canonicalKey,
            kind: "status-change",
            title,
          })
          alertedIds.add(e.id)
        }
      }
    } catch {}
  })

  const persist = () => {
    if (!storageKey) return
    try {
      const data = {
        statusFilter,
        sortBy,
        authorFilter,
        showFilters,
        searchTerm,
        selectedLabels,
        matchAllLabels,
        labelSearch,
      }
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch (e) {
      // ignore
    }
  }

  $effect(() => {
    statusFilter
    persist()
  })
  $effect(() => {
    sortBy
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
  $effect(() => {
    labelSearch
    persist()
  })

  const applyFromData = (data: any) => {
    if (!data) return
    if (typeof data.statusFilter === "string") statusFilter = data.statusFilter
    if (typeof data.sortBy === "string") sortBy = data.sortBy
    if (typeof data.authorFilter === "string") authorFilter = data.authorFilter
    if (typeof data.showFilters === "boolean") showFilters = data.showFilters
    if (typeof data.searchTerm === "string") searchTerm = data.searchTerm
    if (Array.isArray(data.selectedLabels)) selectedLabels = data.selectedLabels
    if (typeof data.matchAllLabels === "boolean") matchAllLabels = data.matchAllLabels
    if (typeof data.labelSearch === "string") labelSearch = data.labelSearch
  }

  const resetFilters = () => {
    statusFilter = "open"
    sortBy = "newest"
    authorFilter = ""
    showFilters = true
    searchTerm = ""
    selectedLabels = []
    matchAllLabels = false
    labelSearch = ""
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
  const allNormalizedLabels = $derived.by(() =>
    Array.from(new Set(Array.from(labelsByPatch.values()).flat())),
  )

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

  // Precompute status for patches to avoid scattered .get() calls
  const patchStatusData = $derived.by(() => {
    const byId: Record<string, StatusEvent | undefined> = {}
    const reasons: Record<string, string | undefined> = {}
    for (const p of repoClass.patches || []) {
      let statusStub: StatusEvent | undefined
      let reason: string | undefined
      const r = getResolvedStateFor(p.id)
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
        const res = deriveStatus(p.id, p.pubkey, euc).get()
        statusStub = res?.final as StatusEvent | undefined
        reason = res?.reason
      }
      byId[p.id] = statusStub
      reasons[p.id] = reason
    }
    return {byId, reasons}
  })
  const statusByPatch: Record<string, StatusEvent | undefined> = $derived.by(
    () => patchStatusData.byId,
  )
  const statusReasonByPatch: Record<string, string | undefined> = $derived.by(
    () => patchStatusData.reasons,
  )

  const patchList = $derived.by(() => {
    if (repoClass.patches && $statusEvents.length > 0 && $comments) {
      // First get all root patches
      let filteredPatches = repoClass.patches
        .filter((patch: PatchEvent) => {
          return getTags(patch, "t").find((tag: string[]) => tag[1] === "root")
        })
        .map((patch: PatchEvent) => {
          // Use precomputed status precedence data
          const status = statusByPatch[patch.id] as any
          const statusReason = statusReasonByPatch[patch.id] || ""

          const patches = repoClass.patches.filter(issue => {
            return getTags(issue, "e").find((tag: string[]) => tag[1] === patch.id)
          })
          const parsedPatch = parseGitPatchFromEvent(patch)

          const commentEvents = $comments?.filter((comment: any) => {
            return getTags(comment, "E").find((tag: string[]) => tag[1] === patch.id)
          })

          return {
            ...patch,
            patches,
            status,
            parsedPatch,
            comments: commentEvents,
            // Add commit count directly for easier sorting
            commitCount: parsedPatch?.commitCount || 0,
            statusReason,
            groups: labelGroupsFor(patch.id),
          }
        })

      if (statusFilter !== "all") {
        filteredPatches = filteredPatches.filter(patch => {
          if (!patch.status) {
            return statusFilter === "open"
          }

          switch (statusFilter) {
            case "open":
              return patch.status.kind === GIT_STATUS_OPEN
            case "applied":
              return patch.status.kind === GIT_STATUS_COMPLETE
            case "closed":
              return patch.status.kind === GIT_STATUS_CLOSED
            case "draft":
              return patch.status.kind === GIT_STATUS_DRAFT
            default:
              return true
          }
        })
      }

      // Apply author filter
      if (authorFilter) {
        filteredPatches = filteredPatches.filter(patch => patch.pubkey === authorFilter)
      }

      const sortedPatches = [...filteredPatches]

      const currentSortBy = sortBy

      if (currentSortBy === "newest") {
        sortedPatches.sort((a, b) => b.created_at - a.created_at)
      } else if (currentSortBy === "oldest") {
        sortedPatches.sort((a, b) => a.created_at - b.created_at)
      } else if (currentSortBy === "status") {
        // Sort by status priority: open, draft, complete, closed
        sortedPatches.sort((a, b) => {
          const getStatusPriority = (status?: any) => {
            if (!status) return 0 // Open (default)
            switch (status.kind) {
              case GIT_STATUS_OPEN:
                return 0
              case GIT_STATUS_DRAFT:
                return 1
              case GIT_STATUS_COMPLETE:
                return 2
              case GIT_STATUS_CLOSED:
                return 3
              default:
                return 4
            }
          }
          return getStatusPriority(a.status) - getStatusPriority(b.status)
        })
      } else if (currentSortBy === "commits") {
        // Sort by commit count (highest first)
        sortedPatches.sort((a, b) => b.commitCount - a.commitCount)
      }
      return sortedPatches
    }
    return []
  })

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, repoClass.relays || repoRelays).result
  }

  $effect(() => {
    if (repoClass.patches) {
      load({
        relays: repoClass.relays,
        filters: [patchFilter],
      })

      const tryStart = () => {
        if (element) {
          makeFeed({
            element,
            relays: repoClass.relays,
            feedFilters: [patchFilter],
            subscriptionFilters: [patchFilter],
            initialEvents: patchList,
            onExhausted: () => {
              loading = false
            },
          })
        } else {
          requestAnimationFrame(tryStart)
        }
      }
      tryStart()
      loading = false
    }
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
</script>

<div bind:this={element}>
  <div class="z-10 sticky -top-8 z-nav mb-2 flex flex-col gap-y-2 py-4 backdrop-blur">
    <div class=" flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Patches</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">Review and merge code changes</p>
      </div>
    </div>
    <div class="row-2 input grow overflow-x-hidden">
      <Icon icon="magnifier" />
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus={!isMobile}
        class="w-full"
        bind:value={searchTerm}
        type="text"
        placeholder="Search patches..." />
      <Button
        variant="outline"
        size="sm"
        class="gap-2"
        onclick={() => (showFilters = !showFilters)}>
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
              variant={statusFilter === "applied" ? "default" : "outline"}
              size="sm"
              onclick={() => (statusFilter = "applied")}
              class="gap-1">
              <Check class="h-3 w-3" /> Applied
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
              variant={sortBy === "newest" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortBy = "newest")}
              class="gap-1">
              <CalendarDays class="h-3 w-3" /> Newest
            </Button>
            <Button
              variant={sortBy === "oldest" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortBy = "oldest")}
              class="gap-1">
              <CalendarDays class="h-3 w-3" /> Oldest
            </Button>
            <Button
              variant={sortBy === "status" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortBy = "status")}
              class="gap-1">
              <Check class="h-3 w-3" /> Status
            </Button>
            <Button
              variant={sortBy === "commits" ? "default" : "outline"}
              size="sm"
              onclick={() => (sortBy = "commits")}
              class="gap-1">
              <GitCommit class="h-3 w-3" /> Commits
            </Button>
          </div>
        </div>

        <!-- Author Filter -->
        {#if uniqueAuthors.size > 1}
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
                  onclick={() => (authorFilter = author!)}
                  class="gap-1">
                  <User class="h-3 w-3" />
                  <span class="text-sm"><ProfileName pubkey={author!} /></span>
                </Button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Label Filter -->
        {#if allNormalizedLabels.length > 0}
          <div class="md:col-span-2">
            <h3 class="mb-2 text-sm font-medium">Labels</h3>
            <div class="row-2 input mb-2 max-w-md">
              <Icon icon="magnifier" />
              <input
                class="w-full"
                bind:value={labelSearch}
                type="text"
                placeholder="Search labels..." />
            </div>
            <div class="flex flex-wrap gap-2">
              {#each allNormalizedLabels.filter(l => l
                  .toLowerCase()
                  .includes(labelSearch.toLowerCase())) as lbl (lbl)}
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
            {#if selectedLabels.length > 0}
              <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span class="text-muted-foreground">Selected:</span>
                {#each selectedLabels as sl (sl)}
                  <span class="badge badge-ghost badge-sm">{sl}</span>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
      <div class="mt-3 flex items-center justify-end">
        <span class="text-[11px] opacity-60 inline-flex items-center gap-1" title="Bell indicates review requested (label, you are tagged, or mentioned in comments)">
          <Bell class="h-3 w-3" />
          Review indicator
        </span>
      </div>
    </div>
  {/if}

  {#if patchDag}
    <div class="mb-4">
      <PatchDagSummary
        nodeCount={patchDag.nodeCount}
        roots={patchDag.roots}
        rootRevisions={patchDag.rootRevisions}
        edgesCount={patchDag.edgesCount}
        topParents={patchDag.topParents}
        parentOutDegree={patchDag.parentOutDegree}
        parentChildren={patchDag.parentChildren}
        maxShow={50} />
    </div>
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
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#key searchedPatches}
        {#each searchedPatches as patch (patch.id)}
          <div in:fly={slideAndFade({duration: 200})}>
            <div class="relative">
              <PatchCard
                event={patch}
                patches={patch.patches}
                status={patch.status as StatusEvent}
                comments={patch.comments}
                currentCommenter={$pubkey!}
                extraLabels={labelsByPatch.get(patch.id) || []}
                {onCommentCreated} />
              <!-- Status chip (Repo getter preferred) -->
              {#key statusByPatch[patch.id]}
                {@const resolved = getResolvedStateFor(patch.id)}
                {@const badge = (
                  repoClass as unknown as {
                    getMaintainerBadge?: (pubkey: string) => "owner" | "maintainer" | null
                  }
                ).getMaintainerBadge?.call(repoClass, patch.pubkey)}
                {@const needsReview = (() => {
                  try {
                    const typeVals = (patch.groups?.Type || []).map((v: string) => v.toLowerCase())
                    const hasType = typeVals.some(v => v.includes("review"))
                    const me = $pubkey
                    const pks = getTags(patch as any, "p").map((t: string[]) => t[1])
                    const hasTag = !!(me && pks.includes(me))
                    // Also consider thread mentions
                    const comments = repoClass.getIssueThread(patch.id)?.comments || []
                    const hasMention = !!(me && comments.some((c: any) => getTags(c, "p").some((t: string[]) => t[1] === me)))
                    return hasType || hasTag || hasMention
                  } catch { return false }
                })()}
                <RepoPatchStatus
                  className="absolute left-2 top-2"
                  state={resolved?.state}
                  kind={statusByPatch[patch.id]?.kind}
                  reason={statusReasonByPatch[patch.id]}
                  badgeRole={badge}
                  reviewRequested={needsReview} />
              {/key}
              <!-- Grouped labels below card -->
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
      {/key}
    </div>
  {/if}
</div>
