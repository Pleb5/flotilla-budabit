<script lang="ts">
  // Svelte 5 runes: use $props instead of export let
  const { state, kind, reason, badgeRole, className = "" } = $props<{
    state?: "open" | "draft" | "closed" | "merged" | "resolved";
    kind?: number;
    reason?: string;
    badgeRole?: "owner" | "maintainer" | null;
    className?: string;
  }>();

  const kindToState = (k?: number): "open" | "draft" | "closed" | "merged" | "resolved" | undefined => {
    switch (k) {
      case 1630:
        return "open";
      case 1631:
        return "draft";
      case 1632:
        return "closed";
      case 1633:
        return "merged"; // treat complete as merged
      default:
        return undefined;
    }
  };

  const status = $derived(state ?? kindToState(kind));
  const label = $derived.by(() => status ? status.charAt(0).toUpperCase() + status.slice(1) : "Status");
  const chipClass = $derived.by(() => {
    switch (status) {
      case "open":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "draft":
        return "bg-slate-100 text-slate-800 border-slate-200";
      case "merged":
        return "bg-indigo-100 text-indigo-800 border-indigo-200";
      case "closed":
        return "bg-rose-100 text-rose-800 border-rose-200";
      case "resolved":
        return "bg-lime-100 text-lime-800 border-lime-200";
      default:
        return "bg-muted text-foreground/80 border-border";
    }
  });
</script>

<div class={`flex items-center gap-2 ${className}`}>
  <span class={`inline-flex items-center rounded px-2 py-0.5 text-[11px] border ${chipClass}`}>{label}</span>
  {#if badgeRole}
    <span
      class="inline-flex items-center rounded px-2 py-0.5 text-[10px] border border-amber-200 bg-amber-50 text-amber-800"
      title={badgeRole === 'owner' ? 'Owner' : 'Maintainer'}
      >{badgeRole}</span
    >
  {/if}
  {#if reason}
    <div class="text-[10px] opacity-60" title={reason}>ⓘ</div>
  {/if}
</div>
