<script lang="ts">
  import Icon from "@lib/components/Icon.svelte"
  import SecondaryNavItem from "@lib/components/SecondaryNavItem.svelte"
  import ChannelName from "@app/components/ChannelName.svelte"
  import {makeRoomPath} from "@app/routes"
  import {deriveChannel} from "@app/state"
  import {notifications} from "@app/notifications"

  interface Props {
    url: any
    room: any
    notify?: boolean
    replaceState?: boolean
  }

  const {url, room, notify = false, replaceState = false}: Props = $props()

  const path = makeRoomPath(url, room)
  const channel = deriveChannel(url, room)

</script>

<SecondaryNavItem
  href={path}
  {replaceState}
  notification={notify ? $notifications.has(path) : false}>
  {#if $channel?.closed || $channel?.private}
    <Icon icon="lock" size={4} />
  {:else}
    <Icon icon="hashtag" />
  {/if}
  <div class="min-w-0 overflow-hidden text-ellipsis">
    <ChannelName {url} {room} />
  </div>
</SecondaryNavItem>
