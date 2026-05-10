<script lang="ts">
  import {deriveChannel, deriveRoom} from "@app/core/state"

  type Props = {
    url: string
    h: string
    class?: string
  }

  const {url, h, ...props}: Props = $props()

  const room = deriveRoom(url, h)
  const channel = deriveChannel(url, h)
</script>

<span class="ellipsize {props.class}">
  {$channel?.name || $room?.name || h}
</span>
