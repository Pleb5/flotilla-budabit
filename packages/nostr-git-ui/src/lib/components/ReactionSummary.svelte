<script lang="ts">
  type Props = {
    event?: any;
    deleteReaction?: (event: any) => unknown;
    createReaction?: (template: any) => unknown;
    url?: string;
    relays?: string[];
    reactionClass?: string;
    noTooltip?: boolean;
    children?: any;
  };

  const { children }: Props = $props();
</script>

<div class="flex items-center gap-2">
  {#if children}
    {@render children()}
  {/if}
</div>
