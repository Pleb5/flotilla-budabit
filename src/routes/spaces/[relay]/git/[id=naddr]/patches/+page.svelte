<script lang="ts">
  import {Button, PatchCard} from "@nostr-git/ui"
  import {Funnel, Plus, SearchX} from "@lucide/svelte"
  import {Address, COMMENT, getTagValue, type TrustedEvent} from "@welshman/util"
  import {nthEq, sortBy} from "@welshman/lib"
  import {repository} from "@welshman/app"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {makeFeed} from "@src/app/requests"
  import {deriveEvents} from "@welshman/store"
  import {
    GIT_PATCH,
    GIT_STATUS_OPEN,
    GIT_STATUS_COMPLETE,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
  } from "@welshman/util"
  import {fly} from "@lib/transition"
  import {load} from "@welshman/net"

  const {data} = $props()
  const {repoClass} = data

  const statusFilter = {
    kinds: [GIT_STATUS_OPEN, GIT_STATUS_COMPLETE, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT],
    "#e": [...repoClass.patches.map((patch: TrustedEvent) => patch.id)],
  }

  const statuses = deriveEvents(repository, {filters: [statusFilter]})

  $inspect(repoClass.patches).with((type, patches) => {
    console.log('patches in budabit', patches)
  })

  const patchList = $derived.by(() => {
    if (repoClass.patches) {
      sortBy(e => -e.created_at, repoClass.patches)
      return repoClass.patches.map((patch: TrustedEvent) => {
        let status = $statuses
          ?.filter(s => {
            let [_, eventId] = s.tags.find(nthEq(0, "e")) || []
            return eventId === patch.id
          })
          .sort((a: TrustedEvent, b: TrustedEvent) => b.created_at - a.created_at)[0]
        return {
          ...patch,
          patches: repoClass.patches.filter(
            issue => issue.tags.find(nthEq(0, "e"))?.[1] === patch.id,
          ),
          status,
        }
      })
    }
  })

  let loading = $state(true)
  let element: HTMLElement | undefined = $state()

  const patchFilter = {
    kinds: [GIT_PATCH],
    "#a": [Address.fromEvent(repoClass.repoEvent).toString()],
    "#t": ["root"],
  }

  const commentFilter = {
    kinds: [COMMENT],
    "#E": [...repoClass.patches.map(i => i.id)],
  }

  const allComments = $derived.by(() => {
    if(repoClass.patches) {
      return deriveEvents(repository, {filters:[commentFilter]})
    }
  })

  $effect(() => {
    if (repoClass.patches) {
      load({relays: repoClass.relays, filters: [patchFilter, statusFilter, commentFilter]})
 
      makeFeed({
        element: element!,
        relays: repoClass.relays,
        feedFilters: [patchFilter],
        subscriptionFilters: [patchFilter],
        initialEvents: patchList,
        onExhausted: () => {
          loading = false
        },
      })
      loading = false
    }
  })
</script>

<div bind:this={element}>
  <div class="z-10 sticky z-nav -top-8 mb-4 flex items-center justify-between py-4 backdrop-blur">
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
  {:else if repoClass.patches.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-gray-500">
      <SearchX class="mb-2 h-8 w-8" />
      No patches found.
    </div>
  {:else}
    <div class="flex flex-col gap-y-4 overflow-y-auto">
      {#each patchList! as patch}
        {@const count = $allComments
          ?.filter((c)=>getTagValue("E", c.tags) === patch.id).length ?? 0
        }
        <div in:fly>
          <PatchCard event={patch} status={patch.status} commentCount={count} />
        </div>
      {/each}
    </div>
  {/if}
</div>
