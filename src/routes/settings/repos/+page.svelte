<script lang="ts">
  import {Address, getTagValue, type Filter} from "@welshman/util"
  import {GIT_REPO} from "@src/lib/util"
  import {pubkey, repository, tracker} from "@welshman/app"
  import {fly} from "@lib/transition"
  import Spinner from "@lib/components/Spinner.svelte"
  import GitItem from "@app/components/GitItem.svelte"
  import {load} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {deriveEvents} from "@welshman/store"
  import {derived as _derived} from "svelte/store"
  import {onMount} from "svelte"
  import {repoGroups, loadRepoAnnouncements} from "@src/app/core/state"

  const id = $pubkey!
  let loading = $state(true)
  let loadingAnnouncements = $state(true)

  const filters: Filter[] = [
    {
      kinds: [GIT_REPO],
      authors: [id],
    },
  ]
  const repoEvents = deriveEvents(repository, {filters})

  // Announced repositories (NIP-34 30617) grouped by r:euc
  const myGroups = $derived.by(() => {
    const groups = $repoGroups || []
    // Only groups where at least one announcement is authored by current user
    return groups.filter(g => g.repos?.some?.(evt => evt.pubkey === id))
  })

  const repos = $derived.by(() => {
    const elements: any[] = []

    for (const event of $repoEvents.toReversed()) {
      const address = Address.fromEvent(event)
      const addressStr = address.toString()
      // Need to keep selected and unselected repos as distinct sets
      const relayHints = tracker.getRelays(event.id)
      const repoEventRelayHint = getTagValue("relays", event.tags)

      const relaysFromRepoPubkey = Router.get().getRelaysForPubkey(event.pubkey)?.[0] ?? ""

      const firstHint =
        relayHints.values().next().value ?? repoEventRelayHint ?? relaysFromRepoPubkey

      elements.push({
        repo: event,
        relay: firstHint,
        address: addressStr,
        selected: false,
      })
    }

    return elements
  })

  $effect(() => {
    if (repos.length > 0) loading = false
    if (myGroups.length >= 0) loadingAnnouncements = false
  })

  onMount(async () => {
    const relays = Router.get().FromUser().getUrls()
    // Load announcements + legacy repo events
    loadRepoAnnouncements(relays)
    await load({
      relays,
      filters,
    })
  })

  const refreshAnnouncements = () => {
    const relays = Router.get().FromUser().getUrls()
    loadRepoAnnouncements(relays)
    loadingAnnouncements = true
  }
</script>

<div class="content column gap-4">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold">Announced Repositories</h2>
    <button class="btn btn-outline btn-sm" onclick={refreshAnnouncements}>Refresh</button>
  </div>
  {#if loadingAnnouncements}
    <p class="flex h-10 items-center justify-center py-10" out:fly>
      <Spinner loading={loadingAnnouncements}>
        {#if loadingAnnouncements}
          Loading announcements...
        {/if}
      </Spinner>
    </p>
  {:else if myGroups.length === 0}
    <div class="text-sm text-muted-foreground">No announcements found for your account.</div>
  {:else}
    {#each myGroups as g (g.euc)}
      <div class="space-y-3 rounded-lg border p-4" in:fly>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-mono text-sm">euc: <span class="font-semibold">{g.euc}</span></div>
          <div class="flex items-center gap-2">
            <div class="text-xs text-muted-foreground">{g.relays?.length || 0} relays</div>
            {#if g.web?.length}
              <button class="btn btn-outline btn-xs" onclick={() => window.open(g.web[0], "_blank")}
                >Open</button>
            {/if}
          </div>
        </div>
        {#if g.handles?.length}
          <div class="flex flex-wrap gap-1 text-sm">
            {#each g.handles as h (h)}
              <span class="badge badge-ghost badge-sm">{h}</span>
            {/each}
          </div>
        {/if}
        {#if g.web?.length}
          <div class="space-y-1">
            <div class="text-xs font-semibold text-muted-foreground">Web</div>
            <div class="flex flex-col gap-1">
              {#each g.web as w (w)}
                <a
                  class="link link-primary break-all text-sm"
                  href={w}
                  target="_blank"
                  rel="noreferrer">{w}</a>
              {/each}
            </div>
          </div>
        {/if}
        {#if g.clone?.length}
          <div class="space-y-1">
            <div class="text-xs font-semibold text-muted-foreground">Clone URLs</div>
            <div class="flex flex-col gap-1">
              {#each g.clone as c (c)}
                <div class="flex items-center gap-2">
                  <code class="break-all text-xs">{c}</code>
                  <button class="btn btn-xs" onclick={() => navigator.clipboard?.writeText(c)}>
                    Copy
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        {#if g.maintainers?.length}
          <div class="space-y-1">
            <div class="text-xs font-semibold text-muted-foreground">Maintainers</div>
            <div class="flex flex-wrap gap-1 text-xs">
              {#each g.maintainers as m (m)}
                <span class="badge badge-outline badge-sm">{m}</span>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  {/if}

  <div class="git-separator my-2"></div>
  <h2 class="text-xl font-semibold">Legacy Repos</h2>
  {#if loading}
    <p class="flex h-10 items-center justify-center py-20" out:fly>
      <Spinner {loading}>
        {#if loading}
          Looking for Git Repos...
        {:else if !repos || repos.length === 0}
          No Git Repos found.
        {/if}
      </Spinner>
    </p>
  {:else}
    {#each repos! as repo (repo.repo.id)}
      <div in:fly>
        <GitItem
          url={id}
          event={repo.repo}
          showActivity={false}
          showIssues={false}
          showActions={true} />
      </div>
    {/each}
  {/if}
</div>
