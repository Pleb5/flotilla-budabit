<script lang="ts">
  import {GENERAL, makeChannelId, channelsById} from "@lib/budabit/state"
  const {url, room} = $props()
</script>

{#if room === GENERAL}
  general
{:else}
  {$channelsById.get(makeChannelId(url, room))?.name || room}
{/if}