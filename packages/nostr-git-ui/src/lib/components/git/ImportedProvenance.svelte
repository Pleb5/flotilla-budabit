<script lang="ts">
  import { getImportProvenance } from "../../utils/import-provenance.js";
  const { event }: { event?: { tags: string[][] } } = $props();
  const source = $derived(getImportProvenance(event));
</script>

{#if source}
  <p class="my-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
    Imported GitHub attribution: <strong>{source.author}</strong>{#if source.date}
      · {source.date}{/if} ·
    <a class="underline" href={source.url} target="_blank" rel="noopener noreferrer"
      >Original source</a
    >. The Nostr signature belongs to the importer, not the original GitHub author.
  </p>
{/if}
