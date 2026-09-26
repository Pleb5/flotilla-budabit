<script lang="ts">
  import {eventTagValue} from '../workflows'
  import type {WorkflowRun} from '../types'
  const {run}: {run: WorkflowRun} = $props()
  const workerError = $derived(eventTagValue(run.loomResultEvent, 'error') || run.loomStatusEvent?.content)
</script>

{#if run.status === 'failure' && !run.workflowLogEvent && (run.loomResultEvent || workerError)}
  <div role="alert" class="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
    <p class="font-medium">{workerError || 'The worker reported a failed job.'}</p>
    {#if workerError === 'Pubkey not whitelisted for this worker'}
      <p class="mt-1 text-xs text-muted-foreground">The worker rejected your account before execution. Payment does not grant access. Ask the operator for access or choose another worker.</p>
    {:else}
      <p class="mt-1 text-xs text-muted-foreground">No workflow result was received. This failure was reported by the worker.</p>
    {/if}
  </div>
{/if}
