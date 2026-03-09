<script lang="ts">
  import type {Snippet} from "svelte"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {splitAt} from "@welshman/lib"
  import {userProfile, shouldUnwrap} from "@welshman/app"
  import Widget from "@assets/icons/widget.svg?dataurl"
  import Compass from "@assets/icons/compass.svg?dataurl"
  import Letter from "@assets/icons/letter.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import SettingsMinimalistic from "@assets/icons/settings-minimalistic.svg?dataurl"
  import UserRounded from "@assets/icons/user-rounded.svg?dataurl"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import ImageIcon from "@lib/components/ImageIcon.svelte"
  import Divider from "@lib/components/Divider.svelte"
  import PrimaryNavItem from "@lib/components/PrimaryNavItem.svelte"
  import ChatEnable from "@lib/budabit/components/ChatEnable.svelte"
  import MenuOtherSpaces from "@app/components/MenuOtherSpaces.svelte"
  import MenuSettings from "@app/components/MenuSettings.svelte"
  import PrimaryNavItemSpace from "@app/components/PrimaryNavItemSpace.svelte"
  import RelayIcon from "@app/components/RelayIcon.svelte"
  import {userSpaceUrls, PLATFORM_RELAYS, PLATFORM_LOGO, decodeRelay} from "@app/core/state"
  import {pushModal} from "@app/util/modal"
  import {makeSpacePath} from "@app/util/routes"
  import {notifications} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"
  import Git from "@assets/icons/git.svg?dataurl"
  import SlotRenderer from "@app/extensions/components/SlotRenderer.svelte"
  import {extensionSettings, getWidgetsForLocation} from "@app/extensions/settings"
  import type {SmartWidgetEvent} from "@app/extensions/types"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const spaceUrls = $derived($userSpaceUrls)

  const showOtherSpacesMenu = () => pushModal(MenuOtherSpaces, {urls: secondarySpaceUrls})

  const showSettingsMenu = () => pushModal(MenuSettings)

  const openChat = () => ($shouldUnwrap ? goto("/chat") : pushModal(ChatEnable, {next: "/chat"}))

  const gitNavErrorMessage = "Could not find platform relays cannot navigate to git path"
  let gitNavErrorToastId: string | null = null
  let gitNavErrorToastTimeout: ReturnType<typeof setTimeout> | null = null

  const showGitNavError = () => {
    if (gitNavErrorToastId) return
    const timeout = 5000
    gitNavErrorToastId = pushToast({
      message: gitNavErrorMessage,
      theme: "error",
      timeout,
    })
    if (gitNavErrorToastTimeout) clearTimeout(gitNavErrorToastTimeout)
    gitNavErrorToastTimeout = setTimeout(() => {
      gitNavErrorToastId = null
      gitNavErrorToastTimeout = null
    }, timeout)
  }

  const openGit = () => {
    const platformUrl = PLATFORM_RELAYS[0] || PLATFORM_RELAYS.find(Boolean)

    if (platformUrl) {
      goto(makeSpacePath(platformUrl, "git"))
      return
    }

    showGitNavError()
    goto("/home")
  }

  const hasNotification = (url: string) => {
    const path = makeSpacePath(url)

    return !$page.url.pathname.startsWith(path) && $notifications.has(path)
  }

  const gitNotification = $derived(
    (() => {
      const currentRelay = $page.params.relay
      if (currentRelay) {
        const url = decodeRelay(currentRelay)
        const gitPath = makeSpacePath(url, "git")
        return $notifications.has(gitPath)
      }
      const urls = spaceUrls.length > 0 ? spaceUrls : PLATFORM_RELAYS
      return urls.some((url: string) => {
        const gitPath = makeSpacePath(url, "git")
        return $notifications.has(gitPath)
      })
    })(),
  )

  let windowHeight = $state(0)

  const itemHeight = 56
  const navPadding = 6 * itemHeight
  const itemLimit = $derived((windowHeight - navPadding) / itemHeight)
  const [primarySpaceUrls, secondarySpaceUrls] = $derived(splitAt(itemLimit, $userSpaceUrls))
  const anySpaceNotifications = $derived($userSpaceUrls.some(hasNotification))
  const otherSpaceNotifications = $derived(secondarySpaceUrls.some(hasNotification))

  // Get widgets configured for menu display
  const menuWidgets = $derived.by(() => {
    // Re-run when extensionSettings changes
    const _ = $extensionSettings
    return getWidgetsForLocation("menu-route")
  })
