<script lang="ts">
  import {makeChannelId} from "@app/core/state"
  import {channelsById} from "@lib/budabit/state"
  const {url, room} = $props()
</script>

{$channelsById.get(makeChannelId(url, room))?.name || room}
