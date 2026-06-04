<script lang="ts">
  import {
    AlertCircle,
    CheckCircle,
    ChevronDown,
    ChevronRight,
    FileCode,
    FileMinus,
    FilePlus,
    FileText,
    FileX,
    GitCommit,
    GitMerge,
    Loader2,
    MessageSquare,
    Shield,
    X,
  } from "@lucide/svelte"
  import {
    Button,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DiffViewer,
    IssueThread,
    MergeStatus,
    Status,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    ACCESS_TOKEN_SETTINGS_PATH,
    getAccessTokenManagementMessage,
    isAccessTokenManagementIssue,
    publishGraspRepoStateForPush,
    prChangeToParseDiffFile,
    prChangeToReviewParseDiffFile,
    toast,
  } from "@nostr-git/ui"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import NostrGitProfileComponent from "@app/components/NostrGitProfileComponent.svelte"
  import {profilesByPubkey, pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {load, PublishStatus} from "@welshman/net"
  import {
    COMMENT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    getTagValue,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {filterValidCloneUrls} from "@nostr-git/core"
  import {
    parseStatusEvent,
    parsePullRequestUpdateEvent,
    createCoverLetterEvent,
    createPullRequestUpdateEvent,
    createStatusEvent,
    type CommentEvent,
    type StatusEvent,
    type PullRequestEvent,
    type CoverLetterEvent,
    type CoverLetterTag,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
    GIT_STATUS_APPLIED,
    isImportedEvent,
    resolveStatus,
  } from "@nostr-git/core/events"
  import {postComment, postStatus, publishEvent} from "@app/core/git-commands"
  import {fetchRelayEventsWithTimeout} from "@app/util/fetch-relay-events"
  import {HIDDEN_ROOT_IDS_KEY, getRepoMaintainers} from "@app/core/git-state"
  import {
    canEditReplyEvent,
    areTagsEqual,
    editedTargetIds,
    filterVisibleAfterDeletesAndEdits,
    mergeRichEditorTags,
  } from "@app/core/event-edits"
  import {publishEditedReply} from "@app/core/event-edit-publish"
  import {githubPermalinkDiffId, type PRMergeAnalysisResult} from "@nostr-git/core/git"
  import {getCloneUrlsFromEvent, isGraspRepoHttpUrl} from "@nostr-git/core/utils"
  import {normalizeRelayUrl} from "@welshman/util"
  import Profile from "@src/app/components/Profile.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import Markdown from "@src/lib/components/Markdown.svelte"
  import RepoRichDescriptionEditor from "@app/components/RepoRichDescriptionEditor.svelte"
  import {loadBudabitProfile} from "@app/core/profile-resolver"
  import {pushModal} from "@app/util/modal"
  import type {
    Repo,
    RichComposerContext,
    RichContentPayload,
    RichDescriptionEditorHandle,
  } from "@nostr-git/ui"
  import {getContext, hasContext, tick, untrack} from "svelte"
  import type {Readable} from "svelte/store"
  import {
    REPO_TRUST_METRICS_KEY,
    defaultRepoTrustMetrics,
    type RepoTrustMetrics,
  } from "@app/core/repo-trust-metrics"

  type PrChange = {
    path: string
    status: "added" | "modified" | "deleted" | "renamed"
    diffHunks: Array<{
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
      patches: Array<{line: string; type: "+" | "-" | " "}>
    }>
  }

  type PrCommitMeta = {
    sha: string
    author: string
    date: number
    message: string
    parents?: string[]
  }

  type PrCommitDiffState = {
    loading: boolean
    error?: string
    warning?: string
    meta?: PrCommitMeta
    changes?: PrChange[]
  }

  type PrPushStatus = "idle" | "pushing" | "pushed" | "skipped" | "failed"

  type PrPushRemote = {
    remote: string
    url: string
    provider: string
    selected: boolean
    status: PrPushStatus
    summary?: string
    error?: string
  }

  type PrSyncResult = {
    ok: boolean
    error?: string
    warning?: string | null
    usedUrl?: string
  }

  interface Props {
    pr: ReturnType<typeof import("@nostr-git/core/events").parsePullRequestEvent>
    prEvent: PullRequestEvent
    repo: Repo
    repoRelays: string[]
    prEditRelays: string[]
  }

  const {pr, prEvent, repo: repoClass, repoRelays, prEditRelays}: Props = $props()
  const repoTrustMetricsStore = hasContext(REPO_TRUST_METRICS_KEY)
    ? getContext<Readable<RepoTrustMetrics>>(REPO_TRUST_METRICS_KEY)
    : undefined
  const hiddenRepoEventIdsStore = hasContext(HIDDEN_ROOT_IDS_KEY)
    ? getContext<Readable<Set<string>>>(HIDDEN_ROOT_IDS_KEY)
    : undefined

  const GIT_COVER_LETTER_KIND = 1624
  const normalizeRelay = (relay: string | undefined | null) => {
    try {
      return normalizeRelayUrl(relay || "")
    } catch {
      return ""
    }
  }
  const normalizeUniqueRelays = (relays: Array<string | undefined | null>) =>
    Array.from(new Set(relays.map(normalizeRelay).filter(Boolean)))

  const strictPrEditRelays = $derived.by(() => normalizeUniqueRelays(prEditRelays || []))
  const profileRelays = $derived.by(() =>
    repoClass.community?.relay ? normalizeUniqueRelays([repoClass.community.relay]) : [],
  )

  const normalizeBranchName = (input?: string | null) => {
    const value = String(input || "").trim()
    if (!value) return ""
    if (value.startsWith("ref: refs/heads/")) return value.slice("ref: refs/heads/".length)
    if (value.startsWith("refs/heads/")) return value.slice("refs/heads/".length)
    if (value.startsWith("refs/remotes/origin/")) return value.slice("refs/remotes/origin/".length)
    if (value.startsWith("origin/")) return value.slice("origin/".length)
    return value
  }

  const repoMaintainers = $derived.by((): string[] => {
    const owner = (repoClass as any)?.repoEvent?.pubkey as string | undefined
    const maintainers = (((repoClass as any)?.maintainers as string[]) || []).filter(
      (value): value is string => Boolean(value),
    )
    const fallback = Array.from(
      new Set([...maintainers, owner].filter((value): value is string => Boolean(value))),
    )
    const parsedMaintainers = getRepoMaintainers((repoClass as any)?.repoEvent)
    return parsedMaintainers.length > 0 ? parsedMaintainers : fallback
  })

  const repoMaintainerPubkeys = $derived.by(() => new Set(repoMaintainers))
  const repoOwnerPubkey = $derived.by(
    () => ((repoClass as any)?.repoEvent?.pubkey || (repoClass as any)?.owner || "") as string,
  )
  const repoCommunityScope = $derived(
    repoClass.community?.pubkey ||
      getTagValue("h", (((repoClass as any)?.repoEvent?.tags || []) as string[][])) ||
      "",
  )
  const isImportedPr = $derived.by(() => isImportedEvent(prEvent as any))
  const repoAddresses = $derived.by(() => {
    const address = (repoClass as any)?.address || ""
    return address ? [address] : []
  })
  const commentRepoRefs = $derived.by(() => repoAddresses)
  const commentRelayHint = $derived.by(() => {
    const sourceRelays = repoRelays?.length ? repoRelays : repoClass.relays || []
    const relays = sourceRelays.map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    return relays[0] || undefined
  })
  const prRepoAddress = $derived.by(
    () =>
      (prEvent?.tags || []).find((tag: string[]) => tag[0] === "a")?.[1] ||
      ((repoClass as any)?.address as string) ||
      "",
  )
  const prDescriptionContext = $derived.by(
    (): RichComposerContext => ({
      url: commentRelayHint || strictPrEditRelays[0] || "",
      relays: strictPrEditRelays.length ? strictPrEditRelays : repoRelays || [],
      repoAddress: prRepoAddress,
      relayHint: commentRelayHint,
      rootEvent: prEvent
        ? {
            id: prEvent.id,
            kind: prEvent.kind,
            pubkey: prEvent.pubkey,
            tags: (prEvent.tags || []) as string[][],
          }
        : undefined,
    }),
  )
  const repoTrustMetrics = $derived.by<RepoTrustMetrics>(() =>
    repoTrustMetricsStore
      ? ($repoTrustMetricsStore ?? defaultRepoTrustMetrics)
      : defaultRepoTrustMetrics,
  )
  const hiddenRepoEventIds = $derived.by(() =>
    hiddenRepoEventIdsStore ? ($hiddenRepoEventIdsStore ?? new Set<string>()) : new Set<string>(),
  )
  const prTrustMetric = $derived.by(() => repoTrustMetrics.byRootId.get(prEvent?.id || ""))
  const prTrustSummary = $derived.by(() => {
    const metric = prTrustMetric

    if (repoTrustMetrics.status === "loading") {
      return "Refreshing community activity for this PR..."
    }

    if (repoTrustMetrics.status === "error") {
      return repoTrustMetrics.error || "Unable to compute community activity for this PR."
    }

    if (!metric) {
      return "No community activity data for this PR yet."
    }

    if (metric.communityAlignedActorCount > 0) {
      return `${metric.communityAlignedActorCount} community-aligned actor${metric.communityAlignedActorCount === 1 ? "" : "s"} matched this PR.`
    }

    return metric.merged
      ? "No community-aligned actors matched this merged PR."
      : "No community-aligned actors matched this PR yet."
  })

  const canManagePr = $derived.by(() => {
    if (!$pubkey) return false
    return repoMaintainerPubkeys.has($pubkey)
  })

  const canEditPrDescription = $derived.by(() => {
    if (!$pubkey || !prEvent) return false
    return $pubkey === prEvent.pubkey || repoMaintainerPubkeys.has($pubkey)
  })

  const statusRepo = $derived.by(
    () =>
      ({
        maintainers: repoMaintainers,
        relays: repoClass.relays || repoRelays || [],
        repoEvent: (repoClass as any).repoEvent,
        owner: repoOwnerPubkey,
        getCommitHistory: (...args: any[]) => (repoClass as any).getCommitHistory(...args),
      }) as unknown as Repo,
  )

  // PR-specific status and comments
  const getPrStatusFilter = () => ({
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_APPLIED, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [prEvent?.id ?? ""],
  })

  const prStatusEvents = $derived.by(() => {
    if (!prEvent) return undefined
    return deriveEventsAsc(deriveEventsById({repository, filters: [getPrStatusFilter()]}))
  })

  const prStatusEventsArray = $derived.by(() => {
    if (!prStatusEvents) return []
    return $prStatusEvents as StatusEvent[]
  })

  const prStatus = $derived.by(() => {
    if (!prEvent) return undefined
    const latest = resolveStatus({
      statuses: prStatusEventsArray as any,
      rootAuthor: prEvent.pubkey,
      maintainers: repoMaintainerPubkeys,
      repoOwner: repoOwnerPubkey,
      importedRoot: isImportedPr,
    }).final
    return latest ? parseStatusEvent(latest as StatusEvent) : undefined
  })

  const getPrCoverLetterFilter = () => ({
    kinds: [GIT_COVER_LETTER_KIND],
    "#e": [prEvent?.id ?? ""],
  })

  const prCoverLetterEvents = $derived.by(() => {
    if (!prEvent) return undefined
    return deriveEventsAsc(deriveEventsById({repository, filters: [getPrCoverLetterFilter()]}))
  })

  const prCoverLetterEventsArray = $derived.by(() => {
    if (!prCoverLetterEvents) return []
    return ($prCoverLetterEvents as CoverLetterEvent[]) || []
  })

  const prDescriptionEvent = $derived.by(() => {
    if (!prEvent) return undefined

    const authoritative = new Set<string>([prEvent.pubkey, ...Array.from(repoMaintainerPubkeys)])
    const coverLetters = [...prCoverLetterEventsArray]
      .filter(
        event =>
          event.kind === GIT_COVER_LETTER_KIND &&
          authoritative.has(event.pubkey) &&
          (event.tags || []).some(tag => tag[0] === "e" && tag[1] === prEvent.id),
      )
      .sort((a, b) => {
        const byTime = (a.created_at || 0) - (b.created_at || 0)
        if (byTime !== 0) return byTime
        return (a.id || "").localeCompare(b.id || "")
      })

    return coverLetters[coverLetters.length - 1] || prEvent
  })

  const prDescription = $derived.by(() => {
    if (!prEvent) return pr?.content || ""

    return prDescriptionEvent?.kind === GIT_COVER_LETTER_KIND
      ? prDescriptionEvent.content || ""
      : pr?.content || ""
  })

  let prCommentParentIds = $state<string[]>([])

  const prThreadCommentFilters = $derived.by(() => {
    if (!prEvent) return []
    const filters: Filter[] = [
      {kinds: [COMMENT], "#E": [prEvent.id]},
      {kinds: [COMMENT], "#e": [prEvent.id]},
    ]
    if (prCommentParentIds.length > 0) {
      filters.push({kinds: [COMMENT], "#e": prCommentParentIds})
    }
    return filters
  })

  const prThreadComments = $derived.by(() => {
    if (!prEvent) return undefined
    const filters = prThreadCommentFilters
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    load({relays: relays as string[], filters})
    return deriveEventsAsc(deriveEventsById({repository, filters}))
  })

  const prThreadCommentsArray = $derived.by(() => {
    if (!prThreadComments) return []
    return filterVisibleAfterDeletesAndEdits(
      ($prThreadComments || []) as CommentEvent[],
      $editedTargetIds,
    ).filter(comment => !hiddenRepoEventIds.has(comment.id))
  })
  const prThreadCommentsCount = $derived.by(() => prThreadCommentsArray.length)

  let prCommentProfileLoadKey = ""
  $effect(() => {
    const pubkeys = Array.from(
      new Set(prThreadCommentsArray.map(comment => comment.pubkey)),
    ).filter(Boolean)
    const key = `${profileRelays.join(",")}:${pubkeys.join(",")}`
    if (pubkeys.length === 0 || key === prCommentProfileLoadKey) return

    prCommentProfileLoadKey = key
    for (const commentPubkey of pubkeys) {
      if ($profilesByPubkey.get(commentPubkey)) continue
      loadBudabitProfile(commentPubkey, {communityRelays: profileRelays}).catch(() => undefined)
    }
  })

  let prCommentParentIdsKey = ""
  $effect(() => {
    const nextIds = Array.from(
      new Set(prThreadCommentsArray.map(comment => comment.id).filter(Boolean)),
    ).sort()
    const nextKey = nextIds.join(",")
    if (nextKey === prCommentParentIdsKey) return
    prCommentParentIdsKey = nextKey
    prCommentParentIds = nextIds
  })

  const prUpdatesFilter = $derived.by(() =>
    prEvent ? ([{kinds: [GIT_PULL_REQUEST_UPDATE], "#E": [prEvent.id]}] as Filter[]) : [],
  )

  const prUpdatesDerived = $derived.by(() => {
    if (!prEvent || prUpdatesFilter.length === 0) return undefined
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    load({relays: relays as string[], filters: prUpdatesFilter})
    return deriveEventsAsc(deriveEventsById({repository, filters: prUpdatesFilter}))
  })

  const prUpdatesArray = $derived.by(() => {
    if (!prUpdatesDerived) return []
    const events = $prUpdatesDerived as TrustedEvent[]
    return (events || [])
      .sort((a: TrustedEvent, b: TrustedEvent) => {
        if (a.created_at !== b.created_at) return a.created_at - b.created_at
        return a.id.localeCompare(b.id)
      })
      .map((e: TrustedEvent) => parsePullRequestUpdateEvent(e as any))
  })

  let lastPrStatusLoadKey: string | null = null
  let lastPrCoverLetterLoadKey: string | null = null

  $effect(() => {
    if (!prEvent) return

    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    if (relays.length === 0) return

    const updatesCount = prUpdatesArray.length
    const key = `${prEvent.id}|${relays.slice().sort().join(",")}|${updatesCount}`
    if (lastPrStatusLoadKey === key) return
    lastPrStatusLoadKey = key

    void load({
      relays: relays as string[],
      filters: [getPrStatusFilter()],
    }).catch(() => {})
  })

  $effect(() => {
    if (!prEvent) return

    const relays = strictPrEditRelays
    if (relays.length === 0) return

    const key = `${prEvent.id}|${relays.slice().sort().join(",")}`
    if (lastPrCoverLetterLoadKey === key) return
    lastPrCoverLetterLoadKey = key

    void load({
      relays: relays as string[],
      filters: [getPrCoverLetterFilter()],
    }).catch(() => {})
  })

  const prEffectiveTipOid = $derived.by(() => {
    if (!pr) return ""
    const updates = prUpdatesArray
    if (updates.length > 0) {
      return updates[updates.length - 1].tipCommitOid || ""
    }
    return pr.tipCommitOid || ""
  })

  const prEffectiveTipIssue = $derived.by(() => {
    if (!pr) return null
    const updates = prUpdatesArray
    const source = updates.length > 0 ? updates[updates.length - 1] : pr
    if (!source.tipError) return null
    return {
      type: source.tipError,
      candidates: source.tipCandidates || [],
      isFromUpdate: updates.length > 0,
    }
  })

  /** Clone URLs for PR source (fork); from latest update if present, else original PR event */
  const prEffectiveCloneUrls = $derived.by(() => {
    const updates = prUpdatesArray
    if (updates.length > 0) {
      const latest = updates[updates.length - 1]
      const urls = getCloneUrlsFromEvent(latest.raw)
      if (urls.length > 0) return urls
    }
    return getCloneUrlsFromEvent(pr?.raw ?? {tags: []})
  })

  /** Target branch from PR event, fallback to repo selection */
  const prTargetBranch = $derived(
    normalizeBranchName(
      pr?.branchName ?? repoClass?.selectedBranch ?? repoClass?.mainBranch ?? "main",
    ) || "main",
  )

  const prTargetCloneUrls = $derived.by(() =>
    filterValidCloneUrls(
      (((repoClass as any).cloneUrls || []) as string[]).map(url => String(url || "").trim()),
    ),
  )

  const prFetchCloneUrls = $derived.by(() =>
    Array.from(new Set([...prEffectiveCloneUrls, ...prTargetCloneUrls])),
  )

  const primaryTargetCloneUrl = $derived.by(() => {
    return prTargetCloneUrls[0] || ""
  })

  const canPublishPrUpdates = $derived.by(() => {
    if (!prEvent || !$pubkey || $pubkey !== prEvent.pubkey) return false
    return prStatus?.status !== "applied" && prStatus?.status !== "closed"
  })

  const prUpdateBlockedReason = $derived.by(() => {
    if (!prEvent || !$pubkey || $pubkey !== prEvent.pubkey) return null
    if (prStatus?.status === "applied") return "PR is already merged"
    if (prStatus?.status === "closed") return "PR is closed"
    return null
  })

  let prMergeAnalysisResult: PRMergeAnalysisResult | null = $state(null)
  let isAnalyzingPRMerge = $state(false)
  let prAnalysisProgress = $state("")
  let prAnalysisWarning = $state<string | null>(null)
  let prAnalysisGeneration = $state(0)
  let lastPrAnalysisKey: string | null = null

  const prAnalysisErrorMessage = $derived.by(() =>
    prMergeAnalysisResult?.analysis === "error" ? prMergeAnalysisResult.errorMessage || null : null,
  )

  const prAnalysisTimedOut = $derived.by(() => {
    const message = prAnalysisErrorMessage || ""
    return /timed out|timeout/.test(message.toLowerCase())
  })

  let prChanges = $state<PrChange[] | null>(null)
  let prChangesLoading = $state(false)
  let prChangesError = $state<string | null>(null)
  let prChangesProgress = $state("")
  let prChangesGeneration = $state(0)
  let lastPrChangesLoadKey: string | null = null
  let prDiffBaseOid = $state<string | null>(null)
  let prDiffHeadOid = $state<string | null>(null)
  let prExpandedFiles = $state<Set<string>>(new Set())
  let prDiffAnchors = $state<Record<string, string>>({})
  let prReviewTab = $state("commits")
  let prExpandedCommits = $state<Set<string>>(new Set())
  let prCommitDiffByOid = $state<Record<string, PrCommitDiffState>>({})
  let prInlineTargetStatus = $state<{
    state: "loading" | "error"
    message: string
    detail?: string
  } | null>(null)
  let prInlineTargetGeneration = $state(0)
  let dismissedPrInlineTargetHash = $state("")
  let prInlineScrollTarget = $state<{
    mode: "files" | "commit"
    commitId?: string
    filePath: string
    id: string | null
    line?: number | null
    side?: "del"
    request: number
  } | null>(null)
  let suppressNextPrDiffHashOpen = false

  const prReviewHasExpandedItem = $derived.by(() =>
    prReviewTab === "commits" ? prExpandedCommits.size > 0 : prExpandedFiles.size > 0,
  )

  const prCommitOids = $derived.by(() => {
    const fromAnalysis = (prMergeAnalysisResult?.prCommits || []).map(commit => commit.oid)
    if (fromAnalysis.length > 0) return fromAnalysis
    return prStatus?.appliedCommits || []
  })

  const prCommitMetaByOid = $derived.by(() => {
    const commits = prMergeAnalysisResult?.prCommits || []
    return new Map(commits.map(c => [c.oid, c]))
  })

  const getPrCommitState = (oid: string): PrCommitDiffState =>
    prCommitDiffByOid[oid] || {
      loading: false,
    }

  const getPrCommitTitle = (oid: string) => {
    const stateTitle = getPrCommitState(oid).meta?.message?.split("\n")[0]?.trim()
    const analysisTitle = prCommitMetaByOid.get(oid)?.message?.split("\n")[0]?.trim()
    const title = stateTitle || analysisTitle
    return title || "Commit message unavailable"
  }

  const getPrCommitAuthor = (oid: string) => {
    const stateAuthor = getPrCommitState(oid).meta?.author
    const analysisAuthor = prCommitMetaByOid.get(oid)?.author?.name
    return stateAuthor || analysisAuthor || "Unknown author"
  }

  async function loadPrCommitDiff(oid: string, force = false) {
    if (!repoClass?.workerManager || !repoClass?.key) return
    const current = prCommitDiffByOid[oid]
    if (!force && (current?.loading || current?.changes || current?.error || current?.warning))
      return

    prCommitDiffByOid = {
      ...prCommitDiffByOid,
      [oid]: {
        loading: true,
      },
    }

    try {
      const result = await repoClass.workerManager.getCommitDetails({
        repoId: repoClass.key,
        commitId: oid,
        ...(prFetchCloneUrls.length > 0 ? {cloneUrls: prFetchCloneUrls} : {}),
      })

      if (!result?.success || !result?.meta) {
        prCommitDiffByOid = {
          ...prCommitDiffByOid,
          [oid]: {
            loading: false,
            error: result?.error || "Failed to load commit diff",
          },
        }
        return
      }

      const changes = (result.changes || []) as PrChange[]
      const diffUnavailable = result.diffAvailable === false
      const warning =
        typeof result.warning === "string"
          ? result.warning
          : diffUnavailable
            ? "Commit metadata loaded, but file diff is unavailable from the current remotes."
            : undefined
      prCommitDiffByOid = {
        ...prCommitDiffByOid,
        [oid]: {
          loading: false,
          warning,
          meta: {
            sha: result.meta.sha || oid,
            author: result.meta.author || "Unknown author",
            date: Number(result.meta.date) || 0,
            message: result.meta.message || "",
            parents: Array.isArray(result.meta.parents) ? result.meta.parents : [],
          },
          changes,
        },
      }
    } catch (error) {
      prCommitDiffByOid = {
        ...prCommitDiffByOid,
        [oid]: {
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load commit diff",
        },
      }
    }
  }

  const togglePrCommit = async (oid: string) => {
    const next = new Set(prExpandedCommits)
    if (next.has(oid)) {
      next.delete(oid)
      prExpandedCommits = next
      return
    }
    next.add(oid)
    prExpandedCommits = next
    await loadPrCommitDiff(oid)
  }

  const expandAllPrCommits = async () => {
    const commits = prCommitOids
    if (!commits.length) return
    prExpandedCommits = new Set(commits)
    await Promise.all(commits.map((oid: string) => loadPrCommitDiff(oid)))
  }

  async function ensurePrCommitDiffReady(oid: string) {
    if (!prExpandedCommits.has(oid)) {
      prExpandedCommits = new Set([...prExpandedCommits, oid])
    }
    void loadPrCommitDiff(oid)
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const state = prCommitDiffByOid[oid]
      if (state && !state.loading) return !state.error
      await waitMs(100)
    }
    return false
  }

  const inferRemoteProvider = (url: string) => {
    if (isGraspRepoHttpUrl(url)) return "grasp"

    try {
      const host = new URL(url).hostname.toLowerCase()
      if (host.includes("github")) return "github"
      if (host.includes("gitlab")) return "gitlab"
      return "git"
    } catch {
      return "git"
    }
  }

  const isGraspRemote = (url: string, provider?: string) =>
    provider === "grasp" || provider === "grasp-rest" || isGraspRepoHttpUrl(url)

  const formatMergeAnalysisError = (message: string) => {
    const raw = (message || "Unknown merge analysis error").trim()
    const lower = raw.toLowerCase()
    const withDetails = (friendly: string) =>
      friendly === raw ? friendly : `${friendly} Details: ${raw}`

    if (!raw || raw === "error" || raw === "unknown" || raw === "unknown error") {
      return "Merge analysis failed without a usable error message. Retry sync + analyze."
    }
    if (/timed out|timeout/.test(lower)) {
      return withDetails(
        "Merge analysis timed out while fetching remote data. Retry sync + analyze. If it keeps timing out, reload this page and try again.",
      )
    }
    if (lower.includes("no valid clone urls")) {
      return withDetails(
        "PR source has no valid clone URL configured. Add a valid clone URL and re-run analysis.",
      )
    }
    if (lower.includes("target branch") && lower.includes("not found")) {
      return withDetails(
        `Target branch ${prTargetBranch} was not found on fetched remotes. Sync and verify branch name.`,
      )
    }
    if (lower.includes("source branch") && lower.includes("not found")) {
      return withDetails(
        "Source branch for this PR was not found on remote. Ensure the source branch is pushed.",
      )
    }
    if (/401|403|unauthorized|forbidden|auth|permission/.test(lower)) {
      return withDetails(
        "Authentication/permission failure while fetching PR refs. Check remote access and tokens.",
      )
    }
    if (/failed to fetch|network|cors|timeout|econn|enotfound/.test(lower)) {
      return withDetails(
        "Network/CORS error while fetching PR refs. Check connectivity or CORS policy and retry.",
      )
    }
    return raw
  }

  const formatSyncError = (message: string) => {
    const raw = (message || "Target sync failed").trim()
    const lower = raw.toLowerCase()
    const withDetails = (friendly: string) =>
      friendly === raw ? friendly : `${friendly} Details: ${raw}`

    if (
      /missing tracking ref|cannot prove remote sync|remote fetch completed but no remote commit/.test(
        lower,
      )
    ) {
      return withDetails(
        `Target branch ${prTargetBranch} could not be verified against remote refs. Retry sync and check remote credentials/access.`,
      )
    }
    if (/cors|network|failed to fetch|timeout|econn|enotfound/.test(lower)) {
      return withDetails(
        "Target sync failed due to network/CORS issues. Retry sync + analyze after network or CORS recovery.",
      )
    }
    if (/401|403|unauthorized|forbidden|auth|permission/.test(lower)) {
      return withDetails(
        "Target sync failed due to authentication/permission issues. Check tokens/credentials and retry.",
      )
    }
    return withDetails(`Target sync failed for branch ${prTargetBranch}.`)
  }

  const toAnalysisErrorResult = (
    errorMessage: string,
    patchCommits: string[],
  ): PRMergeAnalysisResult => ({
    canMerge: false,
    hasConflicts: false,
    conflictFiles: [],
    conflictDetails: [],
    upToDate: false,
    fastForward: false,
    patchCommits,
    analysis: "error",
    errorMessage,
  })

  const isRepoNotClonedMessage = (message?: string) => {
    const value = String(message || "").toLowerCase()
    return value.includes("not cloned") || value.includes("clone first")
  }

  const getErrorText = (error: unknown) => {
    if (error instanceof Error) {
      const cause = (error as any)?.cause
      const causeMsg =
        cause instanceof Error
          ? cause.message
          : typeof cause === "string"
            ? cause
            : cause && typeof cause === "object" && "message" in cause
              ? String((cause as any).message)
              : ""
      return [error.message, causeMsg].filter(Boolean).join(" | ")
    }
    return String(error || "")
  }

  const setPrPhaseProgress = (phase: "analysis" | "merge", message: string) => {
    if (phase === "analysis") {
      prAnalysisProgress = message
      return
    }
    mergePrStep = message
  }

  const startCloneProgressMirror = (phase: "analysis" | "merge") => {
    const update = () => {
      const progressState = (repoClass as any)?.cloneProgress
      const progressValue =
        typeof progressState?.progress === "number"
          ? ` ${Math.max(0, Math.min(100, Math.round(progressState.progress)))}%`
          : ""
      const detail = progressState?.phase ? `: ${progressState.phase}` : ""
      setPrPhaseProgress(phase, `Cloning repository${progressValue}${detail}`)
    }
    update()
    return setInterval(update, 250)
  }

  const ensureRepoClonedForPR = async (
    phase: "analysis" | "merge",
    repoId: string,
    cloneUrls: string[],
  ): Promise<{ok: boolean; error?: string}> => {
    setPrPhaseProgress(phase, "Repository not cloned locally, cloning now...")
    const progressTimer = startCloneProgressMirror(phase)
    try {
      const initResult = await repoClass.workerManager.smartInitializeRepo({
        repoId,
        cloneUrls,
        branch: prTargetBranch,
        timeoutMs: 90000,
      })
      if (!initResult?.success) {
        return {
          ok: false,
          error:
            initResult?.error || "Repository clone failed while preparing merge analysis/merge",
        }
      }
      return {ok: true}
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Repository clone failed: ${error.message}`
            : "Repository clone failed",
      }
    } finally {
      clearInterval(progressTimer)
    }
  }

  const forceRefreshTargetBranchForPR = async (
    phase: "analysis" | "merge",
    repoId: string,
    cloneUrls: string[],
  ): Promise<{ok: boolean; error?: string}> => {
    setPrPhaseProgress(phase, `Refreshing ${prTargetBranch} from remote...`)
    const progressTimer = startCloneProgressMirror(phase)
    try {
      const refreshResult = await repoClass.workerManager.smartInitializeRepo({
        repoId,
        cloneUrls,
        branch: prTargetBranch,
        forceUpdate: true,
        timeoutMs: 90000,
      })
      if (!refreshResult?.success) {
        return {
          ok: false,
          error: refreshResult?.error || `Failed to refresh target branch ${prTargetBranch}`,
        }
      }
      return {ok: true}
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Failed to refresh target branch ${prTargetBranch}: ${error.message}`
            : `Failed to refresh target branch ${prTargetBranch}`,
      }
    } finally {
      clearInterval(progressTimer)
    }
  }

  const finalizeTargetSync = async (
    phase: "analysis" | "merge",
    syncResult: any,
    targetCloneUrls: string[],
    allowRefresh = true,
  ): Promise<PrSyncResult> => {
    const verifyTargetSync = async () =>
      await (repoClass.workerManager as any).syncWithRemote({
        repoId: repoClass.key,
        cloneUrls: targetCloneUrls,
        branch: prTargetBranch,
        requireRemoteSync: true,
        requireTrackingRef: true,
        preferredUrl: primaryTargetCloneUrl || undefined,
      })

    if (
      allowRefresh &&
      (!syncResult?.success || syncResult?.needsUpdate === true || syncResult?.synced !== true)
    ) {
      const refreshResult = await forceRefreshTargetBranchForPR(
        phase,
        repoClass.key,
        targetCloneUrls,
      )
      if (!refreshResult.ok) {
        return {
          ok: false,
          error:
            syncResult?.error ||
            syncResult?.warning ||
            refreshResult.error ||
            `Failed to sync target branch ${prTargetBranch} before ${phase}`,
        }
      }

      setPrPhaseProgress(phase, `Refresh complete, verifying ${prTargetBranch}...`)
      try {
        syncResult = await verifyTargetSync()
      } catch (error) {
        return {
          ok: false,
          error: getErrorText(error) || `Failed to sync target branch ${prTargetBranch}`,
        }
      }
    }

    if (!syncResult?.success) {
      return {
        ok: false,
        error:
          syncResult?.error || `Failed to sync target branch ${prTargetBranch} before ${phase}`,
      }
    }

    if (syncResult.branch && syncResult.branch !== prTargetBranch) {
      return {
        ok: false,
        error: `Synced branch ${syncResult.branch}, but PR target is ${prTargetBranch}`,
      }
    }

    if (syncResult?.needsUpdate === true) {
      return {
        ok: false,
        error: `Target branch ${prTargetBranch} is still behind remote after sync`,
      }
    }

    if (syncResult?.synced !== true) {
      return {
        ok: false,
        error:
          syncResult?.error ||
          syncResult?.warning ||
          `Target branch ${prTargetBranch} could not be synced with remote refs`,
      }
    }

    const warning =
      syncResult.warning || syncResult.synced === false
        ? syncResult.warning || `Sync finished with local data only before ${phase}`
        : null
    return {ok: true, warning, usedUrl: syncResult.usedUrl}
  }

  async function syncTargetBranchForPR(phase: "analysis" | "merge"): Promise<PrSyncResult> {
    if (!repoClass.key || !repoClass.workerManager) {
      return {ok: false, error: "Repository worker is not ready"}
    }

    const targetCloneUrls = prTargetCloneUrls
    if (targetCloneUrls.length === 0) {
      return {ok: false, error: "Repository has no clone URLs to sync target branch"}
    }

    const verifyTargetSync = async () =>
      await (repoClass.workerManager as any).syncWithRemote({
        repoId: repoClass.key,
        cloneUrls: targetCloneUrls,
        branch: prTargetBranch,
        requireRemoteSync: true,
        requireTrackingRef: true,
        preferredUrl: primaryTargetCloneUrl || undefined,
      })

    try {
      const cloned = await repoClass.workerManager
        .isRepoCloned({repoId: repoClass.key})
        .catch(() => null)
      if (cloned === false) {
        const cloneResult = await ensureRepoClonedForPR(phase, repoClass.key, targetCloneUrls)
        if (!cloneResult.ok) return cloneResult
      }

      let syncResult: any
      try {
        syncResult = await verifyTargetSync()
      } catch (error) {
        const syncError = getErrorText(error)
        if (!isRepoNotClonedMessage(syncError)) {
          const refreshResult = await forceRefreshTargetBranchForPR(
            phase,
            repoClass.key,
            targetCloneUrls,
          )
          if (!refreshResult.ok) {
            return {ok: false, error: syncError || refreshResult.error}
          }

          setPrPhaseProgress(phase, `Refresh complete, verifying ${prTargetBranch}...`)
          try {
            syncResult = await verifyTargetSync()
          } catch (retryError) {
            return {
              ok: false,
              error: getErrorText(retryError) || `Failed to sync target branch ${prTargetBranch}`,
            }
          }

          return finalizeTargetSync(phase, syncResult, targetCloneUrls, false)
        }

        const cloneResult = await ensureRepoClonedForPR(phase, repoClass.key, targetCloneUrls)
        if (!cloneResult.ok) return cloneResult

        setPrPhaseProgress(phase, "Repository clone complete, syncing target branch...")
        try {
          syncResult = await verifyTargetSync()
        } catch (retryError) {
          return {
            ok: false,
            error: getErrorText(retryError) || `Failed to sync target branch ${prTargetBranch}`,
          }
        }
      }

      return finalizeTargetSync(phase, syncResult, targetCloneUrls)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `Failed to sync before ${phase}`,
      }
    }
  }

  async function validatePRTargetBranchForAnalysis(): Promise<PrSyncResult> {
    const targetBranch = normalizeBranchName(prTargetBranch)
    if (!targetBranch) {
      return {ok: false, error: "PR target branch is missing"}
    }

    try {
      const refs =
        typeof (repoClass as any)?.loadRefsForPRAnalysis === "function"
          ? await (repoClass as any).loadRefsForPRAnalysis()
          : (repoClass as any)?.refs || []
      const heads = Array.from(
        new Set<string>(
          (refs || [])
            .filter((ref: any) => ref?.type === "heads")
            .map((ref: any) => normalizeBranchName(ref?.name))
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b))

      if (heads.length === 0) {
        return {
          ok: false,
          error: `Could not verify target branch ${targetBranch}; repository branches have not loaded yet.`,
        }
      }

      if (!heads.includes(targetBranch)) {
        const visibleBranches = heads.slice(0, 12).join(", ")
        const moreBranches = heads.length > 12 ? `, and ${heads.length - 12} more` : ""
        return {
          ok: false,
          error: `Target branch "${targetBranch}" is not advertised by this repository. Available branches: ${visibleBranches}${moreBranches}.`,
        }
      }

      return {ok: true}
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Could not load repository branches before merge analysis: ${error.message}`
            : "Could not load repository branches before merge analysis",
      }
    }
  }

  async function runPRMergeAnalysis() {
    if (!pr || !prEvent || !prEffectiveTipOid || !repoClass.key || !repoClass.workerManager) return
    const tipOid = prEffectiveTipOid
    const prCloneUrls = prEffectiveCloneUrls
    const cloneUrls = prCloneUrls.length > 0 ? prCloneUrls : (repoClass as any).cloneUrls || []
    if (cloneUrls.length === 0) return

    const analysisKey = `${prEvent.id}-${tipOid}-${prTargetBranch}`

    prAnalysisGeneration++
    const myGen = prAnalysisGeneration
    lastPrAnalysisKey = analysisKey
    isAnalyzingPRMerge = true
    prAnalysisProgress = "Loading target branches..."
    prAnalysisWarning = null
    prMergeAnalysisResult = null

    try {
      const targetBranchCheck = await validatePRTargetBranchForAnalysis()
      if (prAnalysisGeneration !== myGen) return
      if (!targetBranchCheck.ok) {
        prMergeAnalysisResult = toAnalysisErrorResult(
          `Cannot run merge analysis until target branch is available: ${
            targetBranchCheck.error || `Target branch ${prTargetBranch} could not be verified`
          }`,
          [],
        )
        return
      }

      prAnalysisProgress = "Syncing target branch..."
      const sync = await syncTargetBranchForPR("analysis")
      if (prAnalysisGeneration !== myGen) return
      if (!sync.ok) {
        const syncError = formatSyncError(
          sync.error || `Failed to sync target branch ${prTargetBranch}`,
        )
        prMergeAnalysisResult = toAnalysisErrorResult(
          `Cannot run merge analysis until target branch is synced: ${syncError}`,
          [tipOid],
        )
        return
      }
      if (sync.warning) prAnalysisWarning = sync.warning

      prAnalysisProgress = "Fetching PR from clone URL..."
      const result = await repoClass.getPRMergeAnalysis(cloneUrls, tipOid, prTargetBranch)
      if (prAnalysisGeneration === myGen) {
        if (!result) {
          prMergeAnalysisResult = toAnalysisErrorResult(
            "Merge analysis returned no result. Retry sync + analyze.",
            [tipOid],
          )
          return
        }

        if (result.analysis === "error") {
          prMergeAnalysisResult = {
            ...result,
            errorMessage: formatMergeAnalysisError(result.errorMessage || "Merge analysis failed"),
          }
          return
        }

        prMergeAnalysisResult = result
      }
    } catch (err) {
      if (prAnalysisGeneration === myGen) {
        prMergeAnalysisResult = toAnalysisErrorResult(
          formatMergeAnalysisError(err instanceof Error ? err.message : String(err)),
          [tipOid],
        )
      }
    } finally {
      if (prAnalysisGeneration === myGen) {
        isAnalyzingPRMerge = false
        prAnalysisProgress = ""
      }
    }
  }

  $effect(() => {
    if (!pr || !prEvent || !prEffectiveTipOid || !repoClass.key || !repoClass.workerManager) return
    const tipOid = prEffectiveTipOid
    const analysisKey = `${prEvent.id}-${tipOid}-${prTargetBranch}`

    if (lastPrAnalysisKey && lastPrAnalysisKey !== analysisKey) {
      prChanges = null
      prChangesError = null
      prDiffBaseOid = null
      prDiffHeadOid = null
      lastPrChangesLoadKey = null
    }
    if (lastPrAnalysisKey === analysisKey || isAnalyzingPRMerge) return
    runPRMergeAnalysis()
  })

  const resolvePrDiffRange = async () => {
    const tipOid = prEffectiveTipOid
    if (!repoClass.key || !repoClass.workerManager || !tipOid) return null

    if (prStatus?.status === "applied" && prStatus.mergedCommit) {
      prChangesProgress = "Loading merged commit..."
      const mergeDetails = await repoClass.workerManager.getCommitDetails({
        repoId: repoClass.key,
        commitId: prStatus.mergedCommit,
        ...(prFetchCloneUrls.length > 0 ? {cloneUrls: prFetchCloneUrls} : {}),
      })
      const parentOid = mergeDetails?.meta?.parents?.[0]
      if (mergeDetails?.success && parentOid) {
        return {baseOid: parentOid, headOid: prStatus.mergedCommit}
      }
    }

    const mergeBase = prMergeAnalysisResult?.mergeBase
    if (mergeBase) {
      return {baseOid: mergeBase, headOid: tipOid}
    }

    if (prStatus?.appliedCommits && prStatus.appliedCommits.length > 0) {
      const headOid = prStatus.appliedCommits[0]
      const oldestOid = prStatus.appliedCommits[prStatus.appliedCommits.length - 1]
      prChangesProgress = "Loading merged commit range..."
      const oldestDetails = await repoClass.workerManager.getCommitDetails({
        repoId: repoClass.key,
        commitId: oldestOid,
        ...(prFetchCloneUrls.length > 0 ? {cloneUrls: prFetchCloneUrls} : {}),
      })
      const parentOid = oldestDetails?.meta?.parents?.[0]
      if (oldestDetails?.success && parentOid) {
        return {baseOid: parentOid, headOid}
      }
    }

    return null
  }

  async function loadPrChanges() {
    if (!repoClass.key || !repoClass.workerManager || !prEffectiveTipOid) return

    prChangesGeneration++
    const currentGen = prChangesGeneration
    prChangesLoading = true
    prChangesError = null
    prChangesProgress = "Resolving diff range..."
    prChanges = null
    prDiffBaseOid = null
    prDiffHeadOid = null

    try {
      const range = await resolvePrDiffRange()
      if (prChangesGeneration !== currentGen) return
      if (!range) {
        prChanges = []
        prChangesError =
          prStatus?.status === "applied"
            ? "Unable to resolve a merged diff range for this PR yet. Re-run Analyze or retry loading files."
            : "Merge analysis is incomplete. Re-run Analyze to load file changes."
        return
      }

      prDiffBaseOid = range.baseOid
      prDiffHeadOid = range.headOid
      prChangesProgress = "Loading file diffs..."

      const res = await (repoClass.workerManager as any).getDiffBetween({
        repoId: repoClass.key,
        baseOid: range.baseOid,
        headOid: range.headOid,
        ...(prFetchCloneUrls.length > 0 ? {cloneUrls: prFetchCloneUrls} : {}),
      })

      if (prChangesGeneration !== currentGen) return
      if (res.success && res.changes) {
        prChanges = res.changes
        prChangesError = null
      } else {
        prChanges = []
        prChangesError = res.error || "Failed to load diff"
      }
    } catch (err) {
      if (prChangesGeneration !== currentGen) return
      prChanges = []
      prChangesError = err instanceof Error ? err.message : "Failed to load diff"
    } finally {
      if (prChangesGeneration === currentGen) {
        prChangesLoading = false
        prChangesProgress = ""
      }
    }
  }

  async function ensurePrChangesReady() {
    if (!prChanges && !prChangesLoading) {
      await loadPrChanges()
    }
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (!prChangesLoading && prChanges !== null) return !prChangesError
      await waitMs(100)
    }
    return false
  }

  async function waitForPrDiffAnchors() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (Object.keys(prDiffAnchors).length > 0) return true
      await waitMs(50)
    }
    return Object.keys(prDiffAnchors).length > 0
  }

  $effect(() => {
    if (!prEffectiveTipOid || !repoClass.key || !repoClass.workerManager) return
    if (!prMergeAnalysisResult && prStatus?.status !== "applied") return

    const changesKey = [
      prEvent?.id || "",
      prEffectiveTipOid,
      prStatus?.status || "",
      prStatus?.mergedCommit || "",
      (prStatus?.appliedCommits || []).join(","),
      prMergeAnalysisResult?.mergeBase || "",
      prMergeAnalysisResult?.analysis || "",
    ].join("|")

    if (lastPrChangesLoadKey === changesKey) return
    lastPrChangesLoadKey = changesKey

    loadPrChanges()
  })

  const getPrFileStatusIcon = (status: string) => {
    switch (status) {
      case "added":
        return {icon: FilePlus, class: "text-emerald-700 dark:text-emerald-300"}
      case "deleted":
        return {icon: FileMinus, class: "text-rose-700 dark:text-rose-300"}
      case "modified":
        return {icon: FileCode, class: "text-sky-700 dark:text-sky-300"}
      case "renamed":
        return {icon: FileX, class: "text-amber-700 dark:text-amber-300"}
      default:
        return {icon: FileText, class: "text-muted-foreground"}
    }
  }

  const getPrFileStats = (hunks: PrChange["diffHunks"]) => {
    let additions = 0
    let deletions = 0
    for (const hunk of hunks) {
      for (const patch of hunk.patches) {
        if (patch.type === "+") additions++
        else if (patch.type === "-") deletions++
      }
    }
    return {additions, deletions}
  }

  const PR_COMMIT_DIFF_CONTEXT_LINES = 3

  const getCommentTagValue = (comment: CommentEvent, name: string) =>
    (comment.tags || []).find((tag: string[]) => tag[0] === name)?.[1] || ""

  const getCommentParentId = (comment: CommentEvent) =>
    (comment.tags || []).find((tag: string[]) => tag[0] === "e")?.[1] || ""

  const isResolveCommentEvent = (comment: CommentEvent) =>
    (comment.tags || []).some((tag: string[]) => tag[0] === "l" && tag[1] === "resolved")

  const getInlineCommentLine = (comment: CommentEvent) => {
    const lineTag = (comment.tags || []).find((tag: string[]) => tag[0] === "line")
    const raw = lineTag?.[1] || ""
    if (!raw)
      return {lineNumber: 0, lineStart: 0, lineEnd: 0, lineSide: undefined as "del" | undefined}
    const parts = raw.split("-")
    const firstLine = parseInt(parts[0] || "", 10)
    const lastLine = parseInt(parts[parts.length - 1] || parts[0], 10)
    const lineStart = Number.isFinite(firstLine)
      ? firstLine
      : Number.isFinite(lastLine)
        ? lastLine
        : 0
    const lineEnd = Number.isFinite(lastLine) ? lastLine : lineStart
    return {
      lineNumber: lineEnd,
      lineStart,
      lineEnd,
      lineSide: lineTag?.[2] === "del" ? ("del" as const) : undefined,
    }
  }

  const getInlineCommentLocation = (comment: CommentEvent) => {
    const filePath = getCommentTagValue(comment, "f")
    if (!filePath) return null
    const lineTag = (comment.tags || []).find((tag: string[]) => tag[0] === "line")
    const rawLine = lineTag?.[1] || ""
    const parts = rawLine.split("-")
    const start = Number.parseInt(parts[0] || "", 10)
    const end = Number.parseInt(parts[parts.length - 1] || "", 10)
    const targetLine = Number.isFinite(end) ? end : Number.isFinite(start) ? start : null
    return {
      filePath,
      targetLine,
      lineSide: lineTag?.[2] === "del" ? ("del" as const) : undefined,
    }
  }

  const getPrFilePathByDiffHash = (hash: string) => {
    for (const [filePath, value] of Object.entries(prDiffAnchors)) {
      if (value === hash) return filePath
    }
    return null
  }

  const setPrInlineScrollTarget = ({
    mode,
    commitId,
    filePath,
    id,
    line,
    side,
  }: {
    mode: "files" | "commit"
    commitId?: string
    filePath: string
    id: string | null
    line?: number | null
    side?: "del"
  }) => {
    prInlineScrollTarget = {
      mode,
      commitId,
      filePath,
      id,
      line,
      side,
      request: prInlineTargetGeneration,
    }
  }

  const nextFrame = () =>
    new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve())
    })

  const waitMs = (ms: number) =>
    new Promise<void>(resolve => {
      window.setTimeout(() => resolve(), ms)
    })

  const openPrDiffHashFromLocation = async () => {
    if (typeof window === "undefined") return false
    if (suppressNextPrDiffHashOpen) {
      suppressNextPrDiffHashOpen = false
      return false
    }
    const currentHash = window.location.hash || ""
    const match = currentHash.match(/^#diff-([a-f0-9]+)/i)
    if (!match) return false
    if (dismissedPrInlineTargetHash === currentHash) return false
    const generation = ++prInlineTargetGeneration
    prInlineTargetStatus = {
      state: "loading",
      message: "Opening inline comment target...",
      detail: "Loading changed files and expanding the matching file.",
    }
    const ready = await ensurePrChangesReady()
    if (generation !== prInlineTargetGeneration) return false
    if (!ready) {
      prInlineTargetStatus = {
        state: "error",
        message: "Could not load file diffs for this inline comment.",
        detail: prChangesError || "Try retrying the file diff load.",
      }
      return false
    }
    await waitForPrDiffAnchors()
    if (generation !== prInlineTargetGeneration) return false
    const filePath = getPrFilePathByDiffHash(match[1])
    if (!filePath) {
      prInlineTargetStatus = {
        state: "error",
        message: "Could not find the file for this inline comment.",
        detail: "The comment may point at an older diff that is not in the current PR view.",
      }
      return false
    }
    prReviewTab = "files"
    if (!prExpandedFiles.has(filePath)) {
      prExpandedFiles = new Set([...prExpandedFiles, filePath])
    }
    const anchor = currentHash.slice(1)
    const lineMatch = anchor.match(/^diff-[a-f0-9]+([LR])(\d+)/i)
    const targetLine = lineMatch ? Number.parseInt(lineMatch[2], 10) : null
    setPrInlineScrollTarget({
      mode: "files",
      filePath,
      id: anchor,
      line: Number.isFinite(targetLine) ? targetLine : null,
      side: lineMatch?.[1]?.toUpperCase() === "L" ? "del" : undefined,
    })
    await tick()
    await nextFrame()
    if (generation !== prInlineTargetGeneration) return false
    prInlineTargetStatus = null
    return true
  }

  $effect(() => {
    const anchors = prDiffAnchors
    if (Object.keys(anchors).length === 0) return
    untrack(() => void openPrDiffHashFromLocation())
  })

  $effect(() => {
    if (typeof window === "undefined") return
    if (!window.location.hash.match(/^#diff-[a-f0-9]+/i)) return
    if (dismissedPrInlineTargetHash === window.location.hash) return
    if (prInlineTargetStatus) return
    if (prChanges === null || prChangesLoading || Object.keys(prDiffAnchors).length === 0) {
      prInlineTargetStatus = {
        state: "loading",
        message: "Opening inline comment target...",
        detail: "Loading the PR diff before scrolling to the selected line.",
      }
    }
  })

  $effect(() => {
    if (typeof window === "undefined") return
    const handler = () => void openPrDiffHashFromLocation()
    window.addEventListener("hashchange", handler)
    return () => window.removeEventListener("hashchange", handler)
  })

  const openPrInlineCommentLocation = async (comment: CommentEvent) => {
    const location = getInlineCommentLocation(comment)
    if (!location) return
    dismissedPrInlineTargetHash = ""
    const generation = ++prInlineTargetGeneration
    const commitId = getCommentTagValue(comment, "c")
    const side = location.lineSide === "del" ? "L" : "R"
    const hash =
      prDiffAnchors[location.filePath] || (await githubPermalinkDiffId(location.filePath))
    const anchor = location.targetLine
      ? `diff-${hash}${side}${location.targetLine}`
      : `diff-${hash}`
    const setHash = () => {
      if (typeof window === "undefined") return
      const nextHash = `#${anchor}`
      if (window.location.hash !== nextHash) {
        suppressNextPrDiffHashOpen = true
        window.location.hash = anchor
      }
    }
    const fail = (message: string, detail?: string) => {
      if (generation !== prInlineTargetGeneration) return
      prInlineTargetStatus = {state: "error", message, detail}
    }

    prInlineTargetStatus = {
      state: "loading",
      message: "Opening inline comment...",
      detail:
        commitId && prCommitOids.includes(commitId)
          ? "Loading the commit diff and jumping to the commented line."
          : "Loading file diffs and jumping to the commented line.",
    }

    if (commitId && prCommitOids.includes(commitId)) {
      prReviewTab = "commits"
      const ready = await ensurePrCommitDiffReady(commitId)
      if (generation !== prInlineTargetGeneration) return
      if (ready) {
        await tick()
        await nextFrame()
        setHash()
        setPrInlineScrollTarget({
          mode: "commit",
          commitId,
          filePath: location.filePath,
          id: anchor,
          line: location.targetLine,
          side: location.lineSide,
        })
        if (generation !== prInlineTargetGeneration) return
        prInlineTargetStatus = null
        return
      }
    }

    prInlineTargetStatus = {
      state: "loading",
      message: "Opening inline comment in Files changed...",
      detail: "Loading the full PR diff and expanding the matching file.",
    }
    prReviewTab = "files"
    const ready = await ensurePrChangesReady()
    if (generation !== prInlineTargetGeneration) return
    if (!ready) {
      fail(
        "Could not load file diffs for this inline comment.",
        prChangesError || "Try retrying the file diff load.",
      )
      return
    }
    if (!prExpandedFiles.has(location.filePath)) {
      prExpandedFiles = new Set([...prExpandedFiles, location.filePath])
    }
    await waitForPrDiffAnchors()
    await tick()
    await nextFrame()
    setHash()
    setPrInlineScrollTarget({
      mode: "files",
      filePath: location.filePath,
      id: anchor,
      line: location.targetLine,
      side: location.lineSide,
    })
    if (generation !== prInlineTargetGeneration) return
    prInlineTargetStatus = null
  }

  const prDiffComments = $derived.by(() => {
    const comments = prThreadCommentsArray
    if (!comments || comments.length === 0) return []

    const inlineRoots = comments.filter(
      (commentEvent: CommentEvent) =>
        getCommentTagValue(commentEvent, "f") && getCommentTagValue(commentEvent, "line"),
    )
    const childrenByParent = new Map<string, CommentEvent[]>()
    for (const commentEvent of comments) {
      const parentId = getCommentParentId(commentEvent)
      if (!parentId) continue
      const children = childrenByParent.get(parentId) || []
      children.push(commentEvent)
      childrenByParent.set(parentId, children)
    }
    for (const children of childrenByParent.values()) {
      children.sort((a, b) => (a.created_at || 0) - (b.created_at || 0) || a.id.localeCompare(b.id))
    }

    const toDiffComment = (commentEvent: CommentEvent, rootInline: CommentEvent) => {
      const filePath = getCommentTagValue(rootInline, "f")
      const {lineNumber, lineStart, lineEnd, lineSide} = getInlineCommentLine(rootInline)
      const profile = $profilesByPubkey.get(commentEvent.pubkey)
      const authorName = profile?.name || profile?.display_name || commentEvent.pubkey.slice(0, 8)
      const authorAvatar = profile?.picture || ""
      return {
        id: commentEvent.id || "",
        lineNumber,
        lineStart,
        lineEnd,
        filePath,
        commitId: getCommentTagValue(rootInline, "c"),
        lineSide,
        content: commentEvent.content,
        rawEvent: commentEvent,
        parentId: getCommentParentId(commentEvent),
        rootInlineId: rootInline.id,
        isResolveEvent: isResolveCommentEvent(commentEvent),
        author: {name: authorName, avatar: authorAvatar},
        createdAt: new Date(commentEvent.created_at * 1000).toISOString(),
      }
    }

    const collectThread = (root: CommentEvent) => {
      const thread = [toDiffComment(root, root)]
      const visit = (parentId: string) => {
        for (const child of childrenByParent.get(parentId) || []) {
          if (child.id === root.id) continue
          thread.push(toDiffComment(child, root))
          visit(child.id)
        }
      }
      visit(root.id)
      return thread
    }

    return inlineRoots.flatMap(collectThread)
  })

  const prDiffCommentLinesByFile = $derived.by(() => {
    const linesByFile = new Map<string, number[]>()

    for (const comment of prDiffComments) {
      if (!comment.filePath || !comment.lineNumber || comment.isResolveEvent) continue

      const lines = linesByFile.get(comment.filePath) || []
      const start = comment.lineStart || comment.lineNumber
      const end = comment.lineEnd || comment.lineNumber
      for (let line = Math.min(start, end); line <= Math.max(start, end); line += 1) {
        if (!lines.includes(line)) lines.push(line)
      }
      linesByFile.set(comment.filePath, lines)
    }

    for (const lines of linesByFile.values()) {
      lines.sort((a, b) => a - b)
    }

    return linesByFile
  })

  const getPrCommitReviewDiff = (change: PrChange) =>
    prChangeToReviewParseDiffFile(change, {
      contextLines: PR_COMMIT_DIFF_CONTEXT_LINES,
      includeLines: prDiffCommentLinesByFile.get(change.path) || [],
    })

  const handlePrDiffCommentSubmit = (comment: any) => {
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    try {
      postComment(comment, relays)
    } catch (e) {
      toast.push({
        message: "Failed to start sending comment",
        timeout: 3000,
        variant: "destructive",
      })
    }
  }

  const requireLogin = () => pushModal(LogIn)

  /** PR event with commit/parent-commit tags for DiffViewer permalinks and comments */
  const prDiffRootEvent = $derived.by(() => {
    if (!prEvent) return undefined
    const tipOid = prDiffHeadOid || prEffectiveTipOid
    const mergeBase = prDiffBaseOid || prMergeAnalysisResult?.mergeBase
    const tags: string[][] = [
      ...(prEvent.tags || []).map(t => (Array.isArray(t) ? [...t] : [String(t)])),
    ]
    if (tipOid && !tags.some(t => t[0] === "commit")) {
      tags.push(["commit", tipOid])
    }
    if (mergeBase && !tags.some(t => t[0] === "parent-commit")) {
      tags.push(["parent-commit", mergeBase])
    }
    return {id: prEvent.id, pubkey: prEvent.pubkey, kind: prEvent.kind, tags}
  })

  const togglePrFile = (path: string) => {
    const next = new Set(prExpandedFiles)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    prExpandedFiles = next
  }

  const getPrCommitDiffRootEvent = (oid: string) => {
    if (!prEvent) return undefined
    const parentCommit = getPrCommitState(oid).meta?.parents?.[0]
    const tags: string[][] = [
      ...(prEvent.tags || []).map(t => (Array.isArray(t) ? [...t] : [String(t)])),
    ].filter(t => t[0] !== "commit" && t[0] !== "parent-commit")
    tags.push(["commit", oid])
    if (parentCommit) tags.push(["parent-commit", parentCommit])
    return {id: prEvent.id, pubkey: prEvent.pubkey, kind: prEvent.kind, tags}
  }

  $effect(() => {
    const changes = prChanges
    if (!changes || changes.length === 0) {
      prDiffAnchors = {}
      return
    }
    let cancelled = false
    const paths = changes.map(c => c.path)
    Promise.all(paths.map(async path => [path, await githubPermalinkDiffId(path)] as const))
      .then(entries => {
        if (!cancelled) prDiffAnchors = Object.fromEntries(entries)
      })
      .catch(() => {
        if (!cancelled) prDiffAnchors = {}
      })
    return () => {
      cancelled = true
    }
  })

  // Update PR form state
  let showUpdatePrForm = $state(false)
  let updatePrPreview = $state<{
    success: boolean
    error?: string
    commits: Array<{oid: string; message: string; author?: {name?: string}}>
    commitOids: string[]
    tipCommit?: string
    mergeBase?: string
  } | null>(null)
  let updatePrPreviewLoading = $state(false)
  let isPublishingPrUpdate = $state(false)
  let updatePrError = $state("")

  let updatePrSourceBranch = $state("")
  let updatePrTriedTipFirst = $state(false)

  $effect(() => {
    if (!canPublishPrUpdates && showUpdatePrForm) {
      showUpdatePrForm = false
      updatePrPreview = null
      updatePrSourceBranch = ""
      updatePrTriedTipFirst = false
    }
  })

  // Try tip-based preview first when form opens (no branch name needed)
  $effect(() => {
    if (!showUpdatePrForm || !repoClass?.workerManager || !prEffectiveTipOid) {
      if (!showUpdatePrForm) {
        updatePrPreview = null
        updatePrTriedTipFirst = false
      }
      return
    }
    if (updatePrSourceBranch.trim()) return
    const tipOid = prEffectiveTipOid
    let cancelled = false
    updatePrPreviewLoading = true
    updatePrPreview = null
    updatePrTriedTipFirst = true
    const targetCloneUrls = (repoClass as any)?.cloneUrls ?? []
    const sourceCloneUrls = prEffectiveCloneUrls.length > 0 ? prEffectiveCloneUrls : undefined
    repoClass.workerManager
      .getCommitsAheadOfTip({
        repoId: repoClass.key,
        tipOid,
        cloneUrls: targetCloneUrls,
        ...(sourceCloneUrls && {sourceCloneUrls}),
      })
      .then((result: typeof updatePrPreview) => {
        if (cancelled) return
        if (result && !result.success && result.error) {
          updatePrPreview = {
            ...result,
            error: formatMergeAnalysisError(result.error),
          }
        } else {
          updatePrPreview = result
        }
        updatePrPreviewLoading = false
      })
      .catch((err: unknown) => {
        if (cancelled) return
        updatePrPreview = {
          success: false,
          error: formatMergeAnalysisError(
            err instanceof Error ? err.message : String(err || "Failed to load PR update preview"),
          ),
          commits: [],
          commitOids: [],
          tipCommit: undefined,
        }
        updatePrPreviewLoading = false
      })
    return () => {
      cancelled = true
    }
  })

  // Fallback: when user enters branch name, use branch-based preview
  $effect(() => {
    const sourceBranch = updatePrSourceBranch.trim() || undefined
    if (!showUpdatePrForm || !repoClass?.workerManager || !sourceBranch) return
    if (sourceBranch === prTargetBranch) return
    let cancelled = false
    updatePrPreviewLoading = true
    updatePrPreview = null
    const targetCloneUrls = (repoClass as any)?.cloneUrls ?? []
    const sourceCloneUrls = prEffectiveCloneUrls.length > 0 ? prEffectiveCloneUrls : undefined
    repoClass.workerManager
      .getPRPreview({
        repoId: repoClass.key,
        sourceBranch,
        targetBranch: prTargetBranch,
        cloneUrls: targetCloneUrls,
        ...(sourceCloneUrls && {sourceCloneUrls}),
      })
      .then(result => {
        if (cancelled) return
        if (result && !result.success && result.error) {
          updatePrPreview = {
            ...result,
            error: formatMergeAnalysisError(result.error),
          }
        } else {
          updatePrPreview = result
        }
        updatePrPreviewLoading = false
      })
      .catch(err => {
        if (cancelled) return
        updatePrPreview = {
          success: false,
          error: formatMergeAnalysisError(err?.message || "Failed to load PR update preview"),
          commits: [],
          commitOids: [],
          tipCommit: undefined,
        }
        updatePrPreviewLoading = false
      })
    return () => {
      cancelled = true
    }
  })

  const submitPrUpdate = async () => {
    if (!canPublishPrUpdates) {
      updatePrError = prUpdateBlockedReason || "PR updates are not allowed in the current state"
      return
    }
    if (!prEvent || !$pubkey) {
      updatePrError = "Missing PR or identity"
      return
    }
    if (!updatePrPreview?.success || !updatePrPreview?.commitOids?.length) {
      updatePrError =
        "Wait for commits to load, or ensure the source branch has commits not in the target."
      return
    }
    const repoAddr = (repoClass as any)?.address ?? (repoClass as any)?.repoId ?? ""
    if (!repoAddr) {
      updatePrError = "Repository address not available"
      return
    }
    isPublishingPrUpdate = true
    updatePrError = ""
    try {
      const cloneUrls =
        prEffectiveCloneUrls.length > 0
          ? prEffectiveCloneUrls
          : ((repoClass as any)?.cloneUrls as string[]) || []
      if (cloneUrls.length === 0) {
        updatePrError = "No clone URLs available (PR and repo have none)"
        isPublishingPrUpdate = false
        return
      }
      let mergeBase = updatePrPreview.mergeBase
      const updateTipOid = updatePrPreview.tipCommit || updatePrPreview.commitOids?.[0]
      if (!updateTipOid) {
        updatePrError = "Unable to determine update tip commit"
        isPublishingPrUpdate = false
        return
      }
      if (!mergeBase && updateTipOid) {
        const targetCloneUrls = (repoClass as any)?.cloneUrls ?? []
        const mbResult = await (repoClass.workerManager as any).getMergeBaseBetween({
          repoId: repoClass.key,
          headOid: updateTipOid,
          targetBranch: prTargetBranch,
          cloneUrls: targetCloneUrls,
        })
        mergeBase = mbResult?.mergeBase
        if (mbResult?.error && !mergeBase) {
          updatePrError = mbResult.error
          isPublishingPrUpdate = false
          return
        }
      }
      const recipients = repoMaintainers
      const unsigned = createPullRequestUpdateEvent({
        repoAddr,
        pullRequestEventId: prEvent.id,
        pullRequestAuthorPubkey: prEvent.pubkey,
        tipCommitOid: updateTipOid,
        clone: cloneUrls,
        mergeBase,
        recipients: recipients.length ? recipients : undefined,
      } as Parameters<typeof createPullRequestUpdateEvent>[0])
      const event = {
        ...unsigned,
        pubkey: $pubkey,
        id: "",
        sig: "",
      }
      publishEvent(event as any, repoRelays || [])
      showUpdatePrForm = false
      updatePrPreview = null
      updatePrSourceBranch = ""
      updatePrTriedTipFirst = false
      toast.push({message: "PR update published"})
      load({relays: (repoRelays || []) as string[], filters: prUpdatesFilter})
    } catch (e) {
      updatePrError = e instanceof Error ? e.message : String(e)
    } finally {
      isPublishingPrUpdate = false
    }
  }

  let editingDescription = $state(false)
  let savingDescription = $state(false)
  let descriptionDraft = $state("")
  let descriptionEditor = $state<RichDescriptionEditorHandle | null>(null)

  $effect(() => {
    if (editingDescription) return
    descriptionDraft = prDescription || ""
  })

  const savePrDescriptionEdit = async () => {
    if (savingDescription) return
    if (!prEvent || !canEditPrDescription) return

    const relays = strictPrEditRelays
    if (relays.length === 0) {
      toast.push({
        message: "No repo relays available to publish PR description edit",
        theme: "error",
      })
      return
    }

    try {
      savingDescription = true
      const descriptionPayload: RichContentPayload = descriptionEditor
        ? await descriptionEditor.getContent()
        : {content: descriptionDraft.trim(), tags: []}
      const nextDescription = descriptionPayload.content.trim()
      const currentTags = mergeRichEditorTags(prDescriptionEvent as any, [], {
        repoAddress: prRepoAddress,
      })
      const nextTags = mergeRichEditorTags(prDescriptionEvent as any, descriptionPayload.tags || [], {
        repoAddress: prRepoAddress,
      })
      if (nextDescription === (prDescription || "") && areTagsEqual(nextTags, currentTags)) {
        editingDescription = false
        descriptionEditor = null
        return
      }

      const coverLetterEvent = createCoverLetterEvent({
        rootId: prEvent.id,
        repoAddr: prRepoAddress || undefined,
        content: nextDescription,
        tags: nextTags as CoverLetterTag[],
      })
      publishThunk({event: coverLetterEvent as any, relays})
      await load({relays, filters: [getPrCoverLetterFilter()]})
      descriptionDraft = nextDescription
      editingDescription = false
      descriptionEditor = null
      toast.push({message: "PR description updated"})
    } catch (error) {
      toast.push({
        message: `Failed to update PR description: ${error instanceof Error ? error.message : String(error)}`,
        theme: "error",
      })
    } finally {
      savingDescription = false
    }
  }

  const onCommentCreated = async (comment: CommentEvent) => {
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    try {
      await postComment(comment, relays)
    } catch (error) {
      toast.push({
        message: "Failed to start sending comment",
        timeout: 3000,
        variant: "destructive",
      })
      throw error
    }
  }

  const canEditComment = (comment: CommentEvent) => canEditReplyEvent(comment as any, $pubkey)

  const onCommentEdited = async (comment: CommentEvent, content: string, tags?: string[][]) => {
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    await publishEditedReply({
      event: comment as unknown as TrustedEvent,
      content,
      tags,
      relays,
      url: relays[0],
    })
  }

  const handlePrStatusPublish = async (statusEvent: StatusEvent) => {
    if (!prEvent || !$pubkey) return
    if ($pubkey !== prEvent.pubkey && !canManagePr) {
      throw new Error("Only the PR author or maintainers can change PR status")
    }

    const recipients = Array.from(
      new Set([...repoMaintainers, prEvent.pubkey, $pubkey].filter(Boolean)),
    )
    const tags = (statusEvent.tags || []).filter((tag: string[]) => tag[0] !== "p")
    tags.push(...recipients.map((recipient: string) => ["p", recipient] as ["p", string]))

    const statusWithRecipients = {
      ...statusEvent,
      tags,
    }
    const relays = (repoClass.relays || repoRelays || [])
      .map((u: string) => normalizeRelayUrl(u))
      .filter(Boolean)
    return postStatus(statusWithRecipients as any, relays)
  }

  // PR merge state
  let isMergingPr = $state(false)
  let mergePrStep = $state("")
  let mergePrError = $state<string | null>(null)
  let mergePrSuccess = $state(false)
  let mergePrMergedLocal = $state(false)
  let mergePrResult = $state<{
    mergeCommitOid?: string
    pushedRemotes?: string[]
    skippedRemotes?: string[]
    pushErrors?: Array<{remote: string; url: string; error: string; code: string; stack: string}>
  } | null>(null)
  let showPrMergeDialog = $state(false)
  let showPrPushDialog = $state(false)
  let mergePrCommitMessage = $state("")
  let isLoadingPrPushRemotes = $state(false)
  let isPushingPrRemotes = $state(false)
  let prPushSyncNotice = $state<string | null>(null)
  let prPushSyncSource = $state<string | null>(null)
  let prPushRemotes = $state<PrPushRemote[]>([])
  let isMarkingApplied = $state(false)
  let markAsAppliedSuccess = $state(false)

  const prPushCounts = $derived.by(() => {
    let pushed = 0
    let skipped = 0
    let failed = 0
    for (const remote of prPushRemotes) {
      if (remote.status === "pushed") pushed++
      if (remote.status === "skipped") skipped++
      if (remote.status === "failed") failed++
    }
    return {pushed, skipped, failed}
  })
  const mergePrTokenIssue = $derived.by(() =>
    Boolean(mergePrError && isAccessTokenManagementIssue(mergePrError)),
  )
  const prPushTokenIssue = $derived.by(() =>
    prPushRemotes.some(
      remote =>
        (remote.status === "failed" || remote.status === "skipped") &&
        remote.error &&
        isAccessTokenManagementIssue(remote.error),
    ),
  )

  const updatePushRemote = (url: string, next: Partial<PrPushRemote>) => {
    prPushRemotes = prPushRemotes.map(remote =>
      remote.url === url
        ? {
            ...remote,
            ...next,
          }
        : remote,
    )
  }

  const classifyPushFailure = (
    error: any,
  ): {status: "skipped" | "failed"; summary: string; detail: string} => {
    const reason = String(error?.reason || error?.error?.reason || "")
    const detail = String(error?.error || error?.message || error?.toString?.() || "Push failed")
    const lower = detail.toLowerCase()

    if (reason === "remote_ahead" || /remote appears to have new commits/.test(lower)) {
      return {
        status: "skipped",
        summary: "Skipped (preflight)",
        detail:
          "Push was blocked before contacting the remote because the selected branch appears to be behind.",
      }
    }

    if (/force\s*=\s*true|force push|requires confirmation|requiresconfirmation/.test(lower)) {
      return {
        status: "skipped",
        summary: "Skipped (confirmation)",
        detail,
      }
    }

    if (/non-fast-forward|non fast-forward|not a fast-forward/.test(lower)) {
      return {
        status: "failed",
        summary: "Failed (remote rejected)",
        detail: "The remote rejected the push as non-fast-forward after the push was attempted.",
      }
    }

    if (reason === "workflow_scope_missing") {
      return {status: "skipped", summary: "Skipped (read-only)", detail}
    }
    if (/forbidden|permission denied|read-only|not allowed|403/.test(lower)) {
      return {status: "skipped", summary: "Skipped (read-only)", detail}
    }
    if (/auth|token|unauthorized|401/.test(lower)) {
      return {status: "failed", summary: "Failed (auth)", detail}
    }
    if (/network|failed to fetch|cors|timeout|econn|enotfound/.test(lower)) {
      return {status: "failed", summary: "Failed (network)", detail}
    }
    return {status: "failed", summary: "Failed", detail}
  }

  const publishMergeStateToRelay = async (remoteUrl: string, branch: string, commitSha: string) => {
    const remote = new URL(remoteUrl)
    const relayUrl = `${remote.protocol === "http:" ? "ws" : "wss"}://${remote.host}`

    const fetchRelayEvents = async (params: {
      relays: string[]
      filters: any[]
      timeoutMs?: number
    }) =>
      fetchRelayEventsWithTimeout({
        relays: params.relays,
        filters: params.filters,
        timeoutMs: params.timeoutMs,
      })

    const publishRepoState = async (event: any) => {
      const thunk = publishEvent(event, [relayUrl])

      if (thunk?.complete) {
        await thunk.complete
      }

      const results = thunk?.results || {}
      const ackedRelays = Object.entries(results)
        .filter(([, result]: [string, any]) => result?.status === PublishStatus.Success)
        .map(([url]) => url)
      const failedRelays = Object.entries(results)
        .filter(([, result]: [string, any]) => result?.status !== PublishStatus.Success)
        .map(([url]) => url)

      return {
        ackedRelays,
        failedRelays,
        successCount: ackedRelays.length,
        hasRelayOutcomes: ackedRelays.length + failedRelays.length > 0,
      }
    }

    await publishGraspRepoStateForPush({
      remoteUrl,
      branch,
      commitSha,
      fallbackRepoName: repoClass.name || "repo",
      authorPubkey: $pubkey || undefined,
      fetchRelayEvents,
      onPublishEvent: publishRepoState,
    })
  }

  const openPrPushDialog = async () => {
    if (!repoClass.workerManager || !repoClass.key) return
    isLoadingPrPushRemotes = true
    prPushSyncNotice = null
    prPushSyncSource = null
    try {
      const remotes = (await repoClass.workerManager.listRemotes({
        repoId: repoClass.key,
      })) as Array<{remote: string; url: string}>
      const fallback = ((repoClass as any).cloneUrls || []).map((url: string, i: number) => ({
        remote: `remote-${i + 1}`,
        url,
      }))

      const combined: Array<{remote: string; url: string}> = [
        ...(Array.isArray(remotes) ? remotes : []),
        ...fallback,
      ]
        .filter((remote: {remote: string; url: string}) => Boolean(remote?.url))
        .reduce(
          (acc: Array<{remote: string; url: string}>, remote: {remote: string; url: string}) => {
            if (!acc.some(x => x.url === remote.url)) acc.push(remote)
            return acc
          },
          [],
        )

      prPushRemotes = combined.map(remote => ({
        remote: remote.remote,
        url: remote.url,
        provider: inferRemoteProvider(remote.url),
        selected: true,
        status: "idle" as PrPushStatus,
      }))

      const syncResult = await repoClass.workerManager.syncWithRemote({
        repoId: repoClass.key,
        cloneUrls: combined.map(r => r.url),
        branch: prTargetBranch,
        preferredUrl: primaryTargetCloneUrl || undefined,
      })
      prPushSyncSource = syncResult?.usedUrl || primaryTargetCloneUrl || null
      if (!syncResult?.success) {
        prPushSyncNotice = `Remote sync failed: ${syncResult?.error || "unknown"}. You can still try pushing.`
      } else if (syncResult?.warning || syncResult?.synced === false) {
        prPushSyncNotice =
          syncResult.warning || "Remote sync used local fallback data. Push may still be attempted."
      }
    } catch (error) {
      prPushSyncNotice = `Could not refresh remotes: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      isLoadingPrPushRemotes = false
      showPrPushDialog = true
    }
  }

  const togglePrPushRemote = (url: string) => {
    prPushRemotes = prPushRemotes.map(remote =>
      remote.url === url ? {...remote, selected: !remote.selected} : remote,
    )
  }

  const closePrPushDialog = () => {
    showPrPushDialog = false
    prPushSyncSource = null
  }

  const applyPR = () => {
    if (!canManagePr) return
    if (!pr || !prEvent || !prEffectiveTipOid) return
    isMergingPr = false
    mergePrStep = ""
    mergePrError = null
    mergePrSuccess = false
    mergePrMergedLocal = false
    mergePrResult = null
    showPrPushDialog = false
    prPushRemotes = []
    prPushSyncNotice = null
    prPushSyncSource = null
    // Only set a merge commit message if it's not a fast-forward merge
    mergePrCommitMessage = prMergeAnalysisResult?.fastForward
      ? ""
      : `Merge PR: ${pr.subject || "Untitled"}`
    showPrMergeDialog = true
  }

  const pushMergedCommitToSelectedRemotes = async () => {
    if (!mergePrResult?.mergeCommitOid || !repoClass.key || !repoClass.workerManager) return
    const selected = prPushRemotes.filter(remote => remote.selected)
    if (selected.length === 0) {
      toast.push({message: "Select at least one remote", timeout: 3000, variant: "destructive"})
      return
    }

    isPushingPrRemotes = true
    mergePrError = null
    const mergeCommitOid = mergePrResult.mergeCommitOid

    for (const remote of selected) {
      updatePushRemote(remote.url, {status: "pushing", summary: "Pushing...", error: undefined})
      try {
        if (isGraspRemote(remote.url, remote.provider)) {
          updatePushRemote(remote.url, {
            status: "pushing",
            summary: "Publishing state...",
            error: undefined,
          })
          await publishMergeStateToRelay(remote.url, prTargetBranch, mergeCommitOid)
          updatePushRemote(remote.url, {
            status: "pushing",
            summary: "Pushing...",
            error: undefined,
          })
        }

        const pushResult = await repoClass.pushToAllRemotes({
          branch: prTargetBranch,
          mode: "best-effort",
          remoteUrls: [remote.url],
          userPubkey: $pubkey || undefined,
        })
        const entry = pushResult.results[0]
        if (entry?.success) {
          updatePushRemote(remote.url, {status: "pushed", summary: "Pushed", error: undefined})
        } else {
          const classified = classifyPushFailure(entry?.error)
          updatePushRemote(remote.url, {
            status: classified.status,
            summary: classified.summary,
            error: classified.detail,
          })
        }
      } catch (error: any) {
        const detailResult = (error as any)?.details?.results?.[0]
        const classified = classifyPushFailure(detailResult?.error || error)
        updatePushRemote(remote.url, {
          status: classified.status,
          summary: classified.summary,
          error: classified.detail,
        })
      }
    }

    isPushingPrRemotes = false

    const pushed = prPushRemotes.filter(remote => remote.status === "pushed").length
    if (pushed > 0) {
      mergePrSuccess = true
      mergePrStep = "Merge pushed to selected remotes"
      await emitPRAppliedStatus(mergeCommitOid)
      load({
        relays: (repoRelays || []) as string[],
        filters: [getPrStatusFilter()],
      })
      toast.push({
        message: `Pushed to ${pushed} remote${pushed === 1 ? "" : "s"}`,
        timeout: 4000,
      })
      return
    }

    mergePrError = "Merged locally, but no selected remote accepted the push."
    toast.push({
      message: "Merged locally, but all selected remote pushes were skipped or failed",
      timeout: 6000,
      variant: "destructive",
    })
  }

  const executePRMerge = async () => {
    if (!canManagePr) return
    if (
      !pr ||
      !prEvent ||
      !prEffectiveTipOid ||
      !repoClass.workerManager ||
      !repoClass.key ||
      !$pubkey
    )
      return

    showPrMergeDialog = false
    isMergingPr = true
    mergePrStep = "Syncing with remote..."
    mergePrError = null
    mergePrSuccess = false
    mergePrMergedLocal = false

    const cloneUrls = prEffectiveCloneUrls
    const prCloneUrls = cloneUrls.length > 0 ? cloneUrls : (repoClass as any).cloneUrls || []
    if (prCloneUrls.length === 0) {
      mergePrError = "No clone URLs available for this PR"
      mergePrStep = "Setup failed"
      isMergingPr = false
      toast.push({message: "No clone URLs for PR", timeout: 5000, variant: "destructive"})
      return
    }

    const sync = await syncTargetBranchForPR("merge")
    if (!sync.ok) {
      mergePrError = `Cannot merge until target branch is synced: ${formatSyncError(sync.error || "Sync failed")}`
      mergePrStep = "Sync failed"
      isMergingPr = false
      toast.push({message: mergePrError, timeout: 7000, variant: "destructive"})
      return
    }
    if (sync.warning) toast.push({message: sync.warning, timeout: 5000, variant: "default"})

    mergePrStep = "Merging PR..."
    const tipOid = prEffectiveTipOid

    try {
      const result = await repoClass.workerManager.mergePRAndPush({
        repoId: repoClass.key,
        cloneUrls: prCloneUrls,
        targetCloneUrls: prTargetCloneUrls,
        tipCommitOid: tipOid,
        targetBranch: prTargetBranch,
        mergeCommitMessage: mergePrCommitMessage || undefined,
        fastForward: prMergeAnalysisResult?.fastForward === true,
        userPubkey: $pubkey ?? undefined,
        skipPush: true,
      })

      if (result.success) {
        mergePrMergedLocal = true
        mergePrResult = result
        mergePrStep = "Merge completed locally. Choose remotes to push."
        toast.push({message: "PR merged locally", timeout: 3000})
        await openPrPushDialog()
      } else {
        mergePrError = result.error || "Unknown merge error"
        mergePrStep = "Merge failed"
        toast.push({
          message: `Merge failed: ${mergePrError}`,
          timeout: 8000,
          variant: "destructive",
        })
      }
    } catch (error) {
      mergePrError = error instanceof Error ? error.message : "Unknown error"
      mergePrStep = "Merge failed"
      toast.push({message: `Merge error: ${mergePrError}`, timeout: 8000, variant: "destructive"})
    } finally {
      isMergingPr = false
    }
  }

  const emitPRAppliedStatus = async (mergeCommitOid?: string) => {
    if (!prEvent || !$pubkey) return
    try {
      const commitIds = prCommitOids
      const appliedCommits =
        commitIds.length > 0 ? commitIds : prEffectiveTipOid ? [prEffectiveTipOid] : undefined
      const recipients = Array.from(
        new Set([...repoMaintainers, prEvent.pubkey, $pubkey].filter(Boolean)),
      )
      const repoAddress =
        (prEvent.tags || []).find((tag: string[]) => tag[0] === "a")?.[1] ||
        ((repoClass as any).address as string) ||
        ((repoClass as any).repoId as string) ||
        ""
      const statusEvent = createStatusEvent({
        kind: GIT_STATUS_APPLIED,
        content: mergePrCommitMessage || `PR merged: ${pr?.subject || "Untitled"}`,
        rootId: prEvent.id,
        recipients,
        repoAddr: repoAddress,
        relays: repoClass.relays || repoRelays || [],
        appliedCommits,
        mergedCommit: mergeCommitOid,
      })
      postStatus(statusEvent as any, repoClass.relays || repoRelays || [])
    } catch (error) {
      console.error("[emitPRAppliedStatus] Failed to publish status event:", error)
      toast.push({
        message: "Warning: Failed to publish PR status event",
        timeout: 5000,
        variant: "destructive",
      })
    }
  }

  const cancelPrMerge = () => {
    showPrMergeDialog = false
    mergePrCommitMessage = ""
  }

  const markPrAsApplied = async () => {
    if (!canManagePr) return
    if (!prEvent || !$pubkey) return
    isMarkingApplied = true
    markAsAppliedSuccess = false
    try {
      await emitPRAppliedStatus(undefined)
      markAsAppliedSuccess = true
      toast.push({message: "PR marked as merged", timeout: 5000})
    } finally {
      isMarkingApplied = false
    }
  }

  const formatTimestamp = (timestamp: string | number) => {
    const date =
      typeof timestamp === "string"
        ? new Date(timestamp)
        : new Date(timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return `today at ${date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}`
    } else if (diffDays === 1) {
      return `yesterday at ${date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}`
    } else if (diffDays < 7) {
      return `${diffDays} days ago`
    } else {
      return date.toLocaleDateString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    }
  }

  const getStatusLabel = (status?: string) => {
    if (status === "open") return "Open"
    if (status === "applied") return "Merged"
    if (status === "closed") return "Closed"
    if (status === "draft") return "Draft"
    return "Status unknown"
  }

  const getStatusBadgeClass = (status?: string) => {
    if (status === "open")
      return "border-sky-200 bg-sky-100/80 text-sky-900 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200"
    if (status === "applied")
      return "border-emerald-200 bg-emerald-100/80 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
    if (status === "closed")
      return "border-rose-200 bg-rose-100/80 text-rose-900 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200"
    if (status === "draft")
      return "border-amber-200 bg-amber-100/80 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
    return "border-border bg-secondary text-secondary-foreground"
  }
</script>

{#if prInlineTargetStatus}
  <div
    class="z-50 fixed left-1/2 top-20 w-[min(calc(100vw-1rem),28rem)] -translate-x-1/2 rounded-lg border border-border bg-card/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
    <div class="flex items-start gap-2">
      {#if prInlineTargetStatus.state === "loading"}
        <Loader2 class="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
      {:else}
        <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      {/if}
      <div class="min-w-0 flex-1">
        <p class="font-medium">{prInlineTargetStatus.message}</p>
        {#if prInlineTargetStatus.detail}
          <p class="mt-0.5 text-xs text-muted-foreground">{prInlineTargetStatus.detail}</p>
        {/if}
      </div>
      <button
        type="button"
        class="rounded p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss inline comment navigation status"
        onclick={() => {
          dismissedPrInlineTargetHash = typeof window !== "undefined" ? window.location.hash : ""
          prInlineTargetGeneration++
          prInlineTargetStatus = null
        }}>
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
{/if}

<div
  class="z-10 sticky items-center justify-between py-4 backdrop-blur"
  style="top: var(--repo-tabs-height, 0px);">
  <div>
    <div class="rounded-lg border border-border bg-card p-4 sm:p-6">
      <div class="mb-4 flex flex-col items-start justify-between gap-2">
        <div class="flex w-full items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-4">
            <div class="mt-1">
              <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                <GitCommit class="h-5 w-5 text-amber-500" />
              </div>
            </div>

            <h1
              class="line-clamp-2 overflow-hidden break-words text-lg font-bold md:text-2xl"
              title={pr?.subject || "Untitled"}>
              {pr?.subject || "Untitled"}
            </h1>
          </div>

          {#if repoOwnerPubkey && repoOwnerPubkey === $pubkey && prEvent.pubkey !== $pubkey}
            <EventActions
              event={prEvent as any}
              url={commentRelayHint || repoRelays[0] || ""}
              relays={repoRelays}
              noun="pull request"
              ownerPubkey={repoOwnerPubkey}
              zapScopeH={repoCommunityScope}
              showReport={true}
              menuOnly
              class="shrink-0" />
          {/if}
        </div>

        <div class="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-1">
          <div
            class={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-semibold ${getStatusBadgeClass(prStatus?.status)}`}>
            {getStatusLabel(prStatus?.status)}
          </div>
          <div class="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground sm:text-sm">
            {#if prEvent?.pubkey}
              <Profile pubkey={prEvent.pubkey} relays={profileRelays} hideDetails={true}></Profile>
              <ProfileLink pubkey={prEvent.pubkey} relays={profileRelays} />
            {/if}
            <span class="hidden sm:inline">•</span>
            <span>{formatTimestamp(pr?.createdAt || "")}</span>
          </div>
        </div>
      </div>

      <div class="mb-6 rounded-lg border bg-muted/20 p-4 text-sm">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 class="font-medium">Community activity</h3>
            <p class="mt-1 text-xs text-muted-foreground">{prTrustSummary}</p>
          </div>

          <div class="flex flex-wrap gap-2 text-xs">
            {#if prTrustMetric?.communityAlignedAuthor}
              <span
                class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                Community-aligned author
              </span>
            {/if}
            {#if prTrustMetric?.communityAlignedMaintainerMerge}
              <span
                class="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
                Community-aligned merge
              </span>
            {/if}
          </div>
        </div>

        {#if prTrustMetric?.mergedByPubkey && prTrustMetric.communityAlignedMaintainerMerge}
          <div class="mt-3 text-xs text-muted-foreground">
            Merged by
            <ProfileLink
              pubkey={prTrustMetric.mergedByPubkey}
              relays={profileRelays}
              unstyled
              class="font-medium hover:underline" />
          </div>
        {/if}
      </div>

      <div
        class="prose-sm dark:prose-invert markdown-content prose mb-6 max-w-none text-muted-foreground">
        {#if editingDescription && canEditPrDescription}
          <div class="not-prose space-y-3">
            <RepoRichDescriptionEditor
              initialContent={descriptionDraft}
              placeholder="PR description"
              compact={true}
              disabled={savingDescription}
              context={prDescriptionContext}
              onReady={handle => (descriptionEditor = handle)} />
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onclick={savePrDescriptionEdit}
                disabled={savingDescription || !descriptionEditor}>
                {savingDescription ? "Saving..." : "Save description"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onclick={() => {
                  editingDescription = false
                  descriptionDraft = prDescription || ""
                  descriptionEditor = null
                }}
                disabled={savingDescription}>
                Cancel
              </Button>
            </div>
          </div>
        {:else}
          <Markdown
            content={prDescription || ""}
            event={prDescriptionEvent as any}
            relays={repoRelays}
            variant="body" />
          {#if canEditPrDescription}
            <button
              class="not-prose mt-3 text-xs text-muted-foreground underline-offset-2 hover:underline"
              onclick={() => {
                editingDescription = true
                descriptionDraft = prDescription || ""
                descriptionEditor = null
              }}>
              Edit description
            </button>
          {/if}
        {/if}
      </div>

      <!-- PR details -->
      {#if prEffectiveTipOid || pr?.raw?.tags?.some(t => t[0] === "clone")}
        <div class="mb-6 rounded-lg border bg-muted/20 p-4 text-sm">
          <h3 class="mb-2 font-medium">PR details</h3>
          {#if prEffectiveTipOid}
            <div class="mb-2">
              <span class="text-muted-foreground">Tip commit:</span>
              <code class="ml-2 rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                {prEffectiveTipOid.substring(0, 8)}
              </code>
            </div>
          {:else if prEffectiveTipIssue?.type === "ambiguous-tip"}
            <div
              class="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <p>
                Ambiguous tip commit: expected exactly one <code class="rounded bg-background px-1"
                  >c</code>
                tag, found {prEffectiveTipIssue.candidates.length}.
              </p>
              {#if prEffectiveTipIssue.candidates.length > 0}
                <div class="mt-1 flex flex-wrap items-center gap-1">
                  <span class="text-muted-foreground">c tags:</span>
                  {#each prEffectiveTipIssue.candidates as candidate}
                    <code class="rounded bg-background px-1.5 py-0.5 font-mono"
                      >{candidate.substring(0, 8)}</code>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          {#if prTargetBranch}
            <div class="mb-2">
              <span class="text-muted-foreground">Target branch:</span>
              <code class="ml-2 rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                {prTargetBranch}
              </code>
            </div>
          {/if}
          {#if pr?.raw?.tags}
            {@const cloneTags = pr.raw.tags.filter(t => t[0] === "clone")}
            {#if cloneTags.length}
              <div>
                <span class="text-muted-foreground">Clone:</span>
                {#each cloneTags.slice(0, 3) as tag}
                  <a
                    href={tag[1]}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="ml-2 break-all text-primary hover:underline">{tag[1]}</a>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      <div class="mb-6">
        <Status
          repo={statusRepo}
          rootId={prEvent.id}
          rootKind={GIT_PULL_REQUEST}
          rootAuthor={prEvent.pubkey}
          statusEvents={prStatusEventsArray}
          actorPubkey={$pubkey}
          isMirrored={isImportedPr}
          ProfileComponent={NostrGitProfileComponent}
          onLoginRequired={requireLogin}
          onPublish={handlePrStatusPublish} />
      </div>

      <!-- PR merge analysis -->
      <div class="mb-6 rounded-lg border bg-muted/20 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-medium">Merge analysis</h3>
          <Button
            variant="outline"
            size="sm"
            onclick={() => runPRMergeAnalysis()}
            disabled={isAnalyzingPRMerge || !prEffectiveTipOid}
            class="gap-2">
            {#if isAnalyzingPRMerge}
              <Loader2 class="h-4 w-4 animate-spin" />
              Analyzing...
            {:else}
              <Shield class="h-4 w-4" />
              Analyze
            {/if}
          </Button>
        </div>
        {#if isAnalyzingPRMerge}
          <div class="flex items-center gap-2 text-muted-foreground">
            <Loader2 class="h-4 w-4 animate-spin" />
            <span class="text-sm">{prAnalysisProgress || "Analyzing..."}</span>
          </div>
        {:else if prMergeAnalysisResult}
          <MergeStatus
            result={prMergeAnalysisResult}
            loading={false}
            targetBranch={prTargetBranch} />
          {#if prAnalysisWarning}
            <p
              class="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              {prAnalysisWarning}
            </p>
          {/if}
          {#if prAnalysisErrorMessage}
            <div
              class="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <p>{prAnalysisErrorMessage}</p>
              {#if prAnalysisTimedOut}
                <p class="mt-1 text-red-600 dark:text-red-400">
                  Resolution: click Analyze to retry. If retries keep timing out, reload the page
                  and try again.
                </p>
              {/if}
              <div class="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => runPRMergeAnalysis()}
                  disabled={isAnalyzingPRMerge}
                  class="h-7">
                  Retry sync + analyze
                </Button>
              </div>
            </div>
          {/if}
          {#if prMergeAnalysisResult.usedTargetCloneUrl}
            <p class="mt-2 text-xs text-muted-foreground">
              Target synced from: {prMergeAnalysisResult.usedTargetCloneUrl}
              {#if primaryTargetCloneUrl && prMergeAnalysisResult.usedTargetCloneUrl !== primaryTargetCloneUrl}
                (primary is {primaryTargetCloneUrl})
              {/if}
            </p>
          {/if}
          {#if prMergeAnalysisResult.usedCloneUrl}
            <p class="mt-2 text-xs text-muted-foreground">
              PR fetched from: {prMergeAnalysisResult.usedCloneUrl}
            </p>
          {/if}
          {#if prMergeAnalysisResult.prCommits && prMergeAnalysisResult.prCommits.length > 0}
            <div class="mt-3">
              <h4 class="mb-2 text-sm font-medium">
                Commits ({prMergeAnalysisResult.prCommits.length})
              </h4>
              <ul class="space-y-1 text-xs">
                {#each prMergeAnalysisResult.prCommits.slice(0, 10) as c}
                  <li class="flex items-center gap-2">
                    <code class="rounded bg-background px-1 font-mono"
                      >{c.oid?.substring(0, 8)}</code>
                    <span class="truncate text-muted-foreground"
                      >{c.message?.split("\n")[0] || "-"}</span>
                  </li>
                {/each}
                {#if prMergeAnalysisResult.prCommits.length > 10}
                  <li class="text-muted-foreground">
                    ... and {prMergeAnalysisResult.prCommits.length - 10} more
                  </li>
                {/if}
              </ul>
            </div>
          {/if}
        {:else if prEffectiveTipOid}
          <p class="text-sm text-muted-foreground">Click Analyze to check mergeability.</p>
        {:else if prEffectiveTipIssue?.type === "ambiguous-tip"}
          <div
            class="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <p>
              Ambiguous tip commit: expected exactly one <code class="rounded bg-background px-1"
                >c</code>
              tag, found {prEffectiveTipIssue.candidates.length}. Analyze is disabled.
            </p>
            {#if prEffectiveTipIssue.candidates.length > 0}
              <div class="mt-1 flex flex-wrap items-center gap-1">
                <span class="text-muted-foreground">c tags:</span>
                {#each prEffectiveTipIssue.candidates as candidate}
                  <code class="rounded bg-background px-1.5 py-0.5 font-mono"
                    >{candidate.substring(0, 8)}</code>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">
            No tip commit available. Add commits to the PR branch first.
          </p>
        {/if}
      </div>

      <!-- PR Merge section (maintainers only, when canMerge and open) -->
      {#if canManagePr && prMergeAnalysisResult?.canMerge === true && prStatus?.status === "open" && !prMergeAnalysisResult?.upToDate}
        <div class="mb-6 rounded-lg border bg-card p-6">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <GitMerge class="h-5 w-5 text-primary" />
              <div>
                <h3 class="font-semibold">Merge this PR</h3>
                <p class="text-sm text-muted-foreground">
                  Merge the PR branch into {prTargetBranch}
                </p>
              </div>
            </div>
            {#if isMergingPr}
              <div class="flex items-center gap-2 text-sky-700 dark:text-sky-300">
                <Loader2 class="h-4 w-4 animate-spin" />
                <span class="text-sm font-medium">Merging...</span>
              </div>
            {:else if mergePrSuccess}
              <div class="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle class="h-4 w-4" />
                <span class="text-sm font-medium">Merged</span>
              </div>
            {:else if mergePrMergedLocal}
              <div class="flex items-center gap-2 text-sky-700 dark:text-sky-300">
                <CheckCircle class="h-4 w-4" />
                <span class="text-sm font-medium">Merged locally</span>
              </div>
            {:else if mergePrError}
              <div class="flex items-center gap-2 text-rose-700 dark:text-rose-300">
                <AlertCircle class="h-4 w-4" />
                <span class="text-sm font-medium">Failed</span>
              </div>
            {/if}
          </div>

          {#if isMergingPr}
            <div class="mb-4">
              <div class="mb-2 flex items-center justify-between text-sm">
                <span class="text-muted-foreground">{mergePrStep}</span>
              </div>
            </div>
          {/if}

          {#if mergePrError}
            <div
              class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
              <div class="flex items-start gap-2">
                <AlertCircle
                  class="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-700 dark:text-rose-300" />
                <div class="flex-1">
                  <p class="text-sm font-medium text-red-800 dark:text-red-200">Merge failed</p>
                  <p class="mt-1 text-sm text-red-700 dark:text-red-300">{mergePrError}</p>
                  {#if mergePrTokenIssue}
                    <p class="mt-2 text-xs text-rose-700 dark:text-rose-400">
                      {getAccessTokenManagementMessage(mergePrError)}
                      <a
                        href={ACCESS_TOKEN_SETTINGS_PATH}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="ml-1 underline underline-offset-2">
                        Open token settings
                      </a>
                    </p>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          {#if mergePrMergedLocal && mergePrResult}
            <div
              class="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
              <div class="flex items-start gap-2">
                <CheckCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-700 dark:text-sky-300" />
                <div class="flex-1">
                  <p class="text-sm font-medium text-sky-900 dark:text-sky-200">
                    PR merged locally.
                  </p>
                  {#if mergePrResult.mergeCommitOid}
                    <p class="mt-1 text-sm text-sky-800 dark:text-sky-300">
                      Merge commit:
                      <code class="rounded bg-sky-100 px-1 dark:bg-sky-900/50"
                        >{mergePrResult.mergeCommitOid.slice(0, 8)}</code>
                    </p>
                  {/if}
                  {#if mergePrSuccess}
                    <p class="mt-1 text-sm text-sky-800 dark:text-sky-300">
                      Push summary: {prPushCounts.pushed} pushed, {prPushCounts.skipped} skipped, {prPushCounts.failed}
                      failed
                    </p>
                  {:else}
                    <p class="mt-1 text-sm text-sky-800 dark:text-sky-300">
                      Push this merge to selected remotes to complete the operation.
                    </p>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          <div class="flex justify-end gap-2">
            {#if mergePrMergedLocal && !mergePrSuccess}
              <Button variant="outline" onclick={openPrPushDialog}>Push remotes</Button>
            {/if}
            <Button
              onclick={applyPR}
              variant="default"
              disabled={isMergingPr || mergePrSuccess || mergePrMergedLocal}
              class="min-w-[120px]">
              {#if isMergingPr}
                <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                Merging...
              {:else if mergePrSuccess}
                <CheckCircle class="mr-2 h-4 w-4" />
                Merged
              {:else if mergePrMergedLocal}
                <CheckCircle class="mr-2 h-4 w-4" />
                Merged local
              {:else}
                <GitMerge class="mr-2 h-4 w-4" />
                Merge PR
              {/if}
            </Button>
          </div>
        </div>
      {/if}

      <!-- Mark as merged (maintainers only, when up-to-date and open - no git ops) -->
      {#if canManagePr && prStatus?.status === "open" && prMergeAnalysisResult && prMergeAnalysisResult.upToDate === true}
        <div class="mb-6 rounded-lg border bg-card p-6">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <CheckCircle class="h-5 w-5 text-primary" />
              <div>
                <h3 class="font-semibold">Mark as merged</h3>
                <p class="text-sm text-muted-foreground">
                  No changes to merge. Publish merged status without git operations.
                </p>
              </div>
            </div>
            {#if markAsAppliedSuccess}
              <div class="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle class="h-4 w-4" />
                <span class="text-sm font-medium">Marked</span>
              </div>
            {/if}
          </div>
          <div class="flex justify-end">
            <Button
              onclick={markPrAsApplied}
              variant="outline"
              disabled={isMarkingApplied || markAsAppliedSuccess}
              class="min-w-[140px]">
              {#if isMarkingApplied}
                <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                Publishing...
              {:else if markAsAppliedSuccess}
                <CheckCircle class="mr-2 h-4 w-4" />
                Marked
              {:else}
                <CheckCircle class="mr-2 h-4 w-4" />
                Mark as merged
              {/if}
            </Button>
          </div>
        </div>
      {/if}

      <Dialog bind:open={showPrMergeDialog}>
        <DialogContent
          class="max-w-md bg-card [&>button]:hidden"
          interactOutsideBehavior="ignore"
          escapeKeydownBehavior="ignore">
          <DialogHeader class="mb-4 text-left">
            <div class="flex items-center gap-3">
              <GitMerge class="h-5 w-5 text-primary" />
              <DialogTitle>
                {prMergeAnalysisResult?.fastForward ? "Confirm Fast-forward" : "Confirm Merge"}
              </DialogTitle>
            </div>
          </DialogHeader>
          <div class="mb-6 space-y-4">
            <p class="text-sm text-muted-foreground">
              {#if prMergeAnalysisResult?.fastForward}
                This will fast-forward the
                <code class="rounded bg-muted px-1">{prTargetBranch}</code>
                branch to include the PR commits locally.
              {:else}
                This will merge the PR into
                <code class="rounded bg-muted px-1">{prTargetBranch}</code>
                locally. You can choose remotes to push afterward.
              {/if}
            </p>
            {#if prMergeAnalysisResult?.fastForward}
              <div
                class="rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
                <p class="text-sm text-sky-900 dark:text-sky-200">
                  <strong>Fast-forward merge:</strong> No merge commit will be created. The branch will
                  be moved to point to the latest commit.
                </p>
              </div>
            {:else}
              <div>
                <label for="pr-merge-message" class="mb-2 block text-sm font-medium">
                  Merge commit message:
                </label>
                <textarea
                  id="pr-merge-message"
                  bind:value={mergePrCommitMessage}
                  class="w-full resize-none rounded-md border p-2 text-sm"
                  rows="3"
                  placeholder="Enter merge commit message..."></textarea>
              </div>
            {/if}
          </div>
          <div class="flex justify-end gap-3">
            <Button variant="outline" onclick={cancelPrMerge}>Cancel</Button>
            <Button variant="default" onclick={executePRMerge}>
              <GitMerge class="mr-2 h-4 w-4" />
              {prMergeAnalysisResult?.fastForward ? "Fast-forward" : "Confirm Merge"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog bind:open={showPrPushDialog}>
        <DialogContent
          class="max-w-2xl bg-card [&>button]:hidden"
          interactOutsideBehavior="ignore"
          escapeKeydownBehavior="ignore">
          <DialogHeader class="mb-4 text-left">
            <div class="flex items-center gap-3">
              <GitMerge class="h-5 w-5 text-primary" />
              <DialogTitle>Push merged commit</DialogTitle>
            </div>
          </DialogHeader>

          {#if mergePrResult?.mergeCommitOid}
            <p class="mb-3 text-sm text-muted-foreground">
              Merge commit
              <code class="ml-1 rounded bg-muted px-1"
                >{mergePrResult.mergeCommitOid.slice(0, 8)}</code>
              is local. Select remotes to push.
            </p>
          {/if}

          {#if prPushSyncNotice}
            <p
              class="mb-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              {prPushSyncNotice}
            </p>
          {/if}

          {#if prPushSyncSource}
            <p class="mb-3 text-xs text-muted-foreground">
              Target sync checked via: {prPushSyncSource}
              {#if primaryTargetCloneUrl && prPushSyncSource !== primaryTargetCloneUrl}
                (primary is {primaryTargetCloneUrl})
              {/if}
            </p>
          {/if}

          {#if prPushTokenIssue}
            <p
              class="mb-3 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Review your Git access tokens before retrying these pushes.
              <a
                href={ACCESS_TOKEN_SETTINGS_PATH}
                target="_blank"
                rel="noopener noreferrer"
                class="ml-1 underline underline-offset-2">
                Open token settings
              </a>
            </p>
          {/if}

          {#if isLoadingPrPushRemotes}
            <div class="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 class="h-4 w-4 animate-spin" />
              Loading remotes...
            </div>
          {:else if prPushRemotes.length === 0}
            <p class="mb-4 text-sm text-muted-foreground">No remotes available to push.</p>
          {:else}
            <div class="mb-4 max-h-[45vh] space-y-2 overflow-y-auto">
              {#each prPushRemotes as remote (remote.url)}
                <label class="flex items-start gap-3 rounded-md border border-border p-3">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm mt-1"
                    checked={remote.selected}
                    disabled={isPushingPrRemotes}
                    onchange={() => togglePrPushRemote(remote.url)} />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-2">
                      <div class="truncate text-sm font-medium">{remote.remote}</div>
                      <div class="flex items-center gap-2 text-xs">
                        <span class="rounded border px-2 py-0.5 text-muted-foreground"
                          >{remote.provider}</span>
                        {#if remote.status !== "idle"}
                          <span
                            class={`rounded border px-2 py-0.5 ${
                              remote.status === "pushed"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                                : remote.status === "skipped"
                                  ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
                                  : remote.status === "failed"
                                    ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
                                    : "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300"
                            }`}>
                            {remote.summary || remote.status}
                          </span>
                        {/if}
                      </div>
                    </div>
                    <p class="mt-1 break-all text-xs text-muted-foreground">{remote.url}</p>
                    {#if remote.error && (remote.status === "failed" || remote.status === "skipped")}
                      <p class="mt-1 text-xs text-muted-foreground">{remote.error}</p>
                    {/if}
                  </div>
                </label>
              {/each}
            </div>

            {#if prPushCounts.pushed + prPushCounts.skipped + prPushCounts.failed > 0}
              <div class="mb-4 rounded border border-border bg-muted/30 px-3 py-2 text-xs">
                <span class="font-medium">Results:</span>
                <span class="ml-2 text-emerald-800 dark:text-emerald-300"
                  >{prPushCounts.pushed} pushed</span>
                <span class="ml-2 text-amber-800 dark:text-amber-300"
                  >{prPushCounts.skipped} skipped</span>
                <span class="ml-2 text-rose-800 dark:text-rose-300"
                  >{prPushCounts.failed} failed</span>
              </div>
            {/if}
          {/if}

          <div class="flex justify-end gap-3">
            <Button variant="outline" onclick={closePrPushDialog} disabled={isPushingPrRemotes}
              >Close</Button>
            <Button
              variant="default"
              onclick={pushMergedCommitToSelectedRemotes}
              disabled={isLoadingPrPushRemotes ||
                isPushingPrRemotes ||
                !mergePrMergedLocal ||
                prPushRemotes.filter(r => r.selected).length === 0}>
              {#if isPushingPrRemotes}
                <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                Pushing...
              {:else}
                Push selected
              {/if}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div
        class="mb-6 scroll-mt-4 overflow-hidden rounded-lg border bg-muted/20 {prReviewHasExpandedItem
          ? 'p-0 sm:p-4'
          : 'p-4'}"
        id="pr-changes">
        <Tabs bind:value={prReviewTab} class="w-full">
          <div
            class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between {prReviewHasExpandedItem
              ? 'p-3 sm:p-0'
              : ''}">
            <TabsList class="grid w-full grid-cols-2 sm:max-w-sm">
              <TabsTrigger value="commits" class="px-2 text-xs sm:text-sm">
                <span class="sm:hidden">Commits</span>
                <span class="hidden sm:inline">Commits ({prCommitOids.length})</span>
              </TabsTrigger>
              <TabsTrigger value="files" class="px-2 text-xs sm:text-sm">
                <span class="sm:hidden">Files</span>
                <span class="hidden sm:inline">Files changed ({prChanges?.length ?? 0})</span>
              </TabsTrigger>
            </TabsList>

            {#if prReviewTab === "commits" && prCommitOids.length > 0}
              <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                <button
                  type="button"
                  onclick={() => expandAllPrCommits()}
                  disabled={prExpandedCommits.size === prCommitOids.length}
                  class="w-full rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50 sm:w-auto">
                  Expand all
                </button>
                <button
                  type="button"
                  onclick={() => {
                    prExpandedCommits = new Set()
                  }}
                  disabled={prExpandedCommits.size === 0}
                  class="w-full rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50 sm:w-auto">
                  Collapse all
                </button>
              </div>
            {:else if prReviewTab === "files" && prChanges && prChanges.length > 0}
              <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                <button
                  type="button"
                  onclick={() => {
                    prExpandedFiles = new Set(prChanges!.map(c => c.path))
                  }}
                  disabled={prExpandedFiles.size === prChanges!.length}
                  class="w-full rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50 sm:w-auto">
                  Expand all
                </button>
                <button
                  type="button"
                  onclick={() => {
                    prExpandedFiles = new Set()
                  }}
                  disabled={prExpandedFiles.size === 0}
                  class="w-full rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50 sm:w-auto">
                  Collapse all
                </button>
              </div>
            {/if}
          </div>

          <TabsContent value="commits" class="mt-0" id="pr-commits-tab-panel">
            {#if !prCommitOids.length}
              <p class="text-sm text-muted-foreground">No commits found for this PR.</p>
            {:else}
              <div
                class="divide-y divide-border bg-background/50 {prReviewHasExpandedItem
                  ? 'border-y sm:rounded sm:border'
                  : 'rounded border'}">
                {#each prCommitOids as oid (oid)}
                  {@const commitState = getPrCommitState(oid)}
                  {@const isExpanded = prExpandedCommits.has(oid)}
                  <div class="overflow-x-auto">
                    <button
                      type="button"
                      onclick={() => togglePrCommit(oid)}
                      class="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50">
                      <div class="flex min-w-0 items-center gap-2">
                        {#if isExpanded}
                          <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
                        {:else}
                          <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
                        {/if}
                        <GitCommit class="h-4 w-4 shrink-0 text-amber-500" />
                        <code
                          class="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                          {oid.substring(0, 8)}
                        </code>
                        <span class="truncate text-sm">{getPrCommitTitle(oid)}</span>
                      </div>
                      <div class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <span>{getPrCommitAuthor(oid)}</span>
                        {#if commitState.meta?.date}
                          <span>• {formatTimestamp(commitState.meta.date)}</span>
                        {/if}
                      </div>
                    </button>

                    {#if isExpanded}
                      <div class="border-t border-border px-0 pb-0 pt-0 sm:px-4 sm:pb-4 sm:pt-2">
                        {#if commitState.loading}
                          <div
                            class="flex items-center gap-2 rounded border bg-background/50 p-3 text-sm text-muted-foreground">
                            <Loader2 class="h-4 w-4 animate-spin" />
                            Loading commit diff...
                          </div>
                        {:else if commitState.error}
                          <div
                            class="space-y-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                            <p>{commitState.error}</p>
                            <Button
                              variant="outline"
                              size="sm"
                              onclick={() => loadPrCommitDiff(oid, true)}>
                              Retry commit diff
                            </Button>
                          </div>
                        {:else}
                          {#if commitState.warning}
                            <div
                              class="mb-3 space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                              <p>{commitState.warning}</p>
                              <Button
                                variant="outline"
                                size="sm"
                                onclick={() => loadPrCommitDiff(oid, true)}>
                                Retry commit diff
                              </Button>
                            </div>
                          {/if}
                          {#if commitState.changes && commitState.changes.length > 0}
                            <div class="space-y-0 sm:space-y-3">
                              {#each commitState.changes as change (change.path)}
                                <div
                                  class="border-y border-border bg-background sm:rounded sm:border">
                                  <div
                                    class="flex min-w-0 items-center justify-between gap-3 px-3 py-1.5 text-xs">
                                    <span
                                      class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono">
                                      {change.path}
                                    </span>
                                    <div class="flex items-center gap-2 text-muted-foreground">
                                      {#if getPrFileStats(change.diffHunks).additions > 0}
                                        <span class="text-emerald-700 dark:text-emerald-300"
                                          >+{getPrFileStats(change.diffHunks).additions}</span>
                                      {/if}
                                      {#if getPrFileStats(change.diffHunks).deletions > 0}
                                        <span class="text-rose-700 dark:text-rose-300"
                                          >-{getPrFileStats(change.diffHunks).deletions}</span>
                                      {/if}
                                    </div>
                                  </div>
                                  <div
                                    class="border-t border-border px-0 pb-0 pt-0 sm:px-3 sm:pb-3 sm:pt-1.5">
                                    <DiffViewer
                                      diff={[getPrCommitReviewDiff(change)]}
                                      showLineNumbers={true}
                                      expandAll={true}
                                      comments={prDiffComments}
                                      rootEvent={getPrCommitDiffRootEvent(oid)}
                                      onComment={handlePrDiffCommentSubmit}
                                      {canEditComment}
                                      onCommentEdited={$pubkey ? onCommentEdited : undefined}
                                      currentPubkey={$pubkey}
                                      repo={repoClass}
                                      repoRefs={commentRepoRefs}
                                      relayHint={commentRelayHint}
                                      enablePermalinks={false}
                                      enableHashNavigation={false}
                                      scrollTarget={prInlineScrollTarget?.mode === "commit" &&
                                      prInlineScrollTarget.commitId === oid &&
                                      prInlineScrollTarget.filePath === change.path
                                        ? prInlineScrollTarget
                                        : null}
                                      showFileHeaders={false}
                                      compact={true}
                                      framed={false} />
                                  </div>
                                </div>
                              {/each}
                            </div>
                          {:else}
                            <p class="text-sm text-muted-foreground">
                              {commitState.warning
                                ? "Diff unavailable for this commit."
                                : "No file changes in this commit."}
                            </p>
                          {/if}
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </TabsContent>

          <TabsContent value="files" class="mt-0" id="pr-files-tab-panel">
            {#if prChangesLoading}
              <div
                class="flex items-center gap-2 rounded border bg-background/50 p-4 text-sm text-muted-foreground">
                <Loader2 class="h-4 w-4 animate-spin" />
                {prChangesProgress || "Loading file diffs..."}
              </div>
            {:else if prChangesError}
              <div
                class="space-y-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                <p>{prChangesError}</p>
                <Button variant="outline" size="sm" onclick={() => loadPrChanges()}>
                  Retry file diff
                </Button>
              </div>
            {:else if prChanges}
              <div
                class="divide-y divide-border bg-background/50 {prReviewHasExpandedItem
                  ? 'border-y sm:rounded sm:border'
                  : 'rounded border'}">
                {#each prChanges as change (change.path)}
                  {@const isExpanded = prExpandedFiles.has(change.path)}
                  {@const statusInfo = getPrFileStatusIcon(change.status)}
                  {@const stats = getPrFileStats(change.diffHunks)}
                  {@const IconComponent = statusInfo.icon}
                  <div
                    class="overflow-x-auto"
                    id={prDiffAnchors[change.path]
                      ? `diff-${prDiffAnchors[change.path]}`
                      : undefined}>
                    <button
                      type="button"
                      onclick={() => togglePrFile(change.path)}
                      class="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50">
                      <div class="flex min-w-0 flex-1 items-center gap-2">
                        {#if isExpanded}
                          <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
                        {:else}
                          <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
                        {/if}
                        <IconComponent class="h-4 w-4 shrink-0 {statusInfo.class}" />
                        <span
                          class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">
                          {change.path}
                        </span>
                        <span
                          class="shrink-0 rounded-full border px-2 py-0.5 text-xs {change.status ===
                          'added'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                            : change.status === 'deleted'
                              ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
                              : change.status === 'modified'
                                ? 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200'
                                : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}">
                          {change.status}
                        </span>
                      </div>
                      <div class="flex shrink-0 gap-2 text-sm text-muted-foreground">
                        {#if stats.additions > 0}
                          <span class="text-emerald-700 dark:text-emerald-300"
                            >+{stats.additions}</span>
                        {/if}
                        {#if stats.deletions > 0}
                          <span class="text-rose-700 dark:text-rose-300">-{stats.deletions}</span>
                        {/if}
                      </div>
                    </button>
                    {#if isExpanded}
                      <div class="border-t border-border px-0 pb-0 pt-0 sm:px-3 sm:pb-3 sm:pt-1.5">
                        <DiffViewer
                          diff={[prChangeToParseDiffFile(change)]}
                          showLineNumbers={true}
                          expandAll={true}
                          comments={prDiffComments}
                          rootEvent={prDiffRootEvent}
                          onComment={handlePrDiffCommentSubmit}
                          {canEditComment}
                          onCommentEdited={$pubkey ? onCommentEdited : undefined}
                          currentPubkey={$pubkey}
                          repo={repoClass}
                          repoRefs={commentRepoRefs}
                          relayHint={commentRelayHint}
                          enablePermalinks={false}
                          enableHashNavigation={false}
                          scrollTarget={prInlineScrollTarget?.mode === "files" &&
                          prInlineScrollTarget.filePath === change.path
                            ? prInlineScrollTarget
                            : null}
                          showFileHeaders={false}
                          showFileAnchors={false}
                          compact={true}
                          framed={false} />
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-sm text-muted-foreground">
                No file changes found for this diff range.
              </p>
            {/if}
          </TabsContent>
        </Tabs>
      </div>

      <!-- PR updates (1619) timeline + merge status -->
      {#if prUpdatesArray.length > 0 || (prStatus?.status === "applied" && prStatus?.createdAt)}
        <div class="mb-6 space-y-2">
          <h2 class="flex items-center gap-2 text-lg font-medium">
            <GitCommit class="h-5 w-5" />
            Updates
            {#if prUpdatesArray.length > 0}
              ({prUpdatesArray.length})
            {/if}
          </h2>
          <ul class="space-y-2 rounded-lg border bg-muted/20 p-3">
            {#each prUpdatesArray as update}
              <li class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span class="text-muted-foreground">Tip updated to</span>
                <code class="rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                  {update.tipCommitOid?.substring(0, 8) ?? "—"}
                </code>
                <span class="text-muted-foreground">
                  {new Date(update.createdAt).toLocaleString()}
                </span>
                <ProfileLink pubkey={update.author.pubkey} relays={profileRelays} />
              </li>
            {/each}
            {#if prStatus?.status === "applied" && prStatus?.createdAt}
              <li class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <CheckCircle class="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                <span class="text-muted-foreground">Merged</span>
                <span class="text-muted-foreground">
                  {formatTimestamp(prStatus.createdAt)}
                </span>
                <span class="text-muted-foreground">by</span>
                <ProfileLink pubkey={prStatus.author.pubkey} relays={profileRelays} />
              </li>
            {/if}
          </ul>
        </div>
      {/if}

      <!-- Update PR button (author only; unlimited updates until applied/closed) -->
      {#if canPublishPrUpdates}
        <div class="mb-6">
          {#if showUpdatePrForm}
            <div class="rounded-lg border bg-muted/20 p-4">
              <h3 class="mb-3 font-medium">Update PR</h3>
              {#if !updatePrPreview?.success && updatePrTriedTipFirst}
                <div class="mb-3 space-y-2">
                  <label for="update-pr-source-branch" class="block text-xs text-muted-foreground"
                    >Source branch (if auto-detect failed):</label>
                  <input
                    id="update-pr-source-branch"
                    type="text"
                    bind:value={updatePrSourceBranch}
                    placeholder="e.g. feature/my-changes"
                    class="w-full rounded border border-input bg-background px-2 py-1.5 font-mono text-sm" />
                  <div class="text-xs text-muted-foreground">
                    <span class="font-mono">{updatePrSourceBranch || "(enter above)"}</span>
                    <span class="mx-1">→</span>
                    <span class="font-mono">{prTargetBranch}</span>
                  </div>
                </div>
              {:else if updatePrPreview?.success && !updatePrSourceBranch}
                <p class="mb-3 text-xs text-muted-foreground">
                  Found commits on top of PR tip. No branch name needed.
                </p>
              {:else}
                <div class="mb-3 space-y-2">
                  <label for="update-pr-source-branch" class="block text-xs text-muted-foreground"
                    >Your source branch:</label>
                  <input
                    id="update-pr-source-branch"
                    type="text"
                    bind:value={updatePrSourceBranch}
                    placeholder="e.g. feature/my-changes"
                    class="w-full rounded border border-input bg-background px-2 py-1.5 font-mono text-sm" />
                  <div class="text-xs text-muted-foreground">
                    <span class="font-mono">{updatePrSourceBranch || "(enter above)"}</span>
                    <span class="mx-1">→</span>
                    <span class="font-mono">{prTargetBranch}</span>
                  </div>
                </div>
              {/if}
              {#if updatePrPreviewLoading}
                <div class="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 class="h-4 w-4 animate-spin" />
                  <span>Loading commits…</span>
                </div>
              {:else if updatePrPreview?.error}
                <p class="mb-3 text-sm text-rose-700 dark:text-rose-300">{updatePrPreview.error}</p>
              {:else if updatePrPreview?.success && updatePrPreview.commits?.length}
                <div
                  class="mb-3 max-h-24 overflow-y-auto rounded border bg-background/50 p-2 text-xs">
                  <span class="font-medium">{updatePrPreview.commits.length} commit(s)</span>
                  <ul class="mt-1 space-y-0.5 font-mono">
                    {#each updatePrPreview.commits.slice(0, 10) as c (c.oid)}
                      <li class="flex gap-2 truncate">
                        <span class="shrink-0 text-muted-foreground">{c.oid?.substring(0, 7)}</span>
                        <span class="truncate">{c.message?.split("\n")[0] ?? "-"}</span>
                      </li>
                    {/each}
                    {#if updatePrPreview.commits.length > 10}
                      <li class="text-muted-foreground">
                        … and {updatePrPreview.commits.length - 10} more
                      </li>
                    {/if}
                  </ul>
                </div>
              {/if}
              {#if updatePrError}
                <p class="mb-2 text-sm text-rose-700 dark:text-rose-300">{updatePrError}</p>
              {/if}
              <div class="flex gap-2">
                <Button
                  onclick={submitPrUpdate}
                  disabled={isPublishingPrUpdate ||
                    updatePrPreviewLoading ||
                    !updatePrPreview?.success ||
                    !updatePrPreview?.commitOids?.length}>
                  {isPublishingPrUpdate ? "Publishing…" : "Publish update"}
                </Button>
                <Button
                  variant="outline"
                  onclick={() => {
                    showUpdatePrForm = false
                    updatePrSourceBranch = ""
                    updatePrTriedTipFirst = false
                  }}>
                  Cancel
                </Button>
              </div>
            </div>
          {:else}
            <Button variant="outline" onclick={() => (showUpdatePrForm = true)}>
              Update PR (push new commits)
            </Button>
          {/if}
        </div>
      {:else if prUpdateBlockedReason}
        <div
          class="mb-6 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          {prUpdateBlockedReason}
        </div>
      {/if}

      <div class="space-y-4">
        <h2 class="flex items-center gap-2 text-lg font-medium">
          <MessageSquare class="h-5 w-5" />
          Discussion ({prThreadCommentsCount})
        </h2>

        {#if prThreadComments}
          <IssueThread
            issueId={prEvent?.id || ""}
            issueKind={"1618"}
            comments={prThreadCommentsArray}
            currentCommenter={$pubkey || ""}
            onCommentCreated={$pubkey ? onCommentCreated : undefined}
            {canEditComment}
            onCommentEdited={$pubkey ? onCommentEdited : undefined}
            onLoginRequired={requireLogin}
            relays={repoRelays?.length ? repoRelays : repoClass.relays || []}
            repoAddress={repoClass.address || ""}
            rootEvent={prEvent}
            repoRefs={commentRepoRefs}
            relayHint={commentRelayHint}
            ownerPubkey={repoOwnerPubkey}
            onInlineCommentOpen={openPrInlineCommentLocation}
            enableReplies />
        {/if}
      </div>
    </div>
  </div>
</div>
