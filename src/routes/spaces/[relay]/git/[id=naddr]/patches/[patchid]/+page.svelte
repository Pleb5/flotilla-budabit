<script lang="ts">
  import {page} from "$app/stores"
  import {getContext} from "svelte"
  import {getTags, parsePullRequestEvent} from "@nostr-git/core/events"
  import type {PatchEvent, PullRequestEvent} from "@nostr-git/core/events"
  import {parseGitPatchFromEvent} from "@nostr-git/core/git"
  import type {Repo} from "@nostr-git/ui"
  import type {Readable} from "svelte/store"
  import {REPO_KEY, REPO_RELAYS_KEY, PULL_REQUESTS_KEY} from "@lib/budabit/state"
  import PRView from "@src/lib/budabit/components/PRView.svelte"
  import PatchView from "@src/lib/budabit/components/PatchView.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const pullRequestsStore = getContext<Readable<PullRequestEvent[]>>(PULL_REQUESTS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const repoRelays = $derived.by(() => (repoRelaysStore ? $repoRelaysStore : []) as string[])
  const pullRequests = $derived.by(() => (pullRequestsStore ? $pullRequestsStore : []) as PullRequestEvent[])

  const patchId = $page.params.patchid

  const patchEvent = $derived.by(() =>
    repoClass.patches.find((p: {id: string}) => p.id === patchId) as PatchEvent | undefined,
  )
  const patch = $derived.by(() => (patchEvent ? parseGitPatchFromEvent(patchEvent) : undefined))

  const prEvent = $derived.by(() =>
    (pullRequests || []).find((pr: PullRequestEvent) => pr.id === patchId) as PullRequestEvent | undefined,
  )
  const pr = $derived.by(() => (prEvent ? parsePullRequestEvent(prEvent) : undefined))

  const rootPatchId = $derived.by(() => {
    let rootId = patchId
    let currentPatch = patchEvent as PatchEvent | null | undefined
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

  const patchSet = $derived.by(() =>
    repoClass.patches
      .filter((p: PatchEvent & {id: string}): p is PatchEvent => {
        if (p.id === patchId) return true
        const directReplyToThis = getTags(p, "e").some((tag) => tag[1] === patchId)
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
      .map((p: PatchEvent) => parseGitPatchFromEvent(p)),
  )
</script>

<svelte:head>
  <title>{repoClass.name} - {patch?.title || pr?.subject || "Patch"}</title>
</svelte:head>

{#if !patch && pr && prEvent}
  <PRView {pr} prEvent={prEvent} repo={repoClass} repoRelays={repoRelays} />
{:else if patch && patchSet}
  <PatchView {patch} {patchSet} repo={repoClass} repoRelays={repoRelays} />
{/if}
