<script lang="ts">
  type Props = {permissions?: string[]}
  const {permissions = []}: Props = $props()
</script>

{#if permissions.length > 0}
  <div>
    <strong class="text-sm">Permissions</strong>
    <ul class="mt-2 list-inside list-disc text-xs opacity-80">
      {#each permissions as p}
        <li>{p}</li>
      {/each}
    </ul>
  </div>
{/if}