</script>

<svelte:window bind:innerHeight={windowHeight} />

<div
  class="ml-sai mt-sai mb-sai relative z-nav hidden w-14 flex-shrink-0 bg-base-200 pt-4 md:block">
  <div class="flex h-full flex-col" class:justify-between={PLATFORM_RELAYS.length === 0}>
    <div>
      {#each PLATFORM_RELAYS as url, i (url)}
        {#if i === 0}
          <PrimaryNavItem
            title="Home"
            href="/home"
            class="tooltip-right"
            notification={$notifications.has(makeSpacePath(url))}>
            <RelayIcon {url} size={7} class="rounded-full" />
          </PrimaryNavItem>
        {:else}
          <PrimaryNavItemSpace {url} />
        {/if}
      {:else}
        <PrimaryNavItem title="Home" href="/home" class="tooltip-right">
          <ImageIcon alt="Home" src={PLATFORM_LOGO} class="rounded-full" />
        </PrimaryNavItem>
        <Divider />
        {#each primarySpaceUrls as url (url)}
          <PrimaryNavItemSpace {url} />
        {/each}
        {#if secondarySpaceUrls.length > 0}
          <PrimaryNavItem
            title="Other Spaces"
            class="tooltip-right"
            onclick={showOtherSpacesMenu}
            notification={otherSpaceNotifications}>
            <ImageIcon alt="Other Spaces" src={Widget} />
          </PrimaryNavItem>
        {/if}
        <PrimaryNavItem title="Add a Space" href="/discover" class="tooltip-right">
          <ImageIcon alt="Add a Space" src={Compass} size={7} />
        </PrimaryNavItem>
      {/each}
    </div>
    {#if PLATFORM_RELAYS.length > 0}
      <Divider />
    {/if}
    <div>
      <div class="hidden md:block lg:hidden">
        <PrimaryNavItem
          title="Settings"
          href="/settings"
          prefix="/settings"
          class="tooltip-right">
          <ImageIcon alt="Settings" src={$userProfile?.picture || UserRounded} class="rounded-full" />
        </PrimaryNavItem>
      </div>
      <div class="hidden lg:block">
        <PrimaryNavItem
          title="Settings"
          href="/settings/profile"
          prefix="/settings"
          class="tooltip-right">
          <ImageIcon alt="Settings" src={$userProfile?.picture || UserRounded} class="rounded-full" />
        </PrimaryNavItem>
      </div>
      <PrimaryNavItem
        title="Git"
        onclick={openGit}
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
      <SlotRenderer slotId="space:sidebar:widgets" context={{urls: spaceUrls}} />
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
  <div class="content-padding-x content-sizing flex justify-between px-2">
    <div class="flex gap-2 sm:gap-6">
      <PrimaryNavItem title="Home" href="/home">
        <ImageIcon alt="Home" src={HomeSmile} size={7} />
      </PrimaryNavItem>
      <PrimaryNavItem
        title="Messages"
        onclick={openChat}
        notification={$notifications.has("/chat")}>
        <ImageIcon alt="Messages" src={Letter} size={7} />
      </PrimaryNavItem>
      <PrimaryNavItem
        title="Git"
        onclick={openGit}
        notification={gitNotification}>
        <ImageIcon alt="Git" src={Git} size={7} />
      </PrimaryNavItem>
      {#if PLATFORM_RELAYS.length !== 1}
        <PrimaryNavItem title="Spaces" href="/spaces" notification={anySpaceNotifications}>
          <ImageIcon alt="Spaces" src={SettingsMinimalistic} size={7} />
        </PrimaryNavItem>
      {/if}
    </div>
    <PrimaryNavItem title="Settings" onclick={showSettingsMenu}>
      <ImageIcon
        alt="Settings"
        src={$userProfile?.picture || Settings}
        size={7}
        class="rounded-full" />
    </PrimaryNavItem>
  </div>
</div>
