<script lang="ts">
  import {Button, IssueCard, PatchCard} from "@nostr-git/ui"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {Address, GIT_PATCH, type TrustedEvent} from "@welshman/util"
  import {getContext} from "svelte"
  import {nthEq} from "@welshman/lib"
  import {deriveProfile, repository} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import type {Readable} from "svelte/store"
  import {type RepoStateEvent} from "@nostr-git/shared-types"

  const repoEvent = getContext<Readable<TrustedEvent>>("repo-event")

  const repo = getContext<{
    repo: Readable<TrustedEvent>
    state: () => Readable<RepoStateEvent>
    issues: () => Readable<TrustedEvent[]>
    patches: () => Readable<TrustedEvent[]>
  }>("repo")

  let patches = $derived(repo.patches())

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  $effect(() => {
    if (!patches) {
      return
    }

    const [_, ...relays] = $repoEvent.tags.find(nthEq(0, "relays")) || []

    const patchFilter = {
      kinds: [GIT_PATCH],
      "#a": [Address.fromEvent($repoEvent).toString()],
    }

    const {cleanup} = makeFeed({
      element: element!,
      relays: relays,
      feedFilters: [patchFilter],
      subscriptionFilters: [patchFilter],
      initialEvents: $patches,
      onExhausted: () => {
        loading = false
      },
    })
  })
</script>

<div bind:this={element}>
  <div
    class="z-10 sticky top-0 mb-4 flex items-center justify-between bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div>
      <h2 class="text-xl font-semibold">Patches</h2>
      <p class="text-sm text-muted-foreground">Review and merge code changes</p>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" class="gap-2">
        <Funnel class="h-4 w-4" />
        Filter
      </Button>

      <Button size="sm" class="gap-2 bg-git hover:bg-git-hover">
        <Plus class="h-4 w-4" />
        New Patch
      </Button>
    </div>
  </div>

  {#if loading}
    <div class="flex flex-col items-center justify-center py-12">
      <Spinner {loading}>
        {#if loading}
          Loading patches….
        {:else}
          End of patches history
        {/if}
      </Spinner>
    </div>
  {:else if $patches.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No patches found.
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#each $patches as patch}
        <PatchCard event={patch} owner={deriveProfile(patch.pubkey)} />
      {/each}
    </div>
  {/if}
</div>
