<script lang="ts">
  import {Check, X, Circle, ChevronDown, ChevronRight, Loader2} from "@lucide/svelte"
  import type {ActJob, WorkflowJob, JobGroup} from "@lib/budabit/cicd"
  import {groupMatrixJobs} from "@lib/budabit/cicd"

  interface Props {
    parsedActJobs: ActJob[]
    jobGroups: JobGroup[]
    runFinished?: boolean
  }

  const {parsedActJobs, jobGroups, runFinished = false}: Props = $props()

  // Index act results by matrix base name and by full name
  const matrixGroups = $derived(groupMatrixJobs(parsedActJobs))
  const matrixByBaseName = $derived(new Map(matrixGroups.map(g => [g.baseName.toLowerCase(), g])))
  const actJobByName = $derived(new Map(parsedActJobs.map(j => [j.name.toLowerCase(), j])))

  /**
   * For a YAML job, extract the base name for matching against act matrix groups.
   * "Build .ipk (${{ matrix.openwrt_arch }})" → "Build .ipk"
   * "${{ format('Build .ipk ({0})', matrix.openwrt_arch) }}" → "Build .ipk"
   */
  function yamlJobBaseName(name: string): string {
    // Strip ${{ format('Name ({0})', ...) }} patterns
    const formatMatch = name.match(/\$\{\{\s*format\(\s*'([^']+)'\s*,/)
    if (formatMatch) {
      // "Build .ipk ({0})" → "Build .ipk"
      return formatMatch[1].replace(/\s*\(\{0\}\)/, "").trim()
    }
    // Strip ${{ ... }} suffix
    return name.replace(/\s*\$\{\{[^}]*\}\}/, "").replace(/\s*\([^)]*\$\{\{[^}]*\}\}[^)]*\)/, "").trim()
  }

  function isMatrixJob(job: WorkflowJob): boolean {
    return job.name.includes("${{")
  }

  /** Find act results for a YAML job */
  function findActResults(job: WorkflowJob): {isMatrix: boolean; variants: {label: string; actJob: ActJob}[]; singleJob: ActJob | null} {
    if (isMatrixJob(job)) {
      const base = yamlJobBaseName(job.name).toLowerCase()
      const mg = matrixByBaseName.get(base)
      if (mg) return {isMatrix: true, variants: mg.variants, singleJob: null}
      return {isMatrix: true, variants: [], singleJob: null}
    }
    // Non-matrix: match by name or job id
    const actJob = actJobByName.get(job.name.toLowerCase()) || actJobByName.get(job.id.toLowerCase())
    return {isMatrix: false, variants: [], singleJob: actJob || null}
  }

  function jobStatus(job: WorkflowJob): string {
    const results = findActResults(job)
    if (results.isMatrix) {
      if (results.variants.length === 0) return runFinished ? "skipped" : "pending"
      if (results.variants.some(v => v.actJob.status === "failure")) return "failure"
      if (results.variants.every(v => v.actJob.status === "success")) return "success"
      return "pending"
    }
    if (!results.singleJob) return runFinished ? "skipped" : "pending"
    return results.singleJob.status
  }

  function statusBorderClass(status: string, isExpanded: boolean): string {
    if (isExpanded) return "border-blue-500 bg-blue-500/10"
    if (status === "success") return "border-green-500 bg-green-500/10"
    if (status === "failure") return "border-red-500 bg-red-500/10"
    return "border-border bg-muted/30"
  }

  function statusTextClass(status: string): string {
    if (status === "success") return "text-green-600 dark:text-green-400"
    if (status === "failure") return "text-red-600 dark:text-red-400"
    if (status === "skipped") return "text-muted-foreground"
    return ""
  }

  function formatDuration(ms?: number): string {
    if (!ms) return ""
    const totalSeconds = Math.round(ms / 1000)
    if (totalSeconds < 1) return "<1s"
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    if (mins === 0) return `${secs}s`
    return `${mins}m ${secs}s`
  }

  function displayStepName(name: string): string {
    let cleaned = name
    if (cleaned.startsWith("Main ")) cleaned = cleaned.slice(5)
    else if (cleaned.startsWith("Pre ")) cleaned = cleaned.slice(4)
    else if (cleaned.startsWith("Post ")) cleaned = cleaned.slice(5)
    const newline = cleaned.indexOf("\n")
    if (newline !== -1) cleaned = cleaned.slice(0, newline)
    return cleaned.trim()
  }

  // Track expanded act job (by full act job name)
  let expandedJobName = $state<string | null>(null)
  let expandedStepIndex = $state<number | null>(null)

  function toggleJob(name: string) {
    if (expandedJobName === name) {
      expandedJobName = null
      expandedStepIndex = null
    } else {
      expandedJobName = name
      expandedStepIndex = null
    }
  }

  const expandedActJob = $derived(expandedJobName ? (actJobByName.get(expandedJobName.toLowerCase()) ?? null) : null)
</script>

