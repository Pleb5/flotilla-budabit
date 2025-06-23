<script lang="ts">
  import {page} from "$app/stores"
  import {GitCommit, MessageSquare, Check, X} from "@lucide/svelte"
  import {parseGitPatchFromEvent} from "@nostr-git/core"
  import {Button, Repo} from "@nostr-git/ui"
  import { DiffViewer, IssueThread} from "@nostr-git/ui"
  import { repository, pubkey } from "@welshman/app"
  import {getContext} from "svelte"
  import markdownit from "markdown-it"
  import {deriveEvents} from "@welshman/store"
  import {load} from "@welshman/net"
  import {COMMENT, GIT_PATCH, type Filter, type TrustedEvent} from "@welshman/util"
  import type {CommentEvent} from "@nostr-git/shared-types"
  import { REPO_KEY, REPO_RELAYS_KEY } from "@src/app/state"
  import { derived as _derived } from "svelte/store"
  import { postComment } from "@src/app/commands"
  import Profile from "@src/app/components/Profile.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)

  const patch = $derived.by(() => {
    if (repoClass.patches) {
      const p = repoClass.patches.find(p => p.id === $page.params.patchid)
      if (p) {
        return parseGitPatchFromEvent(p)
      }
    }
  })

  let threadComments = $derived.by(() => {
    if(patch) {
      const filter: Filter = {kinds: [COMMENT], "#E": [patch.id]}
      load({relays: repoClass.relays, filters:[filter]})
      return _derived(deriveEvents(repository, {filters:[filter]}),
        (events: TrustedEvent[]) => {
          return events as CommentEvent[]
        }
      )
    }
  })

  const repoRelays = getContext<string[]>(REPO_RELAYS_KEY)
  const onCommentCreated = async (comment: CommentEvent) => {
    await postComment(comment, repoClass.relays || repoRelays).result
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

          <Profile pubkey={patch.author.pubkey} hideDetails={true}></Profile>
        </div>

        <div class="git-separator"></div>

        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-medium">{patch?.commitCount} Commits</h2>

          <div class="flex items-center gap-2">
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

          <IssueThread
            issueId = {patch?.id}
            issueKind={GIT_PATCH.toString() as '1617'}
            comments = {$threadComments}
            currentCommenter = {$pubkey!}
            onCommentCreated={onCommentCreated}
          />
        </div>
      </div>
    </div>
  </div>
{/if}
