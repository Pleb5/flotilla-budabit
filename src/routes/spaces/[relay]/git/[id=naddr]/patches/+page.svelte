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
  import {deriveEvents} from "@welshman/store"
  import {
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
  } from "@welshman/util"
    import { fly } from "@lib/transition"

  const repoEvent = getContext<Readable<TrustedEvent>>("repo-event")

  const repo = getContext<{
    repo: Readable<TrustedEvent>
    state: () => Readable<RepoStateEvent>
    issues: () => Readable<TrustedEvent[]>
    patches: () => Readable<TrustedEvent[]>
  }>("repo")

  const patches = $derived(repo.patches())

  const patchList = $derived.by(() => {
    if ($patches) {
      return $patches.map(patch => {
        const statuses = deriveEvents(repository, {
          filters: [
            {
              kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
              "#e": [patch.id],
            },
          ],
        })
        const profile = deriveProfile(patch.pubkey)

        return {
          ...patch,
          status,
          profile,
        }
      })
    }
  })

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  $effect(() => {
    if (patches) {
      loading = false
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
    class="z-10 sticky top-0 mb-4 flex items-center justify-between py-4 backdrop-blur">
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
      {#each patchList! as patch}
        <div in:fly>
          <PatchCard event={patch} status={patch.status} owner={patch.profile} />
        </div>
      {/each}
    </div>
  {/if}
</div>
