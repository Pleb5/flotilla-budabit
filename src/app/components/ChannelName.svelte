<script lang="ts">
  import {channelsById, makeChannelId, GENERAL} from "@app/state"

  const {url, room} = $props()
</script>

{#if room === GENERAL}
  general
{:else}
  {$channelsById.get(makeChannelId(url, room))?.name || room}
{/if}
