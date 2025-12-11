<script lang="ts">
  import {onMount} from "svelte"
  import {displayRelayUrl, getTagValue} from "@welshman/util"
  import {deriveRelay, pubkey} from "@welshman/app"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic-2.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import ChatRound from "@assets/icons/chat-round.svg?dataurl"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import SecondaryNavItem from "@lib/components/SecondaryNavItem.svelte"
  import SecondaryNavHeader from "@lib/components/SecondaryNavHeader.svelte"
  import SecondaryNavSection from "@lib/components/SecondaryNavSection.svelte"
  import AlertAdd from "@app/components/AlertAdd.svelte"
  import Alerts from "@app/components/Alerts.svelte"
  import RoomCreate from "@lib/budabit/components/RoomCreate.svelte"
  import {
    alerts,
    ENABLE_ZAPS,
  } from "@app/core/state"
  import {notifications} from "@app/util/notifications"
  import {pushModal} from "@app/util/modal"
  import {makeSpacePath} from "@app/util/routes"
  import MenuSpaceRoomItem from "./MenuSpaceRoomItem.svelte"
  import { channelsByUrl } from "@lib/budabit/state"

  const {url} = $props()

  const relay = deriveRelay(url)
  const owner = $derived($relay?.profile?.pubkey)
  const chatPath = makeSpacePath(url, "chat")
  const threadsPath = makeSpacePath(url, "threads")
  const calendarPath = makeSpacePath(url, "calendar")
  const gitPath = makeSpacePath(url, "git")
  const hasAlerts = $derived($alerts.some(a => getTagValue("feed", a.tags)?.includes(url)))
  const goalsPath = makeSpacePath(url, "goals")

  const openMenu = () => {
    showMenu = true
  }

  const addRoom = () => {
    // only let owner add a room
    if ($pubkey && owner && owner === $pubkey) {
      pushModal(RoomCreate, {url}, {replaceState})
    }
  }

  const manageAlerts = () => {
    const component = hasAlerts ? Alerts : AlertAdd
    const params = {url, channel: "push", hideSpaceField: true}

    pushModal(component, params, {replaceState})
  }

  let showMenu = $state(false)
  let replaceState = $state(false)
  let element: Element | undefined = $state()

  const channelNamesByUrl = $derived.by(() => {
    const channels = $channelsByUrl.get(url) || []

    return channels.map((ch) => ch.name)
  })

  onMount(() => {
    replaceState = Boolean(element?.closest(".drawer"))
  })
</script>

<div bind:this={element} class="flex h-full flex-col justify-between">
  <SecondaryNavSection>
    <div>
      <SecondaryNavItem class="w-full !justify-between" onclick={openMenu}>
        <strong class="ellipsize flex items-center gap-3">
          {displayRelayUrl(url)}
        </strong>
        <Icon icon={AltArrowDown} />
      </SecondaryNavItem>
    </div>
    <div class="flex min-h-0 flex-col gap-1 overflow-auto">
      <SecondaryNavItem {replaceState} href={makeSpacePath(url)}>
        <Icon icon={HomeSmile} /> Home
      </SecondaryNavItem>
      {#if ENABLE_ZAPS}
        <SecondaryNavItem
          {replaceState}
          href={goalsPath}
          notification={$notifications.has(goalsPath)}>
          <Icon icon={StarFallMinimalistic} /> Goals
        </SecondaryNavItem>
      {/if}
      <SecondaryNavItem
        {replaceState}
        href={threadsPath}
        notification={$notifications.has(threadsPath)}>
        <Icon icon={NotesMinimalistic} /> Threads
      </SecondaryNavItem>
      <SecondaryNavItem
        {replaceState}
        href={calendarPath}
        notification={$notifications.has(calendarPath)}>
        <Icon icon={CalendarMinimalistic} /> Calendar
      </SecondaryNavItem>

      <SecondaryNavItem href={gitPath} notification={$notifications.has(gitPath)}>
        <Icon icon={Git} /> Git
      </SecondaryNavItem>
      <SecondaryNavHeader>
        Rooms
      </SecondaryNavHeader>
      {#if owner && owner == $pubkey}
        <SecondaryNavItem {replaceState} onclick={addRoom}>
          <Icon icon={AddCircle} />
          Create room
        </SecondaryNavItem>
      {/if}
      <SecondaryNavItem {replaceState} href={chatPath} notification={$notifications.has(chatPath)}>
        <Icon icon={ChatRound} /> Chat
      </SecondaryNavItem>
      {#each channelNamesByUrl as room, i (room)}
        <MenuSpaceRoomItem {replaceState} notify {url} {room} />
      {/each}
    </div>
  </SecondaryNavSection>
  <div class="p-4">
    <button class="btn btn-neutral btn-sm w-full" onclick={manageAlerts}>
      <Icon icon={Bell} />
      Manage Alerts
    </button>
  </div>
</div>
