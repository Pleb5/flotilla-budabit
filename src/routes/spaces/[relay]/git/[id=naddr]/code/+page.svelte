<script lang="ts">
  import {getContext} from "svelte"
  import {FileView} from "@nostr-git/ui"
  import {GitBranch} from "@lucide/svelte"
  import {
    listRepoFilesFromEvent,
    type FileEntry,
    listBranchesFromEvent,
  } from "@nostr-git/core"
  import {
    parseRepoAnnouncementEvent,
    parseRepoStateEvent,
    type RepoAnnouncementEvent,
    type RepoStateEvent,
    type TrustedEvent,
    type RepoEvent,
  } from "@nostr-git/shared-types"
  import {page} from "$app/stores"
  import type {Readable} from "svelte/store"
  import Popover from "@src/lib/components/Popover.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import {fly} from "svelte/transition"
  import Icon from "@lib/components/Icon.svelte"

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
  let files: FileEntry[] = $state([])
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
      files = await listRepoFilesFromEvent({
        repoEvent: $repoEvent as RepoEvent,
        branch: selectedBranchValue,
      })
    }
  })

  $effect(async () => {
    if ($repoState) {
      loading = false
      files = await listRepoFilesFromEvent({
        repoEvent: $repoEvent as RepoEvent,
        branch: await selectedBranch,
      })
    } else {
      console.log($repoEvent)
      branches = await listBranchesFromEvent({repoEvent: $repoEvent})
      loading = false
    }
  })

  let showMenu = $state(false)

  const toggleMenu = () => {
    showMenu = !showMenu
  }

  const openMenu = () => {
    showMenu = true
  }
</script>

<div class="rounded-lg border border-border bg-card">
  <div class="p-4">
    {#if loading}
      <div class="text-muted-foreground">Loading repository files...</div>
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
          {#each branches as branch}
            <option value={branch.name}>
              {branch.name}
            </option>
          {/each}
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
            <ul transition:fly class="menu z-popover mt-2 rounded-box bg-base-100 p-2 shadow-xl">
              {#each branches as branch}
                <li>
                  <Button onclick={() => (selectedBranch = branch.name)}>
                    <span>{branch.name}</span>
                  </Button>
                </li>
              {/each}
            </ul>
          </Popover>
        {/if}
      </div>
      <div class="border-t border-border pt-4">
        {#if files.length === 0}
          <div class="text-muted-foreground">No files found in this branch.</div>
        {:else}
          <div class="space-y-2">
            {#each files as file}
              <FileView name={file.name} type={file.type} path={file.path} />
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
