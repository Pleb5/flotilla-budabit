<script lang="ts">
  import markdownit from "markdown-it"
  import {BranchSelector, Card, classifyCloneUrlIssue} from "@nostr-git/ui"
  import {
    CircleAlert,
    GitBranch,
    GitPullRequest,
    Users,
    Eye,
    BookOpen,
    Copy,
    Check,
    Star,
    Bell,
    GitFork,
    RotateCcw,
    ChevronDown,
    HeartPulse,
    Info,
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
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {pushModal} from "@app/util/modal"
  import ResetRepoConfirm from "@app/components/ResetRepoConfirm.svelte"
  import {
    PULL_REQUESTS_KEY,
    REPO_KEY,
    REPO_PROFILE_RELAYS_KEY,
    STATUS_EVENTS_BY_ROOT_KEY,
    REPO_ACTIONS_KEY,
    getRepoMaintainers,
    type RepoActions,
  } from "@app/core/git-state"
  import {
    REPO_TRUST_METRICS_KEY,
    defaultRepoTrustMetrics,
    type RepoTrustMetrics,
  } from "@app/core/repo-trust-metrics"
  import {
    parsePullRequestEvent,
    type IssueEvent,
    type PullRequestEvent,
    type StatusEvent,
  } from "@nostr-git/core/events"
  import {isGraspRelayUrl, isGraspRepoHttpUrl} from "@nostr-git/core/utils"
  import {page} from "$app/stores"
  import {profilesByPubkey, pubkey} from "@welshman/app"
  import {nip19} from "nostr-tools"
  import {clip, pushToast} from "@app/util/toast"
  import {getDisplayedRepoWebUrls} from "@app/util/repo-web-urls"
  import {makeCommunityPath} from "@app/util/routes"
  import {normalizeRelays} from "@app/core/community"

  import {getContext} from "svelte"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  // Get repoClass from context
  const repoClass = getContext<Repo>(REPO_KEY)
  const repoProfileRelays = getContext<() => string[]>(REPO_PROFILE_RELAYS_KEY)
  const repoActions = getContext<RepoActions>(REPO_ACTIONS_KEY)
  const statusEventsByRootStore =
    getContext<Readable<Map<string, StatusEvent[]>>>(STATUS_EVENTS_BY_ROOT_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)
  const repoTrustMetricsStore = getContext<Readable<RepoTrustMetrics>>(REPO_TRUST_METRICS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const statusEventsByRoot = $derived.by(() =>
    statusEventsByRootStore ? $statusEventsByRootStore : new Map<string, StatusEvent[]>(),
  )
  const pullRequests = $derived.by(() => (pullRequestsStore ? $pullRequestsStore : []))
  const repoTrustMetrics = $derived.by(() =>
    repoTrustMetricsStore ? $repoTrustMetricsStore : defaultRepoTrustMetrics,
  )
  const prsHref = $derived.by(() => `${$page.url.pathname.replace(/\/+$/, "")}/prs`)
  const repoBasePath = $derived.by(() => $page.url.pathname.replace(/\/+$/, ""))

  const isOwner = $derived.by(() => {
    const me = $pubkey
    if (!me) return false
    return repoClass.repoEvent?.pubkey === me
  })

  const HEAD_REF_PREFIX = "ref: refs/heads/"
  const defaultBranchStatus = $derived.by<
    {kind: "ok"} | {kind: "unset"} | {kind: "missing"; head: string}
  >(() => {
    const event = repoClass.repoStateEvent
    if (!event?.tags) return {kind: "ok"}
    let head = ""
    const heads = new Set<string>()
    for (const tag of event.tags) {
      if (tag?.[0] === "HEAD" && typeof tag[1] === "string") {
        head = tag[1].startsWith(HEAD_REF_PREFIX) ? tag[1].slice(HEAD_REF_PREFIX.length) : tag[1]
      } else if (typeof tag?.[0] === "string" && tag[0].startsWith("refs/heads/")) {
        heads.add(tag[0].slice("refs/heads/".length))
      }
    }
    if (!head) return {kind: "unset"}
    if (heads.size > 0 && !heads.has(head)) return {kind: "missing", head}
    return {kind: "ok"}
  })
  const activityHref = (item: {kind: "issue" | "pr"; id: string}) =>
    `${repoBasePath}/${item.kind === "issue" ? "issues" : "prs"}/${item.id}`
  let openTrustMetricPopover = $state<
    "community-aligned-merged" | "community-aligned-maintainer" | "community-collaborators" | null
  >(null)
  let maintainersPopoverOpen = $state(false)
  const MAINTAINER_PREVIEW_COUNT = 4
  const repoTrustStatus = $derived.by(() => {
    if (repoTrustMetrics.status === "loading") {
      return "Refreshing community-aligned pull request activity..."
    }

    if (repoTrustMetrics.status === "error") {
      return repoTrustMetrics.error || "Unable to compute community-aligned activity."
    }

    if (repoTrustMetrics.totalPullRequests === 0) {
      return "No pull requests loaded yet for community-aligned metrics."
    }

    return "Counting merged pull requests whose authors or mergers have community evidence for this repo context."
  })

  const getRepoTrustPrHref = (rootId: string) => `${prsHref}/${rootId}`

  const getPullRequestSubject = (pullRequest: PullRequestEvent) =>
    getTagValue("subject", pullRequest.tags) || "Pull Request"

  const repoTrustMetricCards = $derived.by(() => {
    const communityAlignedMergedDetails = pullRequests
      .filter(pullRequest => {
        const metric = repoTrustMetrics.byRootId.get(pullRequest.id)

        return Boolean(metric?.merged && metric.communityAlignedAuthor)
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
    const communityAlignedMaintainerDetails = pullRequests
      .filter(pullRequest => {
        const metric = repoTrustMetrics.byRootId.get(pullRequest.id)

        return Boolean(metric?.merged && metric.communityAlignedMaintainerMerge)
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
        key: "community-aligned-merged" as const,
        label: "Community-aligned merged PRs",
        value: repoTrustMetrics.communityAlignedMergedContributions,
        description:
          "Merged pull requests whose authors have community evidence for this repo context.",
        details: communityAlignedMergedDetails,
      },
      {
        key: "community-aligned-maintainer" as const,
        label: "Community-aligned maintainer merges",
        value: repoTrustMetrics.communityAlignedMaintainerMerges,
        description:
          "Merged pull requests where the maintainer who applied the status has community evidence for this repo context.",
        details: communityAlignedMaintainerDetails,
      },
      {
        key: "community-collaborators" as const,
        label: "Community collaborators",
        value: repoTrustMetrics.communityCollaborators,
        description:
          "Distinct authors and maintainers with community evidence in merged pull request activity for this repo.",
        actors: repoTrustMetrics.topActors.slice(0, 5),
      },
    ]
  })

  // Progressive loading states - show immediate content right away
  const initialLoading = false
  let readmeLoading = $state(true)
  let readmeError = $state(false)
  let lastCommit = $state<any>(null)
  let lastCommitReqSeq = $state(0)
  let _prevRepoKey = $state<string | undefined>(undefined)
  let _prevMain = $state<string | undefined>(undefined)
  let _prevBranchSig = $state<string | undefined>(undefined)
  let copiedUrl = $state<string | null>(null)
  let repoInfoLoaded = $state(false)
  let commitLoadDebounce: ReturnType<typeof setTimeout> | null = null
  let commitLoadInProgress = $state(false)
  let cloneDetailsElement = $state<HTMLDetailsElement>()
  let cloneDetailsOpen = $state(false)

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

  const repoOwnerPubkey = $derived.by(() => normalizePubkey(repoClass?.repoEvent?.pubkey))
  const repoMaintainerPubkeys = $derived.by(() => {
    const owner = repoOwnerPubkey
    const fromEvent = getRepoMaintainers(repoClass?.repoEvent as any)
    const fallback = repoClass?.maintainers || []
    const maintainers = fromEvent.length > 0 ? fromEvent : fallback

    return Array.from(
      new Set(
        maintainers.map(normalizePubkey).filter(pubkey => pubkey && pubkey !== owner),
      ),
    )
  })

  const branchCount = $derived(repoClass.branches?.length || 0)

  function getNostrOwnerAndName(): {ownerNpub: string; name: string} | undefined {
    const key = (repoClass.key || "").trim()
    const [keyOwner, keyName] = key.includes("/") ? key.split("/", 2) : [undefined, undefined]
    const name = (repoClass.name || keyName || "").trim()
    const owner = repoClass.repoEvent?.pubkey || keyOwner
    if (!owner || !name) return undefined

    let ownerNpub = owner
    if (!owner.startsWith("npub1")) {
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

  type CloneUrlItem = {
    url: string
    isDeclared: boolean
    isDeclaredPrimary: boolean
    isCurrent: boolean
    isGrasp: boolean
    isApi: boolean
  }

  type RelayItem = {
    url: string
  }

  let remoteFallbackToastKey = $state("")

  const normalizeRemoteForCompare = (value: string) => {
    const raw = String(value || "").trim()
    if (!raw) return ""
    try {
      const parsed = new URL(raw)
      return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\.git$/i, "").replace(/\/+$/, "")}`
    } catch {
      return raw
        .replace(/\.git$/i, "")
        .replace(/\/+$/, "")
        .toLowerCase()
    }
  }

  const getUrlHost = (value: string) => {
    try {
      return new URL(value).hostname
    } catch {
      return value
    }
  }

  const getCloneUrlError = (url: string) => {
    const normalized = normalizeRemoteForCompare(url)
    return (repoClass.cloneUrlErrors || []).find(
      error => normalizeRemoteForCompare(error.url) === normalized,
    )
  }

  const issuePillLabel = (url: string) => {
    const issue = getCloneUrlError(url)
    if (!issue) return ""
    const classified = classifyCloneUrlIssue(issue.error, issue.status)
    if (classified.kind === "auth") return "auth"
    if (classified.kind === "not-found") return "unavailable"
    if (classified.kind === "network") return "failed"
    return "issue"
  }

  const isApiCloneUrl = (url: string) => {
    const provider = detectProviderFromUrl(url)
    return provider === "github" || provider === "gitlab"
  }

  const currentReadRemoteUrl = $derived.by(() => repoClass.currentReadRemoteUrl || "")
  const declaredCloneUrls = $derived.by(() => repoClass.cloneUrls || [])
  const declaredPrimaryCloneUrl = $derived.by(() => declaredCloneUrls[0] || "")

  const repoCloneUrlItems = $derived.by<CloneUrlItem[]>(() => {
    const defaultNgitCloneUrl = buildDefaultNgitCloneUrl()
    const urls = Array.from(new Set((declaredCloneUrls || []).filter(Boolean)))

    if (defaultNgitCloneUrl && !urls.some(url => url.startsWith("nostr://"))) {
      urls.push(defaultNgitCloneUrl)
    }

    return urls.map(url => {
      const declaredIndex = declaredCloneUrls.findIndex(
        declared => normalizeRemoteForCompare(declared) === normalizeRemoteForCompare(url),
      )

      return {
        url,
        isDeclared: declaredIndex >= 0,
        isDeclaredPrimary: declaredIndex === 0,
        isCurrent:
          Boolean(currentReadRemoteUrl) &&
          normalizeRemoteForCompare(currentReadRemoteUrl) === normalizeRemoteForCompare(url),
        isGrasp: isGraspRepoHttpUrl(url) || isGraspRelayUrl(url),
        isApi: isApiCloneUrl(url),
      }
    })
  })

  const repoRelayItems = $derived.by<RelayItem[]>(() => {
    return Array.from(new Set((repoClass.relays || []).filter(Boolean))).map(relay => ({
      url: relay,
    }))
  })

  const repoMetadata = $derived({
    name: repoClass.name || "Unknown Repository",
    description: repoClass.description || "",
    repoId: repoClass.key || "",
    relays: repoRelayItems.map(item => item.url),
    cloneUrls: repoCloneUrlItems.map(item => item.url),
    webUrls: getDisplayedRepoWebUrls(repoClass),
    mainBranch: repoClass.mainBranch,
    createdAt: repoClass.repoEvent?.created_at
      ? new Date(repoClass.repoEvent.created_at * 1000)
      : null,
    updatedAt: (repoClass as any).repoStateEvent?.created_at
      ? new Date(((repoClass as any).repoStateEvent.created_at as number) * 1000)
      : null,
    community: repoClass.community,
  })

  const repoCommunityLabel = $derived.by(() => {
    const community = repoMetadata.community
    if (!community) return ""
    const profile = $profilesByPubkey.get(community.pubkey)
    return profile?.display_name || profile?.name || `${community.pubkey.slice(0, 8)}...`
  })
  const repoCommunityProfileRelays = $derived.by(() => {
    const relays = repoProfileRelays?.() || []
    if (relays.length > 0) return relays

    return normalizeRelays([repoMetadata.community?.relay || ""])
  })

  $effect(() => {
    if (!declaredPrimaryCloneUrl || !currentReadRemoteUrl) return
    if (
      normalizeRemoteForCompare(declaredPrimaryCloneUrl) ===
      normalizeRemoteForCompare(currentReadRemoteUrl)
    ) {
      return
    }

    const key = `${declaredPrimaryCloneUrl}|${currentReadRemoteUrl}`
    if (remoteFallbackToastKey === key) return
    remoteFallbackToastKey = key
    pushToast({
      message: `Primary remote unavailable; reading from fallback ${getUrlHost(currentReadRemoteUrl)}`,
      theme: "warning",
    })
  })

  const naddr = $derived($page.params.id)

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
    const changed = repoKey !== _prevRepoKey || main !== _prevMain || branchSig !== _prevBranchSig
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
    readmeError = false
    try {
      const branchName = normalizeBranchRef(repoClass.mainBranch)
      if (!branchName) {
        console.debug("README: Cannot load - branch not yet determined")
        readmeError = true
        return
      }

      const readmeContent = await repoClass.getFileContent({
        path: "README.md",
        branch: branchName,
        commit: undefined as any,
      })
      readme = readmeContent.content
      renderedReadme = readme ? md.render(readme) : ""
      if (!readme) readmeError = true
    } catch (e) {
      console.debug("README: Failed to load", e)
      readmeError = true
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
        commitLoadInProgress = false
        return
      }

      // Check if WorkerManager is ready before attempting operations
      if (!repoClass.workerManager?.isReady) {
        console.debug("LatestCommit: WorkerManager not ready, skipping")
        commitLoadInProgress = false
        return
      }

      // Try depth 5 first (fast), then 10 if needed, then 25 as fallback
      const depths = [5, 10, 25]

      for (const depth of depths) {
        try {
          const res = await repoClass.getCommitHistory({branch: mainBranch, depth})
          const list = Array.isArray(res) ? res : res?.commits
          if (Array.isArray(list) && list.length > 0) {
            lastCommit = list[0]
            commitLoadInProgress = false
            return
          }
        } catch (e) {
          // If repo not cloned, that's okay - commit history is optional for overview
          // Don't trigger clone just for commit history
          if (String(e).includes("not cloned") || String(e).includes("Repository not")) {
            console.debug(
              "LatestCommit: Repository not cloned, skipping (overview page doesn't need clone)",
            )
            commitLoadInProgress = false
            return
          }
          // Try next depth on other errors
          console.debug("LatestCommit attempt failed", {depth, error: String(e)})
        }
      }
    } catch (e) {
      // Silently fail - commit history is optional
      console.debug("LatestCommit: Failed to load", e)
    } finally {
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
    pubkey: string
    kind: "issue" | "pr"
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

  function getPullRequestTitle(event: PullRequestEvent) {
    const parsed = parsePullRequestEvent(event)
    return parsed.subject || getTagValue("subject", event.tags) || "Untitled PR"
  }

  const recentActivity = $derived.by(() => {
    const items: RecentActivityItem[] = []

    for (const issue of repoClass.issues) {
      items.push({
        id: issue.id,
        title: getIssueTitle(issue),
        createdAt: issue.created_at,
        activityAt: getLatestActivityAt(issue.id, issue.created_at),
        pubkey: issue.pubkey,
        kind: "issue",
      })
    }

    for (const pullRequest of pullRequests) {
      items.push({
        id: pullRequest.id,
        title: getPullRequestTitle(pullRequest),
        createdAt: pullRequest.created_at,
        activityAt: getLatestActivityAt(pullRequest.id, pullRequest.created_at),
        pubkey: pullRequest.pubkey,
        kind: "pr",
      })
    }

    return sortRecentActivity(items).slice(0, 7)
  })

  let activityExpanded = $state(false)
  const visibleActivity = $derived(activityExpanded ? recentActivity : recentActivity.slice(0, 4))

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

  function openRepoProfile(pubkey: string) {
    maintainersPopoverOpen = false
    pushModal(ProfileDetail, {
      pubkey,
      url: repoCommunityProfileRelays[0],
      relays: repoCommunityProfileRelays,
    })
  }

  function closeCloneDropdownOnOutsideClick(event: MouseEvent) {
    const target = event.target

    if (
      cloneDetailsElement?.open &&
      target instanceof Node &&
      !cloneDetailsElement.contains(target)
    ) {
      cloneDetailsElement.open = false
    }
  }
</script>

<svelte:document onclick={closeCloneDropdownOnOutsideClick} />

<svelte:head>
  <title>{repoClass.name || "Repository"}</title>
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
          class="btn btn-outline btn-sm gap-1"
          onclick={repoActions.openRemoteFixModal}
          title="Repo health">
          <HeartPulse class="h-4 w-4" />
          Health
        </Button>
        <Button
          class="btn btn-outline btn-sm gap-1"
          onclick={repoActions.refreshRepo}
          disabled={repoActions.isRefreshing}
          title={repoActions.isRefreshing ? "Syncing..." : "Refresh"}>
          <RotateCcw class="h-4 w-4 {repoActions.isRefreshing ? 'animate-spin' : ''}" />
          {repoActions.isRefreshing ? "Syncing..." : "Refresh"}
        </Button>
        {#if $pubkey}
          <Button
            class="btn btn-ghost btn-sm gap-1 text-muted-foreground hover:text-error"
            onclick={() => pushModal(ResetRepoConfirm, {repoClass, repoName: repoMetadata.name})}
            title="Reset local repo state">
            Reset
          </Button>
        {/if}
        {#if $pubkey}
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Button
              class="btn btn-sm {repoActions.isBookmarked
                ? 'border-amber-400/60 bg-amber-400/10 text-amber-600 hover:bg-amber-400/20 dark:text-amber-400'
                : 'btn-outline'} gap-1"
              onclick={repoActions.bookmarkRepo}
              disabled={repoActions.isTogglingBookmark}
              title={repoActions.isBookmarked ? "Unstar repository" : "Star repository"}>
              <Star class="h-4 w-4 {repoActions.isBookmarked ? 'fill-current' : ''}" />
              {repoActions.isBookmarked ? "Starred" : "Star"}
            </Button>
            <Button
              class="btn btn-sm {repoActions.isWatching ? 'btn-primary' : 'btn-outline'} gap-1"
              onclick={repoActions.openWatchModal}
              title={repoActions.isWatching ? "Watching" : "Watch"}>
              <Bell class="h-4 w-4 {repoActions.isWatching ? 'fill-current' : ''}" />
              {repoActions.isWatching ? "Watching" : "Watch"}
            </Button>
            <Button
              class="btn btn-outline btn-sm gap-1"
              onclick={repoActions.forkRepo}
              title="Fork">
              <GitFork class="h-4 w-4" />
              Fork
            </Button>
          </div>
        {/if}
      </div>
    {/if}

    {#if defaultBranchStatus.kind !== "ok"}
      <div
        class="mb-4 flex items-start gap-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
        <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
        <div class="flex-1">
          {#if defaultBranchStatus.kind === "unset"}
            No default branch has been set. Some parts of this page may not load.
          {:else}
            The default branch <code class="font-mono">{defaultBranchStatus.head}</code> no longer exists.
            Some parts of this page may not load.
          {/if}
          {#if isOwner}
            <a href={`${repoBasePath}/settings`} class="ml-1 underline">Update in Settings</a>
          {:else}
            Ask the owner to pick a replacement.
          {/if}
        </div>
      </div>
    {/if}

    {#if declaredPrimaryCloneUrl && currentReadRemoteUrl && normalizeRemoteForCompare(declaredPrimaryCloneUrl) !== normalizeRemoteForCompare(currentReadRemoteUrl)}
      <div
        class="mb-4 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div class="min-w-0 flex-1">
          Reading from fallback remote
          <code class="font-mono">{getUrlHost(currentReadRemoteUrl)}</code>
          because the primary remote is not the active read source.
          <button class="ml-1 underline" type="button" onclick={repoActions?.openRemoteFixModal}>
            Review health
          </button>
        </div>
      </div>
    {/if}

    <div class="grid min-w-0 gap-4 lg:grid-cols-3" transition:fly>
      <div class="min-w-0 lg:col-span-1 lg:col-start-3 lg:row-start-1">
        <Card class="min-w-0 divide-y divide-border p-3 text-sm">
          <!-- Details header -->
          <section
            class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto]">
            <span
              class="col-span-2 row-start-1 flex items-center gap-2 text-base font-semibold sm:col-span-1 sm:col-start-1 lg:col-span-2">
              <GitBranch class="h-5 w-5" />
              Details
            </span>
            <div
              class="col-start-1 row-start-2 min-w-0 justify-self-stretch sm:col-start-2 sm:row-start-1 lg:col-start-1 lg:row-start-3">
              <BranchSelector repo={repoClass} />
            </div>
            {#if repoCloneUrlItems.length > 0}
              <details
                bind:this={cloneDetailsElement}
                bind:open={cloneDetailsOpen}
                class="group relative col-start-2 row-start-2 shrink-0 justify-self-end sm:col-start-3 sm:row-start-1 lg:col-start-1 lg:row-start-2 lg:justify-self-start">
                <summary
                  class="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-green-600/40 bg-green-100 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-200 dark:border-green-500/40 dark:bg-green-600/20 dark:text-green-300 dark:hover:bg-green-600/30">
                  <span class="flex items-center gap-2">
                    <GitBranch class="h-4 w-4" />
                    Clone
                  </span>
                  <ChevronDown class="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div
                  class="z-20 absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-1 rounded-md border border-border bg-base-100 p-2 shadow-lg">
                  {#each repoCloneUrlItems as item (item.url)}
                    {@const isNostr = item.url.startsWith("nostr://")}
                    {@const issueLabel = issuePillLabel(item.url)}
                    <div
                      class="group/row flex w-full min-w-0 cursor-default items-center gap-2 rounded-md border p-2 text-left transition-colors hover:bg-secondary/40 {item.isDeclaredPrimary
                        ? 'border-green-600/40 bg-green-500/5'
                        : isNostr
                          ? 'border-purple-500/40 bg-purple-500/5'
                          : 'border-transparent'}"
                      title={item.url}>
                      <div class="min-w-0 flex-1">
                        <code
                          class="scrollbar-hide block min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap font-mono text-xs {isNostr
                            ? 'text-purple-700 dark:text-purple-200'
                            : ''}">{item.url}</code>
                        <div class="mt-1 flex flex-wrap gap-1 text-[10px] uppercase tracking-wide">
                          {#if item.isDeclaredPrimary}
                            <span
                              class="rounded border border-green-500/40 px-1 py-0.5 text-green-700 dark:text-green-300"
                              >Primary</span>
                          {:else if item.isDeclared}
                            <span
                              class="rounded border border-border px-1 py-0.5 text-muted-foreground"
                              >Mirror</span>
                          {/if}
                          {#if item.isCurrent}
                            <span
                              class="rounded border border-sky-500/40 px-1 py-0.5 text-sky-700 dark:text-sky-300"
                              >Current</span>
                          {/if}
                          {#if item.isGrasp}
                            <span
                              class="rounded border border-purple-500/40 px-1 py-0.5 text-purple-700 dark:text-purple-300"
                              >GRASP</span>
                          {:else if item.isApi}
                            <span
                              class="rounded border border-border px-1 py-0.5 text-muted-foreground"
                              >API</span>
                          {/if}
                          {#if issueLabel}
                            <span
                              class="rounded border border-rose-500/40 px-1 py-0.5 text-rose-700 dark:text-rose-300"
                              >{issueLabel}</span>
                          {/if}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="self-center rounded p-2 transition-colors hover:bg-background/70 group-hover/row:bg-background/50"
                        title="Copy clone URL"
                        onclick={() => copyUrl(item.url)}>
                        {#if copiedUrl === item.url}
                          <Check class="h-4 w-4 text-green-500" />
                        {:else}
                          <Copy class="h-4 w-4 text-muted-foreground" />
                        {/if}
                      </button>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}
          </section>

          <!-- Repository Details -->
          <section class="py-3">
            <div class="space-y-3">
              <!-- Compact info rows -->
              <div class="space-y-1 text-sm">
                {#if declaredPrimaryCloneUrl}
                  <div class="flex items-center gap-2 py-1">
                    <span class="flex-shrink-0 text-muted-foreground">Primary remote</span>
                    <code
                      class="min-w-0 flex-1 truncate font-mono text-xs"
                      title={declaredPrimaryCloneUrl}>{getUrlHost(declaredPrimaryCloneUrl)}</code>
                    {#if currentReadRemoteUrl && normalizeRemoteForCompare(currentReadRemoteUrl) === normalizeRemoteForCompare(declaredPrimaryCloneUrl)}
                      <span
                        class="rounded border border-sky-500/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-700 dark:text-sky-300"
                        >Current</span>
                    {:else if currentReadRemoteUrl}
                      <span
                        class="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300"
                        >Fallback active</span>
                    {/if}
                  </div>
                {/if}

                {#if repoMetadata.community}
                  <div class="flex items-center gap-2 py-1">
                    <span class="flex-shrink-0 text-muted-foreground">Community</span>
                    <AppLink
                      href={makeCommunityPath(repoMetadata.community.pubkey)}
                      class="min-w-0 flex-1 truncate rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/15">
                      {repoCommunityLabel}
                    </AppLink>
                  </div>
                {/if}

                <!-- Address -->
                <div class="flex items-center gap-2 py-1">
                  <span class="flex-shrink-0 text-muted-foreground">Address</span>
                  <code class="min-w-0 flex-1 truncate font-mono text-xs" title={naddr}
                    >{shortenNip19(naddr)}</code>
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
                  {@const hostname = (u: string) => {
                    try {
                      return new URL(u).hostname
                    } catch {
                      return u
                    }
                  }}
                  <details class="group/urls">
                    <summary
                      class="flex cursor-pointer list-none items-center gap-2 rounded py-1 hover:bg-secondary/20">
                      <span class="flex-shrink-0 text-muted-foreground"
                        >Website{repoMetadata.webUrls.length > 1 ? "s" : ""}</span>
                      <a
                        href={repoMetadata.webUrls[0]}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
                        title={repoMetadata.webUrls[0]}
                        onclick={e => e.stopPropagation()}>{hostname(repoMetadata.webUrls[0])}</a>
                      <button
                        type="button"
                        class="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                        title="Copy URL"
                        onclick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          clip(repoMetadata.webUrls[0])
                        }}>
                        <Copy class="h-3.5 w-3.5" />
                      </button>
                      {#if repoMetadata.webUrls.length > 1}
                        <ChevronDown
                          class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-open/urls:rotate-180" />
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
                  {@const isDefaultBranch = (b: any) =>
                    ("isHead" in b && b.isHead) || b.name === repoMetadata.mainBranch}
                  {@const sortedBranches = [...repoClass.branches].sort(
                    (a, b) => (isDefaultBranch(a) ? 0 : 1) - (isDefaultBranch(b) ? 0 : 1),
                  )}
                  <details class="group/branches">
                    <summary
                      class="flex cursor-pointer list-none items-center gap-2 rounded py-1 hover:bg-secondary/20">
                      <span class="flex-shrink-0 text-muted-foreground">Branches</span>
                      <span class="min-w-0 flex-1 font-mono text-xs">{branchCount}</span>
                      <ChevronDown
                        class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-open/branches:rotate-180" />
                    </summary>
                    <div class="mt-1 space-y-0.5">
                      {#each sortedBranches as branch}
                        {@const isDefault = isDefaultBranch(branch)}
                        <div class="flex items-center gap-2">
                          <span
                            class="min-w-0 flex-1 truncate font-mono text-xs"
                            title={branch.name}>
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
                {#if repoRelayItems.length > 0}
                  {@const relayHostname = (u: string) => {
                    try {
                      return new URL(u).hostname
                    } catch {
                      return u
                    }
                  }}
                  <details class="group/relays">
                    <summary
                      class="flex cursor-pointer list-none items-center gap-2 rounded py-1 hover:bg-secondary/20">
                      <span class="flex-shrink-0 text-muted-foreground">Relays</span>
                      <span class="min-w-0 flex-1 font-mono text-xs">{repoRelayItems.length}</span>
                      <ChevronDown
                        class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-open/relays:rotate-180" />
                    </summary>
                    <div class="mt-1 space-y-0.5">
                      {#each repoRelayItems as relay (relay.url)}
                        <div class="flex items-center gap-2">
                          <span class="min-w-0 flex-1 truncate font-mono text-xs" title={relay.url}
                            >{relayHostname(relay.url)}</span>
                          <button
                            type="button"
                            class="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                            title="Copy relay URL"
                            onclick={() => clip(relay.url)}>
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
                    <summary
                      class="flex cursor-pointer list-none items-center gap-2 rounded py-1 hover:bg-secondary/20">
                      <span class="flex-shrink-0 text-muted-foreground">Latest</span>
                      <span class="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs">
                        <span>{truncateHash(lastCommit.oid)}</span>
                        <span class="text-muted-foreground">·</span>
                        <span class="truncate text-muted-foreground"
                          >{formatDate(new Date(lastCommit.commit.author.timestamp * 1000))}</span>
                      </span>
                      <ChevronDown
                        class="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform group-open/commit:rotate-180" />
                    </summary>
                    <div class="mt-1 flex items-center gap-1.5 text-xs">
                      <span
                        class="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold uppercase text-muted-foreground">
                        {(lastCommit.commit.author.name || "?").charAt(0)}
                      </span>
                      <span class="flex-shrink-0 font-medium"
                        >{lastCommit.commit.author.name}:</span>
                      <span
                        class="min-w-0 flex-1 truncate text-muted-foreground"
                        title={lastCommit.commit.message}>{lastCommit.commit.message}</span>
                    </div>
                  </details>
                {/if}
              </div>

              <!-- Nostr Information -->
              {#if repoOwnerPubkey || repoMaintainerPubkeys.length > 0}
                <div class="space-y-3">
                  {#if repoOwnerPubkey}
                    <div class="min-w-0 rounded-lg border border-border/70 bg-secondary/15 p-2">
                      <div class="mb-2 flex items-center justify-between gap-2">
                        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                          >Owner</span>
                        <span
                          class="rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >Primary</span>
                      </div>
                      <button
                        type="button"
                        class="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-secondary/30"
                        onclick={() => openRepoProfile(repoOwnerPubkey)}>
                        <ProfileCircle
                          pubkey={repoOwnerPubkey}
                          relays={repoCommunityProfileRelays}
                          size={8}
                          class="border border-border" />
                        <span class="min-w-0 truncate text-sm font-medium hover:underline">
                          <ProfileName
                            pubkey={repoOwnerPubkey}
                            relays={repoCommunityProfileRelays} />
                        </span>
                      </button>
                    </div>
                  {/if}

                  {#if repoMaintainerPubkeys.length > 0}
                    <div class="min-w-0 rounded-lg border border-primary/20 bg-primary/5 p-2">
                      <div class="mb-2 flex items-center justify-between gap-2">
                        <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                          >Maintainers</span>
                        <span
                          class="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                          title={`${repoMaintainerPubkeys.length} maintainers`}
                          >{repoMaintainerPubkeys.length}</span>
                      </div>
                      <div class="flex flex-wrap gap-1.5">
                        {#each repoMaintainerPubkeys.slice(0, MAINTAINER_PREVIEW_COUNT) as maintainerPubkey (maintainerPubkey)}
                          <button
                            type="button"
                            class="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/70 py-0.5 pl-0.5 pr-2 text-left text-xs hover:border-primary/40 hover:bg-primary/10"
                            onclick={() => openRepoProfile(maintainerPubkey)}>
                            <ProfileCircle
                              pubkey={maintainerPubkey}
                              relays={repoCommunityProfileRelays}
                              size={5}
                              class="border border-border" />
                            <span class="min-w-0 max-w-[7rem] truncate hover:underline">
                              <ProfileName
                                pubkey={maintainerPubkey}
                                relays={repoCommunityProfileRelays} />
                            </span>
                          </button>
                        {/each}
                        {#if repoMaintainerPubkeys.length > MAINTAINER_PREVIEW_COUNT}
                          <div class="relative">
                            <button
                              type="button"
                              class="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/15"
                              aria-expanded={maintainersPopoverOpen}
                              onclick={() => (maintainersPopoverOpen = !maintainersPopoverOpen)}>
                              +{repoMaintainerPubkeys.length - MAINTAINER_PREVIEW_COUNT} more
                            </button>
                            {#if maintainersPopoverOpen}
                              <InlinePopover
                                onClose={() => (maintainersPopoverOpen = false)}
                                align="right"
                                widthClass="w-72">
                                <div class="space-y-3">
                                  <div>
                                    <div class="text-sm font-semibold">Maintainers</div>
                                    <div class="mt-1 text-xs text-muted-foreground">
                                      {repoMaintainerPubkeys.length} people can maintain this repo.
                                    </div>
                                  </div>
                                  <div class="space-y-1">
                                    {#each repoMaintainerPubkeys as maintainerPubkey (maintainerPubkey)}
                                      <button
                                        type="button"
                                        class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary/30"
                                        onclick={() => openRepoProfile(maintainerPubkey)}>
                                        <ProfileCircle
                                          pubkey={maintainerPubkey}
                                          relays={repoCommunityProfileRelays}
                                          size={6}
                                          class="border border-border" />
                                        <span class="min-w-0 truncate font-medium hover:underline">
                                          <ProfileName
                                            pubkey={maintainerPubkey}
                                            relays={repoCommunityProfileRelays} />
                                        </span>
                                      </button>
                                    {/each}
                                  </div>
                                </div>
                              </InlinePopover>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </section>

          <!-- Recent Activity -->
          {#if recentActivity.length > 0}
            <section class="py-3">
              <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Eye class="h-4 w-4" />
                Recent Activity
              </h3>
              <div class="space-y-1">
                {#each visibleActivity as item, i}
                  {@const isPeek = !activityExpanded && i === 3}
                  <a
                    href={activityHref(item)}
                    class="group/act relative flex min-w-0 items-center gap-2 rounded px-1 py-1 hover:bg-secondary/20 {isPeek
                      ? 'pointer-events-none opacity-40 [mask-image:linear-gradient(to_bottom,black_15%,transparent_70%)]'
                      : ''}">
                    <ProfileCircle
                      pubkey={item.pubkey}
                      relays={repoCommunityProfileRelays}
                      size={6}
                      class="flex-shrink-0" />
                    <div class="flex min-w-0 flex-1 flex-col">
                      <div class="flex min-w-0 items-center gap-1.5 text-xs">
                        <span class="min-w-0 truncate font-medium">
                          <ProfileName pubkey={item.pubkey} relays={repoCommunityProfileRelays} />
                        </span>
                        <span class="flex-shrink-0 text-muted-foreground">·</span>
                        <span class="flex-shrink-0 text-muted-foreground"
                          >{formatDate(new Date(item.activityAt * 1000))}</span>
                      </div>
                      <span
                        class="truncate text-xs text-muted-foreground group-hover/act:underline"
                        title={item.title}>{item.title}</span>
                    </div>
                    {#if item.kind === "issue"}
                      <CircleAlert class="h-4 w-4 flex-shrink-0 text-red-400/70" />
                    {:else}
                      <GitPullRequest class="h-4 w-4 flex-shrink-0 text-purple-400" />
                    {/if}
                  </a>
                {/each}
                {#if recentActivity.length > 4 && !activityExpanded}
                  <button
                    type="button"
                    class="mx-auto mt-1 flex items-center gap-1 bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                    onclick={() => (activityExpanded = true)}>
                    Show more
                    <ChevronDown class="h-3.5 w-3.5" />
                  </button>
                {:else if activityExpanded && recentActivity.length > 4}
                  <button
                    type="button"
                    class="mx-auto mt-1 flex items-center gap-1 bg-transparent px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                    onclick={() => (activityExpanded = false)}>
                    Show less
                    <ChevronDown class="h-3.5 w-3.5 rotate-180" />
                  </button>
                {/if}
              </div>
            </section>
          {/if}

          <section class="py-3">
            <div class="mb-2 flex items-center gap-2">
              <h3 class="flex items-center gap-2 text-sm font-semibold">
                <Users class="h-4 w-4" />
                Community Activity
              </h3>
              <span class="ml-auto text-[11px] text-muted-foreground">Community evidence</span>
            </div>
            {#if repoTrustStatus}
              <p class="mb-2 text-xs text-muted-foreground">{repoTrustStatus}</p>
            {/if}
            <div class="space-y-1">
              {#each repoTrustMetricCards as metric (metric.key)}
                {@const accent =
                  metric.key === "community-aligned-merged"
                    ? "text-emerald-400"
                    : metric.key === "community-aligned-maintainer"
                      ? "text-sky-400"
                      : "text-amber-400"}
                <div class="relative">
                  <button
                    type="button"
                    class="group/trust flex w-full min-w-0 items-center gap-3 rounded px-1 py-1 text-left hover:bg-secondary/20"
                    onclick={() =>
                      (openTrustMetricPopover =
                        openTrustMetricPopover === metric.key ? null : metric.key)}>
                    <span
                      class="flex-shrink-0 font-mono text-lg font-semibold tabular-nums {accent}"
                      >{metric.value}</span>
                    <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                      >{metric.label}</span>
                    <span
                      class="flex-shrink-0 rounded p-1 group-hover/trust:bg-secondary/40 {openTrustMetricPopover ===
                      metric.key
                        ? accent
                        : 'text-muted-foreground group-hover/trust:text-foreground'}">
                      <Info class="h-3.5 w-3.5" />
                    </span>
                  </button>
                  {#if openTrustMetricPopover === metric.key}
                    {@const bgTint =
                      metric.key === "community-aligned-merged"
                        ? "bg-emerald-500/10"
                        : metric.key === "community-aligned-maintainer"
                          ? "bg-sky-500/10"
                          : "bg-amber-500/10"}
                    <InlinePopover
                      onClose={() => (openTrustMetricPopover = null)}
                      align="left"
                      widthClass="w-80">
                      <div class="-m-3 flex flex-col gap-3 rounded-box p-3 text-sm {bgTint}">
                        <div>
                          <div class="font-medium">{metric.label}</div>
                          <div class="mt-1 text-xs opacity-70">{metric.description}</div>
                        </div>
                        {#if metric.key === "community-aligned-merged"}
                          <div class="text-xs opacity-60">
                            {repoTrustMetrics.communityAlignedMergedContributions} of {repoTrustMetrics.mergedPullRequests}
                            merged pull request{repoTrustMetrics.mergedPullRequests === 1
                              ? ""
                              : "s"} had a community-aligned author.
                          </div>
                        {:else if metric.key === "community-aligned-maintainer"}
                          <div class="text-xs opacity-60">
                            {repoTrustMetrics.communityAlignedMaintainerMerges} merged pull request{repoTrustMetrics.communityAlignedMaintainerMerges ===
                            1
                              ? ""
                              : "s"} were merged by community-aligned maintainers.
                          </div>
                        {:else}
                          <div class="text-xs opacity-60">
                            {repoTrustMetrics.communityCollaborators} distinct community collaborator{repoTrustMetrics.communityCollaborators ===
                            1
                              ? ""
                              : "s"} participated in merged pull request activity.
                          </div>
                        {/if}
                        {#if metric.details && metric.details.length > 0}
                          <div class="flex flex-col gap-2">
                            {#each metric.details as detail (detail.rootId)}
                              <div class="rounded-box bg-base-200/50 p-3">
                                <AppLink
                                  href={getRepoTrustPrHref(detail.rootId)}
                                  class="text-sm font-medium text-primary underline-offset-2 hover:underline">
                                  {detail.subject}
                                </AppLink>
                                <div
                                  class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-70">
                                  <span>Author</span>
                                  <ProfileLink
                                    pubkey={detail.authorPubkey}
                                    relays={repoCommunityProfileRelays}
                                    unstyled
                                    class="font-medium text-primary underline-offset-2 hover:underline" />
                                </div>
                                {#if detail.mergedByPubkey}
                                  <div
                                    class="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-70">
                                    <span>Merged by</span>
                                    <ProfileLink
                                      pubkey={detail.mergedByPubkey}
                                      relays={repoCommunityProfileRelays}
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
                                  <ProfileCircle
                                    pubkey={actor.pubkey}
                                    relays={repoCommunityProfileRelays}
                                    size={6}
                                    class="border border-border" />
                                  <div class="min-w-0">
                                    <ProfileLink
                                      pubkey={actor.pubkey}
                                      relays={repoCommunityProfileRelays}
                                      unstyled
                                      class="block truncate text-sm font-medium text-primary underline-offset-2 hover:underline" />
                                    <div class="text-xs opacity-70">
                                      {actor.authoredMergedPullRequests} authored merges • {actor.appliedMergedPullRequests}
                                      maintainer merges
                                    </div>
                                  </div>
                                </div>
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <div class="text-xs opacity-60">
                            No evidence captured for this metric yet.
                          </div>
                        {/if}
                      </div>
                    </InlinePopover>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        </Card>
      </div>

      <!-- README -->
      {#if readmeLoading}
        <div transition:slide class="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
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
        <div transition:slide class="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          <Card class="min-w-0 p-4 sm:p-6">
            <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
              <BookOpen class="h-5 w-5" />
              README
            </h3>
            <div class="git-readme prose max-w-full overflow-x-auto" in:fly>
              {@html renderedReadme}
              <style>
                .git-readme {
                  color: hsl(var(--ng-foreground));
                  background: none;
                }
                .git-readme h1,
                .git-readme h2,
                .git-readme h3 {
                  font-weight: 600;
                  line-height: 1.25;
                  color: hsl(var(--ng-foreground));
                  margin-top: 2rem;
                  margin-bottom: 1rem;
                }
                .git-readme h1 {
                  font-size: 2rem;
                  border-bottom: 1px solid hsl(var(--ng-border));
                  padding-bottom: 0.3em;
                }
                .git-readme h2 {
                  font-size: 1.5rem;
                  border-bottom: 1px solid hsl(var(--ng-border));
                  padding-bottom: 0.2em;
                }
                .git-readme h3 {
                  font-size: 1.25rem;
                  padding-bottom: 0.1em;
                }
                .git-readme ul,
                .git-readme ol {
                  margin: 1em 0;
                  padding-left: 2em;
                }
                .git-readme li {
                  margin: 0.3em 0;
                }
                .git-readme a {
                  color: hsl(var(--ng-primary));
                  text-decoration: underline;
                  text-underline-offset: 2px;
                  transition: color 0.2s;
                }
                .git-readme a:hover {
                  color: hsl(var(--ng-accent));
                }
                .git-readme code {
                  background: hsl(var(--ng-muted));
                  color: hsl(var(--ng-foreground));
                  border-radius: 4px;
                  padding: 0.2em 0.4em;
                  font-size: 0.95em;
                }
                .git-readme pre {
                  background: hsl(var(--ng-background));
                  color: hsl(var(--ng-foreground));
                  border: 1px solid hsl(var(--ng-border));
                  border-radius: 8px;
                  padding: 1em;
                  margin: 1.5em 0;
                  font-size: 1em;
                  overflow-x: auto;
                }
                .git-readme blockquote {
                  border-left: 4px solid hsl(var(--ng-primary));
                  background: hsl(var(--ng-muted));
                  color: hsl(var(--ng-muted-foreground));
                  padding: 1em 1.5em;
                  border-radius: 0.5em;
                  margin: 1.5em 0;
                  font-style: italic;
                }
                .git-readme table {
                  width: 100%;
                  border-collapse: collapse;
                  margin-bottom: 1.5em;
                  background: hsl(var(--ng-card));
                  border-radius: 0.5em;
                  overflow: hidden;
                }
                .git-readme th,
                .git-readme td {
                  border: 1px solid hsl(var(--ng-border));
                  padding: 0.6em 1em;
                }
                .git-readme th {
                  background: hsl(var(--ng-muted));
                  font-weight: 600;
                }
              </style>
            </div>
          </Card>
        </div>
      {:else if readmeError}
        <div transition:slide class="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          <Card class="min-w-0 p-4 sm:p-6">
            <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
              <BookOpen class="h-5 w-5" />
              README
            </h3>
            <p class="text-sm text-muted-foreground">Unable to load README.md</p>
          </Card>
        </div>
      {/if}
    </div>
  {/if}
</div>
