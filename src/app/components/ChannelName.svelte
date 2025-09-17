<script lang="ts">
  import {channelsById, makeChannelId, GENERAL} from "@app/core/state"

  const {url, room} = $props()
</script>

{#if room === GENERAL}
  general
{:else}
  {$channelsById.get(makeChannelId(url, room))?.name || room}
{/if}
