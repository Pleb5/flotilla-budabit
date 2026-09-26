<script lang="ts">
  import {untrack} from 'svelte'
  import {ChevronDown, Eye, EyeOff, RotateCw} from '@lucide/svelte'
  import type {WidgetBridge, RepoCiWatcher} from 'budabit-sdk'
  import {BudabitHiveCIClient} from '../BudabitHiveCIClient'
  import {bridgeNostrSigner} from '../ci-watch'
  import {ciWatcherChoices, selectCiWatcher} from '../ci-watchers'
  import {createCiWatchSession, type CiWatchState} from '../ci-watch-session'

  let {bridge, userPubkey, repoAddress, repoRelays, watchers}: {
    bridge: WidgetBridge
    userPubkey: string
    repoAddress: string
    repoRelays: string[]
    watchers?: RepoCiWatcher[]
  } = $props()

  // Parent keys this component by account + repo. Never carry a manual choice
  // or an in-flight request across either boundary.
  let manualPubkey = $state<string | null>(null)
  const choices = $derived(ciWatcherChoices(watchers))
  const selected = $derived(selectCiWatcher(choices, manualPubkey))
  let watchState = $state<CiWatchState>({status: 'loading', busy: false})
  let retry = $state(0)
  let session: ReturnType<typeof createCiWatchSession> | undefined
  // Stable primitive key avoids reconnecting on duplicate host context events
  // or changes to unrelated community labels/rankings.
  const connectionKey = $derived(JSON.stringify([selected.pubkey, selected.relays, repoRelays]))

  $effect(() => {
    if (manualPubkey && !choices.some(choice => choice.pubkey === manualPubkey)) manualPubkey = null
  })

  $effect(() => {
    connectionKey; retry
    const currentBridge = bridge
    const account = userPubkey
    const address = repoAddress
    return untrack(() => {
      let active = true
      const signer = bridgeNostrSigner(currentBridge, account, () => active)
      const client = new BudabitHiveCIClient({serverPubkey: selected.pubkey, relays: selected.relays, signer})
      const current = createCiWatchSession(client, address, [...repoRelays], next => {watchState = next})
      session = current
      return () => {active = false; current.dispose(); if (session === current) session = undefined}
    })
  })
</script>

<section class="min-w-0 rounded-lg border border-border bg-card p-3" aria-label="Repository watcher">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
    <div class="min-w-0 flex-1">
      <label for="ci-watcher" class="mb-1 block text-xs font-medium text-muted-foreground">CI watcher</label>
      <div class="relative sm:max-w-lg">
        <select id="ci-watcher" class="min-h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-background py-2 pl-3 pr-10 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={selected.pubkey} disabled={watchState.busy}
          onchange={event => {manualPubkey = event.currentTarget.value}}>
          {#each choices as choice (choice.pubkey)}
            <option value={choice.pubkey}>{choice.label}</option>
          {/each}
        </select>
        <ChevronDown class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button class="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
        disabled={watchState.busy || !['followed', 'unfollowed'].includes(watchState.status)}
        onclick={() => void session?.toggle()}>
        {#if watchState.busy || watchState.status === 'loading'}<RotateCw class="h-4 w-4 animate-spin" />
        {:else if watchState.status === 'followed'}<EyeOff class="h-4 w-4" />
        {:else}<Eye class="h-4 w-4" />{/if}
        {watchState.busy ? 'Saving…' : watchState.status === 'followed' ? 'Unwatch' : 'Watch'}
      </button>
      {#if watchState.status === 'error' || watchState.status === 'unauthorized'}
        <button class="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-accent" onclick={() => {retry += 1}}>Retry</button>
      {/if}
    </div>
  </div>
  <div class="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Watcher affiliation">
    <span class="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
      {selected.community ? 'Community' : 'Fallback'}
    </span>
    {#if selected.community}
      <span class="max-w-full break-words rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary">
        {selected.community.communityName}
      </span>
    {/if}
  </div>
  <p class="mt-2 break-words text-xs text-muted-foreground" role="status" aria-live="polite">
    {#if watchState.status === 'loading'}Checking selected watcher…
    {:else if watchState.status === 'followed'}Watching this repository with {selected.community?.communityName || 'Arjen’s watcher'}.
    {:else if watchState.status === 'unfollowed'}This watcher is not watching the repository. Watch to run workflows on new commits.
    {:else if watchState.status === 'unauthorized'}Access denied by this watcher. Choose another or ask its operator for access.
    {:else}Could not reach this watcher. Retry or choose another.{/if}
    {#if watchState.error}<span class="mt-1 block">{watchState.error}</span>{/if}
  </p>
  <details class="mt-2 text-xs text-muted-foreground">
    <summary class="cursor-pointer py-1">Watcher details</summary>
    <div class="mt-1 space-y-1 break-all">
      {#if selected.community}<p class="break-words font-medium">{selected.community.communityName}</p>{/if}
      <p>{selected.pubkey}</p>
      <p>{selected.relays.join(', ')}</p>
      <p class="break-normal">{selected.community?.repoMatch ? 'Recommended for this repository’s community.' : selected.community ? `Your role: ${selected.community.role}.` : 'Fallback watcher.'} Switching watchers does not remove watches from other services.</p>
    </div>
  </details>
  {#if watchers === undefined}
    <p class="mt-2 text-xs text-muted-foreground">Update the BudaBit host to discover your community watchers.</p>
  {/if}
</section>
