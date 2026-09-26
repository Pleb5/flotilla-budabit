<script lang="ts">
  import {getContext} from 'svelte'
  import {HOST_ACTIONS, type HostActions} from '../host-actions'
  import {ChevronDown, Copy, ExternalLink, GitBranch, GitCommit, Server} from '@lucide/svelte'
  import {shortId} from '../presentation'
  import {isFreeRun} from '../workflows'
  import ReclaimBadge from './ReclaimBadge.svelte'
  import type {WorkflowRun, LoomWorker, ReclaimUiState} from '../types'

  interface Props {
    run: WorkflowRun
    worker: LoomWorker | null | undefined
    prepaidAmount: number | null
    changeAmount: number | null
    actualCost: number | null
    reclaim?: ReclaimUiState | null
    copyText: (value: string | undefined, label: string) => void | Promise<void>
    onReclaim?: () => void
  }

  const {
    run,
    worker,
    prepaidAmount,
    changeAmount,
    actualCost,
    reclaim = null,
    copyText,
    onReclaim,
  }: Props = $props()
  const hostActions = getContext<HostActions>(HOST_ACTIONS)

  const fmt = (n: number | null | undefined, sign: '' | '+' | '−' = '') =>
    n === null || n === undefined ? '—' : `${sign}${n.toLocaleString()} sats`

  const plain = (n: number | null | undefined, sign: '' | '+' | '−' = '') =>
    n === null || n === undefined ? '—' : `${sign}${n.toLocaleString()}`
</script>

<aside class="min-w-0">
  <div class="divide-y divide-border rounded-lg border border-border bg-card p-3 text-sm">
    <section class="space-y-2 pb-3">
      <div class="flex items-center gap-2">
        <GitBranch class="h-4 w-4 text-muted-foreground" />
        <span class="font-medium">{run.branch || '—'}</span>
      </div>
      {#if run.commit}
        <div class="flex items-center gap-2 text-xs">
          <GitCommit class="h-3.5 w-3.5 text-muted-foreground" />
          <code class="min-w-0 flex-1 truncate font-mono">{shortId(run.commit, 7)}</code>
          <button
            class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Copy commit"
            onclick={() => void copyText(run.commit, 'Commit')}>
            <Copy class="h-3 w-3" />
          </button>
        </div>
      {/if}
      <div class="flex items-center gap-2 text-xs">
        <span class="text-muted-foreground">Run</span>
        <code class="min-w-0 flex-1 truncate font-mono">{shortId(run.id, 7)}</code>
        <button
          class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Copy run ID"
          onclick={() => void copyText(run.id, 'Run ID')}>
          <Copy class="h-3 w-3" />
        </button>
        <button
          class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Open event"
          onclick={() => hostActions.openEvent(run.id)}>
          <ExternalLink class="h-3 w-3" />
        </button>
      </div>
      {#if run.workflowPath}
        <div class="truncate text-xs text-muted-foreground" title={run.workflowPath}>
          {run.workflowPath.split('/').pop() || run.workflowPath}
        </div>
      {/if}
    </section>

    {#if worker}
      <section class="space-y-2 py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Server class="h-3.5 w-3.5" />
            Worker
          </div>
          <span class={`text-xs ${worker.online ? 'text-green-400' : 'text-muted-foreground'}`}>
            {worker.online ? 'online' : 'offline'}
          </span>
        </div>
        <div class="text-sm font-medium">{worker.name}</div>
        <div class="flex items-center gap-1 text-xs">
          <code class="min-w-0 flex-1 truncate font-mono text-muted-foreground">{shortId(worker.pubkey, 12)}</code>
          <button
            class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Copy pubkey"
            onclick={() => void copyText(worker.pubkey, 'Worker pubkey')}>
            <Copy class="h-3 w-3" />
          </button>
          <button
            class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open profile"
            onclick={() => hostActions.openProfile(worker.pubkey)}>
            <ExternalLink class="h-3 w-3" />
          </button>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {#if worker.architecture}<span>{worker.architecture}</span>{/if}
          {#if worker.actVersion}<span>act {worker.actVersion}</span>{/if}
          {#if worker.pricing?.perSecondRate}<span>{worker.pricing.perSecondRate} {worker.pricing.unit || 'sat'}/s</span>{/if}
        </div>
      </section>
    {/if}

    <details class="group pt-3 [&>summary::-webkit-details-marker]:hidden">
      <summary class="flex cursor-pointer select-none list-none items-center justify-between gap-2">
        <span class="text-xs font-semibold text-muted-foreground">Total cost</span>
        <span class="flex items-center gap-2">
          {#if isFreeRun(run)}
            <span class="font-mono font-semibold text-green-400 group-open:hidden">free</span>
          {:else}
            <span class="font-mono font-semibold text-foreground group-open:hidden">{actualCost === null ? 'Unconfirmed' : fmt(actualCost)}</span>
          {/if}
          <ChevronDown class="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div class="mt-3 space-y-1.5">
        {#if actualCost === null && prepaidAmount !== null}
          <p class="pb-2 text-xs text-muted-foreground">Prepayment is a token attached to the request. It does not confirm that the worker received or redeemed it.</p>
        {/if}
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">Prepayment</span>
          <span class="font-mono text-red-400">{plain(prepaidAmount, '−')}</span>
        </div>

        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">Change</span>
          <span class="font-mono text-green-400">{plain(changeAmount, '+')}</span>
        </div>

        <div class="flex items-center justify-between border-t border-border pt-2 text-sm">
          <span class="font-medium">Total cost</span>
          {#if isFreeRun(run)}
            <span class="font-mono font-semibold text-green-400">free</span>
          {:else}
            <span class="font-mono font-semibold text-foreground">{fmt(actualCost)}</span>
          {/if}
        </div>
      </div>
    </details>

    {#if reclaim}
      <section class="flex flex-wrap items-center justify-between gap-2 pt-3">
        <span class="text-xs font-semibold text-muted-foreground">
          {reclaim.kind === 'change' ? 'Change' : 'Refund'}
        </span>
        <ReclaimBadge
          status={reclaim.status}
          kind={reclaim.kind}
          amount={reclaim.amount}
          rateLimitUntil={reclaim.rateLimitUntil}
          error={reclaim.error}
          manualOnly={reclaim.manualOnly}
          interactive
          onclick={onReclaim} />
        {#if reclaim.manualOnly}
          <p class="w-full text-xs text-muted-foreground">Returns the original payment only if it is still unspent. A successful reclaim makes that token unusable by the worker; this does not send a job cancellation.</p>
        {/if}
        {#if reclaim.status === 'failed' && reclaim.error}
          <p class="w-full break-words text-xs text-red-300">{reclaim.error}</p>
        {/if}
      </section>
    {/if}
  </div>
</aside>
