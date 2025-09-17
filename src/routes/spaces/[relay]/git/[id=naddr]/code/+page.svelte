<script lang="ts">
  import {FileView} from "@nostr-git/ui"
  import {GitBranch, Tag} from "@lucide/svelte"
  import Popover from "@src/lib/components/Popover.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import {fade, fly, slide} from "svelte/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Spinner from "@src/lib/components/Spinner.svelte"
  import {type FileEntry} from "@nostr-git/core"
  import {pushToast} from "@src/app/toast"

  const {data} = $props()
  const {repoClass} = data

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

  let selectedBranch = $state(repoClass.mainBranch)

  let branchLoadTrigger = $state(0)

  let refs: Array<{name: string; type: "heads" | "tags"; fullRef: string; commitId: string}> = $state([])
  let loadingRefs = $state(true)

  // Load refs using the unified API
  $effect(() => {
    if (repoClass) {
      loadingRefs = true
      repoClass.getAllRefsWithFallback()
        .then(loadedRefs => {
          refs = loadedRefs
          loadingRefs = false
          branchLoadTrigger++ // Trigger reactivity for dependent effects
        })
        .catch((error: Error) => {
          console.error('Failed to load repository references:', error)
          pushToast({
            message: "Failed to load branches from git repository: " + error,
            theme: "error",
          })
          refs = []
          loadingRefs = false
        })
    }
  })

  $effect(() => {
    if (selectedBranch) {
      files = repoClass
        .listRepoFiles({
          branch: selectedBranch?.split("/").pop() || "master",
          path,
        })
        .then(result =>
          result.files.map(
            file =>
              ({
                name: file.path.split("/").pop() || file.path,
                path: file.path,
                type: file.type as "file" | "directory" | "submodule" | "symlink",
                oid: file.lastCommit,
              }) as FileEntry,
          ),
        )
      loading = false
    }
  })

  $effect(() => {
    if (path) {
      curDir.path = path.split("/").slice(0, -1).join("/")
      files = repoClass
        .listRepoFiles({
          branch: selectedBranch?.split("/").pop() || "master",
          path,
        })
        .then(result =>
          result.files.map(
            file =>
              ({
                name: file.path.split("/").pop() || file.path,
                path: file.path,
                type: file.type as "file" | "directory" | "submodule" | "symlink",
                oid: file.lastCommit,
              }) as FileEntry,
          ),
        )
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
      const result = await repoClass.getFileContent({
        branch: selectedBranch?.split("/").pop() || "master",
        path,
        commit: undefined as any,
      })
      return result.content
    } catch (e) {
      pushToast({
        message: "Failed to load file: " + e,
        theme: "error",
      })
      return ""
    }
  }

  const setDirectory = (p: string) => {
    if (p !== path) {
      path = p
    }
  }
</script>

<div class="mt-2 rounded-lg border border-border bg-card">
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
              class="menu z-popover mt-2 flex max-h-64 flex-col overflow-y-auto rounded-box bg-base-100 p-2 shadow-xl">
              {#if refs.length === 0}
                <li class="px-3 py-2 text-sm text-muted-foreground">No branches or tags found</li>
              {:else}
                {@const branches = refs.filter(ref => ref.type === "heads")}
                {@const tags = refs.filter(ref => ref.type === "tags")}

                {#if branches.length > 0}
                  <li
                    class="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Branches
                  </li>
                  {#each branches as ref}
                    <li>
                      <Button
                        onclick={async () => {
                          try {
                            selectedBranch = ref.name
                            await repoClass.fileManager.listRepoFiles({
                              repoEvent: repoClass.repoEvent!,
                              branch: ref.name,
                              path: ''
                            })
                          } catch (error) {
                            if (error instanceof Error && error.message.includes('Could not find')) {
                              const { pushToast } = await import('@app/toast')
                              pushToast({
                                message: `Branch '${ref.name}' is not available locally. It may have been deleted, merged, or not fetched yet. Using the repository's default branch instead.`,
                                theme: 'error',
                                timeout: 8000
                              })
                              selectedBranch = repoClass.mainBranch || ''
                            } else {
                              console.error('Branch selection error:', error)
                            }
                          }
                        }}
                        class={selectedBranch === ref.name ? "bg-primary/10 text-primary" : ""}>
                        <GitBranch class="h-4 w-4" />
                        <span>{ref.name}</span>
                        {#if ref.name === repoClass.mainBranch}
                          <span class="ml-auto text-xs text-muted-foreground">default</span>
                        {/if}
                      </Button>
                    </li>
                  {/each}
                {/if}

                {#if tags.length > 0}
                  {#if branches.length > 0}
                    <li class="my-1 border-t border-border"></li>
                  {/if}
                  <li
                    class="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tags
                  </li>
                  {#each tags as ref}
                    <li>
                      <Button
                        onclick={() => (selectedBranch = ref.name)}
                        class={selectedBranch === ref.name ? "bg-primary/10 text-primary" : ""}>
                        <Tag class="h-4 w-4" />
                        <span>{ref.name}</span>
                      </Button>
                    </li>
                  {/each}
                {/if}
              {/if}
            </ul>
          </Popover>
        {/if}
      </div>
      <div class="border-t border-border pt-4">
        {#key files}
          <div transition:fade>
            {#await files}
              <Spinner {loading}>Loading files...</Spinner>
            {:then files}
              {#if files.length === 0}
                <div class="text-muted-foreground">No files found in this branch.</div>
              {:else}
                {#if path}
                  <FileView file={rootDir} {getFileContent} {setDirectory} />
                  <FileView file={curDir} {getFileContent} {setDirectory} />
                {/if}
                {#each files as file (file)}
                  <FileView {file} {getFileContent} {setDirectory} />
                {/each}
              {/if}
            {/await}
          </div>
        {/key}
      </div>
    {/if}
  </div>
</div>
