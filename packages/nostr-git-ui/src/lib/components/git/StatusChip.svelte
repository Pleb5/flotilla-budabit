<script lang="ts">

const {
  state,
  kind,
  reason
} = $props<{ state?: "open" | "draft" | "closed" | "merged" | "resolved" | undefined; kind?: number; reason?: string }>()

  const mapKindToState = (
    k?: number,
  ): "open" | "draft" | "closed" | "merged" | "resolved" | undefined => {
    if (k === 1630) return "open"
    if (k === 1633) return "draft"
    if (k === 1632) return "closed"
    if (k === 1631) return "merged"
    return undefined
  }

  const eff = state ?? mapKindToState(kind) ?? "open"
  const label =
    eff === "open"
      ? "Open"
      : eff === "draft"
        ? "Draft"
        : eff === "closed"
          ? "Closed"
          : eff === "merged"
            ? "Merged"
            : "Resolved"
  const cls =
    eff === "open"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : eff === "draft"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : eff === "closed"
          ? "bg-rose-50 text-rose-700 border-rose-200"
          : eff === "merged"
            ? "bg-indigo-50 text-indigo-700 border-indigo-200"
            : "bg-sky-50 text-sky-700 border-sky-200"
</script>

<span
  class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${cls}`}
  title={reason}>{label}</span>
