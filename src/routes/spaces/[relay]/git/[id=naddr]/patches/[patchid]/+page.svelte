<script lang="ts">
  import {page} from "$app/stores"
  import {GitCommit, MessageSquare, Check, X} from "@lucide/svelte"
  import {parseGitPatchFromEvent} from "@nostr-git/core"
  import {type RepoStateEvent, type TrustedEvent} from "@nostr-git/shared-types"
  import {Button} from "@nostr-git/ui"
  import {Avatar, AvatarFallback, AvatarImage, DiffViewer, IssueThread} from "@nostr-git/ui"
  import {deriveProfile, repository} from "@welshman/app"
  import {getContext} from "svelte"
  import type {Readable} from "svelte/motion"
  import markdownit from "markdown-it"
  import {deriveEvents} from "@welshman/store"
  import {load} from "@welshman/net"
  import {COMMENT, GIT_PATCH, type Filter} from "@welshman/util"
  import {nthEq} from "@welshman/lib"

  const repo = getContext<{
    repo: Readable<TrustedEvent>
    state: () => Readable<RepoStateEvent>
    issues: () => Readable<TrustedEvent[]>
    patches: () => Readable<TrustedEvent[]>
    relays: () => string[]
  }>("repo")

  const patches = $derived(repo.patches())

  const patchSet = $derived.by(() => {
    if (patch) {
      const filters = [{kinds: [GIT_PATCH], "#e": [patch.id]}]
      load({relays: repo.relays(), filters})
      return deriveEvents(repository, {filters})
    }
  })

  const patch = $derived.by(() => {
    if ($patches) {
      const p = $patches.find(p => p.id === $page.params.patchid)
      if (p) {
        return parseGitPatchFromEvent(p)
      }
    }
  })

  const threadComments = $derived.by(() => {
    if ($patchSet) {
      const filters: Filter[] = [{kinds: [COMMENT], "#E": patch?.id}]
      load({relays: repo.relays(), filters})
      return deriveEvents(repository, {filters})
    }
  })

  const patchProfile = $derived.by(() => {
    if (patch) {
      return deriveProfile(patch.author.pubkey)
    }
  })

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
            {#if patch?.status === "open"}
              <div class="mt-1">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                  <GitCommit class="h-5 w-5 text-amber-500" />
                </div>
              </div>
            {:else if patch?.status === "merged"}
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
              <h1 class="text-2xl font-bold">{patch?.title}</h1>

              <div class="mt-1 flex items-center gap-2">
                <div class="git-tag bg-secondary">
                  {patch?.status === "open"
                    ? "Open"
                    : patch?.status === "merged"
                      ? "Merged"
                      : "Closed"}
                </div>
                <span class="text-sm text-muted-foreground">
                  {patch?.author.name} opened this patch • {new Date(
                    patch?.createdAt,
                  ).toLocaleString()}
                </span>
              </div>

              <p class="mt-4 text-muted-foreground">{@html md.render(patch?.description || "")}</p>
            </div>
          </div>

          <Avatar class="h-10 w-10">
            <AvatarImage src={$patchProfile?.picture} alt={$patchProfile?.name} />
            <AvatarFallback>{$patchProfile?.name?.substring(0, 2).toUpperCase()}</AvatarFallback>
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

        <div class="mb-6 space-y-3"></div>

        <h2 class="mb-4 text-lg font-medium">Changes</h2>
        {#if patch?.diff}
          <DiffViewer diff={patch.diff} />
        {/if}

        <div class="git-separator my-6"></div>

        <div class="space-y-4">
          <h2 class="flex items-center gap-2 text-lg font-medium">
            <MessageSquare class="h-5 w-5" />
            Discussion ({$threadComments?.length})
          </h2>

          <IssueThread issueId={patch?.id} comments={$threadComments} />
        </div>
      </div>
    </div>
  </div>
{/if}
