<script lang="ts">
  import {debounce} from "throttle-debounce"
  import {onMount} from "svelte"
  import {GIT_REPO_BOOKMARK_DTAG} from "@src/lib/util"
  import {page} from "$app/stores"
  import {writable} from "svelte/store"
  import {
    Address,
    createEvent,
    getTagValue,
    NAMED_BOOKMARKS,
    type Filter,
    type TrustedEvent,
  } from "@welshman/util"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import FieldInline from "@src/lib/components/FieldInline.svelte"
  import {makeFeedController, createSearch, publishThunk, repository, tracker} from "@welshman/app"
  import {feedFromFilter, makeIntersectionFeed, makeWOTFeed} from "@welshman/feeds"
  import {sleep} from "@welshman/lib"
  import {createScroller, isMobile, type Scroller} from "@src/lib/html"
  import {deriveEvents} from "@welshman/store"
  import {GIT_REPO} from "@src/lib/util"
  import {preventDefault} from "svelte/legacy"
  import {decodeRelay, shouldReloadRepos} from "../state"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {fly} from "svelte/transition"
  import GitItem from "./GitItem.svelte"
  import Divider from "@src/lib/components/Divider.svelte"
  import {makeGitPath} from "../routes"
  import {goto} from "$app/navigation"
  import {Router} from "@welshman/router"
  import {load} from "@welshman/net"

  const url = decodeRelay($page.params.relay)
  let {
    selectedRepos,
  }: {
    selectedRepos: Array<{address: string; event: TrustedEvent; relayHint: string}>
  } = $props()

  let localSelectedReposState = $state([...selectedRepos])

  let unmounted = false
  let element: HTMLElement
  let scroller: Scroller
  let limit = 30
  let loading = $state(true)

  const filters: Filter[] = [{kinds: [GIT_REPO]}]
  const repoEvents = deriveEvents(repository, {filters})

  const repos = $derived.by(() => {
    const elements = []

    for (const {address, event, relayHint} of localSelectedReposState) {
      elements.push({
        repo: event,
        relay: relayHint,
        address: address,
        selected: true,
      })
    }

    for (const event of $repoEvents.toReversed()) {
      const address = Address.fromEvent(event)
      const addressStr = address.toString()
      // Need to keep selected and unselected repos as distinct sets
      if (!localSelectedReposState.find(r => r.address === addressStr)) {
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
    }

    return elements
  })

  let searchTerm = $state("")
  let debouncedTerm = $state("")

  // Set up the debounced update
  const updateDebouncedTerm = debounce(500, term => {
    debouncedTerm = term
  })

  // Watch searchTerm changes
  $effect(() => {
    updateDebouncedTerm(searchTerm)
  })

  const searchedRepos = $derived.by(() => {
    const reposToSearch = repos.map(r => {
      return {
        id: r.repo.id,
        name: getTagValue("name", r.repo.tags) ?? "",
        desc: getTagValue("description", r.repo.tags) ?? "",
      }
    })
    if (debouncedTerm.length > 2) {
      const repoSearch = createSearch(reposToSearch, {
        getValue: (repo: {id: string; name: string; desc: string}) => repo.id,
        fuseOptions: {
          keys: [
            {name: "name", weight: 0.8},
            {name: "desc", weight: 0.2},
          ],
          includeScore: true,
          threshold: 0.3,
          isCaseSensitive: false,
          ignoreLocation: true,
        },
        sortFn: ({score, item}) => {
          if (score && score > 0.3) return -score!
          return item.name
        },
      })
      const searchResults = repoSearch.searchOptions(searchTerm)
      const result = repos.filter(r => searchResults.find(res => res.id === r.repo.id))
      return result
    } else {
      return repos
    }
  })

  const ctrl = makeFeedController({
    useWindowing: true,
    feed: makeIntersectionFeed(makeWOTFeed({min: 0.1}), feedFromFilter({kinds: [GIT_REPO]})),
    onExhausted: () => {
      loading = false
    },
  })

  const uploading = writable(false)

  const back = () => history.back()

  const submit = () => {
    if ($uploading) return
    const atagList: string[][] = []

    for (const {address, relayHint} of localSelectedReposState) {
      atagList.push(["a", address, relayHint])
    }

    const eventToPublish = createEvent(NAMED_BOOKMARKS, {
      tags: [["d", GIT_REPO_BOOKMARK_DTAG], ...atagList],
    })
    console.log("eventToPublish", eventToPublish)

    publishThunk({
      event: eventToPublish,
      relays: [url, ...Router.get().FromUser().getUrls()],
    })

    $shouldReloadRepos = true

    goto(makeGitPath(url))
  }

  onMount(() => {
    const relays = [url, ...Router.get().FromUser().getUrls()]
    load({
      relays,
      filters,
    })
    // Element is frequently not defined. I don't know why
    sleep(1000).then(() => {
      if (!unmounted) {
        scroller = createScroller({
          element,
          delay: 300,
          threshold: 10_000,
          onScroll: () => {
            limit += 10

            if ($repoEvents.length - limit < 20) {
              ctrl.load(20)
            }
          },
        })
      }
    })

    return () => {
      unmounted = true
      scroller?.stop()
    }
  })

  const onRepoChecked = (relay: string, address: string, event: TrustedEvent, checked: boolean) => {
    if (checked) {
      localSelectedReposState.push({address, event, relayHint: relay})
    } else {
      localSelectedReposState = localSelectedReposState.filter(r => r.address !== address)
    }
    console.log("localSelectedReposState", localSelectedReposState)
    selectedRepos.push(...localSelectedReposState)
  }
</script>

{#snippet repoSelectCheckBox(relay: string, address: string, repo: TrustedEvent, selected: boolean)}
  <input
    slot="input"
    type="checkbox"
    class="toggle toggle-primary"
    checked={selected}
    onchange={event =>
      onRepoChecked(relay, address, repo, (event.target as HTMLInputElement).checked)} />
{/snippet}

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      <div>Follow Git Repos</div>
    {/snippet}
    {#snippet info()}
      <div>Select repositories to track</div>
    {/snippet}
  </ModalHeader>
  <label class="row-2 input input-bordered">
    <Icon icon="magnifer" />
    <!-- svelte-ignore a11y_autofocus -->
    <input
      autofocus={!isMobile}
      bind:value={searchTerm}
      class="grow"
      type="text"
      placeholder="Search repos..." />
  </label>
  <div
    class="scroll-container -mt-2 flex h-96 flex-grow flex-col overflow-auto py-2"
    bind:this={element}>
    <Divider>
      <p>Selected</p>
    </Divider>
    {#each searchedRepos.filter(r => r.selected) as { repo, relay, address } (repo.id)}
      <div out:fly={{duration: 200}}>
        <GitItem {url} event={repo} showActivity={false} showActions={false} />
        <div class="flex w-full justify-end">
          <FieldInline>
            {#snippet input()}
              {@render repoSelectCheckBox(relay, address, repo, true)}
            {/snippet}
          </FieldInline>
        </div>
      </div>
    {/each}
    <Divider>
      <p>Other</p>
    </Divider>
    {#each searchedRepos.filter(r => !r.selected) as { repo, relay, address } (repo.id)}
      <div out:fly={{duration: 200}}>
        <GitItem {url} event={repo} showActivity={false} showActions={false} />
        <div class="flex w-full justify-end">
          <FieldInline>
            {#snippet input()}
              {@render repoSelectCheckBox(relay, address, repo, false)}
            {/snippet}
          </FieldInline>
        </div>
      </div>
    {/each}
    {#if loading || searchedRepos.length === 0}
      <p class="flex h-10 items-center justify-center py-20" out:fly>
        <Spinner {loading}>
          {#if loading}
            Looking for repos...
          {:else if searchedRepos.length === 0}
            No Repos found.
          {/if}
        </Spinner>
      </p>
    {/if}
  </div>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon="alt-arrow-left" />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary">Finish</Button>
  </ModalFooter>
</form>
