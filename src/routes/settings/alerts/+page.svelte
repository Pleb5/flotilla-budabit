<script lang="ts">
  import {onMount} from "svelte"
  import {goto} from "$app/navigation"
  import BudabitAlerts from "@app/components/BudabitAlerts.svelte"

  onMount(() => {
    if (!__ALERTS__) {
      goto("/settings/content", {replaceState: true})
    }
  })
</script>

{#if __ALERTS__}
  <div class="content column">
    <BudabitAlerts />
  </div>
{/if}
