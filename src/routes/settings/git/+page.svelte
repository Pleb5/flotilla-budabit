<script lang="ts">
  import GitAuth from "@app/components/GitAuth.svelte"
  import GraspServersPanel from "@app/components/GraspServersPanel.svelte"
</script>

<div class="content column gap-4">
  <GitAuth />

  <div class="card2 bg-alt shadow-xl">
    <GraspServersPanel />
  </div>
</div>
