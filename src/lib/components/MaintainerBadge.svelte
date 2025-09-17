<script lang="ts">
  export let role: "owner" | "maintainer" | null | undefined
</script>

{#if role}
  <span
    class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]
    ${role === "owner" ? "border-purple-200 bg-purple-50 text-purple-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}
    title={role === "owner" ? "Repository Owner" : "Maintainer"}>
    {role === "owner" ? "Owner" : "Maintainer"}
  </span>
{/if}
