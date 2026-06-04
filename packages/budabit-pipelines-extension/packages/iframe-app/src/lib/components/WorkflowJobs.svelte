<script lang="ts">
  import {AlertCircle, Check, ChevronDown, ChevronRight, Circle, Loader2, X} from '@lucide/svelte'
  import Anser from 'anser'
  import {groupMatrixJobs, type ActJob, type JobGroup, type WorkflowJob} from '../cicd'

  // Render an act log line with cargo/rustup ANSI colours preserved, while
  // escaping any HTML in the line itself. `use_classes: false` emits inline
  // styles so we don't need a Tailwind allow-list for the colour palette.
  function ansiToHtml(line: string): string {
    return Anser.ansiToHtml(line, {use_classes: false})
  }

  interface Props {
    workflowJobs: WorkflowJob[]
    jobGroups: JobGroup[]
    loading: boolean
    error: string | null
    actJobByName?: Map<string, ActJob>
  }

  let {workflowJobs, jobGroups, loading, error, actJobByName = new Map()}: Props = $props()

  let expandedJobId = $state<string | null>(null)
  let expandedVariantIndex = $state(0)
  let expandedStepIndex = $state<number | null>(null)

  function toggleJob(id: string) {
    if (expandedJobId === id) {
      expandedJobId = null
      expandedStepIndex = null
      expandedVariantIndex = 0
    } else {
      expandedJobId = id
      expandedStepIndex = null
      expandedVariantIndex = 0
    }
  }

  // A matrix job's YAML name still carries the `${{ matrix.X }}` placeholder;
  // act replaces the placeholder with the concrete variant value at runtime
  // (e.g. `Build .ipk (x86_64)`). Map YAML base → matrix group so we can
  // resolve a matrix WorkflowJob to all its ActJob variants.
  const matrixGroups = $derived(groupMatrixJobs(Array.from(actJobByName.values())))
  const matrixByBaseName = $derived(
    new Map(matrixGroups.map(group => [group.baseName.toLowerCase(), group])),
  )

  function yamlJobBaseName(name: string): string {
    const formatMatch = name.match(/\$\{\{\s*format\(\s*'([^']+)'\s*,/)
    if (formatMatch) {
      return (formatMatch[1] || '').replace(/\s*\(\{0\}\)/, '').trim()
    }
    // If the placeholder sits inside parens, strip the whole `(...)` group
    // so `Build .ipk (${{ matrix.X }})` becomes `Build .ipk`. Do this BEFORE
    // the bare-placeholder strip, or the second regex matches on an already
    // empty `()` and we end up with a stray trailing `()`.
    const parensWithPlaceholder = /\s*\([^)]*\$\{\{[^}]*\}\}[^)]*\)/
    if (parensWithPlaceholder.test(name)) {
      return name.replace(parensWithPlaceholder, '').trim()
    }
    return name.replace(/\s*\$\{\{[^}]*\}\}/, '').trim()
  }

  function isMatrixJob(job: WorkflowJob): boolean {
    return job.name.includes('${{')
  }

  function resolveVariants(job: WorkflowJob): {label: string; actJob: ActJob}[] {
    if (!isMatrixJob(job)) return []
    const base = yamlJobBaseName(job.name).toLowerCase()
    return matrixByBaseName.get(base)?.variants || []
  }

  function resolveActJob(job: WorkflowJob): ActJob | undefined {
    if (isMatrixJob(job)) return undefined
    return actJobByName.get(job.name.toLowerCase()) || actJobByName.get(job.id.toLowerCase())
  }

  function matrixStatus(variants: {label: string; actJob: ActJob}[]): 'success' | 'failure' | 'pending' | undefined {
    if (variants.length === 0) return undefined
    if (variants.some(v => v.actJob.status === 'failure')) return 'failure'
    if (variants.every(v => v.actJob.status === 'success')) return 'success'
    return 'pending'
  }

  function jobStatus(job: WorkflowJob): 'success' | 'failure' | 'pending' | undefined {
    if (isMatrixJob(job)) return matrixStatus(resolveVariants(job))
    return resolveActJob(job)?.status
  }

  function jobBorderClass(job: WorkflowJob, isExpanded: boolean): string {
    if (isExpanded) return 'border-blue-500 bg-blue-500/10'
    const status = jobStatus(job)
    if (status === 'success') return 'border-green-500 bg-green-500/10'
    if (status === 'failure') return 'border-red-500 bg-red-500/10'
    return 'border-border bg-muted/30 hover:bg-muted/50'
  }

  function jobTextClass(job: WorkflowJob): string {
    const status = jobStatus(job)
    if (status === 'success') return 'text-green-600 dark:text-green-400'
    if (status === 'failure') return 'text-red-600 dark:text-red-400'
    return ''
  }

  function displayStepName(name: string): string {
    let cleaned = name
    if (cleaned.startsWith('Main ')) cleaned = cleaned.slice(5)
    else if (cleaned.startsWith('Pre ')) cleaned = cleaned.slice(4)
    else if (cleaned.startsWith('Post ')) cleaned = cleaned.slice(5)
    const newline = cleaned.indexOf('\n')
    if (newline !== -1) cleaned = cleaned.slice(0, newline)
    return cleaned.trim()
  }
</script>

