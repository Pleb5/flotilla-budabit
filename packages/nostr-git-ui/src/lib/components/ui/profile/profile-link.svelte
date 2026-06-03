<script lang="ts">
  let { pubkey }: { pubkey?: string } = $props();
</script>

<div>
  {pubkey ? pubkey.substring(0, 9) : ""}
</div>
