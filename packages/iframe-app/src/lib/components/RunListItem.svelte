<script lang="ts">
  import {ChevronRight, Clock, GitBranch, GitCommit, RotateCw} from '@lucide/svelte'
  import {formatDuration, formatExactTime, formatTimeAgo, getStatusBadge, getStatusColor, getStatusIcon, shortId} from '../presentation'
  import {statusLabel} from '../workflows'
  import UserDisplay from './UserDisplay.svelte'
  import type {WorkflowRun} from '../types'

  interface Props {
    run: WorkflowRun
    selected?: boolean
    divider?: boolean
    refreshing?: boolean
    onSelect: () => void
  }

  const {run, selected = false, divider = false, refreshing = false, onSelect}: Props = $props()

  const visualOpts = $derived({inferred: run.inferredFailure})
  const StatusIcon = $derived(getStatusIcon(run.status, visualOpts))
  const spinning = $derived(run.status === 'running' || run.status === 'in_progress')
</script>

<button
  class={`group flex w-full items-start gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/40 sm:items-center ${divider ? 'border-t border-border' : ''} ${selected ? 'bg-accent/30' : ''}`}
  onclick={onSelect}>
  <div class={`shrink-0 pt-0.5 sm:pt-0 ${getStatusColor(run.status, visualOpts)}`}>
    {#if spinning}
      <RotateCw class="h-5 w-5 animate-spin" />
    {:else}
      <StatusIcon class="h-5 w-5" />
    {/if}
  </div>

  <div class="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
    <div class="min-w-0 flex-1">
      <div class="truncate text-base font-semibold text-foreground">
        {run.commitMessage || run.name}
      </div>
      <div class="mt-1 flex min-w-0 items-center gap-2 truncate text-xs text-muted-foreground">
        <span class="font-medium text-foreground/80">{run.name}</span>
        {#if run.commit}
          <span>·</span>
          <span class="inline-flex items-center gap-1">
            <GitCommit class="h-3 w-3" />
            <span class="font-mono">{shortId(run.commit, 7)}</span>
          </span>
        {/if}
        {#if run.actor}
          <span>·</span>
          <span class="inline-flex min-w-0 items-center gap-1">
            <span class="shrink-0">triggered by</span>
            <UserDisplay pubkey={run.actor} />
          </span>
        {/if}
        {#if selected && refreshing && spinning}
          <span>·</span>
          <span class="text-sky-300">refreshing…</span>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:flex-nowrap sm:gap-4">
      <span class="inline-flex max-w-[9rem] items-center gap-1 truncate rounded-md border border-border bg-background/60 px-2 py-1 font-medium text-sky-300">
        <GitBranch class="h-3 w-3 shrink-0" />
        <span class="truncate">{run.branch}</span>
      </span>

      <div class="flex flex-col items-start sm:w-24 sm:items-end">
        <div class="flex items-center gap-1" title={formatExactTime(run.createdAt)}>
          <Clock class="h-3 w-3" />
          <span>{formatTimeAgo(run.createdAt)}</span>
          {#if run.duration}
            <span class="sm:hidden">·</span>
            <span class="sm:hidden">{formatDuration(run.duration)}</span>
          {/if}
        </div>
        {#if run.duration}
          <div class="mt-0.5 hidden sm:block">{formatDuration(run.duration)}</div>
        {/if}
      </div>

      <span class={`hidden w-24 shrink-0 items-center justify-center rounded-full border px-2 py-0.5 font-medium md:inline-flex ${getStatusBadge(run.status, visualOpts)}`}>
        {statusLabel(run.status)}
      </span>
    </div>
  </div>

  <div class="shrink-0 pt-0.5 text-muted-foreground transition-colors group-hover:text-foreground sm:pt-0">
    <ChevronRight class="h-5 w-5" />
  </div>
</button>
