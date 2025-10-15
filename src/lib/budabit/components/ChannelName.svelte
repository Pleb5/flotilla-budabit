<script lang="ts">
  import {GENERAL} from "@lib/budabit/state"
  import {makeChannelId} from "@app/core/state"
  import {channelsById} from "@lib/budabit/state"
  
  const {url, room} = $props()
</script>

{#if room === GENERAL}
  general
{:else}
  {$channelsById.get(makeChannelId(url, room))?.name || room}
{/if}