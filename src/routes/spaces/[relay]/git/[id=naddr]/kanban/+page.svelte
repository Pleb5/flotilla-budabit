<script lang="ts">
  import {Card} from "@nostr-git/ui"
  import KanbanPanel from "../KanbanPanel.svelte"
  import {pubkey} from "@welshman/app"
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@lib/budabit/state"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import {page} from "$app/stores"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)

  const naddr = $page.params.id
  const repoRelays = $derived.by(() => repoRelaysStore ? $repoRelaysStore : [])

  if (!repoClass) {
    throw new Error("Repo context not available")
  }
</script>

<div class="flex flex-col gap-4">
  <h1 class="text-2xl font-bold">Kanban Board</h1>
  
  {#if repoClass.repoEvent?.pubkey && repoClass.name}
    <Card class="p-0 overflow-hidden">
      <KanbanPanel
        repoPubkey={repoClass.repoEvent.pubkey}
        repoName={repoClass.name}
        repoNaddr={naddr}
        repoRelays={repoRelays}
        maintainers={repoClass.maintainers ?? []}
        userPubkey={$pubkey}
      />
    </Card>
  {:else}
    <div class="p-4 text-center text-muted-foreground">
      Loading repository context...
    </div>
  {/if}
</div>
