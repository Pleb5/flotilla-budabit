<script lang="ts">
  import {page} from "$app/stores"
  import {Address, getTagValue, type Filter} from "@welshman/util"
  import {repository, tracker} from "@welshman/app"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import SpaceMenuButton from "@lib/budabit/components/SpaceMenuButton.svelte"
  import GitItem from "@app/components/GitItem.svelte"
  import {decodeRelay} from "@app/core/state"
  import {load} from "@welshman/net"
  import {Router} from "@welshman/router"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {derived as _derived} from "svelte/store"
  import {onMount} from "svelte"
  import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
  import Git from "@assets/icons/git.svg?dataurl"
  
  const url = decodeRelay($page.params.relay)

  let loading = $state(true)

  const filters: Filter[] = [{kinds: [GIT_REPO_ANNOUNCEMENT]}]
  const repoEvents = deriveEventsAsc(deriveEventsById({repository, filters}))

  const repos = $derived.by(() => {
    const elements = []

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
    if (repos.length > 0) {
      loading = false
    }
  })

  onMount(() => {
    const relays = [url, ...Router.get().FromUser().getUrls()]
    load({
      relays,
      filters,
    })
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={Git} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Git Repos</strong>
  {/snippet}
  {#snippet action()}
    <SpaceMenuButton {url} />
  {/snippet}
</PageBar>

<PageContent>
  <div class="flex flex-grow flex-col gap-2 overflow-auto p-2">
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
            {url}
            event={repo.repo}
            showActivity={false}
            showIssues={false}
            showActions={true} />
        </div>
      {/each}
    {/if}
  </div>
</PageContent>
