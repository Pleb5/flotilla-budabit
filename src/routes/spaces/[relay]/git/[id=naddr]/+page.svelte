<script module lang="ts">
  declare const __TERMINAL__: boolean
</script>

<script lang="ts">
  import markdownit from "markdown-it"
  import {Card} from "@nostr-git/ui"
  import {
    CircleAlert,
    GitBranch,
    GitPullRequest,
    Users,
    Globe,
    User,
    Eye,
    BookOpen,
    Copy,
    Check,
    Bookmark,
    Bell,
    GitFork,
    RotateCcw,
    ChevronDown,
  } from "@lucide/svelte"
  import {fade, fly, slide} from "@lib/transition"
  import Spinner from "@lib/components/Spinner.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import AppLink from "@lib/components/Link.svelte"
  import {formatDistanceToNow} from "date-fns"
  import {getTagValue} from "@welshman/util"
  import Button from "@lib/components/Button.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {pushModal} from "@app/util/modal"
  import ResetRepoConfirm from "@app/components/ResetRepoConfirm.svelte"
  import {
    PULL_REQUESTS_KEY,
    REPO_KEY,
    REPO_RELAYS_KEY,
    STATUS_EVENTS_BY_ROOT_KEY,
    REPO_ACTIONS_KEY,
    type RepoActions,
    effectiveMaintainersByRepoAddress,
  } from "@lib/budabit/state"
  import {
    REPO_TRUST_METRICS_KEY,
    defaultRepoTrustMetrics,
    type RepoTrustMetrics,
  } from "@lib/budabit/repo-trust-metrics"
  import {
    parsePullRequestEvent,
    type IssueEvent,
    type PatchEvent,
    type PullRequestEvent,
    type StatusEvent,
  } from "@nostr-git/core/events"
  import {parseGitPatchFromEvent} from "@nostr-git/core/git"
  import {isGraspRelayUrl, isGraspRepoHttpUrl} from "@nostr-git/core/utils"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import {decodeRelay} from "@app/core/state"
  import {nip19} from "nostr-tools"
  import {clip, pushToast} from "@app/util/toast"

  import {getContext} from "svelte"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  let Terminal = $state<any>(null)
  if (__TERMINAL__) {
    import("@nostr-git/ui").then(m => (Terminal = m.Terminal))
  }

  // Get repoClass and repoRelays from context
  const repoClass = getContext<Repo>(REPO_KEY)
  const repoActions = getContext<RepoActions>(REPO_ACTIONS_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const statusEventsByRootStore = getContext<Readable<Map<string, StatusEvent[]>>>(STATUS_EVENTS_BY_ROOT_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)
  const repoTrustMetricsStore = getContext<Readable<RepoTrustMetrics>>(REPO_TRUST_METRICS_KEY)
  
  if (!repoClass) {
    throw new Error("Repo context not available")
  }
  
  // Get relays reactively
  const repoRelays = $derived.by(() => repoRelaysStore ? $repoRelaysStore : [])
  const statusEventsByRoot = $derived.by(() => statusEventsByRootStore ? $statusEventsByRootStore : new Map<string, StatusEvent[]>())
  const pullRequests = $derived.by(() => pullRequestsStore ? $pullRequestsStore : [])
  const repoTrustMetrics = $derived.by(() =>
    repoTrustMetricsStore ? $repoTrustMetricsStore : defaultRepoTrustMetrics,
  )
  const patchesHref = $derived.by(() => `${$page.url.pathname.replace(/\/+$/, "")}/patches`)
  let openTrustMetricPopover = $state<"trusted-merged" | "trusted-maintainer" | "trusted-collaborators" | null>(null)
  const repoTrustStatus = $derived.by(() => {
    if (repoTrustMetrics.status === "loading") {
      return `Refreshing ${repoTrustMetrics.graphLabel.toLowerCase()} activity...`
    }

    if (repoTrustMetrics.status === "error") {
      return repoTrustMetrics.error || "Unable to compute trust activity."
    }

    if (repoTrustMetrics.totalPullRequests === 0) {
      return "No pull requests loaded yet for trust activity metrics."
    }

    if (repoTrustMetrics.enabledRuleCount > 0) {
      return `Using ${repoTrustMetrics.graphLabel} across ${repoTrustMetrics.enabledRuleCount} graph rules.`
    }

    return "Using the basic WoT fallback. Add graph rules in Trust settings to refine these repo metrics."
  })

  const openPatchesTrustView = (trust = "", trustSort = "") => {
    const search = new URLSearchParams()

    if (trust) {
      search.set("trust", trust)
    }

    if (trustSort) {
      search.set("trustSort", trustSort)
    }

    goto(search.size > 0 ? `${patchesHref}?${search.toString()}` : patchesHref)
  }

  const getRepoTrustPatchHref = (rootId: string) => `${patchesHref}/${rootId}`

  const getPullRequestSubject = (pullRequest: PullRequestEvent) =>
    getTagValue("subject", pullRequest.tags) || "Pull Request"

  const repoTrustMetricCards = $derived.by(() => {
    const trustedMergedDetails = pullRequests
      .filter(pullRequest => {
        const metric = repoTrustMetrics.byRootId.get(pullRequest.id)

        return Boolean(metric?.merged && metric.trustedAuthor)
      })
      .map(pullRequest => {
        const metric = repoTrustMetrics.byRootId.get(pullRequest.id)

        return {
          rootId: pullRequest.id,
          subject: getPullRequestSubject(pullRequest),
          authorPubkey: pullRequest.pubkey,
          mergedByPubkey: metric?.mergedByPubkey,
        }
      })
      .slice(0, 5)
    const trustedMaintainerDetails = pullRequests
      .filter(pullRequest => {
        const metric = repoTrustMetrics.byRootId.get(pullRequest.id)

        return Boolean(metric?.merged && metric.trustedMaintainerMerge)
      })
      .map(pullRequest => ({
        rootId: pullRequest.id,
        subject: getPullRequestSubject(pullRequest),
        authorPubkey: pullRequest.pubkey,
        mergedByPubkey: undefined,
      }))
      .slice(0, 5)

    return [
      {
        key: "trusted-merged" as const,
        label: "Trusted merged contributions",
        value: repoTrustMetrics.trustedMergedContributions,
        description:
          "Merged pull requests in this repo whose authors are in your active trust graph.",
        details: trustedMergedDetails,
      },
      {
        key: "trusted-maintainer" as const,
        label: "Trusted maintainer merges",
        value: repoTrustMetrics.trustedMaintainerMerges,
        description:
          "Merged pull requests in this repo where the effective maintainer who applied the status is in your active trust graph.",
        details: trustedMaintainerDetails,
      },
      {
        key: "trusted-collaborators" as const,
        label: "Trusted collaborators",
        value: repoTrustMetrics.trustedCollaborators,
        description:
          "Distinct trusted authors and maintainers involved in merged pull request activity for this repo.",
        actors: repoTrustMetrics.topActors.slice(0, 5),
      },
    ]
  })

  // Progressive loading states - show immediate content right away
  const initialLoading = false
  let readmeLoading = $state(true)
  let commitLoading = $state(true)
  let lastCommit = $state<any>(null)
  let lastCommitReqSeq = $state(0)
  let _prevRepoKey = $state<string | undefined>(undefined)
  let _prevMain = $state<string | undefined>(undefined)
  let _prevBranchSig = $state<string | undefined>(undefined)
  let copiedUrl = $state<string | null>(null)
  let repoInfoLoaded = $state(false)
  let commitLoadDebounce: ReturnType<typeof setTimeout> | null = null
  let commitLoadInProgress = $state(false)
  let expandedRecentPatchIds = $state<Set<string>>(new Set())
  
  // Expandable sections state
  let showAllRelays = $state(false)
  let showTaggedMaintainers = $state(false)
  const RECENT_PATCH_PREVIEW_LIMIT = 150
  const normalizePubkey = (value: string | undefined | null): string => {
    if (!value) return ""
    if (/^[0-9a-f]{64}$/i.test(value)) return value
    if (value.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(value)
        if (decoded.type === "npub") return decoded.data as string
      } catch {
        // pass
      }
    }
    return ""
  }

  const normalizeBranchRef = (value?: string): string => {
    const raw = String(value || "").trim()
    if (!raw) return ""
    return raw
      .replace(/^ref:\s*refs\/heads\//i, "")
      .replace(/^refs\/heads\//, "")
      .replace(/^refs\/remotes\/origin\//, "")
      .replace(/^origin\//, "")
  }

  const getTaggedMaintainers = (event: any): string[] => {
    const raw = (event?.tags || [])
      .filter((t: string[]) => t[0] === "maintainers")
      .flatMap((t: string[]) => t.slice(1))
    const normalized = raw
      .map((pk: string) => normalizePubkey(pk))
      .filter(Boolean)
    return Array.from(new Set(normalized))
  }

  const taggedMaintainerPubkeys = $derived.by(() => {
    const event = repoClass?.repoEvent
    if (!event) return [] as string[]
    return getTaggedMaintainers(event)
  })

  const repoAddress = $derived.by(() => {
    if (repoClass?.address) return repoClass.address
    const event = repoClass?.repoEvent
    if (!event) return ""
    const dTag = (event.tags || []).find((t: string[]) => t[0] === "d")?.[1]
    if (!event.pubkey || !dTag) return ""
    return `30617:${event.pubkey}:${dTag}`
  })

  const effectiveMaintainerPubkeys = $derived.by(() => {
    if (repoAddress) {
      const maintainers = $effectiveMaintainersByRepoAddress.get(repoAddress)
      if (maintainers && maintainers.size > 0) {
        return Array.from(maintainers)
      }
    }

    const owner = normalizePubkey(repoClass?.repoEvent?.pubkey)
    return owner ? [owner] : []
  })

  const unverifiedTaggedPubkeys = $derived.by(() => {
    const effective = new Set(effectiveMaintainerPubkeys)
    return taggedMaintainerPubkeys.filter(pk => !effective.has(pk))
  })

  const branchCount = $derived(repoClass.branches?.length || 0)

  function getNostrOwnerAndName(): {ownerNpub: string; name: string} | undefined {
    const key = (repoClass.key || '').trim()
    const [keyOwner, keyName] = key.includes('/') ? key.split('/', 2) : [undefined, undefined]
    const name = (repoClass.name || keyName || '').trim()
    const owner = repoClass.repoEvent?.pubkey || keyOwner
    if (!owner || !name) return undefined

    let ownerNpub = owner
    if (!owner.startsWith('npub1')) {
      try {
        ownerNpub = nip19.npubEncode(owner)
      } catch {
        ownerNpub = owner
      }
    }

    return {ownerNpub, name}
  }

  function buildDefaultNgitCloneUrl(): string | undefined {
    const resolved = getNostrOwnerAndName()
    if (!resolved) return undefined
    return `nostr://${resolved.ownerNpub}/${resolved.name}`
  }

  function buildDefaultViewRepoUrl(): string | undefined {
    const resolved = getNostrOwnerAndName()
    if (!resolved) return undefined
    return `https://gitworkshop.dev/${resolved.ownerNpub}/${resolved.name}`
  }

  const repoMetadata = $derived({
    name: repoClass.name || "Unknown Repository",
    description: repoClass.description || "",
    repoId: repoClass.key || "",
    relays: repoClass.relays || [],
    cloneUrls: (() => {
      // Get clone URLs from repoClass directly
      const urls = [...(repoClass.cloneUrls || [])]
      if (!urls.find(u => u.startsWith("nostr://"))) {
        const def = buildDefaultNgitCloneUrl()
        if (def && !urls.includes(def)) urls.push(def)
      }
      return urls
    })(),
    webUrls: (() => {
      // Get web URLs from repoClass directly
      const urls = [...(repoClass.web || [])]
      if (!urls.find(u => u.startsWith("https://gitworkshop.dev"))) {
        const def = buildDefaultViewRepoUrl()
        if (def && !urls.includes(def)) urls.push(def)
      }
      return urls
    })(),
    mainBranch: repoClass.mainBranch,
    createdAt: repoClass.repoEvent?.created_at
      ? new Date(repoClass.repoEvent.created_at * 1000)
      : null,
    updatedAt: (repoClass as any).repoStateEvent?.created_at
      ? new Date(((repoClass as any).repoStateEvent.created_at as number) * 1000)
      : null,
  })

  // Defaults for Terminal
  const repoCloneUrls = $derived(repoMetadata.cloneUrls || [])
  const defaultRemoteUrl = $derived(repoCloneUrls[0])
  const defaultBranch = $derived(repoMetadata.mainBranch || "")
  const detectedProvider = $derived(
    detectProviderFromUrl(defaultRemoteUrl || repoMetadata.relays?.[0]),
  )
  const defaultToken = $derived(detectedProvider === "grasp" ? $pubkey : undefined)
  const relayUrl = $derived(decodeRelay($page.params.relay))
  const naddr = $derived($page.params.id)
  const repoRefObj = $derived({
    relay: relayUrl,
    naddr,
    npub: $pubkey,
    repoId: repoClass.key,
  })

  // Simple provider detection from URL
  function detectProviderFromUrl(url: string | undefined): string | undefined {
    if (!url) return undefined
    if (isGraspRepoHttpUrl(url) || isGraspRelayUrl(url)) return "grasp"

    try {
      const u = new URL(url)
      const host = u.hostname
      if (host.includes("github.com")) return "github"
      if (host.includes("gitlab.com")) return "gitlab"
    } catch {
      // pass
    }
    return undefined
  }

  let readme = $state<string | undefined>(undefined)
  let renderedReadme = $state<string | undefined>(undefined)
  const md = markdownit({
    html: true,
    linkify: true,
    typographer: true,
  })

  $effect(() => {
    // Track repoClass.key to ensure we only load once per repo
    const currentKey = repoClass?.key
    
    if (repoClass && currentKey && !repoInfoLoaded) {
      // Wait for repo initialization before loading data that requires git operations
      // Only run once per repo to prevent duplicate API calls
      repoClass.waitForReady().then(() => {
        // Double-check the key hasn't changed and we haven't already loaded
        if (repoClass.key === currentKey && !repoInfoLoaded) {
          repoInfoLoaded = true
          loadRepoInfo()
        }
      })
    }
  })

  // Reactively refresh latest commit when repo updates
  $effect(() => {
    // Touch reactive dependencies so this effect re-runs when repo changes
    const repoKey = repoClass.key
    const main = repoClass.mainBranch
    const branchSig = (repoClass.branches || []).map(b => b.name).join("|")

    // Only refetch if identity actually changed
    const changed =
      repoKey !== _prevRepoKey ||
      main !== _prevMain ||
      branchSig !== _prevBranchSig
    if (!changed) return

    _prevRepoKey = repoKey
    _prevMain = main
    _prevBranchSig = branchSig
    
    // Reset repoInfoLoaded when navigating to a different repo
    repoInfoLoaded = false

    // Clear any pending debounce timer
    if (commitLoadDebounce) {
      clearTimeout(commitLoadDebounce)
    }

    // Debounce to prevent rapid-fire triggers during initialization
    // Wait 100ms for values to stabilize before loading commits
    commitLoadDebounce = setTimeout(() => {
      // Debounce/Dedupe: increment sequence and capture
      const seq = ++lastCommitReqSeq
      commitLoading = true
      lastCommit = null
      ;(async () => {
        // Wait for repo to be ready before loading commits
        await repoClass.waitForReady()
        await loadLastCommit()
        // Only apply result if this is the latest request
        if (seq !== lastCommitReqSeq) return
      })()
    }, 100)
  })

  async function loadRepoInfo() {
    // Load README only - commit loading is handled by the reactive effect below
    // This prevents duplicate API calls
    await loadReadme()
  }

  async function loadReadme() {
    try {
      // Try to get README - if repo not cloned, that's okay (overview doesn't need clone)
      // The getFileContent will attempt to fetch, but won't block if it fails
      // Don't attempt to load README without a valid branch
      const branchName = normalizeBranchRef(repoClass.mainBranch);
      if (!branchName) {
        console.debug("README: Cannot load - branch not yet determined");
        return;
      }
      
      const readmeContent = await repoClass.getFileContent({
        path: "README.md",
        branch: branchName,
        commit: undefined as any,
      })
      readme = readmeContent.content
      renderedReadme = readme ? md.render(readme) : ""
    } catch (e) {
      // Silently fail - README is optional and shouldn't block page load
      // If repo not cloned, user can still see overview without README
      console.debug("README: Failed to load (repo may not be cloned, which is fine for overview)", e)
    } finally {
      readmeLoading = false
    }
  }

  async function loadLastCommit() {
    // Guard: prevent duplicate calls if already loading
    if (commitLoadInProgress) {
      return
    }
    
    commitLoadInProgress = true
    
    try {
      // Use main branch directly - no need to try multiple branches
      // Start with small depth (5) for faster loading, only increase if needed
      const mainBranch = repoClass.mainBranch
      if (!mainBranch) {
        commitLoading = false
        commitLoadInProgress = false
        return
      }

      // Check if WorkerManager is ready before attempting operations
      if (!repoClass.workerManager?.isReady) {
        console.debug("LatestCommit: WorkerManager not ready, skipping")
        commitLoading = false
        commitLoadInProgress = false
        return
      }

      // Try depth 5 first (fast), then 10 if needed, then 25 as fallback
      const depths = [5, 10, 25]
      
      for (const depth of depths) {
        try {
          const res = await repoClass.getCommitHistory({ branch: mainBranch, depth })
          const list = Array.isArray(res) ? res : res?.commits
          if (Array.isArray(list) && list.length > 0) {
            lastCommit = list[0]
            commitLoading = false
            commitLoadInProgress = false
            return
          }
        } catch (e) {
          // If repo not cloned, that's okay - commit history is optional for overview
          // Don't trigger clone just for commit history
          if (String(e).includes("not cloned") || String(e).includes("Repository not")) {
            console.debug("LatestCommit: Repository not cloned, skipping (overview page doesn't need clone)")
            commitLoading = false
            commitLoadInProgress = false
            return
          }
          // Try next depth on other errors
          console.debug("LatestCommit attempt failed", { depth, error: String(e) })
        }
      }
    } catch (e) {
      // Silently fail - commit history is optional
      console.debug("LatestCommit: Failed to load", e)
    } finally {
      commitLoading = false
      commitLoadInProgress = false
    }
  }

  function formatDate(date: Date | null) {
    if (!date) return "Unknown"
    return formatDistanceToNow(date, {addSuffix: true})
  }

  function truncateHash(hash: string, length = 8) {
    return hash ? hash.substring(0, length) : ""
  }

  function shortenNip19(value: string, prefixLength = 12, suffixLength = 6) {
    if (!value) return ""
    if (value.length <= prefixLength + suffixLength + 3) return value
    return `${value.slice(0, prefixLength)}...${value.slice(-suffixLength)}`
  }

  type RecentActivityItem = {
    id: string
    title: string
    activityAt: number
    createdAt: number
  }

  function getLatestCommentAt(rootId: string) {
    let latest = 0
    for (const comment of repoClass.getIssueThread(rootId).comments || []) {
      if (comment.created_at > latest) latest = comment.created_at
    }
    return latest
  }

  function getLatestStatusAt(rootId: string) {
    let latest = 0
    for (const event of statusEventsByRoot.get(rootId) || []) {
      if (event.created_at > latest) latest = event.created_at
    }
    return latest
  }

  function getLatestActivityAt(rootId: string, createdAt: number) {
    return Math.max(createdAt || 0, getLatestCommentAt(rootId), getLatestStatusAt(rootId))
  }

  function sortRecentActivity(items: RecentActivityItem[]) {
    return [...items].sort((a, b) => {
      if (b.activityAt !== a.activityAt) return b.activityAt - a.activityAt
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
      return a.id.localeCompare(b.id)
    })
  }

  function getIssueTitle(issue: IssueEvent) {
    return getTagValue("subject", issue.tags) || "Untitled Issue"
  }

  function getPatchTitle(event: PatchEvent | PullRequestEvent) {
    if (event.kind === 1618) {
      const parsed = parsePullRequestEvent(event as PullRequestEvent)
      return parsed.subject || "Untitled Patch"
    }

    try {
      const parsed = parseGitPatchFromEvent(event as any)
      return parsed?.title || "Untitled Patch"
    } catch {
      return getTagValue("subject", event.tags) || "Untitled Patch"
    }
  }

  const recentIssues = $derived.by(() => {
    const items = repoClass.issues.map(issue => ({
      id: issue.id,
      title: getIssueTitle(issue),
      createdAt: issue.created_at,
      activityAt: getLatestActivityAt(issue.id, issue.created_at),
    }))

    return sortRecentActivity(items).slice(0, 3)
  })

  const recentPatches = $derived.by(() => {
    const items: RecentActivityItem[] = []

    for (const patch of repoClass.patches) {
      const isRootPatch = patch.tags.some((tag: string[]) => tag[0] === "t" && tag[1] === "root")
      if (!isRootPatch) continue

      items.push({
        id: patch.id,
        title: getPatchTitle(patch),
        createdAt: patch.created_at,
        activityAt: getLatestActivityAt(patch.id, patch.created_at),
      })
    }

    for (const pullRequest of pullRequests) {
      items.push({
        id: pullRequest.id,
        title: getPatchTitle(pullRequest),
        createdAt: pullRequest.created_at,
        activityAt: getLatestActivityAt(pullRequest.id, pullRequest.created_at),
      })
    }

    return sortRecentActivity(items).slice(0, 3)
  })

  function shouldClampRecentPatchTitle(title: string): boolean {
    return title.replace(/\s+/g, " ").trim().length > RECENT_PATCH_PREVIEW_LIMIT
  }

  function getRecentPatchTitlePreview(title: string, expanded: boolean): string {
    const normalizedTitle = title.replace(/\s+/g, " ").trim()

    if (expanded || normalizedTitle.length <= RECENT_PATCH_PREVIEW_LIMIT) {
      return normalizedTitle
    }

    return `${normalizedTitle.slice(0, RECENT_PATCH_PREVIEW_LIMIT).trimEnd()}...`
  }

  function toggleRecentPatchExpanded(id: string) {
    const next = new Set(expandedRecentPatchIds)

    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }

    expandedRecentPatchIds = next
  }

  async function copyUrl(url: string) {
    try {
      await clip(url)
      copiedUrl = url
      setTimeout(() => {
        copiedUrl = null
      }, 2000)
    } catch (e) {
      console.error("Failed to copy URL", e)
    }
  }
</script>

<svelte:head>
  <title>{repoClass.name || 'Repository'}</title>
</svelte:head>

<div class="relative flex min-w-0 flex-col gap-6 py-2">
  {#if initialLoading}
    <div class="flex justify-center py-8">
      <Spinner />
    </div>
  {:else}
    <!-- Repo actions -->
    {#if repoActions}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          class="btn btn-sm btn-outline gap-1"
          onclick={repoActions.refreshRepo}
          disabled={repoActions.isRefreshing}
          title={repoActions.isRefreshing ? 'Syncing...' : 'Refresh'}>
          <RotateCcw class="h-4 w-4 {repoActions.isRefreshing ? 'animate-spin' : ''}" />
          {repoActions.isRefreshing ? 'Syncing...' : 'Refresh'}
        </Button>
        <Button class="btn btn-sm btn-outline gap-1" onclick={repoActions.openRemoteFixModal} title="Review remotes">
          <Globe class="h-4 w-4" />
          Remotes
        </Button>
        {#if $pubkey}
          <Button
            class="btn btn-sm btn-outline btn-error gap-1"
            onclick={() => pushModal(ResetRepoConfirm, {repoClass, repoName: repoMetadata.name})}
            title="Reset local repo state">
            Reset
          </Button>
        {/if}
        {#if $pubkey}
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Button
              class="btn btn-sm {repoActions.isBookmarked ? 'btn-primary' : 'btn-outline'} gap-1"
              onclick={repoActions.bookmarkRepo}
              disabled={repoActions.isTogglingBookmark}
              title={repoActions.isBookmarked ? 'Remove bookmark' : 'Bookmark'}>
              <Bookmark class="h-4 w-4 {repoActions.isBookmarked ? 'fill-current' : ''}" />
              {repoActions.isBookmarked ? 'Bookmarked' : 'Bookmark'}
            </Button>
            <Button
              class="btn btn-sm {repoActions.isWatching ? 'btn-primary' : 'btn-outline'} gap-1"
              onclick={repoActions.openWatchModal}
              title={repoActions.isWatching ? 'Watching' : 'Watch'}>
              <Bell class="h-4 w-4 {repoActions.isWatching ? 'fill-current' : ''}" />
              {repoActions.isWatching ? 'Watching' : 'Watch'}
            </Button>
            <Button class="btn btn-sm btn-outline gap-1" onclick={repoActions.forkRepo} title="Fork">
              <GitFork class="h-4 w-4" />
              Fork
            </Button>
          </div>
        {/if}
      </div>
    {/if}

    <div class="grid gap-4 lg:grid-cols-3" transition:fly>
    <div class="lg:col-start-3 lg:row-start-1 lg:col-span-1">
    <Card class="min-w-0 p-3 text-sm divide-y divide-border">
    <!-- Clone dropdown -->
    {#if repoMetadata.cloneUrls.length > 0}
      {@const sortedCloneUrls = [...repoMetadata.cloneUrls].sort((a, b) => {
        const an = a.startsWith("nostr://") ? 0 : 1
        const bn = b.startsWith("nostr://") ? 0 : 1
        return an - bn
      })}
      <section class="flex items-center justify-between pb-3">
        <span class="flex items-center gap-2 text-base font-semibold">
          <GitBranch class="h-5 w-5" />
          Details
        </span>
        <details class="group relative">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-green-500/40 bg-green-600/20 px-3 py-2 text-sm font-medium text-green-300 hover:bg-green-600/30">
            <span class="flex items-center gap-2">
              <GitBranch class="h-4 w-4" />
              Clone
            </span>
            <ChevronDown class="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div class="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-1 rounded-md border border-border bg-base-100 p-2 shadow-lg">
            {#each sortedCloneUrls as url}
              {@const isNostr = url.startsWith("nostr://")}
              <button
                type="button"
                class="group/row flex min-w-0 w-full items-center gap-2 rounded-md border p-2 transition-all hover:bg-secondary/40 active:scale-[0.995] {isNostr ? 'border-purple-500/40 bg-purple-500/5' : 'border-transparent'}"
                title="Click to copy"
                onclick={() => copyUrl(url)}>
                <code class="scrollbar-hide min-w-0 flex-1 overflow-x-auto overflow-y-hidden whitespace-nowrap text-left font-mono text-xs {isNostr ? 'text-purple-300' : ''}">{url}</code>
                <div class="flex-shrink-0 rounded p-1 transition-colors group-hover/row:bg-background/50">
                  {#if copiedUrl === url}
                    <Check class="h-3.5 w-3.5 text-green-500" />
                  {:else}
                    <Copy class="h-3.5 w-3.5 text-muted-foreground" />
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        </details>
      </section>
    {/if}

      <!-- Repository Details -->
      <section class="py-3">
        <div class="space-y-3">
          <!-- Compact info rows -->
          <div class="space-y-1 text-sm">
            <!-- Address -->
            <div class="flex items-center gap-2 py-1">
              <span class="flex-shrink-0 text-muted-foreground">Address</span>
              <code class="min-w-0 flex-1 truncate font-mono text-xs" title={naddr}>{shortenNip19(naddr)}</code>
              <button
                type="button"
                class="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                title="Copy address"
                onclick={() => clip(naddr)}>
                <Copy class="h-3.5 w-3.5" />
              </button>
            </div>

            <!-- Website(s) -->
            {#if repoMetadata.webUrls.length > 0}
              {@const hostname = (u: string) => { try { return new URL(u).hostname } catch { return u } }}
              <details class="group/urls">
                <summary class="flex cursor-pointer list-none items-center gap-2 rounded py-1 hover:bg-secondary/20">
                  <span class="flex-shrink-0 text-muted-foreground">Website{repoMetadata.webUrls.length > 1 ? "s" : ""}</span>
                  <a
                    href={repoMetadata.webUrls[0]}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
                    title={repoMetadata.webUrls[0]}
                    onclick={(e) => e.stopPropagation()}>{hostname(repoMetadata.webUrls[0])}</a>
                  <button
                    type="button"
                    class="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    title="Copy URL"
                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); clip(repoMetadata.webUrls[0]) }}>
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                  {#if repoMetadata.webUrls.length > 1}
                    <ChevronDown class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-open/urls:rotate-180" />
                  {/if}
                </summary>
                {#if repoMetadata.webUrls.length > 1}
                  <div class="mt-1 space-y-1">
                    {#each repoMetadata.webUrls.slice(1) as url}
                      <div class="flex items-center gap-2">
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
                          title={url}>{hostname(url)}</a>
                        <button
                          type="button"
                          class="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                          title="Copy URL"
                          onclick={() => clip(url)}>
                          <Copy class="h-3.5 w-3.5" />
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}
              </details>
            {/if}

            <!-- Branches -->
            {#if repoClass.branches && repoClass.branches.length > 0}
              {@const isDefaultBranch = (b: any) => (('isHead' in b && b.isHead) || b.name === repoMetadata.mainBranch)}
              {@const sortedBranches = [...repoClass.branches].sort((a, b) => (isDefaultBranch(a) ? 0 : 1) - (isDefaultBranch(b) ? 0 : 1))}
              <details class="group/branches">
                <summary class="flex cursor-pointer list-none items-center gap-2 rounded py-1 hover:bg-secondary/20">
                  <span class="flex-shrink-0 text-muted-foreground">Branches</span>
                  <span class="min-w-0 flex-1 font-mono text-xs">{branchCount}</span>
                  <ChevronDown class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-open/branches:rotate-180" />
                </summary>
                <div class="mt-1 space-y-0.5">
                  {#each sortedBranches as branch}
                    {@const isDefault = isDefaultBranch(branch)}
                    <div class="flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate font-mono text-xs" title={branch.name}>
                        {branch.name}
                        {#if isDefault}
                          <span class="ml-1 text-muted-foreground">(default)</span>
                        {/if}
                      </span>
                      <button
                        type="button"
                        class="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                        title="Copy branch name"
                        onclick={() => clip(branch.name)}>
                        <Copy class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}

            <!-- Relays -->
            {#if repoMetadata.relays.length > 0}
              {@const relayHostname = (u: string) => { try { return new URL(u).hostname } catch { return u } }}
              <details class="group/relays">
                <summary class="flex cursor-pointer list-none items-center gap-2 rounded py-1 hover:bg-secondary/20">
                  <span class="flex-shrink-0 text-muted-foreground">Relays</span>
                  <span class="min-w-0 flex-1 font-mono text-xs">{repoMetadata.relays.length}</span>
                  <ChevronDown class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-open/relays:rotate-180" />
                </summary>
                <div class="mt-1 space-y-0.5">
                  {#each repoMetadata.relays as relay}
                    <div class="flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate font-mono text-xs" title={relay}>{relayHostname(relay)}</span>
                      <button
                        type="button"
                        class="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                        title="Copy relay URL"
                        onclick={() => clip(relay)}>
                        <Copy class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}

            <!-- Latest commit -->
            {#if lastCommit}
              <details class="group/commit" transition:fade>
                <summary class="flex cursor-pointer list-none items-center gap-2 rounded py-1 hover:bg-secondary/20">
                  <span class="flex-shrink-0 text-muted-foreground">Latest</span>
                  <span class="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs">
                    <span>{truncateHash(lastCommit.oid)}</span>
                    <span class="text-muted-foreground">·</span>
                    <span class="truncate text-muted-foreground">{formatDate(new Date(lastCommit.commit.author.timestamp * 1000))}</span>
                  </span>
                  <ChevronDown class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-open/commit:rotate-180" />
                </summary>
                <div class="mt-1 flex items-center gap-1.5 text-xs">
                  <User class="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                  <span class="flex-shrink-0 font-medium">{lastCommit.commit.author.name}:</span>
                  <span class="min-w-0 flex-1 truncate text-muted-foreground" title={lastCommit.commit.message}>{lastCommit.commit.message}</span>
                </div>
              </details>
            {/if}
          </div>

          <!-- Nostr Information -->
          <div class="space-y-3">
            {#if effectiveMaintainerPubkeys.length > 0}
              <div>
                <span class="mb-2 block text-sm text-muted-foreground">Maintainers</span>
                <div class="grid grid-cols-2 gap-x-3 gap-y-2">
                  {#each effectiveMaintainerPubkeys as maintainer}
                    <div class="flex min-w-0 items-center gap-2 text-sm">
                      <ProfileCircle
                        pubkey={maintainer}
                        url={relayUrl}
                        size={8}
                        class="border border-border"
                      />
                      <ProfileLink
                        pubkey={maintainer}
                        url={relayUrl}
                        unstyled
                        class="min-w-0 truncate text-xs hover:underline"
                      />
                    </div>
                  {/each}
                </div>
                {#if unverifiedTaggedPubkeys.length > 0}
                  <button
                    type="button"
                    class="mt-2 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    onclick={() => (showTaggedMaintainers = !showTaggedMaintainers)}>
                    {showTaggedMaintainers
                      ? "Hide tagged maintainers"
                      : `Show tagged maintainers (${unverifiedTaggedPubkeys.length})`}
                  </button>
                  {#if showTaggedMaintainers}
                    <div class="mt-2 space-y-2">
                      <span class="block text-xs text-muted-foreground"
                        >Tagged maintainers (unverified)</span>
                      {#each unverifiedTaggedPubkeys as maintainer}
                        <div class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                          <ProfileCircle
                            pubkey={maintainer}
                            url={relayUrl}
                            size={5}
                            class="border border-border opacity-70"
                          />
                          <ProfileLink
                            pubkey={maintainer}
                            url={relayUrl}
                            unstyled
                            class="min-w-0 truncate text-xs text-muted-foreground hover:underline"
                          />
                        </div>
                      {/each}
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}



          </div>
        </div>
      </section>

      <section class="py-3">
        <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 class="flex items-center gap-2 text-sm font-semibold">
              <Users class="h-4 w-4" />
              Trust Activity
            </h3>
            <p class="mt-1 text-xs text-muted-foreground">{repoTrustStatus}</p>
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

        <div class="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
          {#each repoTrustMetricCards as metric (metric.key)}
            <div class="rounded-box bg-base-200/40 p-3">
              <div class="text-xs uppercase tracking-wide opacity-60">{metric.label}</div>
              <div class="mt-2 flex items-center gap-2">
                <div class="relative">
                  <button
                    type="button"
                    class="badge badge-neutral cursor-pointer px-3 py-3 text-sm font-medium"
                    onclick={() =>
                      (openTrustMetricPopover = openTrustMetricPopover === metric.key ? null : metric.key)}>
                    {metric.value}
                  </button>

                  {#if openTrustMetricPopover === metric.key}
                    <InlinePopover onClose={() => (openTrustMetricPopover = null)} align="left" widthClass="w-80">
                      <div class="flex flex-col gap-3 text-sm">
                        <div>
                          <div class="font-medium">{metric.label}</div>
                          <div class="mt-1 text-xs opacity-70">{metric.description}</div>
                        </div>

                        {#if metric.key === "trusted-merged"}
                          <div class="text-xs opacity-60">
                            {repoTrustMetrics.trustedMergedContributions} of {repoTrustMetrics.mergedPullRequests} merged pull request{repoTrustMetrics.mergedPullRequests === 1 ? "" : "s"} matched a trusted author.
                          </div>
                        {:else if metric.key === "trusted-maintainer"}
                          <div class="text-xs opacity-60">
                            {repoTrustMetrics.trustedMaintainerMerges} merged pull request{repoTrustMetrics.trustedMaintainerMerges === 1 ? "" : "s"} were applied by trusted maintainers.
                          </div>
                        {:else}
                          <div class="text-xs opacity-60">
                            {repoTrustMetrics.trustedCollaborators} distinct trusted collaborator{repoTrustMetrics.trustedCollaborators === 1 ? "" : "s"} participated in merged pull request activity.
                          </div>
                        {/if}

                        {#if metric.details && metric.details.length > 0}
                          <div class="flex flex-col gap-2">
                            {#each metric.details as detail (detail.rootId)}
                              <div class="rounded-box bg-base-200/50 p-3">
                                <AppLink
                                  href={getRepoTrustPatchHref(detail.rootId)}
                                  class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                  {detail.subject}
                                </AppLink>
                                <div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-70">
                                  <span>Author</span>
                                  <ProfileLink
                                    pubkey={detail.authorPubkey}
                                    url={relayUrl}
                                    unstyled
                                    class="font-medium text-primary underline-offset-2 hover:underline" />
                                </div>
                                {#if detail.mergedByPubkey}
                                  <div class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-70">
                                    <span>Merged by</span>
                                    <ProfileLink
                                      pubkey={detail.mergedByPubkey}
                                      url={relayUrl}
                                      unstyled
                                      class="font-medium text-primary underline-offset-2 hover:underline" />
                                  </div>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {:else if metric.actors && metric.actors.length > 0}
                          <div class="flex flex-col gap-2">
                            {#each metric.actors as actor (actor.pubkey)}
                              <div class="rounded-box bg-base-200/50 p-3">
                                <div class="flex min-w-0 items-center gap-3">
                                  <ProfileCircle pubkey={actor.pubkey} url={relayUrl} size={6} class="border border-border" />
                                  <div class="min-w-0">
                                    <ProfileLink
                                      pubkey={actor.pubkey}
                                      url={relayUrl}
                                      unstyled
                                      class="block truncate text-sm font-medium text-primary underline-offset-2 hover:underline" />
                                    <div class="text-xs opacity-70">
                                      {actor.authoredMergedPullRequests} authored merges • {actor.appliedMergedPullRequests} maintainer merges
                                    </div>
                                  </div>
                                </div>
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <div class="text-xs opacity-60">No evidence captured for this metric yet.</div>
                        {/if}
                      </div>
                    </InlinePopover>
                  {/if}
                </div>
                <span class="text-xs opacity-60">Click for meaning and evidence</span>
              </div>
              <div class="mt-2 text-xs opacity-70">
                {#if metric.key === "trusted-merged"}
                  of {repoTrustMetrics.mergedPullRequests} merged pull request{repoTrustMetrics.mergedPullRequests === 1 ? "" : "s"}
                {:else if metric.key === "trusted-maintainer"}
                  by {repoTrustMetrics.trustedMaintainers} trusted maintainer{repoTrustMetrics.trustedMaintainers === 1 ? "" : "s"}
                {:else}
                  {repoTrustMetrics.trustedAuthors} authors and {repoTrustMetrics.trustedMaintainers} maintainers
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <div class="mt-4 flex flex-wrap gap-2 border-t border-base-300/50 pt-4">
          <Button
            class="btn btn-neutral btn-sm"
            onclick={() => openPatchesTrustView("trusted", "first")}>
            View trusted patches
          </Button>
          <Button
            class="btn btn-neutral btn-sm"
            onclick={() => openPatchesTrustView("trusted-maintainer", "first")}>
            View maintainer merges
          </Button>
        </div>

        {#if repoTrustMetrics.topActors.length > 0}
          <div class="mt-4 border-t border-base-300/50 pt-4">
            <div class="mb-3 flex items-center justify-between gap-2">
              <strong class="text-sm">Top trusted collaborators</strong>
              <span class="text-xs opacity-60">Recent merged pull requests</span>
            </div>

            <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {#each repoTrustMetrics.topActors.slice(0, 3) as actor (actor.pubkey)}
                <div class="rounded-box bg-base-200/30 p-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <ProfileCircle pubkey={actor.pubkey} url={relayUrl} size={7} class="border border-border" />
                    <div class="min-w-0">
                      <ProfileLink
                        pubkey={actor.pubkey}
                        url={relayUrl}
                        unstyled
                        class="block truncate text-sm font-medium hover:underline" />
                      <div class="text-xs opacity-60">
                        {actor.totalInteractions} interaction{actor.totalInteractions === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>

      <!-- Activity Overview -->
      {#if recentIssues.length > 0 || recentPatches.length > 0}
        <section class="pt-3">
          <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Eye class="h-4 w-4" />
            Recent Activity
          </h3>
          <div class="space-y-4">
            {#if recentIssues.length > 0}
              <div>
                <h4 class="mb-2 text-sm font-medium text-muted-foreground">Recent Issues</h4>
                <div class="space-y-2">
                  {#each recentIssues as issue}
                    <div
                      class="flex min-w-0 items-start gap-3 rounded-lg p-3 outline outline-1 outline-gray-200">
                      <CircleAlert class="mt-0.5 h-4 w-4 text-red-500" />
                      <div class="min-w-0 flex-1">
                        <p class="break-words text-sm font-medium">
                          {issue.title}
                        </p>
                        <p class="text-xs text-muted-foreground">
                          {formatDate(new Date(issue.activityAt * 1000))}
                        </p>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if recentPatches.length > 0}
              <div>
                <h4 class="mb-2 text-sm font-medium text-muted-foreground">Recent Patches</h4>
                <div class="space-y-2">
                  {#each recentPatches as patch}
                    {@const isExpanded = expandedRecentPatchIds.has(patch.id)}
                    {@const shouldClamp = shouldClampRecentPatchTitle(patch.title)}
                    <div
                      class="flex min-w-0 items-start gap-3 rounded-lg p-3 outline outline-1 outline-gray-200">
                      <GitPullRequest class="mt-0.5 h-4 w-4 text-purple-500" />
                      <div class="min-w-0 flex-1">
                        <p class="break-words text-sm font-medium">
                          {getRecentPatchTitlePreview(patch.title, isExpanded)}
                        </p>
                        {#if shouldClamp}
                          <button
                            type="button"
                            class="mt-1 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
                            aria-expanded={isExpanded}
                            onclick={() => toggleRecentPatchExpanded(patch.id)}>
                            {isExpanded ? 'Show less' : 'Show more'}
                          </button>
                        {/if}
                        <p class="text-xs text-muted-foreground">
                          {formatDate(new Date(patch.activityAt * 1000))}
                        </p>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </section>
      {/if}
    </Card>
    </div>

    <div class="flex-1" transition:slide>
      {#if __TERMINAL__ && Terminal}
        <Terminal
          fs={undefined}
          repoRef={repoRefObj}
          repoEvent={repoClass.repoEvent}
        relays={repoRelays}
        theme="retro"
        height={260}
        initialCwd="/"
        urlAllowlist={[]}
        outputLimit={{bytes: 1_000_000, lines: 10_000, timeMs: 30_000}}
        onCommand={(cmd: string) => console.log(cmd)}
        onOutput={(evt: {stream: string; chunk: string}) => console.log(evt)}
        onExit={(e: {code: number}) => console.log("terminal exit", e.code)}
        onProgress={(evt: any) => console.log("terminal progress", evt)}
        onToast={(evt: {level: "error" | undefined; message: string}) =>
          pushToast({message: evt.message, theme: evt.level})}
        {repoCloneUrls}
        {defaultRemoteUrl}
        {defaultBranch}
        provider={detectedProvider}
        token={defaultToken} />
      {/if}
    </div>

    <!-- README -->
    {#if readmeLoading}
      <div transition:slide class="lg:col-start-1 lg:row-start-1 lg:col-span-2">
        <Card class="min-w-0 p-4 sm:p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <BookOpen class="h-5 w-5" />
            README
          </h3>
          <div class="space-y-3">
            <div class="h-4 w-3/4 animate-pulse rounded bg-muted"></div>
            <div class="h-4 w-full animate-pulse rounded bg-muted"></div>
            <div class="h-4 w-2/3 animate-pulse rounded bg-muted"></div>
            <div class="h-4 w-5/6 animate-pulse rounded bg-muted"></div>
            <div class="h-4 w-1/2 animate-pulse rounded bg-muted"></div>
          </div>
        </Card>
      </div>
    {:else if renderedReadme}
      <div transition:slide class="lg:col-start-1 lg:row-start-1 lg:col-span-2">
        <Card class="min-w-0 p-4 sm:p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <BookOpen class="h-5 w-5" />
            README
          </h3>
          <div class="prose max-w-full overflow-x-auto bg-white dark:bg-zinc-900" in:fly>
            {@html renderedReadme}
            <style>
              .prose {
                color: theme("colors.zinc.50");
                background: none;
              }
              .dark .prose {
                color: theme("colors.white");
              }
              .prose h1,
              .prose h2,
              .prose h3 {
                font-weight: 600;
                line-height: 1.25;
                color: theme("colors.zinc.50");
                margin-top: 2rem;
                margin-bottom: 1rem;
              }
              .prose h1 {
                font-size: 2rem;
                border-bottom: 1px solid theme("colors.zinc.50");
                padding-bottom: 0.3em;
              }
              .prose h2 {
                font-size: 1.5rem;
                border-bottom: 1px solid theme("colors.zinc.50");
                padding-bottom: 0.2em;
              }
              .prose h3 {
                font-size: 1.25rem;
                padding-bottom: 0.1em;
              }
              .prose ul,
              .prose ol {
                margin: 1em 0;
                padding-left: 2em;
              }
              .prose li {
                margin: 0.3em 0;
              }
              .prose a {
                color: theme("colors.accent");
                text-decoration: underline;
                text-underline-offset: 2px;
                transition: color 0.2s;
              }
              .prose a:hover {
                color: theme("colors.primary");
              }
              .prose code {
                background: theme("colors.zinc.700");
                color: theme("colors.zinc.100");
                border-radius: 4px;
                padding: 0.2em 0.4em;
                font-size: 0.95em;
              }
              .prose pre {
                background: theme("colors.zinc.900");
                color: theme("colors.zinc.100");
                border-radius: 8px;
                padding: 1em;
                margin: 1.5em 0;
                font-size: 1em;
                overflow-x: auto;
              }
              .prose blockquote {
                border-left: 4px solid theme("colors.zinc.300");
                background: theme("colors.zinc.50");
                color: theme("colors.zinc.600");
                padding: 1em 1.5em;
                border-radius: 0.5em;
                margin: 1.5em 0;
                font-style: italic;
              }
              .prose table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 1.5em;
                background: theme("colors.zinc.50");
                border-radius: 0.5em;
                overflow: hidden;
              }
              .prose th,
              .prose td {
                border: 1px solid theme("colors.zinc.200");
                padding: 0.6em 1em;
              }
              .prose th {
                background: theme("colors.zinc.100");
                font-weight: 600;
              }
            </style>
          </div>
        </Card>
      </div>
    {/if}
    </div>
  {/if}
</div>
