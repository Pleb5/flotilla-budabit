<script lang="ts">
  import {GENERAL, makeChannelId, channelsById} from "@lib/budabit/state"
  
  const {url, room} = $props()
  console.log("url", url)
  console.log("room", room)
</script>

{#if room === GENERAL}
  general
{:else}
  {$channelsById.get(makeChannelId(url, room))?.name || room}
{/if}