<script lang="ts">
  export let nodeCount: number = 0
  export let roots: string[] = []
  export let rootRevisions: string[] = []
  export let edgesCount: number | undefined
  export let topParents: string[] | undefined
  export let parentOutDegree: Record<string, number> | undefined
  export let parentChildren: Record<string, string[]> | undefined
  export let maxShow: number = 5
  const maxChildIdsInTooltip = 3
</script>

<div class="rounded-md border border-border bg-card p-3 text-xs">
  <div class="mb-1 font-semibold opacity-80">Patch Graph</div>
  <div class="flex flex-wrap gap-x-4 gap-y-1 opacity-80">
    <div>nodes: {nodeCount}</div>
    {#if edgesCount !== undefined}
      <div>edges: {edgesCount}</div>
    {/if}
    {#if roots?.length}
      <div class="flex items-center gap-1">
        <span>roots:</span>
        <div class="flex flex-wrap gap-1">
          {#each roots.slice(0, maxShow) as r (r)}
            <span class="badge badge-ghost badge-sm" title={r}>{r}</span>
          {/each}
          {#if roots.length > maxShow}
            <span>…</span>
          {/if}
        </div>
      </div>
    {/if}
    {#if rootRevisions?.length}
      <div class="flex items-center gap-1">
        <span>root-revisions:</span>
        <div class="flex flex-wrap gap-1">
          {#each rootRevisions.slice(0, maxShow) as r (r)}
            <span class="badge badge-ghost badge-sm" title={r}>{r}</span>
          {/each}
          {#if rootRevisions.length > maxShow}
            <span>…</span>
          {/if}
        </div>
      </div>
    {/if}
    {#if topParents?.length}
      <div class="flex items-center gap-1">
        <span>top parents:</span>
        <div class="flex flex-wrap gap-1">
          {#each topParents.slice(0, maxShow) as r (r)}
            {@const kids = parentChildren?.[r] || []}
            {@const extra = kids.length > maxChildIdsInTooltip ? "…" : ""}
            <span
              class="badge badge-ghost badge-sm"
              title={`${r} · ${parentOutDegree?.[r] ?? 0} children${
                kids.length
                  ? `: ${kids
                      .slice(0, maxChildIdsInTooltip)
                      .map(k => k.slice(0, 8))
                      .join(", ")}${extra}`
                  : ""
              }`}>
              {r}{#if parentOutDegree && parentOutDegree[r] !== undefined}
                ({parentOutDegree[r]}){/if}
            </span>
          {/each}
          {#if topParents.length > maxShow}
            <span>…</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