<div class="rounded-lg border border-border bg-card p-4">
  <h3 class="mb-4 text-lg font-semibold">Workflow Logs</h3>

  {#if jobGroups.length === 0}
    <p class="text-sm text-muted-foreground">No workflow YAML available for rendering</p>
  {:else}
    <!-- Horizontal flow: each jobGroup = one dependency level (column) -->
    <div class="flex items-start gap-3 overflow-x-auto pb-2">
      {#each jobGroups as group, colIndex (colIndex)}
        <!-- Column: parallel jobs stacked vertically -->
        <div class="flex flex-col gap-2">
          {#each group.jobs as job (job.id)}
            {@const results = findActResults(job)}
            {@const status = jobStatus(job)}
            {#if results.isMatrix && results.variants.length > 0}
              <!-- Matrix job: card with variant rows -->
              {@const isAnyExpanded = results.variants.some(v => expandedJobName === v.actJob.name)}
              <div class="min-w-[180px] rounded-md border-2 px-3 py-2 transition-all {statusBorderClass(status, isAnyExpanded)}">
                <div class="mb-1.5 text-xs font-semibold text-muted-foreground">{yamlJobBaseName(job.name)}</div>
                <div class="space-y-1">
                  {#each results.variants as variant (variant.actJob.name)}
                    {@const v = variant.actJob}
                    <button
                      class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-accent/50 {expandedJobName === v.name ? 'bg-accent/50' : ''}"
                      onclick={() => toggleJob(v.name)}>
                      {#if v.status === "success"}
                        <Check class="h-3.5 w-3.5 shrink-0 text-green-500" />
                      {:else if v.status === "failure"}
                        <X class="h-3.5 w-3.5 shrink-0 text-red-500" />
                      {:else}
                        <Circle class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {/if}
                      <span class="truncate text-sm font-medium {statusTextClass(v.status)}">{variant.label}</span>
                      {#if v.durationMs}
                        <span class="ml-auto shrink-0 text-xs text-muted-foreground">{formatDuration(v.durationMs)}</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
            {:else}
              <!-- Single job card (or matrix with no results yet) -->
              {@const singleJob = results.singleJob}
              {@const isExpanded = singleJob ? expandedJobName === singleJob.name : false}
              <button
                class="min-w-[160px] rounded-md border-2 px-3 py-2 text-left transition-all hover:shadow-sm {statusBorderClass(status, isExpanded)}"
                onclick={() => { if (singleJob) toggleJob(singleJob.name) }}>
                <div class="flex items-center gap-2">
                  {#if status === "success"}
                    <Check class="h-3.5 w-3.5 shrink-0 text-green-500" />
                  {:else if status === "failure"}
                    <X class="h-3.5 w-3.5 shrink-0 text-red-500" />
                  {:else}
                    <Circle class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {/if}
                  <span class="truncate text-sm font-medium {statusTextClass(status)}">
                    {isMatrixJob(job) ? yamlJobBaseName(job.name) : job.name}
                  </span>
                </div>
                <div class="mt-1 text-xs text-muted-foreground">
                  {#if status === "skipped"}
                    Skipped
                  {:else if singleJob}
                    {singleJob.steps.filter(s => s.status !== "pending").length}/{singleJob.steps.length} steps
                    {#if singleJob.durationMs}
                      <span class="ml-2">{formatDuration(singleJob.durationMs)}</span>
                    {/if}
                  {:else}
                    Pending
                  {/if}
                </div>
              </button>
            {/if}
          {/each}
        </div>

        {#if colIndex < jobGroups.length - 1}
          <div class="flex items-center self-stretch">
            <div class="flex flex-col justify-center h-full">
              <svg class="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Expanded job: step list with logs -->
  {#if expandedActJob}
    <div class="mt-4 overflow-hidden rounded-md border border-border">
      <div class="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
        {#if expandedActJob.status === "success"}
          <Check class="h-4 w-4 text-green-500" />
        {:else if expandedActJob.status === "failure"}
          <X class="h-4 w-4 text-red-500" />
        {:else}
          <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
        {/if}
        <span class="font-semibold text-sm">{expandedActJob.name}</span>
        {#if expandedActJob.durationMs}
          <span class="ml-auto text-xs text-muted-foreground">{formatDuration(expandedActJob.durationMs)}</span>
        {/if}
      </div>

      <div class="divide-y divide-border">
        {#each expandedActJob.steps as step, i (i)}
          <div>
            <button
              class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-accent/50"
              onclick={() => (expandedStepIndex = expandedStepIndex === i ? null : i)}>
              <span class="shrink-0">
                {#if step.status === "success"}
                  <Check class="h-3.5 w-3.5 text-green-500" />
                {:else if step.status === "failure"}
                  <X class="h-3.5 w-3.5 text-red-500" />
                {:else}
                  <Circle class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </span>
              <span class="flex-1 truncate font-medium {step.status === 'failure' ? 'text-red-600 dark:text-red-400' : ''}"
                >{displayStepName(step.name)}</span>
              {#if step.durationMs}
                <span class="shrink-0 text-xs text-muted-foreground">{formatDuration(step.durationMs)}</span>
              {/if}
              {#if step.logs.length > 0}
                {#if expandedStepIndex === i}
                  <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {:else}
                  <ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {/if}
              {/if}
            </button>

            {#if expandedStepIndex === i && step.logs.length > 0}
              <div class="bg-gray-900 px-4 py-3 font-mono text-xs">
                {#each step.logs as logLine}
                  <div class="text-gray-200">{logLine}</div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
