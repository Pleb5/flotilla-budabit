<script lang="ts">
  import {page} from "$app/stores"
  import {Address, NAMED_BOOKMARKS, type TrustedEvent} from "@welshman/util"
  import {GIT_REPO, GIT_REPO_BOOKMARK_DTAG} from "@src/lib/util"
  import {publishThunk, repository, userMutes} from "@welshman/app"
  import {fly} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import GitItem from "@app/components/GitItem.svelte"
  import RepoPicker from "@app/components/RepoPicker.svelte"
  import {decodeRelay, shouldReloadRepos} from "@app/state"
  import {pushModal} from "@app/modal"
  import {load} from "@welshman/net"
  import {pubkey} from "@welshman/app"
  import {getAddressTags} from "@welshman/util"
  import {Router} from "@welshman/router"
  import { normalizeRelayUrl } from "@welshman/util"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {deriveEvents} from "@welshman/store"
  import {derived as _derived} from "svelte/store"
  import {NewRepoWizard} from "@nostr-git/ui"
  import type {RepoAnnouncementEvent} from "@nostr-git/shared-types"
  import { GRASP_SET_KIND, DEFAULT_GRASP_SET_ID, parseGraspServersEvent } from "@nostr-git/core";
  import { onMount } from "svelte"
    import { pushToast } from "@src/app/toast"

  const url = decodeRelay($page.params.relay)

  let loading = $state(true)

  // Normalize all relay URLs to avoid whitespace/trailing-slash/socket issues
  const bookmarkRelays = Array.from(
    new Set(
      [url, ...Router.get().FromUser().getUrls()].map(u => normalizeRelayUrl(u)).filter(Boolean)
    )
  ) as string[]

  const bookmarkFilter = {
    kinds: [NAMED_BOOKMARKS],
    "#d": [GIT_REPO_BOOKMARK_DTAG],
    authors: [$pubkey!],
  }

  const bookmarks = _derived(
    deriveEvents(repository, {filters: [bookmarkFilter]}),
    (events: TrustedEvent[]) => {
      if (events.length === 0) {
        load({relays: bookmarkRelays, filters: [bookmarkFilter]})
      }
      return events[0]
    },
  )

  const relaysOfAddresses = $state(new Map<string, string>())

  const repos = $derived.by(() => {
    if ($bookmarks) {
      const aTagList = getAddressTags($bookmarks.tags)
      const dTagValues: string[] = []
      const authors: string[] = []
      const relayHints: string[] = []
      aTagList.forEach(([_, value, relayHint]) => {
        dTagValues.push(value.split(":")[2])
        authors.push(value.split(":")[1])
        const normalizedHint = relayHint ? normalizeRelayUrl(relayHint) : ""
        relaysOfAddresses.set(value, normalizedHint)
        if (normalizedHint && !relayHints.includes(normalizedHint)) relayHints.push(normalizedHint)
      })
      const repoFilter = {kinds: [GIT_REPO], authors, "#d": dTagValues}
      return _derived(deriveEvents(repository, {filters: [repoFilter]}), events => {
        if (events.length !== dTagValues.length) {
          load({relays: relayHints, filters: [repoFilter]})
        }
        return events
      })
    }
  })

  // Load user's saved GRASP servers (profile settings) and expose as list of URLs
  const graspServersFilter = {
    kinds: [GRASP_SET_KIND],
    authors: [$pubkey!],
    "#d": [DEFAULT_GRASP_SET_ID],
  };

  const graspServersEvent = _derived(
    deriveEvents(repository, { filters: [graspServersFilter] }),
    (events: TrustedEvent[]) => {
      if (events.length === 0) {
        load({ relays: Router.get().FromUser().getUrls(), filters: [graspServersFilter] });
      }
      return events[0];
    }
  );

  // Keep a reactive list of saved GRASP servers
  let graspServerUrls = $state<string[]>([])
  graspServersEvent.subscribe((ev) => {
    try {
      graspServerUrls = ev ? (parseGraspServersEvent(ev as any) as string[]) : []
    } catch {
      graspServerUrls = []
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
    } else {
      return []
    }
  })

  onMount(() => {
    load({relays: bookmarkRelays, filters: [bookmarkFilter]})
  })

  $effect(() => {
    if (loadedBookmarkedRepos.length > 0) {
      loading = false
    }
  })

  $effect(() => {
    if ($shouldReloadRepos){
      $shouldReloadRepos = false
      load({relays: bookmarkRelays, filters: [bookmarkFilter]})
    }
  })

  const back = () => history.back()

  const onAddRepo = () => {
    pushModal(RepoPicker, {
      selectedRepos: loadedBookmarkedRepos,
      onClose: () => {
        back()
      },
    })
  }

  const onNewRepo = () => {
    pushModal(
      NewRepoWizard,
      {
        onCancel: () => {
          back()
        },
        onRepoCreated: () => {
          pushToast({
            message: "Repository created successfully",
          })
          //back()
        },
        onPublishEvent: async (event: RepoAnnouncementEvent) => {
          publishThunk({
            relays: bookmarkRelays,
            event,
          })
        },
        graspServerUrls: graspServerUrls,
        defaultRelays: bookmarkRelays,
      },
      {
        fullscreen: true,
      },
    )
  }
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon="git" />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Repos</strong>
  {/snippet}
  {#snippet action()}
    <div class="row-2">
      <Button class="btn btn-secondary btn-sm" onclick={onNewRepo}>
        <Icon icon="add-circle" />
        New Repo
      </Button>
      <Button class="btn btn-primary btn-sm" onclick={onAddRepo}>
        <Icon icon="git" />
        Edit Repos
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
