<script lang="ts">
  import {RepoHeader, RepoTab} from "@nostr-git/ui"
  import {page} from "$app/stores"
  import {deriveNaddrEvent} from "@app/state"
  import PageContent from "@src/lib/components/PageContent.svelte"
  import {FileCode, GitBranch, CircleAlert, GitPullRequest, Book} from "@lucide/svelte"
  import {parseRepoAnnouncementEvent, type RepoAnnouncementEvent} from "@nostr-git/shared-types"
  import {setContext} from "svelte"
  import {deriveEvents} from "@welshman/store"
  import {relays, repository} from "@welshman/app"
  import {GIT_REPO_STATE} from "@src/lib/util"
  import {derived as _derived} from "svelte/store"
  import {Address, GIT_ISSUE, GIT_PATCH, type Filter} from "@welshman/util"
  import {load} from "@welshman/net"
  import {nthEq} from "@welshman/lib"
  import PageBar from "@src/lib/components/PageBar.svelte"
  import {Buffer} from "buffer"

  const {id, relay} = $page.params

  let {children} = $props()

  if (typeof window !== "undefined" && !window.Buffer) {
    (window as any).Buffer = Buffer;
  }

  let eventStore = $state(deriveNaddrEvent(id, Array.isArray(relay) ? relay : [relay]))

  const repoState = $derived.by(() => {
    if ($eventStore) {
      const repoEvent = parseRepoAnnouncementEvent($eventStore as RepoAnnouncementEvent)
      const address = repoEvent.repoId
      const repoStateFilter = [{kinds: [GIT_REPO_STATE], "#d": [address]}]
      const repoState = _derived(
        deriveEvents(repository, {filters: repoStateFilter}),
        events => events[0],
      )
      setContext("repo-state", repoState)
      return repoState
    }
  })

  const issues = $derived.by(() => {
    if ($eventStore) {
      const address = Address.fromEvent($eventStore).toString()
      const issueFilter = [{kinds: [GIT_ISSUE], "#a": [address]}]
      return deriveEvents(repository, {filters: issueFilter})
    }
  })

  const patches = $derived.by(() => {
    if ($eventStore) {
      const address = Address.fromEvent($eventStore).toString()
      const patchFilter = [{kinds: [GIT_PATCH], "#a": [address]}]
      return deriveEvents(repository, {filters: patchFilter})
    }
  })

  setContext("repo-event", eventStore)

  const repo = $state({
    repo: eventStore,
    state: () => repoState,
    issues: () => issues,
    patches: () => patches,
  })

  setContext("repo", repo)

  let activeTab: string | undefined = $page.url.pathname.split("/").pop()
  const encodeddRelay = encodeURIComponent(relay)

  $effect(() => {
    if ($eventStore) {
      const repoEvent = parseRepoAnnouncementEvent($eventStore as RepoAnnouncementEvent)
      const address = repoEvent.repoId
      const repoStateFilter: Filter = {kinds: [GIT_REPO_STATE], "#d": [address]}
      const issuesFilter: Filter = {kinds: [GIT_ISSUE], "#a": [address]}
      const patchesFilter: Filter = {kinds: [GIT_PATCH], "#a": [address]}
      const [tagId, ...relays] = $eventStore.tags.find(nthEq(0, "relays")) ?? []

      load({
        relays: relays,
        filters: [issuesFilter, patchesFilter, repoStateFilter],
      })
    }
  })
</script>

<PageBar>
  <RepoHeader event={$eventStore as RepoAnnouncementEvent} {activeTab}>
    {#snippet children(activeTab: string)}
      <RepoTab
        tabValue={id}
        label="Overview"
        href={`/spaces/${encodeddRelay}/git/${id}`}
        {activeTab}>
        {#snippet icon()}
          <FileCode class="h-4 w-4" />
        {/snippet}
      </RepoTab>
      <RepoTab
        tabValue="code"
        label="Code"
        href={`/spaces/${encodeddRelay}/git/${id}/code`}
        {activeTab}>
        {#snippet icon()}
          <GitBranch class="h-4 w-4" />
        {/snippet}
      </RepoTab>
      <RepoTab
        tabValue="issues"
        label="Issues"
        href={`/spaces/${encodeddRelay}/git/${id}/issues`}
        {activeTab}>
        {#snippet icon()}
          <CircleAlert class="h-4 w-4" />
        {/snippet}
      </RepoTab>
      <RepoTab
        tabValue="patches"
        label="Patches"
        href={`/spaces/${encodeddRelay}/git/${id}/patches`}
        {activeTab}>
        {#snippet icon()}
          <GitPullRequest class="h-4 w-4" />
        {/snippet}
      </RepoTab>
      <RepoTab
        tabValue="wiki"
        label="Wiki"
        href={`/spaces/${encodeddRelay}/git/${id}/wiki`}
        {activeTab}>
        {#snippet icon()}
          <Book class="h-4 w-4" />
        {/snippet}
      </RepoTab>
    {/snippet}
  </RepoHeader>
</PageBar>
<PageContent class="flex flex-grow flex-col gap-2 overflow-auto p-8">
  {#if $eventStore === undefined}
    <div class="p-4 text-center">Loading repository...</div>
  {:else if !$eventStore}
    <div class="p-4 text-center text-red-500">Repository not found.</div>
  {:else}
    <RepoHeader event={$eventStore as RepoAnnouncementEvent} {activeTab}>
      {#snippet children(activeTab: string)}
        <RepoTab
          tabValue={id}
          label="Overview"
          href={`/spaces/${encodeddRelay}/git/${id}`}
          {activeTab}>
          {#snippet icon()}
            <FileCode class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="code"
          label="Code"
          href={`/spaces/${encodeddRelay}/git/${id}/code`}
          {activeTab}>
          {#snippet icon()}
            <GitBranch class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="issues"
          label="Issues"
          href={`/spaces/${encodeddRelay}/git/${id}/issues`}
          {activeTab}>
          {#snippet icon()}
            <CircleAlert class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="patches"
          label="Patches"
          href={`/spaces/${encodeddRelay}/git/${id}/patches`}
          {activeTab}>
          {#snippet icon()}
            <GitPullRequest class="h-4 w-4" />
          {/snippet}
        </RepoTab>
        <RepoTab
          tabValue="wiki"
          label="Wiki"
          href={`/spaces/${encodeddRelay}/git/${id}/wiki`}
          {activeTab}>
          {#snippet icon()}
            <Book class="h-4 w-4" />
          {/snippet}
        </RepoTab>
      {/snippet}
    </RepoHeader>
    {@render children()}
  {/if}
</PageContent>
