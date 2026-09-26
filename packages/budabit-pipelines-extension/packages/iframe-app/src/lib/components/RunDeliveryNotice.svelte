<script lang="ts">
  import {runDeliveryState} from '../run-delivery'
  import type {WorkflowRun} from '../types'
  const {run, now = Date.now()}: {run: WorkflowRun; now?: number} = $props()
  const state = $derived(runDeliveryState(run, now))
</script>

{#if state}
  <div role="status" class="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
    <p class="font-semibold">{state === 'missing-job' ? 'No job request seen' : state === 'unacknowledged' ? 'No worker acknowledgement received' : 'Waiting for worker acknowledgement'}</p>
    <p class="text-xs leading-relaxed">
      {#if state === 'missing-job'}
        The run announcement is visible, but its worker job request has not arrived. Submission may be incomplete.
      {:else}
        The job request is visible, but no status or result has arrived from the selected worker.
        {#if state === 'unacknowledged'}This has exceeded the five-minute acknowledgement window.{/if}
        Queueing and execution are unconfirmed. The runtime budget starts when the worker executes the job.
      {/if}
    </p>
    {#if state === 'unacknowledged'}
      <p class="text-xs leading-relaxed">An online advertisement does not confirm delivery. If you prepaid, you can try to reclaim the payment below; only unspent funds can be returned.</p>
    {/if}
  </div>
{/if}
