<script lang="ts">
  import cx from "classnames"
  import Link from "@lib/components/Link.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import type {CommunityRoomRoot} from "@app/core/community-rooms"
  import {makeCommunityRoomPath} from "@app/util/routes"

  type Props = {
    h?: string
    url?: string
    community?: string
    room?: CommunityRoomRoot
    class?: string
    unstyled?: boolean
  }

  const {h, url, community, room, unstyled, ...props}: Props = $props()

  const communityPubkey = $derived(community || room?.communityPubkey || url || "")
  const roomId = $derived(room?.id || h || "")
  const path = $derived(communityPubkey && roomId ? makeCommunityRoomPath(communityPubkey, roomId) : "#")
</script>

<Link href={path} class={cx(props.class, {"link-content bg-alt": !unstyled})}>
  #<RoomName {h} {room} />
</Link>
