<script lang="ts">
  import type { Component } from "svelte";

  type Props = {
    Spinner: Component;
  };

  let { Spinner, loading = false, nevent = null, permalink = null, error = null } = $props();

  function shortNevent(nevent: string): string {
    return nevent.replace(/^nostr:/, "").slice(0, 16) + (nevent.length > 16 ? "…" : "");
  }
</script>

<div class="permalink-node">
  {#if loading}
    <Spinner loading={loading}>
      {#if loading}
        Loading event for: {permalink}
      {/if}
    </Spinner>
  {:else if error}
    <span class="text-red-500">{error}</span>
  {:else if nevent}
    <span class="font-mono">{shortNevent(nevent)}</span>
  {:else}
    (No link?)
  {/if}
</div>
