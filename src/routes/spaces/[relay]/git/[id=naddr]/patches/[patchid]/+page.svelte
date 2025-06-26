<script lang="ts">
  import {page} from "$app/stores"
  import {Check, ChevronLeft, ChevronRight, GitCommit, MessageSquare, X} from "@lucide/svelte"
  import {Button, Profile} from "@nostr-git/ui"
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
    type TrustedEvent
  } from "@welshman/util"
  import {
    getTags,
    parseStatusEvent,
    type CommentEvent,
    type StatusEvent,
    type PatchEvent,
  } from "@nostr-git/shared-types"
  import {postComment} from "@src/app/commands.js"
  import {parseGitPatchFromEvent} from "@nostr-git/core"
  import { sortBy } from "@welshman/lib"
  import { derived as _derived } from "svelte/store"
  import type { LayoutProps } from "../../$types"

  let {data}:LayoutProps = $props()
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
        if (replyTags.length > 0) {
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
    .sort((a,b) => a.id === rootPatchId ? -1 : 1)
    .map(p => parseGitPatchFromEvent(p))
    
  let selectedPatch = $state(patch)

  const threadComments = $derived.by(() => {
    if (repoClass.patches && selectedPatch) {
      const filters: Filter[] = [{kinds: [COMMENT], "#E": [selectedPatch.id]}]
      load({relays: repoClass.relays, filters})
      return _derived(deriveEvents(repository, {filters}),
        (events: TrustedEvent[]) => {
          return sortBy(e => -e.created_at, events) as CommentEvent[]
        }
      )
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

  function truncateHash(hash: string): string {
    return hash.substring(0, 7);
  }

  const md = markdownit({
    html: true,
    linkify: true,
    typographer: true,
  })
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
              <h1 class="text-2xl font-bold break-words">{patch?.title}</h1>

              <div class="mt-1 flex items-center gap-2">
                <div class="git-tag bg-secondary">
                  {status?.status === "open"
                    ? "Open"
                    : status?.status === "applied"
                      ? "Applied"
                      : "Closed"}
                </div>
                <span class="text-sm text-muted-foreground">
                  <ProfileLink pubkey={patch?.author.pubkey}/>
                  opened this patch • {new Date(
                    patch?.createdAt,
                  ).toLocaleString()}
                </span>
              </div>

              <p class="mt-4 text-muted-foreground">{@html md.render(patch?.description || "")}</p>
            </div>
          </div>

          <Profile pubkey={patch.author.pubkey} hideDetails={true}></Profile>
        </div>

        <div class="git-separator"></div>

        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-medium">{patchSet.length} Patches in Set</h2>

          <div class="flex items-center gap-2">
            {#if status?.status === "open"}
              <Button variant="default" size="sm" class="bg-git hover:bg-git-hover">
                Merge Patch
              </Button>
            {/if}
          </div>
        </div>

        <!-- Patch Set -->
        <div class="mb-6 border border-border rounded-md overflow-hidden">
          {#each patchSet as patchItem, index}
            {@const isSelected = selectedPatch?.id === patchItem.id}
            {@const isRoot = patchSet.some(p => {
              const tags = getTags(p.raw, "e")
              return tags.length > 0 && tags[0][1] === patchItem.id
            })}
            
            <button 
              class="w-full text-left p-3 hover:bg-secondary/20 border-b border-border last:border-b-0 flex items-center gap-3 {isSelected ? 'bg-secondary/30' : ''}" 
              onclick={() => selectedPatch = patchItem}
            >
              <div class="flex-shrink-0">
                <GitCommit class="h-5 w-5 {isSelected ? 'text-primary' : 'text-muted-foreground'}" />
              </div>
              <div class="flex-grow">
                <div class="font-semibold break-words">{patchItem.title || `Patch ${index + 1}`}</div>
                <div class="text-sm text-muted-foreground flex items-center gap-2">
                  <ProfileLink pubkey={patchItem.author.pubkey}/>
                  <span>•</span>
                  <span>{new Date(patchItem.createdAt).toLocaleString()}</span>
                  {#if patchItem.commitHash}
                    <span>•</span>
                    <span>{truncateHash(patchItem.commitHash)}</span>
                  {/if}
                  {#if isRoot}
                    <span class="ml-1 px-1.5 py-0.5 text-xs rounded bg-blue-500/20 text-blue-500">root</span>
                  {/if}
                </div>
              </div>
            </button>
          {/each}
        </div>

        <div class="flex items-center justify-between mb-4">
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
                      selectedPatch = patchSet[currentIndex - 1];
                    }
                  }}
                >
                  <ChevronLeft class="h-4 w-4 mr-1" />
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
                      selectedPatch = patchSet[currentIndex + 1];
                    }
                  }}
                >
                  Next
                  <ChevronRight class="h-4 w-4 ml-1" />
                </Button>
              {/key}
            </div>
          {/if}
        </div>
        
        {#if selectedPatch?.diff}
          <DiffViewer diff={selectedPatch.diff} />
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
