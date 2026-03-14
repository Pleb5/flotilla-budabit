<script lang="ts">
  import {Check, X, Circle, Loader2, AlertCircle, ChevronDown, ChevronRight} from "@lucide/svelte"
  import type {ActJob, WorkflowJob, JobGroup} from "@lib/budabit/cicd"

  interface Props {
    workflowJobs: WorkflowJob[]
    jobGroups: JobGroup[]
    loading: boolean
    error: string | null
    // Act log results for coloring and step details
    actJobByName?: Map<string, ActJob>
  }

  const {workflowJobs, jobGroups, loading, error, actJobByName = new Map()}: Props = $props()

  let expandedJobId = $state<string | null>(null)
  let expandedStepIndex = $state<number | null>(null)

  function toggleJob(id: string) {
    if (expandedJobId === id) {
      expandedJobId = null
      expandedStepIndex = null
    } else {
      expandedJobId = id
      expandedStepIndex = null
    }
  }

  function jobBorderClass(job: WorkflowJob, isExpanded: boolean): string {
    if (isExpanded) return "border-blue-500 bg-blue-500/10"
    const actJob = actJobByName.get(job.name.toLowerCase())
    if (actJob?.status === "success") return "border-green-500 bg-green-500/10"
    if (actJob?.status === "failure") return "border-red-500 bg-red-500/10"
    return "border-border bg-muted/30 hover:bg-muted/50"
  }

  function jobTextClass(job: WorkflowJob): string {
    const actJob = actJobByName.get(job.name.toLowerCase())
    if (actJob?.status === "success") return "text-green-600 dark:text-green-400"
    if (actJob?.status === "failure") return "text-red-600 dark:text-red-400"
    return ""
  }

  // Strip "Main " prefix that act adds to user-defined steps
  function displayStepName(name: string): string {
    return name.startsWith("Main ") ? name.slice(5) : name
  }
</script>

{#if loading}
  <div class="rounded-lg border border-border bg-card p-4">
    <div class="flex items-center gap-2">
      <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
      <span class="text-sm text-muted-foreground">Loading workflow stages...</span>
    </div>
  </div>
{:else if error}
  <div class="rounded-lg border border-border bg-card p-4">
    <div class="flex items-center gap-2 text-sm text-muted-foreground">
      <AlertCircle class="h-4 w-4" />
      <span>{error}</span>
    </div>
  </div>
{:else if jobGroups.length > 0}
  <div class="rounded-lg border border-border bg-card p-4">
    <h3 class="mb-4 text-lg font-semibold">Jobs</h3>

    <!-- Horizontal flow diagram -->
    <div class="flex items-start gap-3 overflow-x-auto pb-2">
      {#each jobGroups as group, groupIndex (groupIndex)}
        <div class="flex flex-col gap-2">
          {#each group.jobs as job (job.id)}
            {@const actJob = actJobByName.get(job.name.toLowerCase())}
            {@const isExpanded = expandedJobId === job.id}
            <button
              class="min-w-[160px] rounded-md border-2 px-3 py-2 text-left transition-all hover:shadow-sm {jobBorderClass(job, isExpanded)}"
              onclick={() => toggleJob(job.id)}>
              <div class="flex items-center gap-2">
                {#if actJob?.status === "success"}
                  <Check class="h-3.5 w-3.5 shrink-0 text-green-500" />
                {:else if actJob?.status === "failure"}
                  <X class="h-3.5 w-3.5 shrink-0 text-red-500" />
                {:else if actJob}
                  <Circle class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {/if}
                <span class="truncate text-sm font-medium {isExpanded ? '' : jobTextClass(job)}">{job.name}</span>
              </div>
              {#if job.runsOn}
                <div class="mt-0.5 truncate text-xs text-muted-foreground">{job.runsOn}</div>
              {/if}
              <div class="mt-1 text-xs text-muted-foreground">
                {job.steps.length} step{job.steps.length !== 1 ? "s" : ""}
              </div>
            </button>
          {/each}
        </div>

        {#if groupIndex < jobGroups.length - 1}
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

    <!-- Expanded job detail -->
    {#if expandedJobId}
      {@const selectedJob = workflowJobs.find(j => j.id === expandedJobId)}
      {@const actJob = selectedJob ? actJobByName.get(selectedJob.name.toLowerCase()) : null}
      {#if selectedJob}
        <div class="mt-4 overflow-hidden rounded-md border border-border">
          <div class="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
            {#if actJob?.status === "success"}
              <Check class="h-4 w-4 text-green-500" />
            {:else if actJob?.status === "failure"}
              <X class="h-4 w-4 text-red-500" />
            {/if}
            <span class="text-sm font-semibold">{selectedJob.name}</span>
            {#if selectedJob.needs.length > 0}
              <span class="ml-auto text-xs text-muted-foreground">
                needs: {selectedJob.needs.join(", ")}
              </span>
            {/if}
          </div>

          <div class="divide-y divide-border">
            {#if actJob}
              <!-- Act log steps: status + expandable logs -->
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
                    <span class="flex-1 font-medium {step.status === 'failure' ? 'text-red-600 dark:text-red-400' : ''}"
                      >{displayStepName(step.name)}</span>
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
            {:else}
              <!-- Fallback: YAML steps (no log data yet) -->
              {#each selectedJob.steps as step, stepIndex}
                <div class="flex items-start gap-3 px-4 py-2 text-sm">
                  <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px] text-muted-foreground">
                    {stepIndex + 1}
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium">{step.name}</div>
                    {#if step.uses}
                      <code class="text-xs text-muted-foreground">{step.uses}</code>
                    {:else if step.run}
                      <code class="mt-0.5 block truncate text-xs text-muted-foreground">{step.run.split("\n")[0]}</code>
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
