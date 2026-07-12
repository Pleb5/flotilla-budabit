<script lang="ts">
  import {onMount} from "svelte"
  import {goto} from "$app/navigation"

  onMount(() => {
    if (window.location.pathname === "/") goto("/home", {replaceState: true})
  })
</script>
