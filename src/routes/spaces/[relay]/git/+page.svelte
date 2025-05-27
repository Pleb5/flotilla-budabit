<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {
    getPubkeyTagValues,
    getListTags,
    Address,
    NAMED_BOOKMARKS,
    type TrustedEvent,
  } from "@welshman/util"
  import {GIT_REPO} from "@src/lib/util"
  import {repository, userMutes} from "@welshman/app"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import GitItem from "@app/components/GitItem.svelte"
  import RepoPicker from "@app/components/RepoPicker.svelte"
  import {decodeRelay} from "@app/state"
  import {pushModal} from "@app/modal"
  import {load} from "@welshman/net"
  import {pubkey} from "@welshman/app"
  import {getAddressTags} from "@welshman/util"
  import {Router} from "@welshman/router"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {deriveEvents} from "@welshman/store"
  import {derived as _derived} from "svelte/store"

  const url = decodeRelay($page.params.relay)

  let loading = $state(true)

  const bookmarkRelays = [url, ...Router.get().FromUser().getUrls()]

  const bookmarks = $derived.by(() => {
    const bookmarkFilter = {kinds: [NAMED_BOOKMARKS], authors: [pubkey.get()!]}
    return _derived(
      deriveEvents(repository, {filters: [bookmarkFilter]}),
      (events: TrustedEvent[]) => {
        if (events.length === 0) {
          load({relays: bookmarkRelays, filters: [bookmarkFilter]})
        }
        return events[0]
      },
    )
  })

  const relaysOfAddresses = $state(new Map<string, string>())

  const repos = $derived.by(() => {
    if ($bookmarks) {
      const aTagList = getAddressTags($bookmarks.tags)
      const dTagValues: string[] = []
      const authors: string[] = []
      const relayHints: string[] = []
      aTagList.forEach(([letter, value, relayHint]) => {
        dTagValues.push(value.split(":")[2])
        authors.push(value.split(":")[1])
        relaysOfAddresses.set(value, relayHint || "")
        if (relayHint && !relayHints.includes(relayHint)) relayHints.push(relayHint)
      })
      const repoFilter = {kinds: [GIT_REPO], authors, "#d": dTagValues}
      return _derived(deriveEvents(repository, {filters: [repoFilter]}), events => {
        if (events.length === 0) {
          load({relays: relayHints, filters: [repoFilter]})
        }
        return events
      })
    }
  })

  const loadedBookmarkedRepos = $derived.by(() => {
    if ($repos) {
      return $repos.map(repo => {
        const address = Address.fromEvent(repo)
        const addressString = address.toString()
        const relayHintFromEvent = Router.get().getRelaysForPubkey(repo.pubkey)?.[0]
        const hint = relaysOfAddresses.get(addressString) ?? relayHintFromEvent
        return {address: addressString, event: repo, relayHint: hint}
      })
    }
  })

  onMount(() => {
    loading = false
    console.log("loadedBookmarkedRepos", loadedBookmarkedRepos)
  })

  const onAddRepo = () => {
    pushModal(RepoPicker, {
      selectedRepos: loadedBookmarkedRepos,
      onClose: () => {},
    })
  }
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon="git" />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Followed Repos</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <Button class="btn btn-primary btn-sm" disabled={loading} onclick={onAddRepo}>
        <Icon icon="git" />
        Add Repo
      </Button>
      <MenuSpaceButton {url} />
    </div>
  {/snippet}
</PageBar>

<PageContent>
  <div class="flex flex-grow flex-col gap-2 overflow-auto p-2">
    {#if loading}
      <p class="flex h-10 items-center justify-center py-20" out:fly>
        <Spinner {loading}>
          {#if loading}
            Looking for Your Git Repos...
          {:else if !$repos || $repos.length === 0}
            No Repos found.
          {/if}
        </Spinner>
      </p>
    {:else}
      {#each loadedBookmarkedRepos! as repo (repo.event.id)}
        <div in:fly>
          <GitItem {url} event={repo.event} />
        </div>
      {/each}
    {/if}
  </div>
</PageContent>
