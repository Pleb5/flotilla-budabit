<script lang="ts">
  import {onMount} from "svelte"
  import {goto} from "$app/navigation"
  import {displayRelayUrl} from "@welshman/util"
  import {deriveRelay, pubkey} from "@welshman/app"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import History from "@assets/icons/history.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic-2.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import ChatRound from "@assets/icons/chat-round.svg?dataurl"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import SecondaryNavItem from "@lib/components/SecondaryNavItem.svelte"
  import SecondaryNavHeader from "@lib/components/SecondaryNavHeader.svelte"
  import SecondaryNavSection from "@lib/components/SecondaryNavSection.svelte"
  import SpaceDetail from "@app/components/SpaceDetail.svelte"
  import RelayName from "@app/components/RelayName.svelte"
  import BudabitAlerts from "@lib/budabit/components/BudabitAlerts.svelte"
  import RoomCreate from "@lib/budabit/components/RoomCreate.svelte"
  import SocketStatusIndicator from "@app/components/SocketStatusIndicator.svelte"
  import MenuSpaceRoomItem from "@lib/budabit/components/MenuSpaceRoomItem.svelte"
  import {ENABLE_ZAPS, hasNip29} from "@app/core/state"
  import {notifications} from "@app/util/notifications"
  import {pushModal} from "@app/util/modal"
  import {makeSpacePath} from "@app/util/routes"
  import {channelsByUrl} from "@lib/budabit/state"

  const {url} = $props()

  const relay = deriveRelay(url)
  const owner = $derived($relay?.pubkey)

  const chatPath = makeSpacePath(url, "chat")
  const gitPath = makeSpacePath(url, "git")
  const goalsPath = makeSpacePath(url, "goals")
  const threadsPath = makeSpacePath(url, "threads")
  const calendarPath = makeSpacePath(url, "calendar")

  const channelNamesByUrl = $derived.by(() => {
    const channels = $channelsByUrl.get(url) || []

    return channels.map(ch => ch.name)
  })

  const showDetail = () => pushModal(SpaceDetail, {url}, {replaceState})

  const goHome = () => goto(makeSpacePath(url))

  const addRoom = () => {
    if ($pubkey && owner && owner === $pubkey) {
      pushModal(RoomCreate, {url}, {replaceState})
    }
  }

  const manageAlerts = () => {
    pushModal(BudabitAlerts, {}, {replaceState})
  }

  let replaceState = $state(false)
  let element: Element | undefined = $state()

  onMount(() => {
    replaceState = Boolean(element?.closest(".drawer"))
  })
</script>

<div bind:this={element} class="flex h-full flex-col justify-between">
  <SecondaryNavSection>
    <div>
      <Button
        class="flex w-full flex-col rounded-xl p-3 transition-all hover:bg-base-100"
        onclick={goHome}>
        <div class="flex items-center">
          <strong class="ellipsize flex items-center gap-1">
            <RelayName {url} />
          </strong>
        </div>
        <span class="text-xs text-primary">{displayRelayUrl(url)}</span>
      </Button>
    </div>

    <div class="flex max-h-[calc(100vh-250px)] min-h-0 flex-col gap-1 overflow-auto">
      <SecondaryNavItem {replaceState} href={makeSpacePath(url)}>
        <Icon icon={HomeSmile} /> Home
      </SecondaryNavItem>

      <SecondaryNavItem {replaceState} href={gitPath} notification={$notifications.has(gitPath)}>
        <Icon icon={Git} /> Git
      </SecondaryNavItem>

      <SecondaryNavItem {replaceState} href={threadsPath} notification={$notifications.has(threadsPath)}>
        <Icon icon={NotesMinimalistic} /> Threads
      </SecondaryNavItem>

      <SecondaryNavItem {replaceState} href={calendarPath} notification={$notifications.has(calendarPath)}>
        <Icon icon={CalendarMinimalistic} /> Calendar
      </SecondaryNavItem>

      {#if ENABLE_ZAPS}
        <SecondaryNavItem {replaceState} href={goalsPath} notification={$notifications.has(goalsPath)}>
          <Icon icon={StarFallMinimalistic} /> Goals
        </SecondaryNavItem>
      {/if}

      <SecondaryNavHeader>Rooms</SecondaryNavHeader>

      {#if hasNip29($relay)}
        <SecondaryNavItem {replaceState} href={makeSpacePath(url, "recent")}>
          <Icon icon={History} /> Recent Activity
        </SecondaryNavItem>
      {:else}
        <SecondaryNavItem {replaceState} href={chatPath} notification={$notifications.has(chatPath)}>
          <Icon icon={ChatRound} /> Chat
        </SecondaryNavItem>
      {/if}

      {#if owner && owner == $pubkey}
        <SecondaryNavItem {replaceState} onclick={addRoom}>
          <Icon icon={AddCircle} />
          Create room
        </SecondaryNavItem>
      {/if}

      {#each channelNamesByUrl as room, i (room)}
        <MenuSpaceRoomItem {replaceState} notify {url} {room} />
      {/each}
    </div>
  </SecondaryNavSection>

  <div class="flex flex-col gap-2 p-4">
    <Button class="btn btn-neutral btn-sm" onclick={showDetail}>
      <SocketStatusIndicator {url} />
    </Button>
    <Button class="btn btn-neutral btn-sm" onclick={manageAlerts}>
      <Icon icon={Bell} />
      Manage Alerts
    </Button>
  </div>
</div>
