<script lang="ts">
  import {page} from "$app/stores"
  import {
    AlertCircle,
    Check,
    CheckCircle,
    ChevronDown,
    ChevronUp,
    Copy,
    GitBranch,
    GitCommit,
    GitMerge,
    Loader2,
    MessageSquare,
    Shield,
    User,
    X,
  } from "@lucide/svelte"
  import {Button, MergeStatus, toast, Status} from "@nostr-git/ui"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {IssueThread, MergeAnalyzer, PatchViewer} from "@nostr-git/ui"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {load} from "@welshman/net"
  import {
    COMMENT,
    GIT_PATCH,
    GIT_STATUS_CLOSED,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import {
    getTags,
    parseStatusEvent,
    parsePullRequestEvent,
    type CommentEvent,
    type StatusEvent,
    type PatchEvent,
    type PullRequestEvent,
    GIT_STATUS_APPLIED,
  } from "@nostr-git/shared-types"
  import {createStatusEvent} from "@nostr-git/shared-types"
  import {postComment, postStatus, postRoleLabel, deleteRoleLabelEvent} from "@lib/budabit"
  import {PeoplePicker} from "@nostr-git/ui"
  import type {LabelEvent} from "@nostr-git/shared-types"
  import {ROLE_NS} from "@lib/budabit/labels"
  import {parseGitPatchFromEvent} from "@nostr-git/core"
  import type {Commit, MergeAnalysisResult, Patch, PatchTag} from "@nostr-git/core"
  import {sortBy} from "@welshman/lib"
  import {derived as _derived} from "svelte/store"
  import {slideAndFade} from "@src/lib/transition"
  import {normalizeRelayUrl} from "@welshman/util"
  import {profilesByPubkey, profileSearch, loadProfile} from "@welshman/app"
  import {deriveRoleAssignments} from "@lib/budabit"
  import Profile from "@src/app/components/Profile.svelte"
  import Markdown from "@src/lib/components/Markdown.svelte"
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY, PULL_REQUESTS_KEY} from "@lib/budabit/state"
  import {get} from "svelte/store"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  
  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)
  
  if (!repoClass) {
    throw new Error("Repo context not available")
  }
  
  // Get store values reactively using $ rune
  const repoRelays = $derived.by(() => repoRelaysStore ? $repoRelaysStore : [])
  const pullRequests = $derived.by(() => pullRequestsStore ? $pullRequestsStore : [])

  // Profile functions for PeoplePicker
  const getProfile = async (pubkey: string) => {
    const profile = $profilesByPubkey.get(pubkey)
    if (profile) {
      return {
        name: profile.name,
        picture: profile.picture,
        nip05: profile.nip05,
        display_name: profile.display_name,
      }
    }
    // Try to load profile if not in cache
    // Filter out invalid relay URLs to prevent errors
    const validRelays = (repoClass.relays || []).filter((relay: string) => {
      try {
        const url = new URL(relay)
        return url.protocol === "ws:" || url.protocol === "wss:"
      } catch {
        console.warn(`Invalid relay URL filtered out: ${relay}`)
        return false
      }
    })

    if (validRelays.length > 0) {
      await loadProfile(pubkey, validRelays)
    }

    const loadedProfile = $profilesByPubkey.get(pubkey)
    if (loadedProfile) {
      return {
        name: loadedProfile.name,
        picture: loadedProfile.picture,
        nip05: loadedProfile.nip05,
        display_name: loadedProfile.display_name,
      }
    }
    return null
  }

  const searchProfiles = async (query: string) => {
    // profileSearch.searchValues returns an array of pubkeys (strings)
    const pubkeys = $profileSearch.searchValues(query)

    // Map each pubkey to a profile object by looking it up in profilesByPubkey
    return pubkeys.map((pubkey: string) => {
      const profile = $profilesByPubkey.get(pubkey)
      return {
        pubkey: pubkey,
        name: profile?.name,
        picture: profile?.picture,
        nip05: profile?.nip05,
        display_name: profile?.display_name,
      }
    })
  }

  const patchId = $page.params.patchid

  // Make patch lookup reactive to handle data loading
  const patchEvent = $derived.by(() => repoClass.patches.find((p: any) => p.id === patchId))
  const patch = $derived.by(() => patchEvent ? parseGitPatchFromEvent(patchEvent) : undefined)

  const prEvent = $derived.by(() =>
    (pullRequests || []).find((pr: PullRequestEvent) => pr.id === patchId)
  )
  const pr = $derived.by(() => (prEvent ? parsePullRequestEvent(prEvent as any) : undefined))

  // PR-specific status and comments (read-only view)
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
    const relays = (repoRelays || [])
      .map((u: string) => normalizeRelayUrl(u))
      .filter(Boolean)
    load({relays: relays as string[], filters})
    return deriveEventsAsc(deriveEventsById({repository, filters}))
  })
  
  // Derived values for PR comments for template usage
  const prThreadCommentsArray = $derived.by(() => {
    if (!prThreadComments) return []
    return $prThreadComments as CommentEvent[]
  })
  const prThreadCommentsCount = $derived.by(() => prThreadCommentsArray.length)

  // Find root patch ID reactively
  const rootPatchId = $derived.by(() => {
    let rootId = patchId
    let currentPatch = patchEvent as PatchEvent | null
    while (currentPatch) {
      const replyTags = getTags(currentPatch, "e")
      if (replyTags.length === 0) break

      const parentId = replyTags[0][1]
      const parentPatch = repoClass.patches.find((p: PatchEvent) => p.id === parentId)
      if (!parentPatch) break

      rootId = parentId
      currentPatch = parentPatch
    }
    return rootId
  })

  const patchSet = $derived.by(() => repoClass.patches
    .filter((p: PatchEvent & { id: string }): p is PatchEvent => {
      if (p.id === patchId) return true
      const directReplyToThis = getTags(p, "e").some(tag => tag[1] === patchId)
      if (directReplyToThis) return true
      if (rootPatchId !== patchId) {
        const replyTags = getTags(p, "e")
        if (replyTags.length === 0) {
          let checkPatch: PatchEvent | undefined = p
          let foundRoot = false

          while (checkPatch) {
            if (checkPatch.id === rootPatchId) {
              foundRoot = true
              break
            }

            const checkReplyTags: [string, ...string[]][] = getTags(checkPatch, "e")
            if (checkReplyTags.length === 0) break

            const checkParentId: string = checkReplyTags[0][1]
            checkPatch = repoClass.patches.find((p: PatchEvent) => p.id === checkParentId)
            if (!checkPatch) break
          }
          return foundRoot
        }
      }
      return false
    })
    .sort((a: PatchEvent, b: PatchEvent) => a.created_at - b.created_at)
    .sort((a: PatchEvent, b: PatchEvent) => (a.id === rootPatchId ? -1 : 1))
    .map((p: PatchEvent) => parseGitPatchFromEvent(p))
  )

  let selectedPatch = $state<Patch | undefined>(undefined)
  
  // Update selectedPatch when patch changes
  $effect(() => {
    selectedPatch = patch
  })
  let mergeAnalysisResult: MergeAnalysisResult | null = $state(null)
  let isAnalyzingMerge = $state(false)
  let analysisTriggeredManually = $state(false)
  let isTechnicalDetailsCollapsed = $state(true)

  // Auto-reanalyze when selected branch changes
  let lastAnalyzedBranch = $state(repoClass.selectedBranch)
  $effect(() => {
    if (repoClass.selectedBranch !== lastAnalyzedBranch && patchSet.length > 0) {
      console.log(
        `[BranchChange] Selected branch changed from ${lastAnalyzedBranch} to ${repoClass.selectedBranch}, triggering analysis`,
      )
      lastAnalyzedBranch = repoClass.selectedBranch
      // Clear previous analysis and trigger new one
      mergeAnalysisResult = null
      analysisTriggeredManually = false // Mark as automatic analysis
      analyzeMerge()
    }
  })

  async function analyzeMerge() {
    console.log(`[analyzeMerge] Starting manual analysis...`)
    analysisTriggeredManually = true

    // For manual analysis, we analyze the entire patch set, not just selected patch
    if (!patchSet.length || !repoClass) {
      console.warn(`[analyzeMerge] Missing patchSet or repoClass`)
      return
    }

    // Check if repository is properly initialized before attempting merge analysis
    if (!repoClass.key || !repoClass.mainBranch) {
      console.warn(
        `[analyzeMerge] Repo not initialized: key=${repoClass.key}, mainBranch=${repoClass.mainBranch}`,
      )
      return
    }

    // Check if WorkerManager is ready
    if (!repoClass.workerManager) {
      console.warn(`[analyzeMerge] WorkerManager not ready`)
      return
    }

    // Use robust branch detection: prefer selected branch, then first patch baseBranch, then repo mainBranch
    const firstPatch = patchSet[0]
    const targetBranch = repoClass.selectedBranch || firstPatch?.baseBranch || repoClass.mainBranch
    console.log(
      `[analyzeMerge] Target branch: ${targetBranch} (selected: ${repoClass.selectedBranch}, patch base: ${firstPatch?.baseBranch}, repo main: ${repoClass.mainBranch})`,
    )

    // Resolve the PatchEvent corresponding to the first patch in the set
    const firstPatchEvent = repoClass.patches.find((p: PatchEvent) => p.id === firstPatch?.id)
    if (!firstPatchEvent) {
      console.warn(
        `[analyzeMerge] Could not find PatchEvent for patch ${firstPatch?.id.slice(0, 8)}`,
      )
      return
    }
    console.log(`[analyzeMerge] Found PatchEvent: ${firstPatchEvent.id.slice(0, 8)}`)

    // For manual analysis, we override any global state and force fresh analysis
    console.log(`[analyzeMerge] Performing fresh manual analysis...`)
    isAnalyzingMerge = true
    mergeAnalysisResult = null
    try {
      const result = await repoClass.getMergeAnalysis(firstPatchEvent, targetBranch)
      console.log(`[analyzeMerge] Manual analysis result:`, result?.analysis)

      if (result) {
        mergeAnalysisResult = result
        console.log(`[analyzeMerge] Set mergeAnalysisResult to:`, mergeAnalysisResult?.analysis)
      } else {
        console.warn(`[analyzeMerge] Result was null, trying cache as fallback...`)
        // If fresh analysis fails, try to get from cache as fallback
        const cachedResult = await repoClass.getMergeAnalysis(firstPatchEvent, targetBranch)
        if (cachedResult) {
          console.log(`[analyzeMerge] Got result from cache fallback:`, cachedResult.analysis)
          mergeAnalysisResult = cachedResult
          console.log(`[analyzeMerge] Set mergeAnalysisResult to:`, mergeAnalysisResult?.analysis)
        } else {
          console.warn(`[analyzeMerge] Still no result, returning...`)
          // Don't show error immediately, just return and let it retry
          return
        }
      }
    } catch (error) {
      console.error("❌ [analyzeMerge] Failed to get merge analysis:", error)
      const errorMessage = error instanceof Error ? error.message : "Unknown error"

      // Only show toast for non-initialization errors
      if (!errorMessage.includes("initializing")) {
        toast.push({
          message: `Merge Analysis Failed: ${errorMessage}`,
          timeout: 5000,
          variant: "destructive",
        })
      }

      const errorResult: MergeAnalysisResult = {
        canMerge: false,
        hasConflicts: false,
        conflictFiles: [],
        conflictDetails: [],
        upToDate: false,
        fastForward: false,
        patchCommits: [],
        analysis: "error",
        errorMessage,
      }

      mergeAnalysisResult = errorResult
      console.log(`[analyzeMerge] Set mergeAnalysisResult to error:`, mergeAnalysisResult?.analysis)
    } finally {
      isAnalyzingMerge = false
      console.log(
        `[analyzeMerge] Analysis complete. Final mergeAnalysisResult:`,
        mergeAnalysisResult?.analysis,
      )
    }
  }

  // Analysis is now manual - no automatic effect
  // Users must click the analyze button to trigger analysis

  const threadComments = $derived.by(() => {
    if (repoClass.patches && selectedPatch) {
      const filters: Filter[] = [{kinds: [COMMENT], "#E": [selectedPatch.id]}]
      const relays = (repoRelays || [])
        .map((u: string) => normalizeRelayUrl(u))
        .filter(Boolean)
      load({relays: relays as string[], filters})
      return _derived(deriveEventsAsc(deriveEventsById({repository, filters})), (events: TrustedEvent[]) => {
        return sortBy(e => -e.created_at, events) as CommentEvent[]
      })
    }
  })
  
  // Derived values for thread comments for template usage
  const threadCommentsArray = $derived.by(() => {
    if (!threadComments) return []
    return $threadComments as CommentEvent[]
  })
  const threadCommentsCount = $derived.by(() => threadCommentsArray.length)

  // Transform CommentEvent[] into DiffViewer Comment[] format
  const diffComments = $derived.by(() => {
    if (!threadComments) return []
    const comments = $threadComments as CommentEvent[]
    if (!comments || comments.length === 0) return []
    
    return comments.map((commentEvent: CommentEvent) => {
      // Parse line number and file path from comment content
      // Format: "comment text\n\n---\nFile: path\nLine: 123"
      let lineNumber = 0
      let filePath = ""
      let content = commentEvent.content
      
      const separatorIndex = content.indexOf('\n\n---\n')
      if (separatorIndex !== -1) {
        // Extract the actual comment content (before the separator)
        content = content.substring(0, separatorIndex).trim()
        
        // Extract file path and line number from the metadata section
        const metadataSection = commentEvent.content.substring(separatorIndex + 6)
        const fileMatch = metadataSection.match(/File:\s*(.+?)(?:\n|$)/i)
        if (fileMatch) {
          filePath = fileMatch[1].trim()
        }
        const lineMatch = metadataSection.match(/Line:\s*(\d+)/i)
        if (lineMatch) {
          lineNumber = parseInt(lineMatch[1], 10)
        }
      }
      
      // Get profile information for the author
      const profile = $profilesByPubkey.get(commentEvent.pubkey)
      const authorName = profile?.name || profile?.display_name || commentEvent.pubkey.slice(0, 8)
      const authorAvatar = profile?.picture || ""
      
      return {
        id: commentEvent.id || "",
        lineNumber,
        filePath,
        content,
        author: {
          name: authorName,
          avatar: authorAvatar,
        },
        createdAt: new Date(commentEvent.created_at * 1000).toISOString(),
      }
    })
  })

  const getStatusFilter = () => ({
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [selectedPatch?.id ?? ""],
  })

  const statusEvents = $derived.by(() => {
    return deriveEventsAsc(deriveEventsById({repository, filters: [getStatusFilter()]}))
  })

  // NIP-32 role label events for this patch (reviewers)
  const getLabelFilter = () => ({kinds: [1985], "#e": [selectedPatch?.id ?? ""]})
  const roleLabelEvents = $derived.by(() =>
    deriveEventsAsc(deriveEventsById({repository, filters: [getLabelFilter()]})),
  )
  const reviewerLabelEvents = $derived.by(() => {
    if (!roleLabelEvents) return [] as LabelEvent[]
    const events = $roleLabelEvents as any[]
    return events.filter(
      (ev: any) =>
        ev?.kind === 1985 &&
        Array.isArray(ev.tags) &&
        ev.tags.some((t: string[]) => t[0] === "L" && t[1] === ROLE_NS) &&
        ev.tags.some((t: string[]) => t[0] === "l" && t[1] === "reviewer" && t[2] === ROLE_NS),
    ) as unknown as LabelEvent[]
  })

  const onCommentCreated = async (comment: CommentEvent) => {
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    postComment(comment, relays)
  }

  const handleStatusPublish = async (statusEvent: StatusEvent) => {
    console.log("[PatchDetail] Publishing status", statusEvent)
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    const thunk = postStatus(statusEvent as any, relays)
    console.log("[PatchDetail] Status publish thunk", thunk)
    return thunk
  }

  const status = $derived.by(() => {
    if (!statusEvents) return undefined
    const events = $statusEvents as StatusEvent[]
    if (events && events.length > 0) {
      const statusEvent = events.sort((a, b) => b.created_at - a.created_at)[0]
      return statusEvent ? parseStatusEvent(statusEvent as StatusEvent) : undefined
    }
    return undefined
  })
  
  // Derived value for statusEvents array for template usage
  const statusEventsArray = $derived.by(() => {
    if (!statusEvents) return []
    return $statusEvents as StatusEvent[]
  })

  const reviewersAssignments = $derived.by(() =>
    selectedPatch ? deriveRoleAssignments(selectedPatch.id) : undefined,
  )
  const reviewers = $derived.by(() => {
    if (!reviewersAssignments) return []
    const assignments = $reviewersAssignments
    return Array.from((assignments?.reviewers || new Set()) as Set<string>)
  })

  let reviewersList = $state<string[]>([])
  $effect(() => {
    reviewersList = reviewers
  })

  // Merge state management
  let isMerging = $state(false)
  let mergeProgress = $state(0)
  let mergeStep = $state("")
  let mergeError = $state<string | null>(null)
  let mergeSuccess = $state(false)
  let mergeResult = $state<{
    mergeCommitOid?: string
    pushedRemotes?: string[]
    skippedRemotes?: string[]
    pushErrors?: Array<{remote: string; url: string; error: string; code: string; stack: string}>
  } | null>(null)
  let showMergeDialog = $state(false)
  let mergeCommitMessage = $state("")

  // Apply patch set with full GitHub-style merge workflow
  const applyPatch = async () => {
    if (!patchSet.length || !$pubkey) return

    // Reset merge state
    isMerging = false
    mergeProgress = 0
    mergeStep = ""
    mergeError = null
    mergeSuccess = false
    mergeResult = null

    // Set default merge commit message for the entire patch set
    const firstPatch = patchSet[0]
    const defaultMessage = `Merge patch set: ${firstPatch?.title || `${patchSet.length} patches`} (${patchSet.length} patches)`
    mergeCommitMessage = defaultMessage

    // Show merge dialog for confirmation
    showMergeDialog = true
  }

  // Execute the actual merge after confirmation
  const executeMerge = async () => {
    if (!patchSet.length || !repoClass.workerManager) return

    showMergeDialog = false
    isMerging = true
    mergeProgress = 0
    mergeStep = "Ensuring latest repository state..."
    mergeError = null
    mergeSuccess = false

    // Strategic sync point: Ensure we have latest state before merging
    try {
      const cloneUrls = repoClass.cloneUrls
      if (cloneUrls.length > 0) {
        mergeStep = "Syncing with remote..."
        mergeProgress = 5
        const syncResult = await repoClass.workerManager.syncWithRemote({
          repoId: repoClass.key,
          cloneUrls,
          branch: repoClass.mainBranch,
        })
        
        if (!syncResult.success && !syncResult.error?.includes("Repository not cloned")) {
          console.warn("Sync before merge had issues, but continuing:", syncResult.error)
          // Don't fail merge if sync has issues - continue with current state
        }
      }
    } catch (syncError) {
      console.warn("Failed to sync before merge, but continuing:", syncError)
      // Don't fail merge if sync fails - continue with current state
    }

    mergeStep = "Preparing merge..."
    mergeProgress = 10

    // Get user profile for commit author
    const authorName = "Repository Maintainer" // You might want to get this from user profile
    const authorEmail = "maintainer@nostr-git.local" // You might want to get this from user profile

    // Prepare patch data for the entire patch set - ensure all data is serializable
    const allCommits = patchSet.flatMap((patch: Patch) => patch.commits || [])
    const firstPatch = patchSet[0]

    const patchData = {
      id: firstPatch?.id || "",
      commits: allCommits.map((commit: Commit) => ({
        oid: commit.oid || "",
        message: commit.message || "",
        author: {
          name: commit.author?.name || "",
          email: commit.author?.email || "",
        },
      })),
      baseBranch: firstPatch?.baseBranch || repoClass.mainBranch,
      rawContent: firstPatch?.raw?.content || "",
    }

    // Validate patch data before proceeding
    if (!patchData.rawContent || typeof patchData.rawContent !== "string") {
      mergeError = `Invalid patch data: rawContent is ${typeof patchData.rawContent} (${patchData.rawContent})`
      mergeStep = "Merge failed"
      isMerging = false
      toast.push({
        message: `Merge failed: ${mergeError}`,
        timeout: 8000,
        variant: "destructive",
      })
      return
    }

    try {
      // Manual progress tracking since we can't pass callbacks to workers
      mergeStep = "Preparing merge..."
      mergeProgress = 10

      setTimeout(() => {
        if (isMerging) {
          mergeStep = "Analyzing patch..."
          mergeStep = "Analyzing patch..."
          mergeProgress = 25
        }
      }, 200)

      setTimeout(() => {
        if (isMerging) {
          mergeStep = "Applying changes..."
          mergeProgress = 50
        }
      }, 500)

      setTimeout(() => {
        if (isMerging) {
          mergeStep = "Creating merge commit..."
          mergeProgress = 75
        }
      }, 1000)

      setTimeout(() => {
        if (isMerging) {
          mergeStep = "Pushing to remotes..."
          mergeProgress = 90
        }
      }, 1500)
    } catch (error) {
      mergeError = error instanceof Error ? error.message : "Setup error"
      mergeStep = "Setup failed"
      isMerging = false

      toast.push({
        message: `Setup failed: ${mergeError}`,
        timeout: 8000,
        variant: "destructive",
      })
      return
    }

    // Execute merge via worker
    // Use canonical repo ID consistently for worker operations
    // Require canonical repo key to avoid Invalid repoId issues
    if (!repoClass.key) {
      mergeError = "Repository identifier is not ready (missing canonical key)."
      mergeStep = "Setup failed"
      isMerging = false
      toast.push({
        message: "Repository is still initializing. Please try again once metadata loads.",
        timeout: 6000,
        variant: "destructive",
      })
      return
    }
    const effectiveRepoId = repoClass.key

    try {
      const result = await repoClass.workerManager.applyPatchAndPush({
        repoId: effectiveRepoId,
        patchData,
        targetBranch: repoClass.mainBranch,
        mergeCommitMessage: mergeCommitMessage || undefined,
        authorName,
        authorEmail,
      })

      if (result.success) {
        mergeSuccess = true
        mergeResult = result
        mergeStep = "Merge completed successfully!"
        mergeProgress = 100

        // Show success toast with warning if applicable
        if (result.warning) {
          toast.push({
            message: `Patch merged locally: ${result.warning}`,
            timeout: 8000,
            variant: "default",
          })
        } else {
          toast.push({
            message: "Patch merged successfully!",
            timeout: 5000,
          })
        }

        // Emit status event for applied patch
        await emitPatchAppliedStatus(result.mergeCommitOid)

        // Note: Repository data will be refreshed automatically via reactive stores
      } else {
        mergeError = result.error || "Unknown merge error"
        mergeStep = "Merge failed"

        // Show error toast
        toast.push({
          message: `Merge failed: ${result.error}`,
          timeout: 8000,
          variant: "destructive",
        })
      }
    } catch (error) {
      mergeError = error instanceof Error ? error.message : "Unknown error"
      mergeStep = "Merge failed"

      toast.push({
        message: `Merge error: ${mergeError}`,
        timeout: 8000,
        variant: "destructive",
      })
    } finally {
      // Keep merge state visible for a few seconds on success
      if (mergeSuccess) {
        setTimeout(() => {
          isMerging = false
        }, 3000)
      } else {
        isMerging = false
      }
    }
  }

  // Emit status event when patch is successfully merged
  const emitPatchAppliedStatus = async (mergeCommitOid?: string) => {
    if (!patchSet.length || !$pubkey) return

    try {
      const firstPatch = patchSet[0]
      const allCommits = patchSet.flatMap((p: Patch) => p.commits || [])
      const commitIds = allCommits.map((c: Commit) => c.oid).filter(Boolean)

      // Create status event for applied patch
      const statusEvent = createStatusEvent({
        kind: GIT_STATUS_APPLIED,
        content:
          mergeCommitMessage || `Patch set applied: ${firstPatch?.title || "Multiple patches"}`,
        rootId: firstPatch?.id || "",
        recipients: repoClass.maintainers, // Include repo maintainers in p tags
        repoAddr: repoClass.repoId,
        relays: repoClass.relays,
        appliedCommits: commitIds,
        mergedCommit: mergeCommitOid,
      })

      // Publish the status event
      await postStatus(statusEvent, repoClass.relays || [])
      console.log(`[emitPatchAppliedStatus] Status event published for patch set ${firstPatch?.id}`)
    } catch (error) {
      console.error("[emitPatchAppliedStatus] Failed to publish status event:", error)
      toast.push({
        message: "Warning: Failed to publish patch status event",
        timeout: 5000,
        variant: "destructive",
      })
    }
  }

  // Cancel merge dialog
  const cancelMerge = () => {
    showMergeDialog = false
    mergeCommitMessage = ""
  }

  // Copy to clipboard function
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.push({
        message: `${label} copied to clipboard`,
        timeout: 2000,
      })
    } catch (error) {
      console.error("Failed to copy to clipboard:", error)
      toast.push({
        message: `Failed to copy ${label}`,
        timeout: 3000,
        theme: "error",
      })
    }
  }

  // Navigation functions for PatchViewer
  const navigateToPreviousPatch = () => {
    const currentIndex = patchSet.findIndex((p: Patch) => p.id === selectedPatch?.id)
    if (currentIndex > 0) {
      selectedPatch = patchSet[currentIndex - 1]
    }
  }

  const navigateToNextPatch = () => {
    const currentIndex = patchSet.findIndex((p: Patch) => p.id === selectedPatch?.id)
    if (currentIndex < patchSet.length - 1) {
      selectedPatch = patchSet[currentIndex + 1]
    }
  }

  // Comment handler for PatchViewer
  const handleCommentSubmit = async (comment: any) => {
    try {
      await postComment(comment, repoClass.relays || [])
      toast.push({
        message: "Comment posted successfully",
        timeout: 2000,
      })
    } catch (error) {
      console.error("Failed to post comment:", error)
      toast.push({
        message: "Failed to post comment",
        timeout: 3000,
        variant: "destructive",
      })
    }
  }

  // Enhanced timestamp formatting
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

  // Limit title to a maximum number of characters
  const getTitleDisplay = (title: string | undefined, maxLength: number = 80): string => {
    if (!title) return ""

    if (title.length <= maxLength) {
      return title
    }

    // Truncate and add ellipsis
    return title.substring(0, maxLength).trim() + "..."
  }

  const displayTitle = $derived(getTitleDisplay(patch?.title))
  const selectedPatchDisplayTitle = $derived(
    selectedPatch?.title
      ? getTitleDisplay(selectedPatch.title)
      : `Patch ${selectedPatch?.id || ""}`,
  )
