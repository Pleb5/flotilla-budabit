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
  } from "@lucide/svelte"
  import {Button, DiffViewer, IssueThread, MergeStatus, prChangeToParseDiffFile, toast} from "@nostr-git/ui"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {profilesByPubkey, pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {load, PublishStatus} from "@welshman/net"
  import {
    COMMENT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {
    parseStatusEvent,
    parsePullRequestUpdateEvent,
    createPullRequestUpdateEvent,
    createStatusEvent,
    createRepoStateEvent,
    type CommentEvent,
    type StatusEvent,
    type PullRequestEvent,
    GIT_PULL_REQUEST_UPDATE,
    GIT_STATUS_APPLIED,
  } from "@nostr-git/core/events"
  import {postComment, postPermalink, postStatus, publishEvent} from "@lib/budabit"
  import {githubPermalinkDiffId, type PRMergeAnalysisResult} from "@nostr-git/core/git"
  import {getCloneUrlsFromEvent} from "@nostr-git/core/utils"
  import {nip19} from "nostr-tools"
  import {normalizeRelayUrl} from "@welshman/util"
  import Profile from "@src/app/components/Profile.svelte"
  import Markdown from "@src/lib/components/Markdown.svelte"
  import {slideAndFade} from "@src/lib/transition"
  import type {Repo} from "@nostr-git/ui"

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

  interface Props {
    pr: ReturnType<typeof import("@nostr-git/core/events").parsePullRequestEvent>
    prEvent: PullRequestEvent
    repo: Repo
    repoRelays: string[]
  }

  const {pr, prEvent, repo: repoClass, repoRelays}: Props = $props()

  // PR-specific status and comments
  const getPrStatusFilter = () => ({
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [prEvent?.id ?? ""],
  })

  const prStatusEvents = $derived.by(() => {
    if (!prEvent) return undefined
    return deriveEventsAsc(deriveEventsById({repository, filters: [getPrStatusFilter()]}))
  })

  const prStatus = $derived.by(() => {
    if (!prEvent || !prStatusEvents) return undefined
    const events = $prStatusEvents as any[]
    if (!events || events.length === 0) return undefined
    const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0]
    return latest ? parseStatusEvent(latest as StatusEvent) : undefined
  })

  const prThreadComments = $derived.by(() => {
    if (!prEvent) return undefined
    const filters: Filter[] = [{kinds: [COMMENT], "#E": [prEvent.id]}]
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    load({relays: relays as string[], filters})
    return deriveEventsAsc(deriveEventsById({repository, filters}))
  })

  const prThreadCommentsArray = $derived.by(() => {
    if (!prThreadComments) return []
    return $prThreadComments as CommentEvent[]
  })
  const prThreadCommentsCount = $derived.by(() => prThreadCommentsArray.length)

  const prUpdatesFilter = $derived.by(() =>
    prEvent ? [{kinds: [GIT_PULL_REQUEST_UPDATE], "#E": [prEvent.id]}] as Filter[] : [],
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
      .sort((a: TrustedEvent, b: TrustedEvent) => a.created_at - b.created_at)
      .map((e: TrustedEvent) => parsePullRequestUpdateEvent(e as any))
  })

  const prEffectiveTipAndCommits = $derived.by(() => {
    if (!pr) return null
    const updates = prUpdatesArray
    if (updates.length > 0) {
      const latest = updates[updates.length - 1]
      const commits = latest.commits || []
      const tipOid = commits[0]
      return tipOid ? {tipOid, allCommitOids: commits} : null
    }
    const commits = pr.commits || []
    return commits.length > 0 ? {tipOid: commits[0], allCommitOids: commits} : null
  })

  /** Clone URLs for PR source (fork); from latest update if present, else original PR event */
  const prEffectiveCloneUrls = $derived.by(() => {
    const updates = prUpdatesArray
    if (updates.length > 0) {
      const latest = updates[updates.length - 1]
      const urls = getCloneUrlsFromEvent(latest.raw)
      if (urls.length > 0) return urls
    }
    return getCloneUrlsFromEvent(pr?.raw ?? { tags: [] })
  })

  /** Target branch from PR event, fallback to repo selection */
  const prTargetBranch = $derived(pr?.branchName ?? repoClass?.selectedBranch ?? repoClass?.mainBranch ?? "main")

  let prMergeAnalysisResult: PRMergeAnalysisResult | null = $state(null)
  let isAnalyzingPRMerge = $state(false)
  let prAnalysisProgress = $state("")
  let prAnalysisGeneration = $state(0)
  let lastPrAnalysisKey = $state<string | null>(null)

  let prChanges = $state<PrChange[] | null>(null)
  let prChangesLoading = $state(false)
  let prChangesError = $state<string | null>(null)
  let prExpandedFiles = $state<Set<string>>(new Set())
  let prDiffAnchors = $state<Record<string, string>>({})

  async function runPRMergeAnalysis() {
    if (!pr || !prEvent || !prEffectiveTipAndCommits || !repoClass.key || !repoClass.workerManager)
      return
    const {tipOid, allCommitOids} = prEffectiveTipAndCommits
    const prCloneUrls = getCloneUrlsFromEvent(pr.raw)
    const cloneUrls = prCloneUrls.length > 0 ? prCloneUrls : ((repoClass as any).cloneUrls || [])
    if (cloneUrls.length === 0) return

    const analysisKey = `${prEvent.id}-${tipOid}-${prTargetBranch}`

    prAnalysisGeneration++
    const myGen = prAnalysisGeneration
    lastPrAnalysisKey = analysisKey
    isAnalyzingPRMerge = true
    prAnalysisProgress = "Fetching PR from clone URL..."
    prMergeAnalysisResult = null

    try {
      const result = await repoClass.getPRMergeAnalysis(cloneUrls, tipOid, prTargetBranch, allCommitOids)
      if (prAnalysisGeneration === myGen) {
        prMergeAnalysisResult =
          result ?? {
            canMerge: false,
            hasConflicts: false,
            conflictFiles: [],
            conflictDetails: [],
            upToDate: false,
            fastForward: false,
            patchCommits: allCommitOids,
            analysis: "error",
            errorMessage: "Analysis returned no result",
          }
      }
    } catch (err) {
      if (prAnalysisGeneration === myGen) {
        prMergeAnalysisResult = {
          canMerge: false,
          hasConflicts: false,
          conflictFiles: [],
          conflictDetails: [],
          upToDate: false,
          fastForward: false,
          patchCommits: prEffectiveTipAndCommits!.allCommitOids,
          analysis: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        }
      }
    } finally {
      if (prAnalysisGeneration === myGen) {
        isAnalyzingPRMerge = false
        prAnalysisProgress = ""
      }
    }
  }

  $effect(() => {
    if (!pr || !prEvent || !prEffectiveTipAndCommits || !repoClass.key || !repoClass.workerManager)
      return
    const {tipOid} = prEffectiveTipAndCommits
    const analysisKey = `${prEvent.id}-${tipOid}-${prTargetBranch}`

    if (lastPrAnalysisKey === analysisKey) return
    runPRMergeAnalysis()
  })

  $effect(() => {
    const result = prMergeAnalysisResult
    const tip = prEffectiveTipAndCommits?.tipOid
    const mergeBase = result?.mergeBase
    if (!result || !tip || !mergeBase || !repoClass.key || !repoClass.workerManager) return

    let cancelled = false
    prChangesLoading = true
    prChangesError = null
    prChanges = null

    ;(repoClass.workerManager as any)
      .getDiffBetween({
        repoId: repoClass.key,
        baseOid: mergeBase,
        headOid: tip,
      })
      .then((res: {success: boolean; changes?: PrChange[]; error?: string}) => {
        if (cancelled) return
        if (res.success && res.changes) {
          prChanges = res.changes
          prChangesError = null
        } else {
          prChanges = []
          prChangesError = res.error || "Failed to load diff"
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        prChanges = []
        prChangesError = err instanceof Error ? err.message : "Failed to load diff"
      })
      .finally(() => {
        if (!cancelled) prChangesLoading = false
      })

    return () => {
      cancelled = true
    }
  })

  $effect(() => {
    const key = lastPrAnalysisKey
    return () => {
      if (key !== lastPrAnalysisKey) {
        prChanges = null
        prChangesError = null
      }
    }
  })

  const getPrFileStatusIcon = (status: string) => {
    switch (status) {
      case "added":
        return {icon: FilePlus, class: "text-green-600"}
      case "deleted":
        return {icon: FileMinus, class: "text-red-600"}
      case "modified":
        return {icon: FileCode, class: "text-blue-600"}
      case "renamed":
        return {icon: FileX, class: "text-amber-600"}
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

  const prDiffComments = $derived.by(() => {
    const comments = prThreadCommentsArray
    if (!comments || comments.length === 0) return []
    return comments.map((commentEvent: CommentEvent) => {
      let lineNumber = 0
      let filePath = ""
      let content = commentEvent.content
      const separatorIndex = content.indexOf("\n\n---\n")
      if (separatorIndex !== -1) {
        content = content.substring(0, separatorIndex).trim()
        const metadataSection = commentEvent.content.substring(separatorIndex + 6)
        const fileMatch = metadataSection.match(/File:\s*(.+?)(?:\n|$)/i)
        if (fileMatch) filePath = fileMatch[1].trim()
        const lineMatch = metadataSection.match(/Line:\s*(\d+)/i)
        if (lineMatch) lineNumber = parseInt(lineMatch[1], 10)
      }
      const profile = $profilesByPubkey.get(commentEvent.pubkey)
      const authorName = profile?.name || profile?.display_name || commentEvent.pubkey.slice(0, 8)
      const authorAvatar = profile?.picture || ""
      return {
        id: commentEvent.id || "",
        lineNumber,
        filePath,
        content,
        author: {name: authorName, avatar: authorAvatar},
        createdAt: new Date(commentEvent.created_at * 1000).toISOString(),
      }
    })
  })

  const handlePrDiffCommentSubmit = async (comment: any) => {
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    try {
      await postComment(comment, relays)
      toast.push({message: "Comment posted", timeout: 2000})
    } catch (e) {
      toast.push({message: "Failed to post comment", timeout: 3000, variant: "destructive"})
    }
  }

  /** PR event with commit/parent-commit tags for DiffViewer permalinks and comments */
  const prDiffRootEvent = $derived.by(() => {
    if (!prEvent) return undefined
    const tipOid = prEffectiveTipAndCommits?.tipOid
    const mergeBase = prMergeAnalysisResult?.mergeBase
    const tags: string[][] = [...(prEvent.tags || []).map((t) => (Array.isArray(t) ? [...t] : [String(t)]))]
    if (tipOid && !tags.some((t) => t[0] === "commit")) {
      tags.push(["commit", tipOid])
    }
    if (mergeBase && !tags.some((t) => t[0] === "parent-commit")) {
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

  $effect(() => {
    const changes = prChanges
    if (!changes || changes.length === 0) {
      prDiffAnchors = {}
      return
    }
    let cancelled = false
    const paths = changes.map((c) => c.path)
    Promise.all(paths.map(async (path) => [path, await githubPermalinkDiffId(path)] as const))
      .then((entries) => {
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
    mergeBase?: string
  } | null>(null)
  let updatePrPreviewLoading = $state(false)
  let isPublishingPrUpdate = $state(false)
  let updatePrError = $state("")

  let updatePrSourceBranch = $state("")
  let updatePrTriedTipFirst = $state(false)

  // Try tip-based preview first when form opens (no branch name needed)
  $effect(() => {
    if (!showUpdatePrForm || !repoClass?.workerManager || !prEffectiveTipAndCommits?.tipOid) {
      if (!showUpdatePrForm) {
        updatePrPreview = null
        updatePrTriedTipFirst = false
      }
      return
    }
    if (updatePrSourceBranch.trim()) return
    const tipOid = prEffectiveTipAndCommits.tipOid
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
        ...(sourceCloneUrls && { sourceCloneUrls }),
      })
      .then((result: typeof updatePrPreview) => {
        if (cancelled) return
        updatePrPreview = result
        updatePrPreviewLoading = false
      })
      .catch((err: unknown) => {
        if (cancelled) return
        updatePrPreview = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          commits: [],
          commitOids: [],
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
        ...(sourceCloneUrls && { sourceCloneUrls }),
      })
      .then((result) => {
        if (cancelled) return
        updatePrPreview = result
        updatePrPreviewLoading = false
      })
      .catch((err) => {
        if (cancelled) return
        updatePrPreview = {
          success: false,
          error: err?.message,
          commits: [],
          commitOids: [],
        }
        updatePrPreviewLoading = false
      })
    return () => {
      cancelled = true
    }
  })

  const submitPrUpdate = async () => {
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
      const cloneUrls = prEffectiveCloneUrls.length > 0 ? prEffectiveCloneUrls : ((repoClass as any)?.cloneUrls as string[]) || []
      if (cloneUrls.length === 0) {
        updatePrError = "No clone URLs available (PR and repo have none)"
        isPublishingPrUpdate = false
        return
      }
      let mergeBase = updatePrPreview.mergeBase
      if (!mergeBase && updatePrPreview.commitOids?.length) {
        const targetCloneUrls = (repoClass as any)?.cloneUrls ?? []
        const mbResult = await (repoClass.workerManager as any).getMergeBaseBetween({
          repoId: repoClass.key,
          headOid: updatePrPreview.commitOids[0],
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
      const recipients = (repoClass as any)?.maintainers ?? []
      const unsigned = createPullRequestUpdateEvent({
        repoAddr,
        pullRequestEventId: prEvent.id,
        pullRequestAuthorPubkey: prEvent.pubkey,
        commits: updatePrPreview.commitOids,
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

  const onCommentCreated = async (comment: CommentEvent) => {
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    postComment(comment, relays)
  }

  // PR merge state
  let isMergingPr = $state(false)
  let mergePrStep = $state("")
  let mergePrError = $state<string | null>(null)
  let mergePrSuccess = $state(false)
  let mergePrResult = $state<{
    mergeCommitOid?: string
    pushedRemotes?: string[]
    skippedRemotes?: string[]
    pushErrors?: Array<{remote: string; url: string; error: string; code: string; stack: string}>
  } | null>(null)
  let showPrMergeDialog = $state(false)
  let mergePrCommitMessage = $state("")
  let isMarkingApplied = $state(false)
  let markAsAppliedSuccess = $state(false)

  const applyPR = () => {
    if (!pr || !prEvent || !prEffectiveTipAndCommits) return
    isMergingPr = false
    mergePrStep = ""
    mergePrError = null
    mergePrSuccess = false
    mergePrResult = null
    // Only set a merge commit message if it's not a fast-forward merge
    mergePrCommitMessage = prMergeAnalysisResult?.fastForward ? "" : `Merge PR: ${pr.subject || "Untitled"}`
    showPrMergeDialog = true
  }

  const executePRMerge = async () => {
    if (
      !pr ||
      !prEvent ||
      !prEffectiveTipAndCommits ||
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

    const cloneUrls = getCloneUrlsFromEvent(pr.raw)
    const prCloneUrls = cloneUrls.length > 0 ? cloneUrls : ((repoClass as any).cloneUrls || [])
    if (prCloneUrls.length === 0) {
      mergePrError = "No clone URLs available for this PR"
      mergePrStep = "Setup failed"
      isMergingPr = false
      toast.push({message: "No clone URLs for PR", timeout: 5000, variant: "destructive"})
      return
    }

    try {
      const syncResult = await repoClass.workerManager.syncWithRemote({
        repoId: repoClass.key,
        cloneUrls: (repoClass as any).cloneUrls || [],
        branch: prTargetBranch,
      })
      if (!syncResult.success && !syncResult.error?.includes("Repository not cloned")) {
        console.warn("Sync before merge had issues, but continuing:", syncResult.error)
      }
    } catch {
      /* continue */
    }

    mergePrStep = "Merging PR..."
    const {tipOid, allCommitOids} = prEffectiveTipAndCommits

    try {
      const result = await repoClass.workerManager.mergePRAndPush({
        repoId: repoClass.key,
        cloneUrls: prCloneUrls,
        tipCommitOid: tipOid,
        targetBranch: prTargetBranch,
        mergeCommitMessage: mergePrCommitMessage || undefined,
        fastForward: prMergeAnalysisResult?.fastForward === true,
        userPubkey: $pubkey ?? undefined,
        // Publish Nostr state event (kind 30618) with the new merge commit SHA to the GRASP relay
        // before the git push. GRASP authorises pushes by checking for this event on the relay.
        publishStateEvent: async ({repoName, branch, commitSha, relayUrl}) => {
          console.log(`[PRView] Publishing state event: repo=${repoName}, branch=${branch}, commit=${commitSha}, relay=${relayUrl}`)
          
          const stateEvent = createRepoStateEvent({
            repoId: repoName,
            head: branch,
            refs: [{type: "heads", name: branch, commit: commitSha}],
          })
          
          console.log(`[PRView] Created state event:`, {
            kind: stateEvent.kind,
            tags: stateEvent.tags,
            repoId: repoName,
            commitSha
          })
          
          const thunk = publishEvent(stateEvent as any, [relayUrl])
          // Wait for relay confirmation; cap at 15 s so we don't block forever
          await Promise.race([thunk.complete, new Promise(r => setTimeout(r, 15000))])
          
          // Verify the GRASP relay confirmed the event. ngit-cli skips the push
          // entirely when the relay hasn't confirmed, so we do the same.
          const confirmed = Object.entries(thunk.results ?? {}).some(
            ([url, r]) =>
              r?.status === PublishStatus.Success &&
              (url === relayUrl || url.replace(/\/$/, "") === relayUrl.replace(/\/$/, ""))
          )
          
          console.log(`[PRView] State event confirmation:`, { 
            confirmed, 
            results: thunk.results,
            targetRelay: relayUrl 
          })
          
          if (!confirmed) {
            // Normalize the relay URL for the error — use the ws URL the user will recognize
            throw new Error(
              `State event (kind 30618) was not confirmed by GRASP relay ${relayUrl}. ` +
              `Push aborted — the relay must acknowledge the event before the server accepts the push.`
            )
          }
        },
      })

      if (result.success) {
        mergePrSuccess = true
        mergePrResult = result
        mergePrStep = "Merge completed successfully!"
        if (result.warning) {
          toast.push({message: result.warning, timeout: 8000, variant: "default"})
        } else {
          toast.push({message: "PR merged successfully!", timeout: 5000})
        }
        await emitPRAppliedStatus(result.mergeCommitOid)
        load({
          relays: (repoRelays || []) as string[],
          filters: [getPrStatusFilter()],
        })
      } else {
        mergePrError = result.error || "Unknown merge error"
        mergePrStep = "Merge failed"
        toast.push({message: `Merge failed: ${mergePrError}`, timeout: 8000, variant: "destructive"})
      }
    } catch (error) {
      mergePrError = error instanceof Error ? error.message : "Unknown error"
      mergePrStep = "Merge failed"
      toast.push({message: `Merge error: ${mergePrError}`, timeout: 8000, variant: "destructive"})
    } finally {
      if (mergePrSuccess) {
        setTimeout(() => {
          isMergingPr = false
        }, 3000)
      } else {
        isMergingPr = false
      }
    }
  }

  const emitPRAppliedStatus = async (mergeCommitOid?: string) => {
    if (!prEvent || !$pubkey) return
    try {
      const commitIds = prEffectiveTipAndCommits?.allCommitOids || []
      const statusEvent = createStatusEvent({
        kind: GIT_STATUS_APPLIED,
        content: mergePrCommitMessage || `PR applied: ${pr?.subject || "Untitled"}`,
        rootId: prEvent.id,
        recipients: (repoClass as any).maintainers || [],
        repoAddr: (repoClass as any).repoId || (repoClass as any).address || "",
        relays: repoClass.relays || repoRelays || [],
        appliedCommits: commitIds.length > 0 ? commitIds : undefined,
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
    if (!prEvent || !$pubkey) return
    isMarkingApplied = true
    markAsAppliedSuccess = false
    try {
      await emitPRAppliedStatus(undefined)
      markAsAppliedSuccess = true
      toast.push({message: "PR marked as applied", timeout: 5000})
    } finally {
      isMarkingApplied = false
    }
  }

  const formatTimestamp = (timestamp: string | number) => {
    const date = new Date(typeof timestamp === "string" ? timestamp : timestamp * 1000)
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
    if (status === "applied") return "Applied"
    if (status === "closed") return "Closed"
    if (status === "draft") return "Draft"
    return "Status unknown"
  }

  const getStatusBadgeClass = (status?: string) => {
    if (status === "open") return "border-sky-200 bg-sky-100/80 text-sky-800"
    if (status === "applied") return "border-emerald-200 bg-emerald-100/80 text-emerald-800"
    if (status === "closed") return "border-rose-200 bg-rose-100/80 text-rose-800"
    if (status === "draft") return "border-amber-200 bg-amber-100/80 text-amber-800"
    return "border-border bg-secondary text-secondary-foreground"
  }
</script>

<div class="z-10 items-center justify-between py-4 backdrop-blur">
  <div>
    <div class="rounded-lg border border-border bg-card p-4 sm:p-6">
      <div class="mb-4 flex flex-col items-start justify-between gap-2">
        <div class="flex items-start gap-4">
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

        <div class="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-1">
          <div
            class={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-semibold ${getStatusBadgeClass(prStatus?.status)}`}>
            {getStatusLabel(prStatus?.status)}
          </div>
          <div class="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground sm:text-sm">
            {#if prEvent?.pubkey}
              <Profile pubkey={prEvent.pubkey} hideDetails={true}></Profile>
              <ProfileLink pubkey={prEvent.pubkey} />
            {/if}
            <span class="hidden sm:inline">•</span>
            <span>{formatTimestamp(pr?.createdAt || "")}</span>
          </div>
        </div>
      </div>

      <div
        class="prose-sm dark:prose-invert markdown-content prose mb-6 max-w-none text-muted-foreground">
        <Markdown content={pr?.content || ""} />
      </div>

      <!-- PR details -->
      {#if pr?.commits?.length || pr?.raw?.tags?.some((t) => t[0] === "clone")}
        <div class="mb-6 rounded-lg border bg-muted/20 p-4 text-sm">
          <h3 class="mb-2 font-medium">PR details</h3>
          {#if prEffectiveTipAndCommits?.tipOid}
            <div class="mb-2">
              <span class="text-muted-foreground">Tip commit:</span>
              <code class="ml-2 rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                {prEffectiveTipAndCommits.tipOid?.substring(0, 8) ?? ""}
              </code>
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
            {@const cloneTags = pr.raw.tags.filter((t) => t[0] === "clone")}
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

      <!-- PR merge analysis -->
      <div class="mb-6 rounded-lg border bg-muted/20 p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-medium">Merge analysis</h3>
          <Button
            variant="outline"
            size="sm"
            onclick={() => runPRMergeAnalysis()}
            disabled={isAnalyzingPRMerge}
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
          {#if prMergeAnalysisResult.usedCloneUrl}
            <p class="mt-2 text-xs text-muted-foreground">
              Fetched from: {prMergeAnalysisResult.usedCloneUrl}
            </p>
          {/if}
          {#if prMergeAnalysisResult.prCommits && prMergeAnalysisResult.prCommits.length > 0}
            <div class="mt-3">
              <h4 class="mb-2 text-sm font-medium">Commits ({prMergeAnalysisResult.prCommits.length})</h4>
              <ul class="space-y-1 text-xs">
                {#each prMergeAnalysisResult.prCommits.slice(0, 10) as c}
                  <li class="flex items-center gap-2">
                    <code class="rounded bg-background px-1 font-mono">{c.oid?.substring(0, 8)}</code>
                    <span class="truncate text-muted-foreground">{c.message?.split("\n")[0] || "-"}</span>
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
        {:else}
          <p class="text-sm text-muted-foreground">
            {prEffectiveTipAndCommits
              ? "Click Analyze to check mergeability."
              : "No tip commit available. Add commits to the PR branch first."}
          </p>
        {/if}
      </div>

      <!-- PR Merge section (maintainers only, when canMerge and open) -->
      {#if repoClass.maintainers?.includes($pubkey!) &&
        prMergeAnalysisResult?.canMerge === true &&
        prStatus?.status === "open" &&
        !prMergeAnalysisResult?.upToDate}
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
              <div class="flex items-center gap-2 text-blue-600">
                <Loader2 class="h-4 w-4 animate-spin" />
                <span class="text-sm font-medium">Merging...</span>
              </div>
            {:else if mergePrSuccess}
              <div class="flex items-center gap-2 text-green-600">
                <CheckCircle class="h-4 w-4" />
                <span class="text-sm font-medium">Merged</span>
              </div>
            {:else if mergePrError}
              <div class="flex items-center gap-2 text-red-600">
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
            <div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
              <div class="flex items-start gap-2">
                <AlertCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                <div class="flex-1">
                  <p class="text-sm font-medium text-red-800 dark:text-red-200">Merge failed</p>
                  <p class="mt-1 text-sm text-red-700 dark:text-red-300">{mergePrError}</p>
                  {#if mergePrError.toLowerCase().includes("push") || mergePrError.toLowerCase().includes("auth") || mergePrError.toLowerCase().includes("permission")}
                    <p class="mt-2 text-xs text-red-600 dark:text-red-400">
                      Tip: Configure a GitHub token in Settings to enable pushing to remotes.
                    </p>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          {#if mergePrSuccess && mergePrResult}
            <div class="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/30">
              <div class="flex items-start gap-2">
                <CheckCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
                <div class="flex-1">
                  <p class="text-sm font-medium text-green-800 dark:text-green-200">
                    PR merged successfully!
                  </p>
                  {#if mergePrResult.mergeCommitOid}
                    <p class="mt-1 text-sm text-green-700 dark:text-green-300">
                      Merge commit:
                      <code class="rounded bg-green-100 px-1 dark:bg-green-900/50"
                        >{mergePrResult.mergeCommitOid.slice(0, 8)}</code
                      >
                    </p>
                  {/if}
                  {#if mergePrResult.pushedRemotes && mergePrResult.pushedRemotes.length > 0}
                    <p class="mt-1 text-sm text-green-700 dark:text-green-300">
                      Pushed to: {mergePrResult.pushedRemotes.join(", ")}
                    </p>
                  {/if}
                  {#if mergePrResult.pushErrors && mergePrResult.pushErrors.length > 0}
                    <div class="mt-2 rounded border border-amber-200 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/30">
                      <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
                        Some remotes failed to push:
                      </p>
                      <ul class="mt-1 space-y-1 text-xs text-amber-700 dark:text-amber-300">
                        {#each mergePrResult.pushErrors.slice(0, 3) as err}
                          <li>
                            <strong>{err.remote}:</strong> {err.error}
                          </li>
                        {/each}
                        {#if mergePrResult.pushErrors.length > 3}
                          <li>+{mergePrResult.pushErrors.length - 3} more</li>
                        {/if}
                      </ul>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          <div class="flex justify-end">
            <Button
              onclick={applyPR}
              variant="default"
              disabled={isMergingPr || mergePrSuccess}
              class="min-w-[120px]">
              {#if isMergingPr}
                <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                Merging...
              {:else if mergePrSuccess}
                <CheckCircle class="mr-2 h-4 w-4" />
                Merged
              {:else}
                <GitMerge class="mr-2 h-4 w-4" />
                Merge PR
              {/if}
            </Button>
          </div>
        </div>
      {/if}

      <!-- Mark as applied (maintainers only, when up-to-date and open - no git ops) -->
      {#if repoClass.maintainers?.includes($pubkey!) &&
        prStatus?.status === "open" &&
        prMergeAnalysisResult &&
        prMergeAnalysisResult.upToDate === true}
        <div class="mb-6 rounded-lg border bg-card p-6">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <CheckCircle class="h-5 w-5 text-primary" />
              <div>
                <h3 class="font-semibold">Mark as applied</h3>
                <p class="text-sm text-muted-foreground">
                  No changes to merge. Publish applied status without git operations.
                </p>
              </div>
            </div>
            {#if markAsAppliedSuccess}
              <div class="flex items-center gap-2 text-green-600">
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
                Mark as applied
              {/if}
            </Button>
          </div>
        </div>
      {/if}

      {#if showPrMergeDialog}
        <div
          class="z-50 fixed inset-0 flex items-center justify-center bg-black/50"
          transition:slideAndFade>
          <div class="mx-4 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
            <div class="mb-4 flex items-center gap-3">
              <GitMerge class="h-5 w-5 text-primary" />
              <h3 class="text-lg font-semibold">
                {prMergeAnalysisResult?.fastForward ? 'Confirm Fast-forward' : 'Confirm Merge'}
              </h3>
            </div>
          <div class="mb-6 space-y-4">
            <p class="text-sm text-muted-foreground">
              {#if prMergeAnalysisResult?.fastForward}
                This will fast-forward the
                <code class="rounded bg-muted px-1">{prTargetBranch}</code>
                branch to include the PR commits and push to all remotes.
              {:else}
                This will merge the PR into
                <code class="rounded bg-muted px-1">{prTargetBranch}</code>
                and push to all remotes.
              {/if}
            </p>
            {#if prMergeAnalysisResult?.fastForward}
              <div class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
                <p class="text-sm text-blue-800 dark:text-blue-200">
                  <strong>Fast-forward merge:</strong> No merge commit will be created. The branch will be moved to point to the latest commit.
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
                {prMergeAnalysisResult?.fastForward ? 'Fast-forward' : 'Confirm Merge'}
              </Button>
            </div>
          </div>
        </div>
      {/if}

      <!-- PR changes (file diffs) -->

        <div id="pr-changes" class="mb-6 scroll-mt-4 rounded-lg border bg-muted/20 p-4">
          {#if prChangesLoading}
            <div class="flex items-center gap-2 rounded border bg-background/50 p-4 text-sm text-muted-foreground">
              <Loader2 class="h-4 w-4 animate-spin" />
              Loading file diffs...
            </div>
          {:else if prChangesError}
            <p
              class="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {prChangesError}
            </p>
          {:else if prChanges}
            <div class="mb-3 flex items-center justify-between">
              <h3 class="font-medium">Files Changed ({prChanges.length})</h3>
              {#if prChanges && prChanges.length > 0}
                <div class="flex gap-2">
                  <button
                    type="button"
                    onclick={() => {
                      prExpandedFiles = new Set(prChanges!.map((c) => c.path))
                    }}
                    disabled={prExpandedFiles.size === prChanges!.length}
                    class="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                    Expand all
                  </button>
                  <button
                    type="button"
                    onclick={() => {
                      prExpandedFiles = new Set()
                    }}
                    disabled={prExpandedFiles.size === 0}
                    class="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                    Collapse all
                  </button>
                </div>
              {/if}
            </div>
            <div class="divide-y divide-border rounded border bg-background/50">
              {#each prChanges as change (change.path)}
                {@const isExpanded = prExpandedFiles.has(change.path)}
                {@const statusInfo = getPrFileStatusIcon(change.status)}
                {@const stats = getPrFileStats(change.diffHunks)}
                {@const IconComponent = statusInfo.icon}
                <div
                  class="overflow-x-auto"
                  id={prDiffAnchors[change.path] ? `diff-${prDiffAnchors[change.path]}` : undefined}>
                  <button
                    type="button"
                    onclick={() => togglePrFile(change.path)}
                    class="flex w-full min-h-[44px] items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50">
                    <div class="flex min-w-0 items-center gap-2">
                      {#if isExpanded}
                        <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
                      {:else}
                        <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
                      {/if}
                      <IconComponent class="h-4 w-4 shrink-0 {statusInfo.class}" />
                      <span class="truncate font-mono text-xs">{change.path}</span>
                      <span
                        class="shrink-0 rounded-full border px-2 py-0.5 text-xs {change.status === "added"
                          ? "border-green-200 bg-green-50 text-green-800"
                          : change.status === "deleted"
                            ? "border-red-200 bg-red-50 text-red-800"
                            : change.status === "modified"
                              ? "border-blue-200 bg-blue-50 text-blue-800"
                              : "border-amber-200 bg-amber-50 text-amber-800"}">
                        {change.status}
                      </span>
                    </div>
                    <div class="flex shrink-0 gap-2 text-sm text-muted-foreground">
                      {#if stats.additions > 0}
                        <span class="text-green-600">+{stats.additions}</span>
                      {/if}
                      {#if stats.deletions > 0}
                        <span class="text-red-600">-{stats.deletions}</span>
                      {/if}
                    </div>
                  </button>
                  {#if isExpanded}
                    <div class="border-t border-border px-4 pb-4 pt-2">
                      <DiffViewer
                        diff={[prChangeToParseDiffFile(change)]}
                        showLineNumbers={true}
                        expandAll={true}
                        comments={prDiffComments}
                        rootEvent={prDiffRootEvent}
                        onComment={handlePrDiffCommentSubmit}
                        currentPubkey={$pubkey}
                        repo={repoClass}
                        publish={async (permalink) => {
                          const relays = (repoRelays || [])
                            .map((u: string) => normalizeRelayUrl(u))
                            .filter(Boolean)
                          const thunk = postPermalink(permalink, relays)
                          toast.push({message: "Permalink published", timeout: 2000})
                          const nevent = nip19.neventEncode({
                            id: thunk.event.id,
                            kind: thunk.event.kind,
                            relays,
                          })
                          await navigator.clipboard.writeText(nevent)
                          toast.push({message: "Permalink copied", timeout: 2000})
                        }}
                        enablePermalinks={true}
                      />
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            {:else}
              <p class="text-sm text-muted-foreground">No changes to show.</p>
          {/if}
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
                  {update.commits?.[0]?.substring(0, 8) ?? "—"}
                </code>
                <span class="text-muted-foreground">
                  {new Date(update.createdAt).toLocaleString()}
                </span>
                <ProfileLink pubkey={update.author.pubkey} />
              </li>
            {/each}
            {#if prStatus?.status === "applied" && prStatus?.createdAt}
              <li class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <CheckCircle class="h-4 w-4 text-green-600 shrink-0" />
                <span class="text-muted-foreground">Merged</span>
                <span class="text-muted-foreground">
                  {formatTimestamp(prStatus.createdAt)}
                </span>
                <span class="text-muted-foreground">by</span>
                <ProfileLink pubkey={prStatus.author.pubkey} />
              </li>
            {/if}
          </ul>
        </div>
      {/if}

      <!-- Update PR button (author only, hidden when PR is applied) -->
      {#if prEvent && $pubkey === prEvent.pubkey && prStatus?.status === "open"}
        <div class="mb-6">
          {#if showUpdatePrForm}
            <div class="rounded-lg border bg-muted/20 p-4">
              <h3 class="mb-3 font-medium">Update PR</h3>
              {#if !updatePrPreview?.success && updatePrTriedTipFirst}
                <div class="mb-3 space-y-2">
                  <label for="update-pr-source-branch" class="block text-xs text-muted-foreground">Source branch (if auto-detect failed):</label>
                  <input
                    id="update-pr-source-branch"
                    type="text"
                    bind:value={updatePrSourceBranch}
                    placeholder="e.g. feature/my-changes"
                    class="w-full rounded border border-input bg-background px-2 py-1.5 font-mono text-sm"
                  />
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
                  <label for="update-pr-source-branch" class="block text-xs text-muted-foreground">Your source branch:</label>
                  <input
                    id="update-pr-source-branch"
                    type="text"
                    bind:value={updatePrSourceBranch}
                    placeholder="e.g. feature/my-changes"
                    class="w-full rounded border border-input bg-background px-2 py-1.5 font-mono text-sm"
                  />
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
                <p class="mb-3 text-sm text-red-600">{updatePrPreview.error}</p>
              {:else if updatePrPreview?.success && updatePrPreview.commits?.length}
                <div class="mb-3 max-h-24 overflow-y-auto rounded border bg-background/50 p-2 text-xs">
                  <span class="font-medium">{updatePrPreview.commits.length} commit(s)</span>
                  <ul class="mt-1 space-y-0.5 font-mono">
                    {#each updatePrPreview.commits.slice(0, 10) as c (c.oid)}
                      <li class="flex gap-2 truncate">
                        <span class="text-muted-foreground shrink-0">{c.oid?.substring(0, 7)}</span>
                        <span class="truncate">{c.message?.split("\n")[0] ?? "-"}</span>
                      </li>
                    {/each}
                    {#if updatePrPreview.commits.length > 10}
                      <li class="text-muted-foreground">… and {updatePrPreview.commits.length - 10} more</li>
                    {/if}
                  </ul>
                </div>
              {/if}
              {#if updatePrError}
                <p class="mb-2 text-sm text-red-600">{updatePrError}</p>
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
                <Button variant="outline" onclick={() => { showUpdatePrForm = false; updatePrSourceBranch = ""; updatePrTriedTipFirst = false }}>
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
            currentCommenter={$pubkey!}
            {onCommentCreated}
            relays={repoClass.relays || repoRelays || []}
            repoAddress={repoClass.address || ""} />
        {/if}
      </div>
    </div>
  </div>
</div>
