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

  // Reactive trigger to force re-computation when branches are loaded
  let branchLoadTrigger = $state(0)

  // Get all NIP-34 refs (branches and tags) from the repository state
  let allRefs = $derived.by(() => {
    // Include branchLoadTrigger to make this reactive to branch loading
    branchLoadTrigger
    console.log("🔍 Code page: Computing allRefs...")
    console.log("🔍 repoClass:", repoClass)
    console.log("🔍 repoClass.branchManager:", repoClass.branchManager)
    console.log("🔍 repoClass.repoEvent (kind 30617):", repoClass.repoEvent)

    // Check for Repository State event (kind 30618) which contains the refs
    const repoStateEvent = repoClass.repoStateEvent
    console.log("🔍 repoClass.repoStateEvent (kind 30618):", repoStateEvent)

    // If we have a Repository State event but no NIP-34 refs, the BranchManager might not have processed it
    if (repoStateEvent && repoStateEvent.tags) {
      console.log("🔍 Repository State event tags:", repoStateEvent.tags)

      // Check if BranchManager has processed this event
      const hasProcessedState = repoClass.branchManager?.getAllNIP34References().size > 0
      if (!hasProcessedState) {
        console.log(
          "⚠️ BranchManager has not processed Repository State event, triggering processing...",
        )
        repoClass.branchManager?.processRepoStateEvent(repoStateEvent)
      }
    } else if (!repoStateEvent) {
      console.log(
        "⚠️ No Repository State event found, attempting to load branches from git repository...",
      )

      // Trigger BranchManager to load branches from the actual git repository
      // This is a fallback when the Repository State event is missing
      if (
        repoClass.branchManager &&
        repoClass.branchManager.getBranches().length === 0 &&
        repoClass.repoEvent
      ) {
        console.log("🔍 Triggering BranchManager.loadBranchesFromRepo() as fallback...")
        repoClass.branchManager
          .loadBranchesFromRepo(repoClass.repoEvent)
          .then(() => {
            console.log("✅ Branches loaded successfully, triggering UI update...")
            console.log("🔍 BranchManager after loading:", {
              branchCount: repoClass.branchManager.getBranches().length,
              branches: repoClass.branchManager
                .getBranches()
                .map(b => ({name: b.name, isHead: b.isHead, fromStateEvent: b.fromStateEvent})),
            })
            branchLoadTrigger++ // Trigger reactive update
          })
          .catch((error: any) => {
            console.warn("⚠️ Failed to load branches from git repository:", error)
          })
      }
    }

    const nip34Refs = repoClass.branchManager?.getAllNIP34References() || new Map()
    console.log(
      "🔍 NIP-34 refs from BranchManager:",
      nip34Refs.size,
      Array.from(nip34Refs.entries()),
    )

    // Also check what branches the BranchManager has processed
    const processedBranches = repoClass.branchManager?.getBranches() || []
    console.log("🔍 Processed branches from BranchManager:", processedBranches)

    const refs: Array<{name: string; type: "heads" | "tags"; fullRef: string; commitId: string}> =
      []

    for (const [shortName, ref] of nip34Refs) {
      refs.push({
        name: shortName,
        type: ref.type,
        fullRef: ref.fullRef,
        commitId: ref.commitId,
      })
    }

    console.log("🔍 Processed refs for popover:", refs)

    // If no NIP-34 refs, fall back to processed branches as a temporary measure
    if (refs.length === 0 && processedBranches.length > 0) {
      console.log("🔍 No NIP-34 refs found, falling back to processed branches")
      console.log(
        "🔍 Processed branches details:",
        processedBranches.map(b => ({
          name: b.name,
          oid: b.oid,
          commit: b.commit,
          isHead: b.isHead,
          lineage: b.lineage,
          fromStateEvent: b.fromStateEvent,
          isNIP34Head: b.isNIP34Head,
        })),
      )

      for (const branch of processedBranches) {
        const refObj = {
          name: branch.name,
          type: "heads" as const,
          fullRef: `refs/heads/${branch.name}`,
          commitId: branch.oid || "",
        }
        console.log("🔍 Adding processed branch to refs:", refObj)
        refs.push(refObj)
      }

      console.log("🔍 Final refs after fallback:", refs)
    }

    // Sort: branches first, then tags, alphabetically within each group
    return refs.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "heads" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
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
      })
      return result.content
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
              {#if allRefs.length === 0}
                <li class="px-3 py-2 text-sm text-muted-foreground">No branches or tags found</li>
              {:else}
                {@const branches = allRefs.filter(ref => ref.type === "heads")}
                {@const tags = allRefs.filter(ref => ref.type === "tags")}

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
                            // Trigger a file listing to validate the branch exists locally
                            await repoClass.fileManager.listRepoFiles({
                              repoEvent: repoClass.repoEvent,
                              branch: ref.name,
                              path: ''
                            })
                          } catch (error) {
                            // Handle branch resolution errors gracefully
                            if (error instanceof Error && error.message.includes('Could not find')) {
                              const { pushToast } = await import('@app/toast')
                              pushToast({
                                message: `Branch '${ref.name}' not available locally. This branch exists in the repository state but may have been deleted, merged, or not fetched locally. Switching to main branch instead.`,
                                theme: 'error',
                                timeout: 8000
                              })
                              selectedBranch = repoClass.mainBranch || 'main'
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
