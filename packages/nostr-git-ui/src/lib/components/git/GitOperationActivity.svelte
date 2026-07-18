<script lang="ts">
  import { Loader2 } from "@lucide/svelte";

  import type { GitOperationActivity } from "../../utils/git-operation-progress.js";
  import { formatGitProgressCount } from "../../utils/git-operation-progress.js";

  interface Props {
    activity?: GitOperationActivity;
  }

  const { activity }: Props = $props();
  let now = $state(Date.now());

  $effect(() => {
    if (!activity) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const count = $derived(activity ? formatGitProgressCount(activity) : undefined);
  const percentage = $derived(
    activity?.current != null && activity?.total != null && activity.total > 0
      ? Math.min(100, Math.max(0, (activity.current / activity.total) * 100))
      : undefined
  );
  const elapsedSeconds = $derived(
    activity ? Math.max(0, Math.floor((now - activity.startedAt) / 1000)) : 0
  );
  const idleSeconds = $derived(
    activity ? Math.max(0, Math.floor((now - activity.updatedAt) / 1000)) : 0
  );

  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  }
</script>

{#if activity}
  <div class="min-w-0 space-y-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
    <div class="flex min-w-0 items-start gap-3">
      <Loader2 class="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-300" />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p class="break-words text-sm font-medium text-blue-100">{activity.phase}</p>
          {#if count}
            <span class="shrink-0 text-xs font-medium text-blue-200">{count}</span>
          {/if}
        </div>
        {#if activity.ref}
          <p class="mt-1 break-all font-mono text-xs text-blue-200/80">{activity.ref}</p>
        {:else if activity.target}
          <p class="mt-1 break-all text-xs text-blue-200/80">{activity.target}</p>
        {/if}
      </div>
    </div>

    {#if percentage != null}
      <div
        class="h-1.5 overflow-hidden rounded-full bg-gray-700"
        aria-label="Git operation progress"
      >
        <div
          class="h-full rounded-full bg-blue-500 transition-[width] duration-200"
          style={`width: ${percentage}%`}
        ></div>
      </div>
    {/if}

    <p class="text-xs text-gray-400">
      Elapsed {formatDuration(elapsedSeconds)}
      {#if idleSeconds > 1}
        · Last activity {formatDuration(idleSeconds)} ago
      {/if}
    </p>
  </div>
{/if}
