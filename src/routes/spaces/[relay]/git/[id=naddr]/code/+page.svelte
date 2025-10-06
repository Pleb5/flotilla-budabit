<script lang="ts">
  import {FileView} from "@nostr-git/ui"
  import {GitBranch, Tag} from "@lucide/svelte"
  import Popover from "@src/lib/components/Popover.svelte"
  import Button from "@src/lib/components/Button.svelte"
  import {fade, fly} from "svelte/transition"
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

  // Keep local selectedBranch in sync with repoClass changes (e.g., BranchSelector)
  $effect(() => {
    if (repoClass) {
      const next = repoClass.selectedBranch || repoClass.mainBranch || selectedBranch
      if (next && next !== selectedBranch) {
        selectedBranch = next
      }
    }
  })

  let curDir: FileEntry = $state({
    name: "..",
    path: "",
    type: "directory",
  })

  let selectedBranch = $state(repoClass.selectedBranch)

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
      <div class="border-border">
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
