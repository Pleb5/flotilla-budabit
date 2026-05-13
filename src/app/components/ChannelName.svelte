<script lang="ts">
  const {room} = $props<{url?: string; room: any}>()

  const name = $derived(typeof room === "string" ? room : room?.name || room?.room || "Room")
</script>

{name}
