<script lang="ts">
  import {ExternalLink, MoreHorizontal} from '@lucide/svelte'
  import type {WorkflowRun, LoomWorker} from '../types'

  interface Props {
    run: WorkflowRun
    worker: LoomWorker | null | undefined
    onCopyRunId: () => void
    onCopyCommit: () => void
  }

  const {run, worker, onCopyRunId, onCopyCommit}: Props = $props()

  let open = $state(false)
  let button: HTMLButtonElement | undefined = $state()
  let panel: HTMLDivElement | undefined = $state()

  const HIVE_CI_BASE = 'https://hive-ci.treegaze.com'
  const LOOM_BASE = 'https://loom.treegaze.com'

  const externalLinks = $derived([
    {
      label: 'Hive CI',
      href: run.runEvent?.id ? `${HIVE_CI_BASE}/run/${run.runEvent.id}` : undefined,
    },
    {
      label: 'Loom (job)',
      href: run.loomJobEvent?.id ? `${LOOM_BASE}/job/${run.loomJobEvent.id}` : undefined,
    },
    {
      label: 'Loom (worker)',
      href: worker?.pubkey ? `${LOOM_BASE}/worker/${worker.pubkey}` : undefined,
    },
  ])

  function onDocumentPointerDown(event: PointerEvent) {
    if (!open) return
    const target = event.target as Node
    if (button?.contains(target)) return
    if (panel?.contains(target)) return
    open = false
  }

  $effect(() => {
    if (!open) return
    document.addEventListener('pointerdown', onDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown)
  })
</script>

<div class="relative">
  <button
    bind:this={button}
    type="button"
    class="rounded-md border border-input bg-background p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
    title="More actions"
    onclick={() => (open = !open)}>
    <MoreHorizontal class="h-4 w-4" />
  </button>

  {#if open}
    <div
      bind:this={panel}
      class="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">

      <div class="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        View externally
      </div>
      {#each externalLinks as link (link.label)}
        {#if link.href}
          <a
            class="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent"
            href={link.href}
            target="_blank"
            rel="noreferrer"
            onclick={() => (open = false)}>
            <span class="truncate">{link.label}</span>
            <ExternalLink class="h-3.5 w-3.5 text-muted-foreground" />
          </a>
        {/if}
      {/each}

      <div class="border-t border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Copy
      </div>
      <button class="flex w-full items-center px-3 py-2 text-sm hover:bg-accent" onclick={() => { onCopyRunId(); open = false }}>
        Run ID
      </button>
      {#if run.commit}
        <button class="flex w-full items-center px-3 py-2 text-sm hover:bg-accent" onclick={() => { onCopyCommit(); open = false }}>
          Commit SHA
        </button>
      {/if}
    </div>
  {/if}
</div>
