<script lang="ts">
  import SecondaryNavItem from "@lib/components/SecondaryNavItem.svelte"
  import RoomNameWithImage from "@app/components/RoomNameWithImage.svelte"
  import {makeRoomPath} from "@app/util/routes"
  import {notifications} from "@app/util/notifications"


  interface Props {
    url: any
    h: any
    notify?: boolean
    replaceState?: boolean
    archived?: boolean
  }

  const {url, h, notify = false, replaceState = false, archived = false}: Props = $props()

  const path = makeRoomPath(url, h)
</script>

<SecondaryNavItem
  href={path}
  {replaceState}
  notification={archived ? false : notify ? $notifications.has(path) : false}>
  <div class="flex min-w-0 flex-1 items-center gap-2">
    <RoomNameWithImage {url} {h} class="min-w-0 flex-1" />
    {#if archived}
      <span class="badge badge-outline badge-xs">Archived</span>
    {/if}
  </div>
</SecondaryNavItem>
