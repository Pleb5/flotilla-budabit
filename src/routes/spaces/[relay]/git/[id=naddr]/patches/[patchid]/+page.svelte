<script lang="ts">
  import {page} from "$app/stores"
  import {
    AlertCircle,
    Check,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Copy,
    FileCode,
    GitBranch,
    GitCommit,
    GitMerge,
    Loader2,
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
    const sel = selectedPatch;
    if (!sel || !repoClass.repoEvent) {
      return
    }

    // Check if repository is properly initialized before attempting merge analysis
    if (!repoClass.repoId || !repoClass.mainBranch) {

      return
    }

    // Check if WorkerManager is ready
    if (!repoClass.workerManager) {

      return
    }

    // Use robust branch detection: patch baseBranch, repo mainBranch, or fallback
    const targetBranch = sel.baseBranch || repoClass.mainBranch || "main";

    // Resolve the PatchEvent corresponding to the currently selected parsed patch
    const selectedPatchEvent = repoClass.patches.find(p => p.id === sel.id)
    if (!selectedPatchEvent) {
      return
    }

    // First, try to get cached result from repository's merge analysis system
    const cachedResult = await repoClass.getMergeAnalysis(selectedPatchEvent, targetBranch)
    
    if (cachedResult) {
      mergeAnalysisResult = cachedResult
      return
    }

    isAnalyzingMerge = true
    mergeAnalysisResult = null
    try {
      let result = await repoClass.getMergeAnalysis(selectedPatchEvent, targetBranch)
      
      if (result) {
        mergeAnalysisResult = result
      } else {
        // If still no result, try to get from cache first
        const cachedResult = await repoClass.getMergeAnalysis(selectedPatchEvent, targetBranch)
        if (cachedResult) {
          mergeAnalysisResult = cachedResult
        } else {
          // Don't show error immediately, just return and let it retry
          return
        }
      }
    } catch (error) {
      console.error("❌ Failed to get merge analysis:", error)
      const errorMessage = error instanceof Error ? error.message : "Unknown error"

      // Only show toast for non-initialization errors
      if (!errorMessage.includes('initializing')) {
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
    } finally {
      isAnalyzingMerge = false
    }
  }

  let analysisTimeout: NodeJS.Timeout | null = null
  
  $effect(() => {
    if (selectedPatch && repoClass.repoId && repoClass.mainBranch) {
      // Clear any existing timeout
      if (analysisTimeout) {
        clearTimeout(analysisTimeout)
      }
      
      // Debounce the analysis call
      analysisTimeout = setTimeout(() => {
        analyzeMerge()
      }, 300) // Wait 300ms before running analysis
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

  // Merge state management
  let isMerging = $state(false);
  let mergeProgress = $state(0);
  let mergeStep = $state('');
  let mergeError = $state<string | null>(null);
  let mergeSuccess = $state(false);
  let mergeResult = $state<{
    mergeCommitOid?: string;
    pushedRemotes?: string[];
    skippedRemotes?: string[];
    pushErrors?: Array<{ remote: string; url: string; error: string; code: string; stack: string }>;
  } | null>(null);
  let showMergeDialog = $state(false);
  let mergeCommitMessage = $state('');

  // Apply patch with full GitHub-style merge workflow
  const applyPatch = async () => {
    if (!selectedPatch || !$pubkey) return;
    
    // Reset merge state
    isMerging = false;
    mergeProgress = 0;
    mergeStep = '';
    mergeError = null;
    mergeSuccess = false;
    mergeResult = null;
    
    // Set default merge commit message
    const defaultMessage = `Merge patch: ${selectedPatch.title || selectedPatch.id.slice(0, 8)}`;
    mergeCommitMessage = defaultMessage;
    
    // Show merge dialog for confirmation
    showMergeDialog = true;
  };
  
  // Execute the actual merge after confirmation
  const executeMerge = async () => {
    if (!selectedPatch || !repoClass.workerManager) return;
    
    showMergeDialog = false;
    isMerging = true;
    mergeProgress = 0;
    mergeStep = 'Preparing merge...';
    mergeError = null;
    mergeSuccess = false;
    
    // Get user profile for commit author
    const authorName = 'Repository Maintainer'; // You might want to get this from user profile
    const authorEmail = 'maintainer@nostr-git.local'; // You might want to get this from user profile
    
    // Prepare patch data - ensure all data is serializable
    const patchData = {
      id: selectedPatch.id,
      commits: (selectedPatch.commits || []).map(commit => ({
        oid: commit.oid || '',
        message: commit.message || '',
        author: {
          name: commit.author?.name || '',
          email: commit.author?.email || ''
        }
      })),
      baseBranch: selectedPatch.baseBranch || repoClass.mainBranch || 'main',
      rawContent: selectedPatch.raw?.content || ''
    };
    
    // Validate patch data before proceeding
    if (!patchData.rawContent || typeof patchData.rawContent !== 'string') {
      mergeError = `Invalid patch data: rawContent is ${typeof patchData.rawContent} (${patchData.rawContent})`;
      mergeStep = 'Merge failed';
      isMerging = false;
      toast.push({
        message: `Merge failed: ${mergeError}`,
        timeout: 8000,
        variant: 'destructive'
      });
      return;
    }
    
    try {
      // Manual progress tracking since we can't pass callbacks to workers
      mergeStep = 'Preparing merge...';
      mergeProgress = 10;
      
      // Simulate progress updates
      setTimeout(() => {
        if (isMerging) {
          mergeStep = 'Analyzing patch...';
          mergeStep = 'Analyzing patch...';
          mergeProgress = 25;
        }
      }, 200);
      
      setTimeout(() => {
        if (isMerging) {
          mergeStep = 'Applying changes...';
          mergeProgress = 50;
        }
      }, 500);
      
      setTimeout(() => {
        if (isMerging) {
          mergeStep = 'Creating merge commit...';
          mergeProgress = 75;
        }
      }, 1000);
      
      setTimeout(() => {
        if (isMerging) {
          mergeStep = 'Pushing to remotes...';
          mergeProgress = 90;
        }
      }, 1500);
      
    } catch (error) {
      mergeError = error instanceof Error ? error.message : 'Setup error';
      mergeStep = 'Setup failed';
      isMerging = false;
      
      toast.push({
        message: `Setup failed: ${mergeError}`,
        timeout: 8000,
        variant: 'destructive'
      });
      return;
    }
      
    // Execute merge via worker
    // Use canonical repo ID consistently for worker operations
    const effectiveRepoId = repoClass.canonicalKey || repoClass.repoId || '';
    
    try {
        
        const result = await repoClass.workerManager.applyPatchAndPush({
          repoId: effectiveRepoId,
          patchData,
          targetBranch: repoClass.mainBranch,
          mergeCommitMessage: mergeCommitMessage || undefined,
          authorName,
          authorEmail
        });
      
      if (result.success) {
        mergeSuccess = true;
        mergeResult = result;
        mergeStep = 'Merge completed successfully!';
        mergeProgress = 100;
        
        // Show success toast with warning if applicable
        if (result.warning) {
          toast.push({
            message: `Patch merged locally: ${result.warning}`,
            timeout: 8000,
            variant: 'default'
          });
        } else {
          toast.push({
            message: 'Patch merged successfully!',
            timeout: 5000
          });
        }
        
        // Note: Repository data will be refreshed automatically via reactive stores
        
      } else {
        mergeError = result.error || 'Unknown merge error';
        mergeStep = 'Merge failed';
        
        // Show error toast
        toast.push({
          message: `Merge failed: ${result.error}`,
          timeout: 8000,
          variant: 'destructive'
        });
      }
      
    } catch (error) {
      mergeError = error instanceof Error ? error.message : 'Unknown error';
      mergeStep = 'Merge failed';
      
      toast.push({
        message: `Merge error: ${mergeError}`,
        timeout: 8000,
        variant: 'destructive'
      });
    } finally {
      // Keep merge state visible for a few seconds on success
      if (mergeSuccess) {
        setTimeout(() => {
          isMerging = false;
        }, 3000);
      } else {
        isMerging = false;
      }
    }
  };
  
  // Cancel merge dialog
  const cancelMerge = () => {
    showMergeDialog = false;
    mergeCommitMessage = '';
  };

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
          <!-- GitHub-style Merge Section -->
          <div class="border rounded-lg p-6 bg-card">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-3">
                <GitMerge class="h-5 w-5 text-primary" />
                <div>
                  <h3 class="font-semibold">Merge this patch</h3>
                  <p class="text-sm text-muted-foreground">
                    Apply the changes from this patch to the {repoClass.mainBranch || 'main'} branch
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
                <div class="flex items-center justify-between text-sm mb-2">
                  <span class="text-muted-foreground">{mergeStep}</span>
                  <span class="text-muted-foreground">{mergeProgress}%</span>
                </div>
                <div class="w-full bg-muted rounded-full h-2">
                  <div 
                    class="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                    style="width: {mergeProgress}%"
                  ></div>
                </div>
              </div>
            {/if}
            
            <!-- Merge Error Display -->
            {#if mergeError}
              <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <div class="flex items-start gap-2">
                  <AlertCircle class="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p class="text-sm font-medium text-red-800">Merge failed</p>
                    <p class="text-sm text-red-700 mt-1">{mergeError}</p>
                  </div>
                </div>
              </div>
            {/if}
            
            <!-- Merge Success Display -->
            {#if mergeSuccess && mergeResult}
              <div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div class="flex items-start gap-2">
                  <CheckCircle class="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <div class="flex-1">
                    <p class="text-sm font-medium text-green-800">Patch merged successfully!</p>
                    {#if mergeResult.mergeCommitOid}
                      <p class="text-sm text-green-700 mt-1">
                        Merge commit: <code class="bg-green-100 px-1 rounded">{mergeResult.mergeCommitOid.slice(0, 8)}</code>
                      </p>
                    {/if}
                    {#if mergeResult.pushedRemotes && mergeResult.pushedRemotes.length > 0}
                      <p class="text-sm text-green-700 mt-1">
                        Pushed to: {mergeResult.pushedRemotes.join(', ')}
                      </p>
                    {/if}
                    {#if mergeResult.skippedRemotes && mergeResult.skippedRemotes.length > 0}
                      <div class="mt-2">
                        <p class="text-sm font-medium text-yellow-700 mb-1">
                          ⚠️ Failed to push to {mergeResult.skippedRemotes.length} remote{mergeResult.skippedRemotes.length > 1 ? 's' : ''}:
                        </p>
                        {#if mergeResult.pushErrors && mergeResult.pushErrors.length > 0}
                          <!-- Detailed error information -->
                          <div class="space-y-2">
                            {#each mergeResult.pushErrors as pushError}
                              <div class="bg-yellow-50 border border-yellow-200 rounded p-2">
                                <div class="flex items-start gap-2">
                                  <div class="flex-1">
                                    <p class="text-sm font-medium text-yellow-800">
                                      {pushError.remote} ({pushError.url})
                                    </p>
                                    <p class="text-sm text-yellow-700 mt-1">
                                      <span class="font-medium">Error:</span> {pushError.error}
                                    </p>
                                    {#if pushError.code && pushError.code !== 'UNKNOWN'}
                                      <p class="text-sm text-yellow-600 mt-1">
                                        <span class="font-medium">Code:</span> {pushError.code}
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
                            {mergeResult.skippedRemotes.join(', ')}
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
                class="min-w-[120px]"
              >
                {#if isMerging}
                  <Loader2 class="h-4 w-4 animate-spin mr-2" />
                  Merging...
                {:else if mergeSuccess}
                  <CheckCircle class="h-4 w-4 mr-2" />
                  Merged
                {:else}
                  <GitMerge class="h-4 w-4 mr-2" />
                  Merge Patch
                {/if}
              </Button>
            </div>
          </div>
        {/if}
        <!-- Merge Confirmation Dialog -->
        {#if showMergeDialog}
          <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" transition:slideAndFade>
            <div class="bg-card border rounded-lg shadow-lg max-w-md w-full mx-4 p-6">
              <div class="flex items-center gap-3 mb-4">
                <GitBranch class="h-5 w-5 text-primary" />
                <h3 class="text-lg font-semibold">Confirm Merge</h3>
              </div>
              
              <div class="space-y-4 mb-6">
                <div>
                  <p class="text-sm text-muted-foreground mb-2">
                    This will merge the patch into <code class="bg-muted px-1 rounded">{repoClass.mainBranch || 'main'}</code> and push to all remotes.
                  </p>
                  
                  <div class="bg-muted/30 p-3 rounded-lg text-sm">
                    <div class="font-medium mb-1">Patch Details:</div>
                    <div>ID: <code>{selectedPatch?.id.slice(0, 16)}...</code></div>
                    <div>Commits: {selectedPatch?.commits?.length || 0}</div>
                    <div>Target: {repoClass.mainBranch || 'main'}</div>
                  </div>
                </div>
                
                <div>
                  <label for="merge-message" class="block text-sm font-medium mb-2">
                    Merge commit message:
                  </label>
                  <textarea
                    id="merge-message"
                    bind:value={mergeCommitMessage}
                    class="w-full p-2 border rounded-md text-sm resize-none"
                    rows="3"
                    placeholder="Enter merge commit message..."
                  ></textarea>
                </div>
              </div>
              
              <div class="flex justify-end gap-3">
                <Button variant="outline" onclick={cancelMerge}>
                  Cancel
                </Button>
                <Button variant="default" onclick={executeMerge}>
                  <GitMerge class="h-4 w-4 mr-2" />
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
