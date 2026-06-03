<script lang="ts">
  import { Badge } from "../ui/badge";
  import { 
    AlertTriangle,
    GitBranch, 
    Activity, 
    XOctagon 
  } from "@lucide/svelte";

  const {
    hasGraspDelay = false,
    headChanged = false,
    relayHealth = "ok",
    healthTip = ""
  }: {
    hasGraspDelay?: boolean;
    headChanged?: boolean;
    relayHealth?: "ok" | "restricted" | "down";
    healthTip?: string;
  } = $props();
</script>

<div class="flex items-center gap-2">
  {#if headChanged}
    <Badge title="HEAD changed in this session" class="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/60">
      <GitBranch class="h-3 w-3 mr-1" /> HEAD switched
    </Badge>
  {/if}
  {#if hasGraspDelay}
    <Badge title="GRASP push delay is enabled" class="bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-700/60">
      <AlertTriangle class="h-3 w-3 mr-1" /> GRASP delay
    </Badge>
  {/if}
  {#if relayHealth !== 'ok'}
    {#if relayHealth === 'restricted'}
      <Badge title={healthTip || 'Relay access restricted'} class="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/60">
        <Activity class="h-3 w-3 mr-1" /> Relay restricted
      </Badge>
    {:else}
      <Badge title={healthTip || 'Relay unavailable'} class="bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700/60">
        <XOctagon class="h-3 w-3 mr-1" /> Relay down
      </Badge>
    {/if}
  {/if}
</div>
