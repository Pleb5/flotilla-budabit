<script lang="ts">
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import NotificationDot from "@lib/components/NotificationDot.svelte"
  import SpaceMenu from "@app/components/SpaceMenu.svelte"
  import {notifications} from "@app/util/notifications"
  import {makeExactCommunityPath, parseExactCommunityRouteParam} from "@app/util/routes"
  import {pushDrawer} from "@app/util/modal"

  const {url} = $props()

  const community = $derived(parseExactCommunityRouteParam(url))
  const path = $derived(community ? makeExactCommunityPath(community) : "/explore")

  const openMenu = () => pushDrawer(SpaceMenu, {url})
</script>

<Button
  aria-label="Open space menu"
  onclick={openMenu}
  class="btn btn-neutral btn-sm relative lg:hidden">
  <Icon icon={MenuDots} />
  {#if $notifications.has(path)}
    <NotificationDot class="absolute right-1 top-1" />
  {/if}
</Button>
