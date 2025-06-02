<script lang="ts">
  import {page} from "$app/stores"
  import {GitCommit, MessageSquare, Check, X} from "@lucide/svelte"
  import { parseGitPatchFromEvent } from "@nostr-git/core"
  import {type RepoStateEvent, type TrustedEvent} from "@nostr-git/shared-types"
  import {Button} from "@nostr-git/ui"
  import {Avatar, AvatarFallback, AvatarImage, DiffViewer, IssueThread} from "@nostr-git/ui"
  import {getContext} from "svelte"
  import type {Readable} from "svelte/motion"

  const repo = getContext<{
    repo: Readable<TrustedEvent>
    state: () => Readable<RepoStateEvent>
    issues: () => Readable<TrustedEvent[]>
    patches: () => Readable<TrustedEvent[]>
  }>("repo")

  const patches = $derived(repo.patches())

  const patch = $derived.by(() => {
    if ($patches) {
      const p = $patches.find(patch => patch.id === $page.params.patchid)
      if (p) {
        return parseGitPatchFromEvent(p)
      }
    }
  })

  const threadComments = $derived.by(() => {
    if (patch) {
      console.log(patch)
      return []
    }
  })
</script>

<div class="container max-w-6xl py-6">
  <div class="mt-6">
    <div class="rounded-lg border border-border bg-card p-6">
      <div class="mb-4 flex items-start justify-between">
        <div class="flex items-start gap-4">
          {#if patch?.status === "open"}
            <div class="mt-1">
              <div class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                <GitCommit class="h-5 w-5 text-amber-500" />
              </div>
            </div>
          {:else if patch?.status === "merged"}
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

          <div>
            <h1 class="text-2xl font-bold">{patch?.title}</h1>

            <div class="mt-1 flex items-center gap-2">
              <div class="git-tag bg-secondary">
                {patch?.status === "open" ? "Open" : patch?.status === "merged" ? "Merged" : "Closed"}
              </div>
              <span class="text-sm text-muted-foreground">
                {patch?.author.name} opened this patch • {new Date(patch?.createdAt).toLocaleString()}
              </span>
            </div>

            <p class="mt-4 text-muted-foreground">{patch?.description}</p>
          </div>
        </div>

        <Avatar class="h-10 w-10">
          <AvatarImage src={patch?.author.picture} alt={patch?.author.name} />
          <AvatarFallback>{patch?.author.name.substring(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </div>

      <div class="git-separator"></div>

      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-medium">{patch?.commitCount} Commits</h2>

        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm">View on GitHub</Button>

          {#if patch?.status === "open"}
            <Button variant="default" size="sm" class="bg-git hover:bg-git-hover">
              Merge Patch
            </Button>
          {/if}
        </div>
      </div>

      <div class="mb-6 space-y-3">
        {#each patch?.diff as commit (commit.id)}
          <div class="flex items-start gap-3 rounded-md border border-border p-3">
            <GitCommit class="mt-1 h-5 w-5 text-muted-foreground" />
            <div>
              <p class="font-medium">{commit.message}</p>
              <div class="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <span>{commit.author}</span>
                <span>•</span>
                <span>{new Date(commit.date).toLocaleString()}</span>
                <span>•</span>
                <code class="rounded bg-secondary/50 px-1.5 py-0.5 text-xs"
                  >{commit.id.substring(0, 7)}</code>
              </div>
            </div>
          </div>
        {/each}
      </div>

      <h2 class="mb-4 text-lg font-medium">Changes</h2>
      <DiffViewer diff={patch?.raw.diff} />

      <div class="git-separator my-6"></div>

      <div class="space-y-4">
        <h2 class="flex items-center gap-2 text-lg font-medium">
          <MessageSquare class="h-5 w-5" />
          Discussion ({threadComments?.length})
        </h2>

        <IssueThread issueId={patch?.id} comments={threadComments} />
      </div>
    </div>
  </div>
</div>
