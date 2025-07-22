<script lang="ts">
  import {page} from "$app/stores"
  import {
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    FileCode,
    GitCommit,
    GitMerge,
    MessageSquare,
    Shield,
    User,
    X,
  } from "@lucide/svelte"
  import {Button, Profile, MergeStatus, toast} from "@nostr-git/ui"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {DiffViewer, IssueThread} from "@nostr-git/ui"
  import {pubkey, repository} from "@welshman/app"
  import markdownit from "markdown-it"
  import {deriveEvents} from "@welshman/store"
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
    type CommentEvent,
    type StatusEvent,
    type PatchEvent,
  } from "@nostr-git/shared-types"
  import {postComment} from "@src/app/commands.js"
  import {parseGitPatchFromEvent, analyzePatchMerge} from "@nostr-git/core"
  import type {MergeAnalysisResult} from "@nostr-git/core"
  import {sortBy} from "@welshman/lib"
  import {derived as _derived} from "svelte/store"
  import type {LayoutProps} from "../../$types"
  import {slideAndFade} from "@src/lib/transition"

  let {data}: LayoutProps = $props()
  const {repoClass, repoRelays} = data

  const patchId = $page.params.patchid

  const patchEvent = repoClass.patches.find(p => p.id === patchId)
  const patch = patchEvent ? parseGitPatchFromEvent(patchEvent) : undefined

  let rootPatchId = patchId
  let currentPatch = patchEvent as PatchEvent | null
  while (currentPatch) {
    const replyTags = getTags(currentPatch, "e")
    if (replyTags.length === 0) break

    const parentId = replyTags[0][1]
    const parentPatch = repoClass.patches.find(p => p.id === parentId)
    if (!parentPatch) break

    rootPatchId = parentId
    currentPatch = parentPatch
  }

  const patchSet = repoClass.patches
    .filter((p): p is PatchEvent => {
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
            checkPatch = repoClass.patches.find((p): p is PatchEvent => p.id === checkParentId)
            if (!checkPatch) break
          }
          return foundRoot
        }
      }
      return false
    })
    .sort((a, b) => a.created_at - b.created_at)
    .sort((a, b) => (a.id === rootPatchId ? -1 : 1))
    .map(p => parseGitPatchFromEvent(p))

  let selectedPatch = $state(patch)
  let mergeAnalysisResult: MergeAnalysisResult | null = $state(null)
  let isAnalyzingMerge = $state(false)

  async function analyzeMerge() {
    if (!selectedPatch || !patchEvent || !repoClass.repoEvent) {
      return
    }

    // Use robust branch detection: patch baseBranch, repo mainBranch, or fallback
    const targetBranch = selectedPatch?.baseBranch || repoClass.mainBranch || "main";

    // First, try to get cached result from repository's merge analysis system
    const cachedResult = await repoClass.getMergeAnalysis(patchEvent, targetBranch)
    
    if (cachedResult) {
      mergeAnalysisResult = cachedResult
      return
    }

    // If no cached result, the repository's background processing should handle this
    // Set loading state and wait for background analysis to complete
    isAnalyzingMerge = true
    mergeAnalysisResult = null

    try {
      // The repository should already be running background merge analysis
      // We just need to trigger a refresh if needed and wait for the result
      const result = await repoClass.refreshMergeAnalysis(patchEvent)
      
      if (result) {
        mergeAnalysisResult = result
      } else {
        // If still no result, create a minimal error state
        throw new Error('Merge analysis not available - repository may still be initializing')
      }
    } catch (error) {
      console.error("❌ Failed to get merge analysis:", error)
      const errorMessage = error instanceof Error ? error.message : "Unknown error"

      toast.push({
        message: `Merge Analysis Failed: ${errorMessage}`,
        timeout: 5000,
        theme: "error",
      })

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
    } finally {
      isAnalyzingMerge = false
    }
  }

  $effect(() => {
    if (selectedPatch) {
      analyzeMerge()
    }
  })

  const threadComments = $derived.by(() => {
    if (repoClass.patches && selectedPatch) {
      const filters: Filter[] = [{kinds: [COMMENT], "#E": [selectedPatch.id]}]
      load({relays: repoClass.relays, filters})
      return _derived(deriveEvents(repository, {filters}), (events: TrustedEvent[]) => {
        return sortBy(e => -e.created_at, events) as CommentEvent[]
      })
    }
  })

  const getStatusFilter = () => ({
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [selectedPatch?.id ?? ""],
  })

  const statusEvents = $derived.by(() => {
    return deriveEvents(repository, {filters: [getStatusFilter()]})
  })

  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, $repoRelays).result
  }

  const status = $derived.by(() => {
    if ($statusEvents) {
      const statusEvent = $statusEvents.sort((a, b) => b.created_at - a.created_at)[0]
      return statusEvent ? parseStatusEvent(statusEvent as StatusEvent) : undefined
    }
  })

  const md = markdownit({
    html: true,
    linkify: true,
    typographer: true,
  })

  const applyPatch = () => {}

  // Copy to clipboard function
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.push({
        message: `${label} copied to clipboard`,
        timeout: 2000
      })
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      toast.push({
        message: `Failed to copy ${label}`,
        timeout: 3000,
        theme: 'error'
      })
    }
  }

  // Enhanced timestamp formatting
  const formatTimestamp = (timestamp: string | number) => {
    const date = new Date(typeof timestamp === 'string' ? timestamp : timestamp * 1000)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      return `today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    } else if (diffDays === 1) {
      return `yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    } else if (diffDays < 7) {
      return `${diffDays} days ago`
    } else {
      return date.toLocaleDateString([], { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }
  }
</script>

{#if patch}
  <div class="z-10 sticky top-0 items-center justify-between py-4 backdrop-blur">
    <div>
      <div class="rounded-lg border border-border bg-card p-6">
        <div class="mb-4 flex items-start justify-between">
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

            <div>
              <h1 class="break-words text-2xl font-bold">{patch?.title}</h1>

              <div class="mt-1 flex items-center gap-2">
                <div class="git-tag bg-secondary">
                  {status?.status === "open"
                    ? "Open"
                    : status?.status === "applied"
                      ? "Applied"
                      : "Closed"}
                </div>
                <span class="text-sm text-muted-foreground">
                  <ProfileLink pubkey={patch?.author.pubkey} />
                  opened this patch • {formatTimestamp(patch?.createdAt || '')}
                </span>
              </div>
            </div>
          </div>

          <Profile pubkey={patch.author.pubkey} hideDetails={true}></Profile>
        </div>

        <div class="mb-6">
          <p class="text-muted-foreground">{@html md.render(patch?.description || "")}</p>
        </div>

        <!-- Technical Metadata -->
        <div class="mb-6 p-4 bg-muted/30 rounded-lg border">
          <h3 class="text-sm font-medium mb-3 flex items-center gap-2">
            <GitCommit class="h-4 w-4" />
            Technical Details
          </h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <!-- Commit Hash -->
            {#if selectedPatch?.commitHash}
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Commit:</span>
                <div class="flex items-center gap-2">
                  <code class="bg-background px-2 py-1 rounded text-xs font-mono">
                    {selectedPatch.commitHash.substring(0, 8)}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-6 w-6"
                    onclick={() => copyToClipboard(selectedPatch?.commitHash || '', 'Commit hash')}
                  >
                    <Copy class="h-3 w-3" />
                  </Button>
                </div>
              </div>
            {/if}

            <!-- Author vs Committer -->
            {#if selectedPatch?.raw?.tags}
              {@const committerTag = selectedPatch.raw.tags.find(t => t[0] === 'committer')}
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
            {#if selectedPatch?.raw?.tags?.find(t => t[0] === 'commit-pgp-sig')}
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Signed:</span>
                <div class="flex items-center gap-2 text-green-600">
                  <Shield class="h-3 w-3" />
                  <span class="text-xs">PGP Verified</span>
                </div>
              </div>
            {/if}

            <!-- Base Branch -->
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">Target Branch:</span>
              <code class="bg-background px-2 py-1 rounded text-xs">
                {selectedPatch?.baseBranch || 'main'}
              </code>
            </div>

            <!-- Commit Count -->
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">Commits:</span>
              <span class="text-xs font-medium">{selectedPatch?.commitCount || 1}</span>
            </div>

            <!-- Recipients/Reviewers -->
            {#if selectedPatch?.raw?.tags && selectedPatch.raw.tags.filter(t => t[0] === 'p').length > 0}
              {@const recipients = selectedPatch.raw.tags.filter(t => t[0] === 'p')}
              <div class="col-span-full">
                <div class="flex items-start justify-between">
                  <span class="text-muted-foreground">Reviewers:</span>
                  <div class="flex flex-wrap gap-1 max-w-xs">
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

        <!-- Individual Commit Timeline -->
        {#if selectedPatch?.commits && selectedPatch.commits.length > 1}
          <div class="mb-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-medium flex items-center gap-2">
                <GitCommit class="h-5 w-5" />
                Commit Timeline ({selectedPatch.commits.length} commits)
              </h3>
            </div>
            
            <div class="space-y-3">
              {#each selectedPatch.commits.slice(0, 5) as commitHash, index}
                {@const commitTag = selectedPatch?.raw?.tags?.find(t => t[0] === 'commit' && t[1] === commitHash)}
                <div class="flex items-start gap-3 p-3 bg-muted/20 rounded-lg border">
                  <div class="flex-shrink-0 mt-1">
                    <div class="w-2 h-2 bg-primary rounded-full"></div>
                  </div>
                  
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <code class="bg-background px-2 py-1 rounded text-xs font-mono">
                        {commitHash.substring(0, 8)}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-5 w-5"
                        onclick={() => copyToClipboard(commitHash, 'Commit hash')}
                      >
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
                      <div class="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
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

        <!-- File Statistics -->
        {#if selectedPatch?.diff && selectedPatch.diff.length > 0}
          <div class="mb-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-medium flex items-center gap-2">
                <FileCode class="h-5 w-5" />
                File Changes
              </h3>
            </div>
            
            {#if selectedPatch.diff}
              {@const stats = selectedPatch.diff.reduce((acc, file) => {
                // This is a simplified calculation - real implementation would parse the diff
                const content = file.content || ''
                const added = (content.match(/^\+/gm) || []).length
                const removed = (content.match(/^-/gm) || []).length
                return { added: acc.added + added, removed: acc.removed + removed }
              }, { added: 0, removed: 0 })}
              
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div class="bg-muted/20 p-3 rounded-lg border text-center">
                  <div class="text-2xl font-bold text-primary">{selectedPatch.diff.length}</div>
                  <div class="text-sm text-muted-foreground">Files Changed</div>
                </div>
                
                <div class="bg-green-50 dark:bg-green-950/20 p-3 rounded-lg border text-center">
                  <div class="text-2xl font-bold text-green-600">+{stats.added}</div>
                  <div class="text-sm text-muted-foreground">Lines Added</div>
                </div>
                
                <div class="bg-red-50 dark:bg-red-950/20 p-3 rounded-lg border text-center">
                  <div class="text-2xl font-bold text-red-600">-{stats.removed}</div>
                  <div class="text-sm text-muted-foreground">Lines Removed</div>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Merge Status Analysis -->
        <div class="mb-6">
          <MergeStatus
            result={mergeAnalysisResult}
            loading={isAnalyzingMerge}
            targetBranch={selectedPatch?.baseBranch || repoClass.mainBranch || "main"} />
        </div>

        <div class="git-separator"></div>

        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-medium">Changes</h2>

          <!-- Navigation Controls -->
          {#if patchSet.length > 1}
            <div class="flex items-center gap-2">
              {#key selectedPatch?.id}
                {@const currentIndex = patchSet.findIndex(p => p.id === selectedPatch?.id)}
                {@const hasPrevious = currentIndex > 0}
                {@const hasNext = currentIndex < patchSet.length - 1}

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasPrevious}
                  onclick={() => {
                    if (hasPrevious) {
                      selectedPatch = patchSet[currentIndex - 1]
                    }
                  }}>
                  <ChevronLeft class="mr-1 h-4 w-4" />
                  Previous
                </Button>

                <span class="text-sm text-muted-foreground">
                  {currentIndex + 1} of {patchSet.length}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNext}
                  onclick={() => {
                    if (hasNext) {
                      selectedPatch = patchSet[currentIndex + 1]
                    }
                  }}>
                  Next
                  <ChevronRight class="ml-1 h-4 w-4" />
                </Button>
              {/key}
            </div>
          {/if}
        </div>

        <!-- Patch Set -->
        <div class="mb-6 overflow-hidden rounded-md border border-border">
          {#key selectedPatch?.id}
            <div transition:slideAndFade={{axis: "y", duration: 250}}>
              {#if selectedPatch}
                <div
                  class="flex w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0 hover:bg-secondary/20">
                  <div class="flex-shrink-0">
                    <GitCommit class="h-5 w-5 text-primary" />
                  </div>
                  <div class="flex-grow">
                    <div class="break-words font-semibold">
                      {selectedPatch.title || `Patch ${selectedPatch.id}`}
                    </div>
                    <div class="flex items-center gap-2 text-sm text-muted-foreground">
                      <span
                        >{selectedPatch.author.name ||
                          selectedPatch.author.pubkey.slice(0, 8)}</span>
                      <span>•</span>
                      <span>{new Date(selectedPatch.createdAt).toLocaleString()}</span>
                      {#if selectedPatch.commitHash}
                        <span>•</span>
                        <span>{selectedPatch.commitHash.slice(0, 8)}</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
              {#if selectedPatch?.diff}
                <DiffViewer diff={selectedPatch.diff} />
              {/if}
            </div>
          {/key}
        </div>
        {#if repoClass.maintainers.includes($pubkey!)}
          <div class="flex justify-end">
            <Button onclick={applyPatch} variant="default">
              <GitMerge class="h-4 w-4" /> Apply
            </Button>
          </div>
        {/if}
        <div class="git-separator my-6"></div>

        <div class="space-y-4">
          <h2 class="flex items-center gap-2 text-lg font-medium">
            <MessageSquare class="h-5 w-5" />
            Discussion ({$threadComments?.length})
          </h2>

          <IssueThread
            issueId={selectedPatch?.id ?? ""}
            issueKind={GIT_PATCH.toString() as "1617"}
            comments={$threadComments as CommentEvent[]}
            currentCommenter={$pubkey!}
            {onCommentCreated} />
        </div>
      </div>
    </div>
  </div>
{/if}
