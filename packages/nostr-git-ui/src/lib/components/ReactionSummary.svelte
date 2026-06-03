<script lang="ts">
  const { event, deleteReaction, createReaction, url, reactionClass, noTooltip, children } =
    $props();
</script>

<div class="flex items-center gap-2">
  {#if children}
    {@render children()}
  {/if}
</div>
