<script lang="ts">
  import type { RepoRelayCheckReport } from "../../utils/repo-creation-preflight.js";
  const { report }: { report: RepoRelayCheckReport } = $props();
</script>

<div class="space-y-2 text-sm">
  <p class="font-medium">Relays checked successfully: {report.checkedRelays.length}</p>
  {#if report.checkedRelays.length}
    <ul class="space-y-1">
      {#each report.checkedRelays as relay}<li class="break-all">✓ {relay}</li>{/each}
    </ul>
  {:else}<p>No relay checks completed successfully.</p>{/if}
  {#if report.failedRelays.length}
    <p role="alert" class="font-semibold text-amber-800 dark:text-amber-300">
      Some relays could not be checked.
    </p>
    <ul class="space-y-1">
      {#each report.failedRelays as failure}<li class="break-words">
          <strong>{failure.relay}</strong>: {failure.error}
        </li>{/each}
    </ul>
    <p>The results are incomplete. You can retry or choose to import anyway.</p>
  {/if}
</div>
