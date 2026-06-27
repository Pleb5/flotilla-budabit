<script lang="ts">
  import type {Snippet} from "svelte"
  import {goto} from "$app/navigation"
  import {pubkey} from "@welshman/app"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import Letter from "@assets/icons/letter.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Compass from "@assets/icons/compass.svg?dataurl"
  import Home from "@assets/icons/home.svg?dataurl"
  import UserRounded from "@assets/icons/user-rounded.svg?dataurl"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import PrimaryNavItem from "@lib/components/PrimaryNavItem.svelte"
  import MenuSettings from "@app/components/MenuSettings.svelte"
  import {pushModal} from "@app/util/modal"
  import {notifications} from "@app/util/notifications"
  import {hasGitNotification} from "@app/util/repo-watch-notifications"
  import Git from "@assets/icons/git.svg?dataurl"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const showSettingsMenu = () => pushModal(MenuSettings)

  const openChat = () => {
    if ($pubkey) goto("/chat")
    else pushModal(LogIn)
  }

  const gitNotification = $derived(hasGitNotification($notifications))
</script>

<div
  class="ml-sai mt-sai mb-sai relative z-nav hidden w-14 flex-shrink-0 bg-base-200 pt-4 md:block">
  <div class="flex h-full flex-col justify-between">
    <div>
      <PrimaryNavItem title="Home" href="/home" prefix="/c" class="tooltip-right">
        <ImageIcon alt="Home" src={Home} size={7} />
      </PrimaryNavItem>
      <PrimaryNavItem title="Explore" href="/explore" prefix="/explore" class="tooltip-right">
        <ImageIcon alt="Explore" src={Compass} size={7} />
      </PrimaryNavItem>
    </div>
    <div>
      <PrimaryNavItem
        title="Messages"
        onclick={openChat}
        class="tooltip-right"
        notification={$notifications.has("/chat")}>
        <ImageIcon alt="Messages" src={Letter} size={7} />
      </PrimaryNavItem>
      <PrimaryNavItem
        title="Git"
        href="/git"
        prefix="/git"
        class="tooltip-right"
        notification={gitNotification}>
        <ImageIcon alt="Git" src={Git} size={7} />
      </PrimaryNavItem>
      <PrimaryNavItem title="Search" href="/people" class="tooltip-right">
        <ImageIcon alt="Search" src={Magnifier} size={7} />
      </PrimaryNavItem>
      <div class="hidden md:block lg:hidden">
        <PrimaryNavItem
          title="Settings"
          onclick={showSettingsMenu}
          prefix="/settings"
          class="tooltip-right">
          {#if $pubkey}
            <ProfileCircle pubkey={$pubkey} size={7} />
          {:else}
            <ImageIcon alt="Settings" src={UserRounded} size={7} class="rounded-full" />
          {/if}
        </PrimaryNavItem>
      </div>
      <div class="hidden lg:block">
        <PrimaryNavItem
          title="Settings"
          onclick={showSettingsMenu}
          prefix="/settings"
          class="tooltip-right">
          {#if $pubkey}
            <ProfileCircle pubkey={$pubkey} size={7} />
          {:else}
            <ImageIcon alt="Settings" src={UserRounded} size={7} class="rounded-full" />
          {/if}
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
    <PrimaryNavItem compact title="Home" href="/home" prefix="/c">
      <ImageIcon alt="Home" src={Home} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem compact title="Explore" href="/explore" prefix="/explore">
      <ImageIcon alt="Explore" src={Compass} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem compact title="Git" href="/git" prefix="/git" notification={gitNotification}>
      <ImageIcon alt="Git" src={Git} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem
      compact
      title="Messages"
      onclick={openChat}
      notification={$notifications.has("/chat")}>
      <ImageIcon alt="Messages" src={Letter} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem compact title="Search" href="/people">
      <ImageIcon alt="Search" src={Magnifier} size={5} />
    </PrimaryNavItem>
    <PrimaryNavItem compact title="Settings" onclick={showSettingsMenu}>
      {#if $pubkey}
        <ProfileCircle pubkey={$pubkey} size={5} />
      {:else}
        <ImageIcon alt="Settings" src={UserRounded} size={5} class="rounded-full" />
      {/if}
    </PrimaryNavItem>
  </div>
</div>
