<script lang="ts">
  import {Check, X, Circle, ChevronDown, ChevronRight, Loader2} from "@lucide/svelte"
  import type {ActJob, WorkflowJob, JobGroup} from "@lib/budabit/cicd"

  interface Props {
    parsedActJobs: ActJob[]
    // Optional: YAML-parsed jobs for dependency grouping/ordering
    jobGroups?: JobGroup[]
  }

  const {parsedActJobs, jobGroups = []}: Props = $props()

  let expandedJobName = $state<string | null>(null)
  let expandedStepIndex = $state<number | null>(null)

  const actJobByName = $derived(new Map(parsedActJobs.map(j => [j.name.toLowerCase(), j])))

  // Use YAML job groups for ordering/layout if available, otherwise show act jobs flat
  const displayGroups = $derived.by((): {jobs: {name: string; actJob: ActJob}[]}[] => {
    if (jobGroups.length > 0) {
      return jobGroups
        .map(group => ({
          jobs: group.jobs
            .map(j => ({name: j.name, actJob: actJobByName.get(j.name.toLowerCase())!}))
            .filter(j => j.actJob),
        }))
        .filter(g => g.jobs.length > 0)
    }
    return parsedActJobs.map(j => ({jobs: [{name: j.name, actJob: j}]}))
  })

  function jobBorderClass(status: ActJob["status"]): string {
    if (status === "success") return "border-green-500 bg-green-500/10"
    if (status === "failure") return "border-red-500 bg-red-500/10"
    return "border-border bg-muted/30"
  }

  function jobTextClass(status: ActJob["status"]): string {
    if (status === "success") return "text-green-600 dark:text-green-400"
    if (status === "failure") return "text-red-600 dark:text-red-400"
    return "text-foreground"
  }

  // Strip "Main " prefix that act adds to user-defined steps
  function displayStepName(name: string): string {
    return name.startsWith("Main ") ? name.slice(5) : name
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

  <!-- Horizontal flow -->
  <div class="flex items-start gap-3 overflow-x-auto pb-2">
    {#each displayGroups as group, groupIndex (groupIndex)}
      <div class="flex flex-col gap-2">
        {#each group.jobs as {name, actJob} (name)}
          <button
            class="min-w-[160px] rounded-md border-2 px-3 py-2 text-left transition-all hover:shadow-sm {jobBorderClass(actJob.status)} {expandedJobName === name ? 'shadow-sm' : ''}"
            onclick={() => toggleJob(name)}>
            <div class="flex items-center gap-2">
              {#if actJob.status === "success"}
                <Check class="h-3.5 w-3.5 shrink-0 text-green-500" />
              {:else if actJob.status === "failure"}
                <X class="h-3.5 w-3.5 shrink-0 text-red-500" />
              {:else}
                <Circle class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {/if}
              <span class="truncate text-sm font-medium {jobTextClass(actJob.status)}">{name}</span>
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              {actJob.steps.filter(s => s.status !== "pending").length}/{actJob.steps.length} steps
            </div>
          </button>
        {/each}
      </div>

      {#if groupIndex < displayGroups.length - 1}
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
  {#if expandedJobName}
    {@const actJob = actJobByName.get(expandedJobName.toLowerCase())}
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
          <span class="font-semibold text-sm">{expandedJobName}</span>
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
        </div>
      </div>
    {/if}
  {/if}
</div>
