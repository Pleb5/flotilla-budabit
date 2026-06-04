<script lang="ts">
  import { slide, fade } from "svelte/transition";

  interface Props {
    loading?: boolean;
    minHeight?: string;
    children?: import("svelte").Snippet;
  }

  const { loading = false, minHeight = "min-h-10", children }: Props = $props();
</script>

<span class="flex {minHeight} items-center">
  {#if loading}
    <span class="pr-3" transition:slide|local={{ axis: "x" }}>
      <span class="loading loading-spinner" transition:fade|local={{ duration: 100 }}></span>
    </span>
  {/if}
  {@render children?.()}
</span>
