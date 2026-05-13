<script lang="ts">
  import type {CommunityRoomRoot} from "@app/core/community-rooms"

  type Props = {
    url?: string
    h?: string
    room?: CommunityRoomRoot
    class?: string
  }

  const {h, room, ...props}: Props = $props()
</script>

<span class="ellipsize {props.class}">
  {room?.name || h || "Room"}
</span>
