<script lang="ts">
  import Lock from "@assets/icons/lock-keyhole.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import SecondaryNavItem from "@lib/components/SecondaryNavItem.svelte"
  import ChannelName from "@app/components/ChannelName.svelte"
  import {makeRoomPath} from "@app/util/routes"
  import {notifications} from "@app/util/notifications"

  interface Props {
    url: any
    room: any
    notify?: boolean
    replaceState?: boolean
    archived?: boolean
  }

  const {url, room, notify = false, replaceState = false, archived = false}: Props = $props()

  const roomId = $derived(typeof room === "string" ? room : room?.id || room?.room || "")
  const path = $derived(makeRoomPath(url, roomId))
  const isClosed = $derived(Boolean(typeof room === "object" && (room.closed || room.private)))
</script>

<SecondaryNavItem
  href={path}
  {replaceState}
  notification={archived ? false : notify ? $notifications.has(path) : false}>
  {#if isClosed}
    <Icon icon={Lock} size={4} />
  {:else}
    <Icon icon={Hashtag} />
  {/if}
  <div class="min-w-0 flex-1 overflow-hidden text-ellipsis">
    <ChannelName {url} {room} />
  </div>
  {#if archived}
    <span class="badge badge-outline badge-xs">Archived</span>
  {/if}
</SecondaryNavItem>
