<script lang="ts">
  import type {Snippet} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {userProfile, pubkey} from "@welshman/app"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import Widget from "@assets/icons/widget.svg?dataurl"
  import Letter from "@assets/icons/letter.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import UserRounded from "@assets/icons/user-rounded.svg?dataurl"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import PrimaryNavItem from "@lib/components/PrimaryNavItem.svelte"
  import MenuSettings from "@app/components/MenuSettings.svelte"
  import {pushModal} from "@app/util/modal"
  import {DEFAULT_COMMUNITY_INPUT} from "@app/core/community-state"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"
  import {notifications} from "@app/util/notifications"
  import Git from "@assets/icons/git.svg?dataurl"
  import SlotRenderer from "@app/extensions/components/SlotRenderer.svelte"
  import {extensionSettings, getWidgetsForLocation} from "@app/extensions/settings"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const currentCommunity = $derived(parseCommunityRouteParam($page.params.community)?.pubkey || "")
  const navCommunity = $derived(currentCommunity || DEFAULT_COMMUNITY_INPUT)
  const communityPath = $derived(navCommunity ? makeCommunityPath(navCommunity) : "/home")

  const openProfile = () => {
    if ($pubkey) pushModal(ProfileDetail, {pubkey: $pubkey})
  }

  const showSettingsMenu = () => pushModal(MenuSettings)

  const openChat = () => goto("/chat")

  const gitNotification = $derived($notifications.has("/git"))

  // Get widgets configured for menu display
  const menuWidgets = $derived.by(() => {
    // Re-run when extensionSettings changes
    const _ = $extensionSettings
    return getWidgetsForLocation("menu-route")
  })
</script>

<div
  class="ml-sai mt-sai mb-sai relative z-nav hidden w-14 flex-shrink-0 bg-base-200 pt-4 md:block">
  <div class="flex h-full flex-col justify-between">
    <div>
      <PrimaryNavItem title="Community" href={communityPath} prefix="/c" class="tooltip-right">
        <ImageIcon alt="Community" src={HomeSmile} class="rounded-full" />
      </PrimaryNavItem>
    </div>
    <div>
      <div class="hidden md:block lg:hidden">
        <PrimaryNavItem title="Profile" onclick={openProfile} class="tooltip-right">
          {#if $userProfile?.picture}
            <img
              alt="Profile"
              src={$userProfile.picture}
              class="h-7 min-h-7 w-7 min-w-7 rounded-full object-cover" />
          {:else}
            <ImageIcon alt="Profile" src={UserRounded} size={7} class="rounded-full" />
          {/if}
        </PrimaryNavItem>
      </div>
      <div class="hidden lg:block">
        <PrimaryNavItem title="Profile" onclick={openProfile} class="tooltip-right">
          {#if $userProfile?.picture}
            <img
              alt="Profile"
              src={$userProfile.picture}
              class="h-7 min-h-7 w-7 min-w-7 rounded-full object-cover" />
          {:else}
            <ImageIcon alt="Profile" src={UserRounded} size={7} class="rounded-full" />
          {/if}
        </PrimaryNavItem>
      </div>
      <PrimaryNavItem
        title="Git"
        href="/git"
        prefix="/git"
        class="tooltip-right"
        notification={gitNotification}>
        <ImageIcon alt="Git" src={Git} size={7} />
      </PrimaryNavItem>
      <PrimaryNavItem
        title="Messages"
        onclick={openChat}
        class="tooltip-right"
        notification={$notifications.has("/chat")}>
        <ImageIcon alt="Messages" src={Letter} size={7} />
      </PrimaryNavItem>
      <PrimaryNavItem title="Search" href="/people" class="tooltip-right">
        <ImageIcon alt="Search" src={Magnifier} size={7} />
      </PrimaryNavItem>
      {#each menuWidgets as widget (widget.identifier)}
        <PrimaryNavItem
          title={widget.content || widget.identifier || "Widget"}
          href="/widgets?id={widget.identifier}"
          prefix="/widgets"
          class="tooltip-right">
          <ImageIcon
            alt={widget.content || "Widget"}
            src={widget.iconUrl || widget.imageUrl || Widget}
            size={7}
            class="rounded-full" />
        </PrimaryNavItem>
      {/each}
      <SlotRenderer slotId="community:sidebar:widgets" context={{urls: []}} />
      <div class="hidden md:block lg:hidden">
        <PrimaryNavItem title="Settings" href="/settings" prefix="/settings" class="tooltip-right">
          <ImageIcon alt="Settings" src={Settings} size={7} />
        </PrimaryNavItem>
      </div>
      <div class="hidden lg:block">
        <PrimaryNavItem
          title="Settings"
          href="/settings/profile"
          prefix="/settings"
          class="tooltip-right">
          <ImageIcon alt="Settings" src={Settings} size={7} />
        </PrimaryNavItem>
      </div>
    </div>
  </div>
</div>

{@render children?.()}

<!-- a little extra something for ios -->
<div
  class="bottom-nav hide-on-keyboard fixed bottom-0 left-0 right-0 z-nav h-[var(--saib)] bg-base-100 md:hidden">
</div>
<div
  class="bottom-nav hide-on-keyboard border-top bottom-sai fixed left-0 right-0 z-nav h-14 border border-base-200 bg-base-100 md:hidden">
  <div class="content-padding-x content-sizing flex items-center gap-1 px-1">
    <PrimaryNavItem compact title="Home" href="/home">
      <ImageIcon alt="Home" src={HomeSmile} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem compact title="Community" href={communityPath} prefix="/c">
      <ImageIcon alt="Community" src={Widget} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem
      compact
      title="Messages"
      onclick={openChat}
      notification={$notifications.has("/chat")}>
      <ImageIcon alt="Messages" src={Letter} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem compact title="Git" href="/git" prefix="/git" notification={gitNotification}>
      <ImageIcon alt="Git" src={Git} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem compact title="Search" href="/people">
      <ImageIcon alt="Search" src={Magnifier} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem compact title="Settings" onclick={showSettingsMenu}>
      <ImageIcon alt="Settings" src={Settings} size={5} />
    </PrimaryNavItem>
  </div>
</div>
