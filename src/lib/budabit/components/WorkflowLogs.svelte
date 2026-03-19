<script lang="ts">
  import {Check, X, Circle, ChevronDown, ChevronRight, Loader2} from "@lucide/svelte"
  import type {ActJob, JobGroup} from "@lib/budabit/cicd"
  import {groupMatrixJobs, type MatrixGroup} from "@lib/budabit/cicd"

  interface Props {
    parsedActJobs: ActJob[]
    jobGroups?: JobGroup[]
  }

  const {parsedActJobs, jobGroups = []}: Props = $props()

  const flatMatrixGroups = $derived(groupMatrixJobs(parsedActJobs))
  const matrixByBaseName = $derived(new Map(flatMatrixGroups.map(g => [g.baseName.toLowerCase(), g])))

  /**
   * Build display columns using YAML dependency groups for ordering.
   * Each column = one dependency level (parallel jobs stacked vertically).
   * Within each column, YAML jobs are matched to act matrix groups by base name.
   * Falls back to flat matrix grouping if no YAML groups available.
   */
  const displayColumns = $derived.by((): MatrixGroup[][] => {
    if (jobGroups.length === 0) return []

    const used = new Set<string>()
    const columns: MatrixGroup[][] = []

    for (const group of jobGroups) {
      const column: MatrixGroup[] = []
      for (const yamlJob of group.jobs) {
        // Match YAML name to act matrix group base name.
        // YAML: "Build .ipk (${{ matrix.openwrt_arch }})" → strip template → "Build .ipk"
        const yamlBase = yamlJob.name.replace(/\s*\(\$\{\{[^}]*\}\}\)/, "").trim().toLowerCase()

        const mg = matrixByBaseName.get(yamlBase) || matrixByBaseName.get(yamlJob.name.toLowerCase())
        if (mg && !used.has(mg.baseName)) {
          column.push(mg)
          used.add(mg.baseName)
        }
      }
      if (column.length > 0) columns.push(column)
    }

    // Append any unmatched act groups together in one column
    const unmatched: MatrixGroup[] = []
    for (const mg of flatMatrixGroups) {
      if (!used.has(mg.baseName)) {
        unmatched.push(mg)
        used.add(mg.baseName)
      }
    }
    if (unmatched.length > 0) columns.push(unmatched)

    return columns
  })

  let expandedJobName = $state<string | null>(null)
  let expandedStepIndex = $state<number | null>(null)

  const actJobByName = $derived(new Map(parsedActJobs.map(j => [j.name, j])))

  function groupStatus(group: MatrixGroup): ActJob["status"] {
    if (group.variants.some(v => v.actJob.status === "failure")) return "failure"
    if (group.variants.every(v => v.actJob.status === "success")) return "success"
    return "pending"
  }

  function statusBorderClass(status: ActJob["status"], isExpanded: boolean): string {
    if (isExpanded) return "border-blue-500 bg-blue-500/10"
    if (status === "success") return "border-green-500 bg-green-500/10"
    if (status === "failure") return "border-red-500 bg-red-500/10"
    return "border-border bg-muted/30"
  }

  function statusTextClass(status: ActJob["status"]): string {
    if (status === "success") return "text-green-600 dark:text-green-400"
    if (status === "failure") return "text-red-600 dark:text-red-400"
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

  function toggleJob(name: string) {
    if (expandedJobName === name) {
      expandedJobName = null
      expandedStepIndex = null
    } else {
      expandedJobName = name
      expandedStepIndex = null
    }
  }
</script>

<div class="rounded-lg border border-border bg-card p-4">
  <h3 class="mb-4 text-lg font-semibold">Workflow Logs</h3>

  {#if displayColumns.length === 0}
    <p class="text-sm text-muted-foreground">No workflow YAML available for rendering</p>
  {:else}
  <!-- Horizontal flow: each column = one dependency level -->
  <div class="flex items-start gap-3 overflow-x-auto pb-2">
    {#each displayColumns as column, colIndex (colIndex)}
      <!-- Column: parallel jobs stacked vertically -->
      <div class="flex flex-col gap-2">
        {#each column as group (group.baseName)}
          {@const status = groupStatus(group)}
          {#if group.variants.length > 1}
            <!-- Matrix job: card with variant rows -->
            {@const isAnyExpanded = group.variants.some(v => expandedJobName === v.actJob.name)}
            <div class="min-w-[180px] rounded-md border-2 px-3 py-2 transition-all {statusBorderClass(status, isAnyExpanded)}">
              <div class="mb-1.5 text-xs font-semibold text-muted-foreground">{group.baseName}</div>
              <div class="space-y-1">
                {#each group.variants as variant (variant.actJob.name)}
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
            <!-- Single job card -->
            {@const job = group.variants[0].actJob}
            {@const isExpanded = expandedJobName === job.name}
            <button
              class="min-w-[160px] rounded-md border-2 px-3 py-2 text-left transition-all hover:shadow-sm {statusBorderClass(job.status, isExpanded)}"
              onclick={() => toggleJob(job.name)}>
              <div class="flex items-center gap-2">
                {#if job.status === "success"}
                  <Check class="h-3.5 w-3.5 shrink-0 text-green-500" />
                {:else if job.status === "failure"}
                  <X class="h-3.5 w-3.5 shrink-0 text-red-500" />
                {:else}
                  <Circle class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {/if}
                <span class="truncate text-sm font-medium {isExpanded ? '' : statusTextClass(job.status)}">{group.baseName}</span>
              </div>
              <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{job.steps.filter(s => s.status !== "pending").length}/{job.steps.length} steps</span>
                {#if job.durationMs}
                  <span>{formatDuration(job.durationMs)}</span>
                {/if}
              </div>
            </button>
          {/if}
        {/each}
      </div>

      {#if colIndex < displayColumns.length - 1}
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

  <!-- Expanded job: step list with logs -->
  {/if}
  {#if expandedJobName}
    {@const actJob = actJobByName.get(expandedJobName)}
    {#if actJob}
      <div class="mt-4 overflow-hidden rounded-md border border-border">
        <div class="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
          {#if actJob.status === "success"}
            <Check class="h-4 w-4 text-green-500" />
          {:else if actJob.status === "failure"}
            <X class="h-4 w-4 text-red-500" />
          {:else}
            <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
          {/if}
          <span class="font-semibold text-sm">{actJob.name}</span>
          {#if actJob.durationMs}
            <span class="ml-auto text-xs text-muted-foreground">{formatDuration(actJob.durationMs)}</span>
          {/if}
        </div>

        <div class="divide-y divide-border">
          {#each actJob.steps as step, i (i)}
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
  {/if}
</div>
