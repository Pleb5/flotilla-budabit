<script lang="ts">
  import {getContext} from "svelte"
  import {FileView} from "@nostr-git/ui"
  import {GitBranch} from "@lucide/svelte"
  import {listRepoFilesFromEvent, type FileEntry, listBranchesFromEvent, getRepoFileContentFromEvent} from "@nostr-git/core"
  import {
    parseRepoStateEvent,
    type RepoAnnouncementEvent,
    type RepoStateEvent,
    type TrustedEvent,
  } from "@nostr-git/shared-types"
  import {page} from "$app/stores"
  import type {Readable} from "svelte/store"
  import Popover from "@src/lib/components/Popover.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import {fly} from "svelte/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"

  const {id, relay} = $page.params
  const repoEvent = getContext<Readable<TrustedEvent>>("repo-event")
  const repoStateEvent = getContext<Readable<TrustedEvent>>("repo-state-event")
  const repo = getContext<{
    repo: Readable<TrustedEvent>
    state: () => Readable<RepoStateEvent>
    issues: () => Readable<TrustedEvent[]>
    patches: () => Readable<TrustedEvent[]>
  }>("repo")
  
  // UI state
  let loading = $state(true)
  let error: string | null = $state(null)
  let files: Promise<FileEntry[]> = $state(Promise.resolve([]))
  let fallbackToBranches = $state(false)

  const repoState = repo.state()

  let branches = $derived.by(() => {
    if ($repoState) {
      const state = parseRepoStateEvent($repoState as RepoStateEvent)
      return state.refs.map(ref => ({name: ref.ref, commit: ref.commit, lineage: ref.lineage}))
    } else {
      return listBranchesFromEvent({repoEvent: $repoEvent})
    }
  })

  let selectedBranch = $derived.by(async () => {
    if ($repoState) {
      const repo = parseRepoStateEvent($repoState as RepoStateEvent)
      return repo.head
    } else {
      const branches = await listBranchesFromEvent({repoEvent: $repoEvent})
      return branches?.[0].name
    }
  })

  let selectedBranchValue = $state<string | undefined>(undefined)

  $effect(async () => {
    if (selectedBranch) {
      selectedBranchValue = await selectedBranch
      files = listRepoFilesFromEvent({
        repoEvent: $repoEvent as RepoAnnouncementEvent,
        branch: selectedBranchValue?.split("/").pop() || "master",
      })
      loading = false
    } else {
      branches = listBranchesFromEvent({repoEvent: $repoEvent})
    }
  })

  let showMenu = $state(false)

  const toggleMenu = () => {
    showMenu = !showMenu
  }

  const openMenu = () => {
    showMenu = true
  }

const getFileContent = async (path: string) => {
  return await getRepoFileContentFromEvent({
    repoEvent: $repoEvent,
    branch: selectedBranchValue?.split("/").pop() || "master",
    path,
  })
}

</script>

<div class="rounded-lg border border-border bg-card">
  <div class="p-4">
    {#if loading}
      <Spinner {loading}>Loading files...</Spinner>
    {:else if error}
      <div class="text-red-500">{error}</div>
    {:else if fallbackToBranches}
      <div class="mb-2 text-muted-foreground">
        No repository event found. Showing available branches.
      </div>
      <div class="mb-4 flex items-center gap-2">
        <GitBranch class="h-5 w-5 text-muted-foreground" />
        <select
          class="rounded border border-border bg-secondary px-2 py-1"
          bind:value={selectedBranchValue}
          disabled>
          {#await branches then branches}
            {#each branches as branch}
              <option value={branch.name}>
                {branch.name}
              </option>
            {/each}
          {/await}
        </select>
      </div>
      <div class="border-t border-border pt-4">
        <div class="text-muted-foreground">No files available for this branch.</div>
      </div>
    {:else}
      <div class="mb-4">
        <Button
          onclick={openMenu}
          class="flex items-center gap-3 text-left transition-all hover:text-base-content">
          <GitBranch class="h-5 w-5 text-muted-foreground" />
          <span>{selectedBranchValue}</span>
          <Icon icon="alt-arrow-down" />
        </Button>
        {#if showMenu}
          <Popover hideOnClick onClose={toggleMenu}>
            <ul
              transition:fly
              class="menu z-popover mt-2 flex flex-col rounded-box bg-base-100 p-2 shadow-xl">
              {#await branches then branches}
                {#each branches as branch}
                  <li>
                    <Button onclick={() => (selectedBranchValue = branch.name)}>
                      <span>{branch.name}</span>
                    </Button>
                  </li>
                {/each}
              {/await}
            </ul>
          </Popover>
        {/if}
      </div>
      <div class="border-t border-border pt-4">
        <div class="space-y-2">
          {#await files then files}
            {#if files.length === 0}
              <div class="text-muted-foreground">No files found in this branch.</div>
            {:else}
              {#each files as file}
                <FileView {file} getFileContent={getFileContent}/>
              {/each}
            {/if}
          {/await}
        </div>
      </div>
    {/if}
  </div>
</div>