</script>

<svelte:head>
  <title>{repoClass.name} - {patch?.title || pr?.subject || "Patch"}</title>
</svelte:head>

{#if !patch && pr}
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
            <div class="git-tag w-fit bg-secondary">
              {#if prStatus?.status === "open"}
                Open
              {:else if prStatus?.status === "applied"}
                Applied
              {:else if prStatus?.status === "closed"}
                Closed
              {:else}
                Status unknown
              {/if}
            </div>
            <div
              class="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground sm:text-sm">
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
              {onCommentCreated} />
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if patch}
  <div class="z-10 items-center justify-between py-4 backdrop-blur">
    <div>
      <div class="rounded-lg border border-border bg-card p-4 sm:p-6">
        <div class="mb-4 flex flex-col items-start justify-between gap-2">
          <div class="flex items-start gap-4">
            {#if status?.status === "open"}
              <div class="mt-1">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                  <GitCommit class="h-5 w-5 text-amber-500" />
                </div>
              </div>
            {:else if status?.status === "applied"}
              <div class="mt-1">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                  <Check class="h-5 w-5 text-green-500" />
                </div>
              </div>
            {:else}
              <div class="mt-1">
                <div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                  <X class="h-5 w-5 text-red-500" />
                </div>
              </div>
            {/if}

            <h1
              class="line-clamp-2 overflow-hidden break-words text-lg font-bold md:text-2xl"
              title={patch?.title}>
              {displayTitle}
            </h1>
          </div>

          <div class="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-1">
            <div class="git-tag w-fit bg-secondary">
              {status?.status === "open"
                ? "Open"
                : status?.status === "applied"
                  ? "Applied"
                  : "Closed"}
            </div>
            <div
              class="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground sm:text-sm">
              <Profile pubkey={patch?.author.pubkey} hideDetails={true}></Profile>
              <ProfileLink pubkey={patch?.author.pubkey} />
              <span class="hidden sm:inline">•</span>
              <span>{formatTimestamp(patch?.createdAt || "")}</span>
            </div>
          </div>
        </div>

        <div
          class="prose-sm dark:prose-invert markdown-content prose mb-6 max-w-none text-muted-foreground">
          <Markdown content={patch?.description || ""} />
        </div>

        <!-- Technical Metadata -->
        <div class="mb-6 rounded-lg border bg-muted/30">
          <button
            class="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50"
            onclick={() => (isTechnicalDetailsCollapsed = !isTechnicalDetailsCollapsed)}
            aria-expanded={!isTechnicalDetailsCollapsed}
            aria-controls="technical-details-content">
            <h3 class="flex items-center gap-2 text-sm font-medium">
              <GitCommit class="h-4 w-4" />
              Technical Details
            </h3>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground">
                {isTechnicalDetailsCollapsed ? "Show" : "Hide"} details
              </span>
              {#if isTechnicalDetailsCollapsed}
                <ChevronDown class="h-4 w-4 text-muted-foreground" />
              {:else}
                <ChevronUp class="h-4 w-4 text-muted-foreground" />
              {/if}
            </div>
          </button>

          <div
            id="technical-details-content"
            class="overflow-hidden transition-all duration-200 ease-in-out"
            class:opacity-0={isTechnicalDetailsCollapsed}
            class:max-h-0={isTechnicalDetailsCollapsed}
            class:opacity-100={!isTechnicalDetailsCollapsed}
            class:max-h-96={!isTechnicalDetailsCollapsed}>
            <div class="p-4 pt-0">
              <div class="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                <!-- Commit Hash -->
                {#if selectedPatch?.commitHash}
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span class="text-muted-foreground">Commit:</span>
                    <div class="flex items-center gap-2">
                      <code class="break-all rounded bg-background px-2 py-1 font-mono text-xs">
                        {selectedPatch.commitHash.substring(0, 8)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-6 w-6 flex-shrink-0"
                        onclick={() =>
                          copyToClipboard(selectedPatch?.commitHash || "", "Commit hash")}>
                        <Copy class="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                {/if}

                <!-- Author vs Committer -->
                {#if selectedPatch?.raw?.tags}
                  {@const committerTag = selectedPatch.raw.tags.find(t => t[0] === "committer")}
                  {#if committerTag && committerTag[1] !== selectedPatch?.author.name}
                    <div class="flex items-center justify-between">
                      <span class="text-muted-foreground">Committer:</span>
                      <div class="flex items-center gap-2">
                        <User class="h-3 w-3" />
                        <span class="text-xs">{committerTag[1]}</span>
                      </div>
                    </div>
                  {/if}
                  {#if committerTag && committerTag[3]}
                    <div class="flex items-center justify-between">
                      <span class="text-muted-foreground">Committed:</span>
                      <span class="text-xs">{formatTimestamp(committerTag[3])}</span>
                    </div>
                  {/if}
                {/if}

                <!-- PGP Signature -->
                {#if selectedPatch?.raw?.tags?.find((t: PatchTag) => t[0] === "commit-pgp-sig")}
                  <div class="flex items-center justify-between">
                    <span class="text-muted-foreground">Signed:</span>
                    <div class="flex items-center gap-2 text-green-600">
                      <Shield class="h-3 w-3" />
                      <span class="text-xs">PGP Verified</span>
                    </div>
                  </div>
                {/if}

                <!-- Base Branch -->
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span class="text-muted-foreground">Target Branch:</span>
                  <code class="break-all rounded bg-background px-2 py-1 text-xs sm:break-normal">
                    {selectedPatch?.baseBranch || repoClass.mainBranch || "-"}
                  </code>
                </div>

                <!-- Commit Count -->
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Commits:</span>
                  <span class="text-xs font-medium">{selectedPatch?.commitCount || 1}</span>
                </div>

                <!-- Recipients/Reviewers -->
                {#if selectedPatch?.raw?.tags && selectedPatch.raw.tags.filter(t => t[0] === "p").length > 0}
                  {@const recipients = selectedPatch.raw.tags.filter(t => t[0] === "p")}
                  <div class="col-span-full">
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <span class="text-muted-foreground">Reviewers:</span>
                      <div class="flex flex-wrap gap-1 sm:max-w-xs">
                        {#each recipients.slice(0, 3) as recipient}
                          <ProfileLink pubkey={recipient[1]} />
                        {/each}
                        {#if recipients.length > 3}
                          <span class="text-xs text-muted-foreground"
                            >+{recipients.length - 3} more</span>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <!-- Status Section -->
        <Status
          repo={repoClass}
          rootId={selectedPatch?.id ?? ""}
          rootKind={GIT_PATCH}
          rootAuthor={selectedPatch?.author.pubkey ?? ""}
          statusEvents={statusEventsArray}
          actorPubkey={$pubkey}
          onPublish={handleStatusPublish} />

        <!-- Individual Commit Timeline -->
        {#if selectedPatch?.commits && selectedPatch.commits.length > 1}
          <div class="mb-6">
            <div class="mb-4 flex items-center justify-between">
              <h3 class="flex items-center gap-2 text-lg font-medium">
                <GitCommit class="h-5 w-5" />
                Commit Timeline ({selectedPatch.commits.length} commits)
              </h3>
            </div>

            <div class="space-y-3">
              {#each selectedPatch.commits.slice(0, 5) as commitHash, index}
                {@const commitTag = selectedPatch?.raw?.tags?.find(
                  t => t[0] === "commit" && t[1] === commitHash,
                )}
                <div class="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
                  <div class="mt-1 flex-shrink-0">
                    <div class="h-2 w-2 rounded-full bg-primary"></div>
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="mb-1 flex items-center gap-2">
                      <code class="rounded bg-background px-2 py-1 font-mono text-xs">
                        {commitHash.substring(0, 8)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-5 w-5"
                        onclick={() => copyToClipboard(commitHash, "Commit hash")}>
                        <Copy class="h-3 w-3" />
                      </Button>
                      <span class="text-xs text-muted-foreground">
                        #{selectedPatch.commits.length - index}
                      </span>
                    </div>

                    <!-- Commit message would go here if available in tags -->
                    <p class="text-sm text-muted-foreground">
                      Commit {index + 1} of {selectedPatch.commits.length}
                    </p>

                    <!-- Author and timestamp if available -->
                    {#if commitTag && commitTag.length > 2}
                      <div class="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                        {#if commitTag[2]}
                          <div class="flex items-center gap-1">
                            <User class="h-3 w-3" />
                            <span>{commitTag[2]}</span>
                          </div>
                        {/if}
                        {#if commitTag[3]}
                          <span>{formatTimestamp(commitTag[3])}</span>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}

              {#if selectedPatch.commits.length > 5}
                <div class="text-center">
                  <Button variant="outline" size="sm">
                    Show {selectedPatch.commits.length - 5} more commits
                  </Button>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if selectedPatch}
          <div class="my-4 space-y-2">
            <h3 class="text-base font-medium">Reviewers</h3>
            {#if repoClass.maintainers.includes($pubkey!) || selectedPatch?.author.pubkey === $pubkey}
              <PeoplePicker
                selected={reviewerLabelEvents as LabelEvent[]}
                placeholder="Search for reviewers..."
                maxSelections={10}
                showAvatars={true}
                compact={false}
                {getProfile}
                {searchProfiles}
                add={async (pubkey: string) => {
                  if (!selectedPatch) return
                  try {
                    const relays = (repoClass.relays || repoRelays || [])
                      .map((u: string) => normalizeRelayUrl(u))
                      .filter(Boolean)
                    postRoleLabel({
                      rootId: selectedPatch.id,
                      role: "reviewer",
                      pubkeys: [pubkey],
                      repoAddr: (repoClass as any)?.repoEvent?.id,
                      relays,
                    })
                    await load({
                      relays,
                      filters: [{kinds: [1985], "#e": [selectedPatch.id]}],
                    })
                  } catch (err) {
                    console.error("[PatchDetail] Failed to add reviewer", err)
                  }
                }}
                onDeleteLabel={async (evt: LabelEvent) => {
                  if (!selectedPatch) return
                  try {
                    const relays = (repoClass.relays || repoRelays || [])
                      .map((u: string) => normalizeRelayUrl(u))
                      .filter(Boolean)
                    deleteRoleLabelEvent({event: evt as any, relays, protect: false})
                    await load({
                      relays,
                      filters: [{kinds: [1985], "#e": [selectedPatch.id]}],
                    })
                  } catch (err) {
                    console.error("[PatchDetail] Failed to remove reviewer", err)
                  }
                }} />
            {:else if reviewers.length}
              <div class="flex flex-wrap gap-2">
                {#each reviewers as pk (pk)}
                  <ProfileLink pubkey={pk} />
                {/each}
              </div>
            {:else}
              <div class="text-sm text-muted-foreground">No reviewers yet.</div>
            {/if}
          </div>
        {/if}

        <!-- Patch Analysis Section -->
        <div class="mb-6">
          <div class="mb-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h3 class="text-lg font-medium">Patch Analysis</h3>
              <span class="rounded bg-muted px-2 py-1 text-sm text-muted-foreground">
                Target: {repoClass.selectedBranch ||
                  patchSet[0]?.baseBranch ||
                  repoClass.mainBranch ||
                  "default"}
              </span>
            </div>
            <div class="flex items-center gap-2">
              {#if analysisTriggeredManually}
                <span
                  class="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800 text-muted-foreground">
                  Manual Analysis
                </span>
              {:else if mergeAnalysisResult}
                <span
                  class="rounded bg-green-100 px-2 py-1 text-xs text-green-800 text-muted-foreground">
                  Auto Analysis
                </span>
              {/if}
              <Button
                variant="outline"
                size="sm"
                onclick={() => analyzeMerge()}
                disabled={isAnalyzingMerge}
                class="gap-2">
                {#if isAnalyzingMerge}
                  <Loader2 class="h-4 w-4 animate-spin" />
                  Analyzing...
                {:else}
                  <Shield class="h-4 w-4" />
                  Analyze Patch Set
                {/if}
              </Button>
            </div>
          </div>

          <!-- Merge Status Analysis -->
          <div class="mb-4">
            <MergeStatus
              result={mergeAnalysisResult}
              loading={isAnalyzingMerge}
              targetBranch={repoClass.selectedBranch ||
                patchSet[0]?.baseBranch ||
                repoClass.mainBranch ||
                ""} />
          </div>
          {#if mergeAnalysisResult}
            <div class="mb-4">
              <MergeAnalyzer
                analysis={{
                  similarity: mergeAnalysisResult.hasConflicts ? 0.7 : 0.95,
                  autoMergeable: mergeAnalysisResult.canMerge,
                  affectedFiles: patchSet.flatMap((p: Patch) =>
                    (p.diff || []).map((f: any) => f.to || f.from || f.file || "unknown"),
                  ),
                  conflictCount: (mergeAnalysisResult.conflictFiles || []).length,
                  errorMessage: mergeAnalysisResult.errorMessage,
                  conflictDetails: mergeAnalysisResult.conflictDetails,
                  analysis: mergeAnalysisResult.analysis,
                }}
                patch={patchSet[0] as any}
                analyzing={isAnalyzingMerge}
                onAnalyze={() => analyzeMerge()} />
            </div>
          {/if}
        </div>

        <div class="git-separator"></div>

        <!-- Unified Patch Viewer Component -->
        <PatchViewer
          selectedPatch={selectedPatch || null}
          {patchSet}
          onNavigatePrevious={navigateToPreviousPatch}
          onNavigateNext={navigateToNextPatch}
          showNavigation={true}
          showFileStats={true}
          showPatchInfo={true}
          comments={diffComments}
          rootEvent={selectedPatch?.raw}
          onComment={handleCommentSubmit}
          currentPubkey={$pubkey}
          diffViewerProps={{
            showLineNumbers: true,
            expandAll: false,
          }} />
        {#if repoClass.maintainers.includes($pubkey!)}
          <!-- GitHub-style Merge Section -->
          <div class="rounded-lg border bg-card p-6">
            <div class="mb-4 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <GitMerge class="h-5 w-5 text-primary" />
                <div>
                  <h3 class="font-semibold">Merge this patch</h3>
                  <p class="text-sm text-muted-foreground">
                    Apply the changes from this patch to the {repoClass.selectedBranch ||
                      selectedPatch?.baseBranch ||
                      repoClass.mainBranch ||
                      "default"} branch
                  </p>
                </div>
              </div>

              <!-- Merge Status Indicator -->
              {#if isMerging}
                <div class="flex items-center gap-2 text-blue-600">
                  <Loader2 class="h-4 w-4 animate-spin" />
                  <span class="text-sm font-medium">Merging...</span>
                </div>
              {:else if mergeSuccess}
                <div class="flex items-center gap-2 text-green-600">
                  <CheckCircle class="h-4 w-4" />
                  <span class="text-sm font-medium">Merged</span>
                </div>
              {:else if mergeError}
                <div class="flex items-center gap-2 text-red-600">
                  <AlertCircle class="h-4 w-4" />
                  <span class="text-sm font-medium">Failed</span>
                </div>
              {/if}
            </div>

            <!-- Merge Progress Bar -->
            {#if isMerging}
              <div class="mb-4">
                <div class="mb-2 flex items-center justify-between text-sm">
                  <span class="text-muted-foreground">{mergeStep}</span>
                  <span class="text-muted-foreground">{mergeProgress}%</span>
                </div>
                <div class="h-2 w-full rounded-full bg-muted">
                  <div
                    class="h-2 rounded-full bg-primary transition-all duration-300 ease-out"
                    style="width: {mergeProgress}%">
                  </div>
                </div>
              </div>
            {/if}

            <!-- Merge Error Display -->
            {#if mergeError}
              <div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
                <div class="flex items-start gap-2">
                  <AlertCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                  <div>
                    <p class="text-sm font-medium text-red-800">Merge failed</p>
                    <p class="mt-1 text-sm text-red-700">{mergeError}</p>
                  </div>
                </div>
              </div>
            {/if}

            <!-- Merge Success Display -->
            {#if mergeSuccess && mergeResult}
              <div class="mb-4 rounded-lg border border-green-200 bg-green-50 p-3">
                <div class="flex items-start gap-2">
                  <CheckCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
                  <div class="flex-1">
                    <p class="text-sm font-medium text-green-800">Patch merged successfully!</p>
                    {#if mergeResult.mergeCommitOid}
                      <p class="mt-1 text-sm text-green-700">
                        Merge commit: <code class="rounded bg-green-100 px-1"
                          >{mergeResult.mergeCommitOid.slice(0, 8)}</code>
                      </p>
                    {/if}
                    {#if mergeResult.pushedRemotes && mergeResult.pushedRemotes.length > 0}
                      <p class="mt-1 text-sm text-green-700">
                        Pushed to: {mergeResult.pushedRemotes.join(", ")}
                      </p>
                    {/if}
                    {#if mergeResult.skippedRemotes && mergeResult.skippedRemotes.length > 0}
                      <div class="mt-2">
                        <p class="mb-1 text-sm font-medium text-yellow-700">
                          ⚠️ Failed to push to {mergeResult.skippedRemotes.length} remote{mergeResult
                            .skippedRemotes.length > 1
                            ? "s"
                            : ""}:
                        </p>
                        {#if mergeResult.pushErrors && mergeResult.pushErrors.length > 0}
                          <!-- Detailed error information -->
                          <div class="space-y-2">
                            {#each mergeResult.pushErrors as pushError}
                              <div class="rounded border border-yellow-200 bg-yellow-50 p-2">
                                <div class="flex items-start gap-2">
                                  <div class="flex-1">
                                    <p class="text-sm font-medium text-yellow-800">
                                      {pushError.remote} ({pushError.url})
                                    </p>
                                    <p class="mt-1 text-sm text-yellow-700">
                                      <span class="font-medium">Error:</span>
                                      {pushError.error}
                                    </p>
                                    {#if pushError.code && pushError.code !== "UNKNOWN"}
                                      <p class="mt-1 text-sm text-yellow-600">
                                        <span class="font-medium">Code:</span>
                                        {pushError.code}
                                      </p>
                                    {/if}
                                  </div>
                                </div>
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <!-- Fallback to simple list if no detailed errors -->
                          <p class="text-sm text-yellow-700">
                            {mergeResult.skippedRemotes.join(", ")}
                          </p>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {/if}

            <!-- Merge Action Button -->
            <div class="flex justify-end">
              <Button
                onclick={applyPatch}
                variant="default"
                disabled={isMerging || mergeSuccess}
                class="min-w-[120px]">
                {#if isMerging}
                  <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                  Merging...
                {:else if mergeSuccess}
                  <CheckCircle class="mr-2 h-4 w-4" />
                  Merged
                {:else}
                  <GitMerge class="mr-2 h-4 w-4" />
                  Merge Patch Set
                {/if}
              </Button>
            </div>
          </div>
        {/if}
        <!-- Merge Confirmation Dialog -->
        {#if showMergeDialog}
          <div
            class="z-50 fixed inset-0 flex items-center justify-center bg-black/50"
            transition:slideAndFade>
            <div class="mx-4 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
              <div class="mb-4 flex items-center gap-3">
                <GitBranch class="h-5 w-5 text-primary" />
                <h3 class="text-lg font-semibold">Confirm Merge</h3>
              </div>

              <div class="mb-6 space-y-4">
                <div>
                  <p class="mb-2 text-sm text-muted-foreground">
                    This will merge the entire patch set ({patchSet.length} patch{patchSet.length !==
                    1
                      ? "es"
                      : ""}) into
                    <code class="rounded bg-muted px-1"
                      >{patchSet[0]?.baseBranch || repoClass.mainBranch || "-"}</code> and push to all
                    remotes.
                  </p>

                  <div class="rounded-lg bg-muted/30 p-3 text-sm">
                    <div class="mb-1 font-medium">Patch Set Details:</div>
                    <div>Patches: {patchSet.length}</div>
                    <div>
                      Total Commits: {patchSet.flatMap((p: Patch) => p.commits || []).length}
                    </div>
                    <div>Target: {patchSet[0]?.baseBranch || repoClass.mainBranch || "-"}</div>
                    {#if patchSet.length > 1}
                      <div class="mt-2 text-xs text-muted-foreground">
                        Includes all patches in the set, not just the currently selected one
                      </div>
                    {/if}
                  </div>
                </div>

                <div>
                  <label for="merge-message" class="mb-2 block text-sm font-medium">
                    Merge commit message:
                  </label>
                  <textarea
                    id="merge-message"
                    bind:value={mergeCommitMessage}
                    class="w-full resize-none rounded-md border p-2 text-sm"
                    rows="3"
                    placeholder="Enter merge commit message..."></textarea>
                </div>
              </div>

              <div class="flex justify-end gap-3">
                <Button variant="outline" onclick={cancelMerge}>Cancel</Button>
                <Button variant="default" onclick={executeMerge}>
                  <GitMerge class="mr-2 h-4 w-4" />
                  Confirm Merge
                </Button>
              </div>
            </div>
          </div>
        {/if}

        <div class="git-separator my-6"></div>

        <div class="space-y-4">
          <h2 class="flex items-center gap-2 text-lg font-medium">
            <MessageSquare class="h-5 w-5" />
            Discussion ({threadCommentsCount})
          </h2>

          <IssueThread
            issueId={selectedPatch?.id ?? ""}
            issueKind={GIT_PATCH.toString() as "1617"}
            comments={threadCommentsArray}
            currentCommenter={$pubkey!}
            {onCommentCreated} />
        </div>
      </div>
    </div>
  </div>
{/if}
