<script lang="ts">
  import {getContext} from "svelte"
  import {FileView, Repo} from "@nostr-git/ui"
  import {GitBranch} from "@lucide/svelte"
  import Popover from "@src/lib/components/Popover.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import {fly} from "svelte/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {type FileEntry} from "@nostr-git/core"
  import {pushToast} from "@src/app/toast"
  const repoClass = getContext<Repo>("repoClass")

  let loading = $state(true)
  let error: string | null = $state(null)
  let files: Promise<FileEntry[]> = $state(Promise.resolve([]))
  let path = $state<string | undefined>(undefined)

  const rootDir: FileEntry = $state({
    name: ".",
    path: "",
    type: "directory",
  })

  let curDir: FileEntry = $state({
    name: "..",
    path: "",
    type: "directory",
  })

  let selectedBranch = $derived.by(() => {
    return repoClass.mainBranch
  })

  $effect(() => {
    if (selectedBranch) {
      files = repoClass.listRepoFiles({
        branch: selectedBranch?.split("/").pop() || "master",
        path,
      })
      loading = false
    }
  })

  $effect(() => {
    if (path) {
      curDir.path = path.split("/").slice(0, -1).join("/")
      files = repoClass.listRepoFiles({
        branch: selectedBranch?.split("/").pop() || "master",
        path,
      })
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
    try {
      return await repoClass.getFileContent({
        branch: selectedBranch?.split("/").pop() || "master",
        path,
      })
    } catch (e) {
      console.error(e)
      pushToast({
        message: "Failed to load file: " + e,
        theme: "error",
      })
      return ""
    }
  }

  const setDirectory = (p: string) => {
    if (p !== path) {
      console.log("setDirectory", p)
      path = p
    }
  }
</script>

<div class="rounded-lg border border-border bg-card">
  <div class="p-4">
    {#if loading}
      <Spinner {loading}>Loading files...</Spinner>
    {:else if error}
      <div class="text-red-500">{error}</div>
    {:else}
      <div class="mb-4">
        <Button
          onclick={openMenu}
          class="flex items-center gap-3 text-left transition-all hover:text-base-content">
          <GitBranch class="h-5 w-5 text-muted-foreground" />
          <span>{selectedBranch}</span>
          <Icon icon="alt-arrow-down" />
        </Button>
        {#if showMenu}
          <Popover hideOnClick onClose={toggleMenu}>
            <ul
              transition:fly
              class="menu z-popover mt-2 flex flex-col rounded-box bg-base-100 p-2 shadow-xl">
              {#each repoClass.branches as branch}
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
        <div class="space-y-2">
          {#await files then files}
            {#if files.length === 0}
              <div class="text-muted-foreground">No files found in this branch.</div>
            {:else}
              {#if path}
              <FileView file={rootDir} {getFileContent} {setDirectory} />
                <FileView file={curDir} {getFileContent} {setDirectory} />
              {/if}
              {#each files as file}
                <FileView {file} {getFileContent} {setDirectory} />
              {/each}
            {/if}
          {/await}
        </div>
      </div>
    {/if}
  </div>
</div>
