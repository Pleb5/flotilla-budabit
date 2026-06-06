<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    event: unknown;
    url: string;
    noun: string;
    customActions?: Snippet;
    relays?: string[];
    ownerPubkey?: string;
    showReport?: boolean;
    showModeration?: boolean;
    readOnly?: boolean;
    menuOnly?: boolean;
    class?: string;
  };

  const { customActions }: Props = $props();
</script>

<div class="flex items-center gap-2">
  {#if customActions}
    {@render customActions()}
  {/if}
</div>
