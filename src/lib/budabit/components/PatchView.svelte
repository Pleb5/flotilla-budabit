<script lang="ts">
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
  import {
    Button,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    MergeStatus,
    MergeAnalyzer,
    PatchViewer,
    Status,
    toast,
  } from "@nostr-git/ui"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import NostrGitProfileComponent from "@app/components/NostrGitProfileComponent.svelte"
  import {IssueThread, PeoplePicker} from "@nostr-git/ui"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {load} from "@welshman/net"
  import {COMMENT, GIT_PATCH, GIT_STATUS_CLOSED, GIT_STATUS_COMPLETE, GIT_STATUS_DRAFT, GIT_STATUS_OPEN, type Filter, type TrustedEvent} from "@welshman/util"
  import {
    parseStatusEvent,
    type CommentEvent,
    type StatusEvent,
    type PatchEvent,
    type LabelEvent,
  } from "@nostr-git/core/events"
  import {postComment, postStatus, postRoleLabel, deleteRoleLabelEvent, postPermalink} from "@lib/budabit"
  import {ROLE_NS} from "@lib/budabit/labels"
  import type {MergeAnalysisResult} from "@nostr-git/core/git"
  import type {Commit, Patch, PermalinkEvent} from "@nostr-git/core/types"
  import {nip19} from "nostr-tools"
  import type {PatchTag} from "@nostr-git/core/events"
  import {sortBy} from "@welshman/lib"
  import {derived as _derived} from "svelte/store"
  import {normalizeRelayUrl} from "@welshman/util"
  import {profilesByPubkey, profileSearch, loadProfile} from "@welshman/app"
  import {deriveRoleAssignments} from "@lib/budabit"
  import {effectiveMaintainersByRepoAddress} from "@lib/budabit/state"
  import Profile from "@src/app/components/Profile.svelte"
  import Markdown from "@src/lib/components/Markdown.svelte"
  import {GIT_STATUS_APPLIED} from "@nostr-git/core/events"
  import {createStatusEvent} from "@nostr-git/core/events"
  import type {Repo} from "@nostr-git/ui"

  interface Props {
    patch: Patch
    patchSet: Patch[]
    repo: Repo
    repoRelays: string[]
  }

  const {patch, patchSet, repo: repoClass, repoRelays}: Props = $props()

  // Profile functions for PeoplePicker
  const getProfile = async (pk: string) => {
    const profile = $profilesByPubkey.get(pk)
    if (profile) {
      return {
        name: profile.name,
        picture: profile.picture,
        nip05: profile.nip05,
        display_name: profile.display_name,
      }
    }
    const validRelays = (repoClass.relays || []).filter((relay: string) => {
      try {
        const url = new URL(relay)
        return url.protocol === "ws:" || url.protocol === "wss:"
      } catch {
        return false
      }
    })
    if (validRelays.length > 0) {
      await loadProfile(pk, validRelays)
    }
    const loadedProfile = $profilesByPubkey.get(pk)
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
    const pubkeys = $profileSearch.searchValues(query)
    return pubkeys.map((pk: string) => {
      const profile = $profilesByPubkey.get(pk)
      return {
        pubkey: pk,
        name: profile?.name,
        picture: profile?.picture,
        nip05: profile?.nip05,
        display_name: profile?.display_name,
      }
    })
  }

  let selectedPatch = $state<Patch | undefined>(patch)
  $effect(() => {
    selectedPatch = patch
  })

  const repoAddress = $derived.by(
    () =>
      selectedPatch?.raw?.tags?.find((tag: PatchTag) => tag[0] === "a")?.[1] ||
      ((repoClass as any)?.address as string) ||
      "",
  )
  const effectiveMaintainers = $derived.by((): string[] => {
    const owner = (repoClass as any)?.repoEvent?.pubkey as string | undefined
    const maintainers = (((repoClass as any)?.maintainers as string[]) || []).filter(
      (value): value is string => Boolean(value),
    )
    const fallback = Array.from(
      new Set([...maintainers, owner].filter((value): value is string => Boolean(value))),
    )

    if (!repoAddress) return fallback

    const mappedMaintainers = $effectiveMaintainersByRepoAddress.get(repoAddress)
    if (mappedMaintainers && mappedMaintainers.size > 0) return Array.from(mappedMaintainers)

    return fallback
  })
  const effectiveMaintainerSet = $derived.by(() => new Set(effectiveMaintainers))
  const statusRepo = $derived.by(
    () =>
      ({
        maintainers: effectiveMaintainers,
        relays: repoClass.relays || repoRelays || [],
        repoEvent: (repoClass as any).repoEvent,
        getCommitHistory: (...args: any[]) => (repoClass as any).getCommitHistory(...args),
      }) as Repo,
  )

  let mergeAnalysisResult: MergeAnalysisResult | null = $state(null)
  let isAnalyzingMerge = $state(false)
  let analysisTriggeredManually = $state(false)
  let isTechnicalDetailsCollapsed = $state(true)

  let lastAnalyzedBranch = $state(repoClass.selectedBranch)
  $effect(() => {
    if (repoClass.selectedBranch !== lastAnalyzedBranch && patchSet.length > 0) {
      lastAnalyzedBranch = repoClass.selectedBranch
      mergeAnalysisResult = null
      analysisTriggeredManually = false
      analyzeMerge()
    }
  })

  async function analyzeMerge() {
    analysisTriggeredManually = true
    if (!patchSet.length || !repoClass) return
    if (!repoClass.key || !repoClass.mainBranch) return
    if (!repoClass.workerManager) return

    const firstPatch = patchSet[0]
    const targetBranch = repoClass.selectedBranch || firstPatch?.baseBranch || repoClass.mainBranch
    const firstPatchEvent = repoClass.patches.find((p: PatchEvent) => p.id === firstPatch?.id)
    if (!firstPatchEvent) return

    isAnalyzingMerge = true
    mergeAnalysisResult = null
    try {
      const result = await repoClass.getMergeAnalysis(firstPatchEvent, targetBranch)
      if (result) {
        mergeAnalysisResult = result
      } else {
        const cachedResult = await repoClass.getMergeAnalysis(firstPatchEvent, targetBranch)
        if (cachedResult) mergeAnalysisResult = cachedResult
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      if (!errorMessage.includes("initializing")) {
        toast.push({
          message: `Merge Analysis Failed: ${errorMessage}`,
          timeout: 5000,
          variant: "destructive",
        })
      }
      mergeAnalysisResult = {
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
    } finally {
      isAnalyzingMerge = false
    }
  }

  const threadComments = $derived.by(() => {
    if (repoClass.patches && selectedPatch) {
      const filters: Filter[] = [{kinds: [COMMENT], "#E": [selectedPatch.id]}]
      const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
      load({relays: relays as string[], filters})
      return _derived(deriveEventsAsc(deriveEventsById({repository, filters})), (events: TrustedEvent[]) => {
        return sortBy((e) => -e.created_at, events) as CommentEvent[]
      })
    }
  })

  const threadCommentsArray = $derived.by(() => {
    if (!threadComments) return []
    return $threadComments as CommentEvent[]
  })
  const threadCommentsCount = $derived.by(() => threadCommentsArray.length)

  const diffComments = $derived.by(() => {
    if (!threadComments) return []
    const comments = $threadComments as CommentEvent[]
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

  const getStatusFilter = () => ({
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [selectedPatch?.id ?? ""],
  })

  const statusEvents = $derived.by(() => {
    return deriveEventsAsc(deriveEventsById({repository, filters: [getStatusFilter()]}))
  })

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
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    return postStatus(statusEvent as any, relays)
  }

  const publishPermalink = async (permalink: PermalinkEvent) => {
    const relays = (repoRelays || []).map((u: string) => normalizeRelayUrl(u)).filter(Boolean)
    const thunk = postPermalink(permalink, relays)
    toast.push({message: "Permalink published successfully", timeout: 2000})
    const nevent = nip19.neventEncode({
      id: thunk.event.id,
      kind: thunk.event.kind,
      relays,
    })
    await navigator.clipboard.writeText(nevent)
    toast.push({message: "Permalink copied to clipboard", timeout: 2000})
  }

  const status = $derived.by(() => {
    if (!statusEvents || !selectedPatch) return undefined
    const rootAuthor = selectedPatch.author.pubkey
    const events = ($statusEvents as StatusEvent[]).filter(
      event => event.pubkey === rootAuthor || effectiveMaintainerSet.has(event.pubkey),
    )
    if (events.length > 0) {
      const statusEvent = [...events].sort((a, b) => b.created_at - a.created_at)[0]
      return statusEvent ? parseStatusEvent(statusEvent as StatusEvent) : undefined
    }
    return undefined
  })

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

  const applyPatch = async () => {
    if (!patchSet.length || !$pubkey) return
    isMerging = false
    mergeProgress = 0
    mergeStep = ""
    mergeError = null
    mergeSuccess = false
    mergeResult = null
    const firstPatch = patchSet[0]
    mergeCommitMessage = `Merge patch set: ${firstPatch?.title || `${patchSet.length} patches`} (${patchSet.length} patches)`
    showMergeDialog = true
  }

  const executeMerge = async () => {
    if (!patchSet.length || !repoClass.workerManager) return

    showMergeDialog = false
    isMerging = true
    mergeProgress = 0
    mergeStep = "Ensuring latest repository state..."
    mergeError = null
    mergeSuccess = false

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
        }
      }
    } catch (syncError) {
      console.warn("Failed to sync before merge, but continuing:", syncError)
    }

    mergeStep = "Preparing merge..."
    mergeProgress = 10

    const authorName = "Repository Maintainer"
    const authorEmail = "maintainer@nostr-git.local"
    const allCommits = patchSet.flatMap((p: Patch) => p.commits || [])
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

    if (!patchData.rawContent || typeof patchData.rawContent !== "string") {
      mergeError = `Invalid patch data: rawContent is ${typeof patchData.rawContent}`
      mergeStep = "Merge failed"
      isMerging = false
      toast.push({message: `Merge failed: ${mergeError}`, timeout: 8000, variant: "destructive"})
      return
    }

    setTimeout(() => {
      if (isMerging) {
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

    try {
      const result = await repoClass.workerManager.applyPatchAndPush({
        repoId: repoClass.key,
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
        if (result.warning) {
          toast.push({
            message: `Patch merged locally: ${result.warning}`,
            timeout: 8000,
            variant: "default",
          })
        } else {
          toast.push({message: "Patch merged successfully!", timeout: 5000})
        }
        await emitPatchAppliedStatus(result.mergeCommitOid)
      } else {
        mergeError = result.error || "Unknown merge error"
        mergeStep = "Merge failed"
        toast.push({message: `Merge failed: ${result.error}`, timeout: 8000, variant: "destructive"})
      }
    } catch (error) {
      mergeError = error instanceof Error ? error.message : "Unknown error"
      mergeStep = "Merge failed"
      toast.push({message: `Merge error: ${mergeError}`, timeout: 8000, variant: "destructive"})
    } finally {
      if (mergeSuccess) {
        setTimeout(() => {
          isMerging = false
        }, 3000)
      } else {
        isMerging = false
      }
    }
  }

  const emitPatchAppliedStatus = async (mergeCommitOid?: string) => {
    if (!patchSet.length || !$pubkey) return
    try {
      const firstPatch = patchSet[0]
      const allCommits = patchSet.flatMap((p: Patch) => p.commits || [])
      const commitIds = allCommits.map((c: Commit) => c.oid).filter(Boolean)
      const recipients = Array.from(
        new Set([...effectiveMaintainers, firstPatch?.author?.pubkey, $pubkey].filter(Boolean)),
      )
      const statusEvent = createStatusEvent({
        kind: GIT_STATUS_APPLIED,
        content: mergeCommitMessage || `Patch set applied: ${firstPatch?.title || "Multiple patches"}`,
        rootId: firstPatch?.id || "",
        recipients,
        repoAddr: repoAddress || ((repoClass as any)?.address as string) || "",
        relays: repoClass.relays,
        appliedCommits: commitIds,
        mergedCommit: mergeCommitOid,
      })
      await postStatus(statusEvent, repoClass.relays || [])
    } catch (error) {
      console.error("[emitPatchAppliedStatus] Failed to publish status event:", error)
      toast.push({
        message: "Warning: Failed to publish patch status event",
        timeout: 5000,
        variant: "destructive",
      })
    }
  }

  const cancelMerge = () => {
    showMergeDialog = false
    mergeCommitMessage = ""
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.push({message: `${label} copied to clipboard`, timeout: 2000})
    } catch (error) {
      console.error("Failed to copy to clipboard:", error)
      toast.push({message: `Failed to copy ${label}`, timeout: 3000, theme: "error"})
    }
  }

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

  const handleCommentSubmit = async (comment: any) => {
    try {
      await postComment(comment, repoClass.relays || [])
      toast.push({message: "Comment posted successfully", timeout: 2000})
    } catch (error) {
      console.error("Failed to post comment:", error)
      toast.push({message: "Failed to post comment", timeout: 3000, variant: "destructive"})
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

  const getTitleDisplay = (title: string | undefined, maxLength: number = 80): string => {
    if (!title) return ""
    if (title.length <= maxLength) return title
    return title.substring(0, maxLength).trim() + "..."
  }

  const displayTitle = $derived(getTitleDisplay(patch?.title))
</script>

<div class="z-10 items-center justify-between py-4 backdrop-blur">
  <div>
    <div class="rounded-lg border border-border bg-card p-4 sm:p-6">
      <div class="mb-4 flex flex-col items-start justify-between gap-2">
        <div class="flex items-start gap-4">
          {#if status?.status === "open"}
            <div class="mt-1">
              <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                <GitCommit class="h-5 w-5 text-amber-500" />
              </div>
            </div>
          {:else if status?.status === "applied"}
            <div class="mt-1">
              <div class="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
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
          <div
            class={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-semibold ${getStatusBadgeClass(status?.status)}`}>
            {getStatusLabel(status?.status)}
          </div>
          <div class="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground sm:text-sm">
            <Profile pubkey={patch?.author.pubkey} hideDetails={true}></Profile>
            <ProfileLink pubkey={patch?.author.pubkey} />
            <span class="hidden sm:inline">•</span>
            <span>{formatTimestamp(patch?.createdAt || "")}</span>
          </div>
        </div>
      </div>

      <div class="prose-sm dark:prose-invert markdown-content prose mb-6 max-w-none text-muted-foreground">
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
                      onclick={() => copyToClipboard(selectedPatch?.commitHash || "", "Commit hash")}>
                      <Copy class="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              {/if}

              {#if selectedPatch?.raw?.tags}
                {@const committerTag = selectedPatch.raw.tags.find((t: PatchTag) => t[0] === "committer")}
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

              {#if selectedPatch?.raw?.tags?.find((t: PatchTag) => t[0] === "commit-pgp-sig")}
                <div class="flex items-center justify-between">
                  <span class="text-muted-foreground">Signed:</span>
                  <div class="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                    <Shield class="h-3 w-3" />
                    <span class="text-xs">PGP Verified</span>
                  </div>
                </div>
              {/if}

              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span class="text-muted-foreground">Target Branch:</span>
                <code class="break-all rounded bg-background px-2 py-1 text-xs sm:break-normal">
                  {selectedPatch?.baseBranch || repoClass.mainBranch || "-"}
                </code>
              </div>

              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Commits:</span>
                <span class="text-xs font-medium">{selectedPatch?.commitCount || 1}</span>
              </div>

              {#if selectedPatch?.raw?.tags && selectedPatch.raw.tags.filter((t: string[]) => t[0] === "p").length > 0}
                {@const recipients = selectedPatch.raw.tags.filter((t: string[]) => t[0] === "p")}
                <div class="col-span-full">
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <span class="text-muted-foreground">Reviewers:</span>
                    <div class="flex flex-wrap gap-1 sm:max-w-xs">
                      {#each recipients.slice(0, 3) as recipient}
                        <ProfileLink pubkey={recipient[1]} />
                      {/each}
                      {#if recipients.length > 3}
                        <span class="text-xs text-muted-foreground">+{recipients.length - 3} more</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <Status
        repo={statusRepo}
        rootId={selectedPatch?.id ?? ""}
        rootKind={GIT_PATCH}
        rootAuthor={selectedPatch?.author.pubkey ?? ""}
        statusEvents={statusEventsArray}
        actorPubkey={$pubkey}
        ProfileComponent={NostrGitProfileComponent}
        onPublish={handleStatusPublish} />

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
                (t: PatchTag) => t[0] === "commit" && t[1] === (commitHash as any as string),
              )}
              <div class="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
                <div class="mt-1 flex-shrink-0">
                  <div class="h-2 w-2 rounded-full bg-primary"></div>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex items-center gap-2">
                    <code class="rounded bg-background px-2 py-1 font-mono text-xs">
                      {(commitHash as any as string).substring(0, 8)}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-5 w-5"
                      onclick={() => copyToClipboard(commitHash as any as string, "Commit hash")}>
                      <Copy class="h-3 w-3" />
                    </Button>
                    <span class="text-xs text-muted-foreground">#{selectedPatch.commits.length - index}</span>
                  </div>
                  <p class="text-sm text-muted-foreground">
                    Commit {index + 1} of {selectedPatch.commits.length}
                  </p>
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
              add={async (pk: string) => {
                if (!selectedPatch) return
                try {
                  const relays = (repoClass.relays || repoRelays || [])
                    .map((u: string) => normalizeRelayUrl(u))
                    .filter(Boolean)
                  postRoleLabel({
                    rootId: selectedPatch.id,
                    role: "reviewer",
                    pubkeys: [pk],
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
              Target: {repoClass.selectedBranch || patchSet[0]?.baseBranch || repoClass.mainBranch || "default"}
            </span>
          </div>
          <div class="flex items-center gap-2">
            {#if analysisTriggeredManually}
              <span
                class="rounded bg-sky-100 px-2 py-1 text-xs text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">
                Manual Analysis
              </span>
            {:else if mergeAnalysisResult}
              <span
                class="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
                Auto Analysis
              </span>
            {/if}
            <Button variant="outline" size="sm" onclick={() => analyzeMerge()} disabled={isAnalyzingMerge} class="gap-2">
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
        <div class="mb-4">
          <MergeStatus
            result={mergeAnalysisResult}
            loading={isAnalyzingMerge}
            targetBranch={repoClass.selectedBranch || patchSet[0]?.baseBranch || repoClass.mainBranch || ""} />
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
        repo={repoClass}
        publish={publishPermalink}
        diffViewerProps={{showLineNumbers: true, expandAll: false}} />

      {#if repoClass.maintainers.includes($pubkey!)}
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
            {#if isMerging}
              <div class="flex items-center gap-2 text-sky-700 dark:text-sky-300">
                <Loader2 class="h-4 w-4 animate-spin" />
                <span class="text-sm font-medium">Merging...</span>
              </div>
            {:else if mergeSuccess}
              <div class="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle class="h-4 w-4" />
                <span class="text-sm font-medium">Merged</span>
              </div>
            {:else if mergeError}
              <div class="flex items-center gap-2 text-rose-700 dark:text-rose-300">
                <AlertCircle class="h-4 w-4" />
                <span class="text-sm font-medium">Failed</span>
              </div>
            {/if}
          </div>

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

          {#if mergeError}
            <div class="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
              <div class="flex items-start gap-2">
                <AlertCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-700 dark:text-rose-300" />
                <div>
                  <p class="text-sm font-medium text-rose-900 dark:text-rose-200">Merge failed</p>
                  <p class="mt-1 text-sm text-rose-800 dark:text-rose-300">{mergeError}</p>
                </div>
              </div>
            </div>
          {/if}

          {#if mergeSuccess && mergeResult}
            <div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div class="flex items-start gap-2">
                <CheckCircle class="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-700 dark:text-emerald-300" />
                <div class="flex-1">
                  <p class="text-sm font-medium text-emerald-900 dark:text-emerald-200">Patch merged successfully!</p>
                  {#if mergeResult.mergeCommitOid}
                    <p class="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
                      Merge commit:
                      <code class="rounded bg-emerald-100 px-1 dark:bg-emerald-900/50"
                        >{mergeResult.mergeCommitOid.slice(0, 8)}</code
                      >
                    </p>
                  {/if}
                  {#if mergeResult.pushedRemotes && mergeResult.pushedRemotes.length > 0}
                    <p class="mt-1 text-sm text-emerald-800 dark:text-emerald-300"
                      >Pushed to: {mergeResult.pushedRemotes.join(", ")}</p
                    >
                  {/if}
                  {#if mergeResult.skippedRemotes && mergeResult.skippedRemotes.length > 0}
                    <div class="mt-2">
                      <p class="mb-1 text-sm font-medium text-amber-800 dark:text-amber-300">
                        ⚠️ Failed to push to {mergeResult.skippedRemotes.length} remote{mergeResult.skippedRemotes.length > 1 ? "s" : ""}:
                      </p>
                      {#if mergeResult.pushErrors && mergeResult.pushErrors.length > 0}
                        <div class="space-y-2">
                          {#each mergeResult.pushErrors as pushError}
                            <div
                              class="rounded border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
                              <p class="text-sm font-medium text-amber-900 dark:text-amber-200">
                                {pushError.remote} ({pushError.url})
                              </p>
                              <p class="mt-1 text-sm text-amber-800 dark:text-amber-300">
                                <span class="font-medium">Error:</span>
                                {pushError.error}
                              </p>
                              {#if pushError.code && pushError.code !== "UNKNOWN"}
                                <p class="mt-1 text-sm text-amber-700 dark:text-amber-400">
                                  <span class="font-medium">Code:</span>
                                  {pushError.code}
                                </p>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <p class="text-sm text-amber-800 dark:text-amber-300"
                          >{mergeResult.skippedRemotes.join(", ")}</p
                        >
                      {/if}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

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

      <Dialog bind:open={showMergeDialog}>
        <DialogContent
          class="max-w-md bg-card [&>button]:hidden"
          interactOutsideBehavior="ignore"
          escapeKeydownBehavior="ignore">
          <DialogHeader class="mb-4 text-left">
            <div class="flex items-center gap-3">
              <GitBranch class="h-5 w-5 text-primary" />
              <DialogTitle>Confirm Merge</DialogTitle>
            </div>
          </DialogHeader>
          <div class="mb-6 space-y-4">
            <div>
              <p class="mb-2 text-sm text-muted-foreground">
                This will merge the entire patch set ({patchSet.length} patch{patchSet.length !== 1 ? "es" : ""}) into
                <code class="rounded bg-muted px-1">{patchSet[0]?.baseBranch || repoClass.mainBranch || "-"}</code>
                and push to all remotes.
              </p>
              <div class="rounded-lg bg-muted/30 p-3 text-sm">
                <div class="mb-1 font-medium">Patch Set Details:</div>
                <div>Patches: {patchSet.length}</div>
                <div>Total Commits: {patchSet.flatMap((p: Patch) => p.commits || []).length}</div>
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
        </DialogContent>
      </Dialog>

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
          {onCommentCreated}
          relays={repoClass.relays || repoRelays || []}
          repoAddress={repoClass.address || ""} />
      </div>
    </div>
  </div>
</div>
