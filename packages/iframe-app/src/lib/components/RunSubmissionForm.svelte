<script lang="ts">
  import type {LoomWorker, RerunDraft, WorkflowDefinition} from '../types'

  interface Props {
    title: string
    description: string
    submissionMode: 'new' | 'rerun' | null
    rerunDraft: RerunDraft
    rerunCommandMode?: 'reuse' | 'regenerate'
    rerunArgsText?: string
    rerunPaymentToken?: string
    rerunSecrets?: {key: string; value: string}[]
    rerunSubmitting?: boolean
    discoveredWorkers?: LoomWorker[]
    loadingWorkers?: boolean
    walletAvailable?: boolean
    walletLoading?: boolean
    walletError?: string | null
    walletTotalBalance?: number
    walletBalancesByMint?: Record<string, number>
    visibleMintOptions?: string[]
    selectedMint?: string
    paymentAmount?: number
    maxDuration?: number
    generatingPaymentToken?: boolean
    autoTokenPromptOpen?: boolean
    selectedWorker?: LoomWorker | null
    compatibleMints?: string[]
    signerError?: string | null
    runnerScriptTemplate?: string
    runnerScriptAutoManaged?: boolean
    canGenerateSuggestedToken?: boolean
    availableWorkflows?: WorkflowDefinition[]
    availableBranches?: string[]
    defaultBranch?: string
    onRefreshWorkers: () => void
    onRefreshWallet: () => void
    onGeneratePaymentToken: () => void
    onConfirmAutoTokenGeneration: () => void
    onDismissAutoTokenGeneration: () => void
    onAddRerunSecret: () => void
    onRemoveRerunSecret: (index: number) => void
    onSetRerunCommandMode?: (mode: 'reuse' | 'regenerate') => void
    onRegenerateTemplate: () => void
    onSubmit: () => void
  }

  let {
    title: _title,
    description: _description,
    submissionMode,
    rerunDraft = $bindable(),
    rerunCommandMode = $bindable('reuse'),
    rerunArgsText = $bindable(''),
    rerunPaymentToken = $bindable(''),
    rerunSecrets = $bindable([{key: '', value: ''}]),
    rerunSubmitting = false,
    discoveredWorkers = [],
    loadingWorkers = false,
    walletAvailable = false,
    walletLoading = false,
    walletError = null,
    walletTotalBalance: _walletTotalBalance = 0,
    walletBalancesByMint = {},
    visibleMintOptions = [],
    selectedMint = $bindable(''),
    paymentAmount = $bindable(100),
    maxDuration = $bindable(600),
    generatingPaymentToken = false,
    autoTokenPromptOpen: _autoTokenPromptOpen = false,
    selectedWorker = null,
    compatibleMints = [],
    signerError = null,
    runnerScriptTemplate = $bindable(''),
    runnerScriptAutoManaged = $bindable(false),
    canGenerateSuggestedToken: _canGenerateSuggestedToken = false,
    availableWorkflows = [],
    availableBranches = [],
    defaultBranch = 'main',
    onRefreshWorkers,
    onRefreshWallet,
    onGeneratePaymentToken: _onGeneratePaymentToken,
    onConfirmAutoTokenGeneration: _onConfirmAutoTokenGeneration,
    onDismissAutoTokenGeneration: _onDismissAutoTokenGeneration,
    onAddRerunSecret,
    onRemoveRerunSecret,
    onSetRerunCommandMode,
    onRegenerateTemplate,
    onSubmit,
  }: Props = $props()

  const isFormValid = $derived(
    !!rerunDraft.workerPubkey && (submissionMode !== 'new' || !!rerunDraft.workflowPath)
  )

  const selectedMintBalance = $derived(selectedMint ? walletBalancesByMint[selectedMint] || 0 : 0)

  const validationMessage = $derived.by(() => {
    if (!rerunDraft.workerPubkey) return 'Please select a worker'
    if (submissionMode === 'new' && !rerunDraft.workflowPath) return 'Workflow path is required'
    return ''
  })

  // Auto-pick the mint with the most balance among compatible/overlapping mints.
  // Only reassigns when the current selection is missing or no longer valid, so
  // user overrides (if we ever add that back) still stick.
  $effect(() => {
    if (!visibleMintOptions || visibleMintOptions.length === 0) return
    if (selectedMint && visibleMintOptions.includes(selectedMint)) return
    const best = [...visibleMintOptions].sort(
      (a, b) => (walletBalancesByMint[b] || 0) - (walletBalancesByMint[a] || 0),
    )[0]
    if (best && best !== selectedMint) selectedMint = best
  })

  // Default the branch selection to the repo's default branch on first render
  // when we know what it is. Only fills in a blank value so explicit user
  // selection (including "" from a rerun draft) isn't stomped after the fact.
  $effect(() => {
    if (!rerunDraft.branch && defaultBranch && availableBranches.includes(defaultBranch)) {
      rerunDraft.branch = defaultBranch
    }
  })

  // Seed one empty env-var row so the form always shows the editor on open.
  $effect(() => {
    if (rerunDraft && rerunDraft.envVars.length === 0) {
      rerunDraft.envVars = [{key: '', value: ''}]
    }
  })

  const addEnvVar = () => {
    rerunDraft.envVars = [...rerunDraft.envVars, {key: '', value: ''}]
  }

  const removeEnvVar = (index: number) => {
    const next = rerunDraft.envVars.filter((_, i) => i !== index)
    rerunDraft.envVars = next.length > 0 ? next : [{key: '', value: ''}]
  }

  // Ranking for worker cards: online > price (cheaper first) > queue depth
  const rankedWorkers = $derived.by(() => {
    if (!discoveredWorkers || discoveredWorkers.length === 0) return []
    const rate = (w: LoomWorker) => w.pricing?.perSecondRate ?? Number.POSITIVE_INFINITY
    const minDur = (w: LoomWorker) => w.minDuration ?? 0
    const queue = (w: LoomWorker) => w.currentQueueDepth ?? 0
    const online = (w: LoomWorker) => (w.online ? 0 : 1)
    const minCostOf = (w: LoomWorker) => rate(w) * minDur(w)
    return [...discoveredWorkers].sort((a, b) => {
      if (online(a) !== online(b)) return online(a) - online(b)
      if (minCostOf(a) !== minCostOf(b)) return minCostOf(a) - minCostOf(b)
      return queue(a) - queue(b)
    })
  })

  const cheapestMinCost = $derived.by(() => {
    let min = Number.POSITIVE_INFINITY
    for (const w of rankedWorkers) {
      const r = w.pricing?.perSecondRate ?? Number.POSITIVE_INFINITY
      const d = w.minDuration ?? 0
      const c = r * d
      if (c > 0 && c < min) min = c
    }
    return min
  })

  const lowestQueue = $derived.by(() => {
    let min = Number.POSITIVE_INFINITY
    for (const w of rankedWorkers) {
      const q = w.currentQueueDepth ?? Number.POSITIVE_INFINITY
      if (q < min) min = q
    }
    return min
  })

  // Auto-select the top-ranked online worker when nothing valid is picked yet.
  $effect(() => {
    if (!rankedWorkers || rankedWorkers.length === 0) return
    const current = rankedWorkers.find(w => w.pubkey === rerunDraft.workerPubkey)
    if (current) return
    const pick = rankedWorkers.find(w => w.online) || rankedWorkers[0]
    if (pick && pick.pubkey !== rerunDraft.workerPubkey) {
      rerunDraft.workerPubkey = pick.pubkey
    }
  })

  const stripScheme = (url: string) => (url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '')

  const durationPresets: Array<{label: string; seconds: number}> = [
    {label: '5m', seconds: 300},
    {label: '15m', seconds: 900},
    {label: '30m', seconds: 1800},
  ]
  let showCustomDuration = $state(false)
  const isCustomDuration = $derived(
    showCustomDuration || !durationPresets.some(p => p.seconds === maxDuration),
  )

  const formatLastSeen = (ts?: number) => {
    if (!ts) return ''
    const sec = Math.max(0, Math.floor((Date.now() - ts * 1000) / 1000))
    if (sec < 60) return `${sec}s ago`
    const m = Math.floor(sec / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 48) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  }
