<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"

  export type BranchChange = {
    name: string
    oldOid?: string
    newOid?: string
    change: "added" | "updated" | "removed"
  }

  export type RepoBranchUpdate = {
    repoId: string
    repoName: string
    cloneUrl: string
    relays: string[]
    headBranch?: string
    updates: BranchChange[]
    refs?: Array<{type: "heads" | "tags"; name: string; commit: string}>
  }

  export type BranchUpdateFailure = {
    repoId: string
    repoName: string
    error: string
  }

  export type BranchUpdateResult = {
    total: number
    completed: number
    failures: BranchUpdateFailure[]
  }

  interface Props {
    repos: RepoBranchUpdate[]
    onCancel?: () => void
    onUpdate?: (
      selected: RepoBranchUpdate[],
      onProgress?: (completed: number, total: number) => void,
    ) => Promise<BranchUpdateResult> | BranchUpdateResult
  }

  const {repos, onCancel, onUpdate}: Props = $props()

  let updating = $state(false)
  let selections = $state<Record<string, boolean>>({})
  let updateCompleted = $state(0)
  let updateTotal = $state(0)
  let updateResult = $state<BranchUpdateResult | null>(null)

  $effect(() => {
    const next: Record<string, boolean> = {}
    for (const repo of repos || []) {
      next[repo.repoId] = true
    }
    selections = next
  })

  const toggleRepo = (repoId: string) => {
    selections = {...selections, [repoId]: !selections[repoId]}
  }

  const selectedRepos = $derived.by(() => (repos || []).filter(r => selections[r.repoId]))

  const formatOid = (oid?: string) => (oid ? oid.slice(0, 8) : "")

  const formatChange = (update: BranchChange) => {
    const oldShort = formatOid(update.oldOid)
    const newShort = formatOid(update.newOid)
    if (update.change === "added") {
      return `+ ${update.name} ${newShort}`.trim()
    }
    if (update.change === "removed") {
      return `- ${update.name} ${oldShort}`.trim()
    }
    return `${update.name} ${oldShort} -> ${newShort}`.trim()
  }

  const handleUpdate = async () => {
    if (updating || !onUpdate) return
    updateTotal = selectedRepos.length
    updateCompleted = 0
    updateResult = null
    updating = true
    try {
      const result = await onUpdate(selectedRepos, (completed, total) => {
        updateCompleted = completed
        updateTotal = total
      })
      updateResult = result

      if (result.failures.length === 0) {
        onCancel?.()
      } else {
        const failedIds = new Set(result.failures.map(f => f.repoId))
        const nextSelections: Record<string, boolean> = {}
        for (const repo of repos || []) {
          nextSelections[repo.repoId] = failedIds.has(repo.repoId)
        }
        selections = nextSelections
      }
    } finally {
      updating = false
    }
  }

  const handleCancel = () => {
    onCancel?.()
  }

  const updateLabel = $derived.by(() => {
    if (updating) {
      return `${updateCompleted}/${updateTotal} Updated`
    }
    return `Update ${selectedRepos.length}/${repos.length}`
  })

  const updateSucceeded = $derived.by(() =>
    updateResult ? updateResult.total - updateResult.failures.length : 0,
  )
</script>

<ModalHeader>
  {#snippet title()}
    Branch State Updates
  {/snippet}
  {#snippet info()}
    Review branch changes before publishing new repository state events.
  {/snippet}
</ModalHeader>

{#if !repos || repos.length === 0}
  <p class="text-sm text-muted-foreground">No branch updates found.</p>
{:else}
  <div class="flex flex-col gap-3">
    {#each repos as repo (repo.repoId)}
      <div class="rounded-md border border-border bg-card p-3">
        <label class="flex items-start gap-3">
          <input
            class="checkbox checkbox-sm mt-1"
            type="checkbox"
            checked={selections[repo.repoId]}
            onchange={() => toggleRepo(repo.repoId)} />
          <div class="flex w-full flex-col gap-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-sm font-semibold">{repo.repoName || repo.repoId}</div>
              <div class="text-xs opacity-60">
                {repo.updates.length} update{repo.updates.length !== 1 ? "s" : ""}
              </div>
            </div>
            <div class="text-xs opacity-60 break-all">Authoritative remote: {repo.cloneUrl}</div>
            {#if repo.headBranch}
              <div class="text-xs opacity-60">HEAD: {repo.headBranch}</div>
            {/if}
            <div class="flex flex-col gap-1">
              {#each repo.updates as update, index (repo.repoId + "-" + update.name + "-" + index)}
                <div class="text-xs font-mono">{formatChange(update)}</div>
              {/each}
            </div>
          </div>
        </label>
      </div>
    {/each}
  </div>
{/if}

{#if updateResult}
  <div class="rounded-md border border-border bg-muted/30 p-3 text-xs">
    <div class="font-semibold text-sm">Update complete</div>
    <div class="opacity-60">{updateSucceeded}/{updateResult.total} updated</div>
    {#if updateResult.failures.length > 0}
      <div class="mt-2 text-red-400 font-semibold">Failures</div>
      <div class="mt-1 flex flex-col gap-1">
        {#each updateResult.failures as failure (failure.repoId)}
          <div class="text-red-400">
            <span class="font-semibold">{failure.repoName || failure.repoId}</span>
            <span class="opacity-80"> — {failure.error}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<ModalFooter>
  <div class="flex w-full items-center justify-between gap-3">
    <span class="text-xs opacity-60">{selectedRepos.length} selected</span>
    <div class="flex items-center gap-2">
      <Button class="btn btn-ghost btn-sm" onclick={handleCancel}>Cancel</Button>
      <Button
        class="btn btn-primary btn-sm"
        disabled={updating || selectedRepos.length === 0}
        onclick={handleUpdate}>
        {updateLabel}
      </Button>
    </div>
  </div>
</ModalFooter>
