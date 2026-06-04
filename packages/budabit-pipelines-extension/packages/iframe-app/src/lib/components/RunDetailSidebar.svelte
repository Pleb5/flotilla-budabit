<script lang="ts">
  import {ChevronDown, Copy, ExternalLink, GitBranch, GitCommit, Server} from '@lucide/svelte'
  import {shortId} from '../presentation'
  import {publicLinkForRun} from '../workflows'
  import ReclaimBadge from './ReclaimBadge.svelte'
  import type {WorkflowRun, LoomWorker, ReclaimUiState} from '../types'

  interface Props {
    run: WorkflowRun
    worker: LoomWorker | null | undefined
    prepaidAmount: number | null
    changeAmount: number | null
    actualCost: number | null
    prepaymentFee?: number | null
    changeFee?: number | null
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
    prepaymentFee = 0,
    changeFee = 0,
    reclaim = null,
    copyText,
    onReclaim,
  }: Props = $props()

  const fmt = (n: number | null | undefined, sign: '' | '+' | '−' = '') =>
    n === null || n === undefined ? '—' : `${sign}₿ ${n.toLocaleString()}`

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
        <a
          class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Open event"
          href={publicLinkForRun(run.id)}
          target="_blank"
          rel="noreferrer">
          <ExternalLink class="h-3 w-3" />
        </a>
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
          <a
            class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open profile"
            href={`nostr:${worker.pubkey}`}
            target="_blank"
            rel="noreferrer">
            <ExternalLink class="h-3 w-3" />
          </a>
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
          <span class="font-mono font-semibold">{fmt(actualCost)}</span>
          <ChevronDown class="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div class="mt-3 space-y-1.5">
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">Prepayment</span>
          <span class="font-mono text-red-400">{plain(prepaidAmount, '−')}</span>
        </div>
        <div class="flex items-center justify-between pl-3 text-[11px]">
          <span class="text-muted-foreground/80">Prepayment fees</span>
          <span class="font-mono text-red-400/80">{plain(prepaymentFee ?? 0, '−')}</span>
        </div>

        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">Change</span>
          <span class="font-mono text-green-400">{plain(changeAmount, '+')}</span>
        </div>
        <div class="flex items-center justify-between pl-3 text-[11px]">
          <span class="text-muted-foreground/80">Change fees</span>
          <span class="font-mono text-red-400/80">{plain(changeFee ?? 0, '−')}</span>
        </div>

        <div class="flex items-center justify-between border-t border-border pt-2 text-sm">
          <span class="font-medium">Total cost</span>
          <span class="font-mono font-semibold text-foreground">{fmt(actualCost)}</span>
        </div>
      </div>
    </details>

    {#if reclaim}
      <section class="flex items-center justify-between gap-2 pt-3">
        <span class="text-xs font-semibold text-muted-foreground">
          {reclaim.kind === 'change' ? 'Change' : 'Refund'}
        </span>
        <ReclaimBadge
          status={reclaim.status}
          kind={reclaim.kind}
          amount={reclaim.amount}
          rateLimitUntil={reclaim.rateLimitUntil}
          error={reclaim.error}
          interactive
          onclick={onReclaim} />
      </section>
    {/if}
  </div>
</aside>
