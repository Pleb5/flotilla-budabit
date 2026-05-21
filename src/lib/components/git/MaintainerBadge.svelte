<script lang="ts">
  const {
    role
  }: { role: "owner" | "maintainer" | null | undefined } = $props();
</script>

{#if role}
  <span
    class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]
    ${role === "owner" ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700/60" : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700/60"}`}
    title={role === "owner" ? "Repository Owner" : "Maintainer"}
  >
    {role === "owner" ? "Owner" : "Maintainer"}
  </span>
{/if}