{#if loading}
  <div class="rounded-lg border border-border bg-card p-4">
    <div class="flex items-center gap-2">
      <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
      <span class="text-sm text-muted-foreground">Loading workflow stages…</span>
    </div>
  </div>
{:else if error}
  <div class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-200">
    <div class="flex items-start gap-2 text-sm">
      <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
      <div class="space-y-1">
        <div class="font-medium">Workflow jobs unavailable</div>
        <div class="text-xs text-yellow-200/80">{error}</div>
        <div class="text-xs text-yellow-200/60">Logs, status, and cost data below are still valid.</div>
      </div>
    </div>
  </div>
{:else if jobGroups.length > 0}
  <div class="rounded-lg border border-border bg-card p-4">
    <h3 class="mb-4 text-lg font-semibold">Jobs</h3>

    <div class="flex items-start gap-3 overflow-x-auto pb-2">
      {#each jobGroups as group, groupIndex (groupIndex)}
        <div class="flex flex-col gap-2">
          {#each group.jobs as job (job.id)}
            {@const variants = resolveVariants(job)}
            {@const status = jobStatus(job)}
            {@const isExpanded = expandedJobId === job.id}
            <button
              class="min-w-[160px] rounded-md border-2 px-3 py-2 text-left transition-all hover:shadow-sm {jobBorderClass(job, isExpanded)}"
              onclick={() => toggleJob(job.id)}>
              <div class="flex items-center gap-2">
                {#if status === 'success'}
                  <Check class="h-3.5 w-3.5 shrink-0 text-green-500" />
                {:else if status === 'failure'}
                  <X class="h-3.5 w-3.5 shrink-0 text-red-500" />
                {:else if status === 'pending'}
                  <Circle class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {/if}
                <span class="truncate text-sm font-medium {isExpanded ? '' : jobTextClass(job)}">{job.name}</span>
              </div>
              {#if job.runsOn}
                <div class="mt-0.5 truncate text-xs text-muted-foreground">{job.runsOn}</div>
              {/if}
              <div class="mt-1 text-xs text-muted-foreground">
                {job.steps.length} step{job.steps.length !== 1 ? 's' : ''}
                {#if variants.length > 0}
                  · {variants.length} variant{variants.length !== 1 ? 's' : ''}
                {/if}
              </div>
            </button>
          {/each}
        </div>

        {#if groupIndex < jobGroups.length - 1}
          <div class="flex items-center self-stretch">
            <div class="flex h-full flex-col justify-center">
              <svg class="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        {/if}
      {/each}
    </div>

    {#if expandedJobId}
      {@const selectedJob = workflowJobs.find(job => job.id === expandedJobId)}
      {@const variants = selectedJob ? resolveVariants(selectedJob) : []}
      {@const singleActJob = selectedJob ? resolveActJob(selectedJob) : undefined}
      {@const activeActJob = variants.length > 0
        ? variants[Math.min(expandedVariantIndex, variants.length - 1)]?.actJob
        : singleActJob}
      {#if selectedJob}
        <div class="mt-4 overflow-hidden rounded-md border border-border">
          <div class="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
            {#if activeActJob?.status === 'success'}
              <Check class="h-4 w-4 text-green-500" />
            {:else if activeActJob?.status === 'failure'}
              <X class="h-4 w-4 text-red-500" />
            {/if}
            <span class="text-sm font-semibold">{selectedJob.name}</span>
            {#if selectedJob.needs.length > 0}
              <span class="ml-auto text-xs text-muted-foreground">needs: {selectedJob.needs.join(', ')}</span>
            {/if}
          </div>

          {#if variants.length > 0}
            <div class="flex flex-wrap gap-1 border-b border-border bg-muted/20 px-3 py-2">
              {#each variants as variant, vi (variant.actJob.name)}
                {@const vStatus = variant.actJob.status}
                <button
                  class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors {expandedVariantIndex === vi ? 'border-blue-500 bg-blue-500/10 text-foreground' : 'border-border bg-background hover:bg-accent/40'}"
                  onclick={() => (expandedVariantIndex = vi)}>
                  {#if vStatus === 'success'}
                    <Check class="h-3 w-3 text-green-500" />
                  {:else if vStatus === 'failure'}
                    <X class="h-3 w-3 text-red-500" />
                  {:else}
                    <Circle class="h-3 w-3 text-muted-foreground" />
                  {/if}
                  <span class="font-mono">{variant.label || variant.actJob.name}</span>
                </button>
              {/each}
            </div>
          {/if}

          <div class="divide-y divide-border">
            {#if activeActJob}
              {#each activeActJob.steps as step, i (i)}
                {@const badgeClass = step.status === 'success'
                  ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                  : step.status === 'failure'
                    ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                    : 'bg-muted text-muted-foreground'}
                <div>
                  <button class="flex w-full items-start gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-accent/50" onclick={() => (expandedStepIndex = expandedStepIndex === i ? null : i)}>
                    <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] {badgeClass}">{i + 1}</span>
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-medium {step.status === 'failure' ? 'text-red-600 dark:text-red-400' : ''}">{displayStepName(step.name)}</div>
                    </div>
                    {#if step.logs.length > 0}
                      {#if expandedStepIndex === i}
                        <ChevronDown class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {:else}
                        <ChevronRight class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {/if}
                    {/if}
                  </button>
                  {#if expandedStepIndex === i && step.logs.length > 0}
                    <div class="whitespace-pre-wrap break-words bg-gray-900 px-4 py-3 font-mono text-xs text-gray-200">
                      {#each step.logs as logLine}
                        <div>{@html ansiToHtml(logLine)}</div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            {:else}
              {#each selectedJob.steps as step, stepIndex}
                <div class="flex items-start gap-3 px-4 py-2 text-sm">
                  <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px] text-muted-foreground">{stepIndex + 1}</span>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium">{step.name}</div>
                    {#if step.uses}
                      <code class="text-xs text-muted-foreground">{step.uses}</code>
                    {:else if step.run}
                      <code class="mt-0.5 block truncate text-xs text-muted-foreground">{step.run.split('\n')[0]}</code>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}
