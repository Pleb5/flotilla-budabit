<script lang="ts">
  import {browser} from "$app/environment"
  import {goto} from "$app/navigation"

  $effect(() => {
    if (browser) goto("/explore/create-community", {replaceState: true})
  })
</script>

<div class="center h-full w-full p-4 text-sm opacity-70">Opening community setup...</div>