</script>

<div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
  <div class="space-y-4 rounded-lg border border-border bg-card p-4">
    {#if submissionMode === 'rerun' && onSetRerunCommandMode}
      <div class="space-y-2">
        <span class="text-xs text-muted-foreground">Rerun command mode</span>
        <div class="flex flex-wrap gap-2">
          <button class="rounded-md border px-3 py-2 text-sm {rerunCommandMode === 'reuse' ? 'border-primary/40 bg-primary/10' : 'border-input hover:bg-accent'}" onclick={() => onSetRerunCommandMode('reuse')}>
            Reuse original command
          </button>
          <button class="rounded-md border px-3 py-2 text-sm {rerunCommandMode === 'regenerate' ? 'border-primary/40 bg-primary/10' : 'border-input hover:bg-accent'}" onclick={() => onSetRerunCommandMode('regenerate')}>
            Regenerate from template
          </button>
        </div>
      </div>
    {/if}

    <div class="grid gap-3 sm:grid-cols-3">
      <label class="space-y-1 text-sm">
        <span class="text-xs text-muted-foreground">Workflow</span>
        {#if availableWorkflows.length > 0}
          <select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={rerunDraft.workflowPath}>
            <option value="">Select workflow</option>
            {#each availableWorkflows as workflow}
              <option value={workflow.path}>{workflow.name} — {workflow.path}</option>
            {/each}
          </select>
        {:else}
          <input class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={rerunDraft.workflowPath} placeholder=".github/workflows/build.yml" />
        {/if}
      </label>

      <label class="space-y-1 text-sm">
        <span class="text-xs text-muted-foreground">Branch</span>
        {#if availableBranches.length > 0}
          <select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={rerunDraft.branch}>
            {#each availableBranches as branch}
              <option value={branch}>{branch}{branch === defaultBranch ? ' (default)' : ''}</option>
            {/each}
          </select>
        {:else}
          <input class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={rerunDraft.branch} placeholder={defaultBranch} />
        {/if}
      </label>

      <label class="space-y-1 text-sm">
        <span class="text-xs text-muted-foreground">Commit</span>
        <input class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={rerunDraft.commit} placeholder="Optional commit SHA" />
      </label>
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">Worker</span>
        <button class="text-xs text-primary hover:underline" onclick={onRefreshWorkers}>{loadingWorkers ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {#if rankedWorkers.length > 0}
        <div class="grid gap-2">
          {#each rankedWorkers as worker (worker.pubkey)}
            {@const rate = worker.pricing?.perSecondRate ?? 0}
            {@const workerMinCost = rate * (worker.minDuration ?? 0)}
            {@const queue = worker.currentQueueDepth ?? 0}
            {@const acceptsMint = !selectedMint || !worker.mints || worker.mints.length === 0 || worker.mints.includes(selectedMint)}
            {@const isSelected = rerunDraft.workerPubkey === worker.pubkey}
            <button
              class="rounded-md border p-3 text-left text-sm {isSelected ? 'border-primary/40 bg-primary/10' : 'border-input hover:bg-accent'}"
              onclick={() => (rerunDraft.workerPubkey = worker.pubkey)}>
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="h-2 w-2 shrink-0 rounded-full {worker.online ? 'bg-green-400' : 'bg-zinc-500'}" title={worker.online ? 'Online' : 'Offline'}></span>
                    <span class="truncate font-medium">{worker.name}</span>
                    {#if workerMinCost > 0 && workerMinCost === cheapestMinCost && rankedWorkers.length > 1}
                      <span class="rounded-full border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-300">cheapest</span>
                    {/if}
                    {#if queue === lowestQueue && rankedWorkers.length > 1 && queue < Number.POSITIVE_INFINITY}
                      <span class="rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">low queue</span>
                    {/if}
                    {#if !acceptsMint}
                      <span class="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-300">mint mismatch</span>
                    {/if}
                  </div>
                  <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{rate || '?'} {worker.pricing?.unit || 'sat'}/s</span>
                    <span>queue {queue}{worker.maxConcurrentJobs ? `/${worker.maxConcurrentJobs}` : ''}</span>
                    <span>{worker.architecture || 'unknown arch'}</span>
                    {#if worker.lastSeen}
                      <span>seen {formatLastSeen(worker.lastSeen)}</span>
                    {/if}
                  </div>
                </div>
              </div>
            </button>
          {/each}
        </div>
      {:else}
        <div class="rounded-md border border-input p-3 text-sm text-muted-foreground">{loadingWorkers ? 'Discovering workers…' : 'No workers discovered yet.'}</div>
      {/if}
    </div>

    <div class="space-y-2">
      <span class="text-xs text-muted-foreground">Environment variables</span>
      {#each rerunDraft.envVars as envVar, index (index)}
        <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input class="rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={envVar.key} placeholder="KEY" />
          <input class="rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={envVar.value} placeholder="value" />
          <button class="rounded-md border border-input px-3 py-2 text-sm leading-none hover:bg-accent" title="Remove" aria-label="Remove variable" onclick={() => removeEnvVar(index)}>−</button>
        </div>
      {/each}
      <button class="rounded-md border border-input px-3 py-1.5 text-sm leading-none hover:bg-accent" title="Add variable" aria-label="Add variable" onclick={addEnvVar}>+</button>
    </div>

    <div class="space-y-2">
      <span class="text-xs text-muted-foreground">Secrets</span>
      {#each rerunSecrets as secret, index (index)}
        <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input class="rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={secret.key} placeholder="SECRET_KEY" />
          <input class="rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={secret.value} placeholder="secret value" />
          <button class="rounded-md border border-input px-3 py-2 text-sm leading-none hover:bg-accent" title="Remove" aria-label="Remove secret" onclick={() => onRemoveRerunSecret(index)}>−</button>
        </div>
      {/each}
      <button class="rounded-md border border-input px-3 py-1.5 text-sm leading-none hover:bg-accent" title="Add secret" aria-label="Add secret" onclick={onAddRerunSecret}>+</button>
    </div>

    <details class="rounded-md border border-dashed border-border bg-background/30">
      <summary class="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Runner script (advanced / debug)</summary>
      <div class="space-y-2 border-t border-border px-3 py-3">
        {#if submissionMode === 'new' || (submissionMode === 'rerun' && rerunCommandMode === 'regenerate')}
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground">Prefilled from the Hive CI runner and updated from the selected workflow and worker.</span>
            <button class="text-xs text-primary hover:underline" onclick={onRegenerateTemplate}>Regenerate</button>
          </div>
          <textarea class="min-h-56 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono" bind:value={runnerScriptTemplate} oninput={() => (runnerScriptAutoManaged = false)}></textarea>
        {:else}
          <span class="text-xs text-muted-foreground">Arguments (one per line)</span>
          <textarea class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono" bind:value={rerunArgsText}></textarea>
        {/if}
      </div>
    </details>

    {#if signerError}
      <div class="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">{signerError}</div>
    {/if}

    {#if !isFormValid && validationMessage}
      <div class="rounded-md border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-200">{validationMessage}</div>
    {/if}
  </div>

  <aside class="space-y-3 rounded-lg border border-border bg-card p-4 xl:sticky xl:top-4 xl:self-start">
    <!-- Mint -->
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">Mint</span>
        {#if walletAvailable}
          <button class="text-xs text-primary hover:underline" onclick={onRefreshWallet}>{walletLoading ? '…' : 'refresh'}</button>
        {/if}
      </div>
      {#if visibleMintOptions.length > 1}
        <select
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          bind:value={selectedMint}
          disabled={!walletAvailable || walletLoading}>
          {#each visibleMintOptions as mint}
            <option value={mint}>{stripScheme(mint)} · {(walletBalancesByMint[mint] || 0).toLocaleString()} sats</option>
          {/each}
        </select>
      {:else if selectedMint}
        <div class="flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
          <span class="truncate" title={selectedMint}>{stripScheme(selectedMint)}</span>
          <span class="shrink-0 font-medium">{selectedMintBalance.toLocaleString()} sats</span>
        </div>
      {:else}
        <div class="rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
          {walletError ? `Wallet unavailable: ${walletError}` : 'No mint available'}
        </div>
      {/if}
    </div>

    <!-- Worker -->
    <div class="space-y-1">
      <span class="text-xs text-muted-foreground">Worker</span>
      <div class="rounded-md border border-input bg-background px-3 py-2 text-sm">
        {selectedWorker?.name || 'No worker selected'}
      </div>
    </div>

    <!-- Max duration -->
    <div class="space-y-2">
      <span class="text-xs text-muted-foreground">Max duration</span>
      <div class="flex flex-wrap gap-2">
        {#each durationPresets as preset}
          <button
            class="rounded-md border px-3 py-1.5 text-sm {maxDuration === preset.seconds && !showCustomDuration ? 'border-primary/40 bg-primary/10' : 'border-input hover:bg-accent'}"
            onclick={() => { showCustomDuration = false; maxDuration = preset.seconds }}>
            {preset.label}
          </button>
        {/each}
        <button
          class="rounded-md border px-3 py-1.5 text-sm {isCustomDuration ? 'border-primary/40 bg-primary/10' : 'border-input hover:bg-accent'}"
          onclick={() => (showCustomDuration = !showCustomDuration || !isCustomDuration)}>
          Custom
        </button>
      </div>
      {#if isCustomDuration}
        <div class="flex items-center gap-2">
          <input class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm" type="number" min="60" step="60" bind:value={maxDuration} />
          <span class="text-xs text-muted-foreground">seconds</span>
        </div>
      {/if}
    </div>

    <!-- Prepayment (prominent, editable) -->
    <label class="block rounded-md border border-primary/30 bg-primary/5 p-4">
      <div class="text-xs uppercase tracking-wide text-muted-foreground">Prepayment</div>
      <div class="mt-1 flex items-baseline gap-2">
        <input
          class="w-full bg-transparent text-2xl font-semibold focus:outline-none"
          type="number"
          min="1"
          step="1"
          bind:value={paymentAmount} />
        <span class="text-base font-normal text-muted-foreground">sats</span>
      </div>
    </label>

    {#if selectedWorker && walletAvailable && compatibleMints.length === 0}
      <div class="rounded-md border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-200">No overlapping mints between your wallet and the selected worker.</div>
    {/if}

    {#if selectedMint && paymentAmount > selectedMintBalance && walletAvailable}
      <div class="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">Selected mint balance is lower than the prepayment.</div>
    {/if}

    <button
      class="inline-flex w-full items-center justify-center gap-2 rounded-md border border-green-500/40 bg-green-500/20 px-3 py-2.5 text-sm font-semibold text-green-100 hover:bg-green-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      onclick={onSubmit}
      disabled={rerunSubmitting || generatingPaymentToken || !isFormValid}>
      <span class="{rerunSubmitting || generatingPaymentToken ? 'animate-pulse' : ''}">▶</span>
      {rerunSubmitting
        ? 'Submitting…'
        : generatingPaymentToken
          ? 'Preparing payment…'
          : submissionMode === 'new'
            ? 'Pay and run'
            : 'Pay and rerun'}
    </button>
  </aside>
</div>
