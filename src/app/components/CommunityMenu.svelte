<script lang="ts">
  import {onMount} from "svelte"
  import {goto} from "$app/navigation"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic-2.svg?dataurl"
  import ShieldUser from "@assets/icons/shield-user.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import SecondaryNavHeader from "@lib/components/SecondaryNavHeader.svelte"
  import SecondaryNavItem from "@lib/components/SecondaryNavItem.svelte"
  import SecondaryNavSection from "@lib/components/SecondaryNavSection.svelte"
  import SocketStatusIndicator from "@app/components/SocketStatusIndicator.svelte"
  import {
    activeCommunityDefinition,
    activeCommunityProfile,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {makeCommunityExclusiveFilter, makeCommunityRoomRootsFilter} from "@app/core/community-feeds"
  import {
    COMMUNITY_ROOM_LABEL_KIND,
    COMMUNITY_ROOM_LABEL_NAMESPACE,
    isCommunityRoomArchived,
    readCommunityRoomRoots,
  } from "@app/core/community-rooms"
  import {
    COMMUNITY_SECTION_GENERAL,
    findCommunitySection,
    getProfileListPubkeys,
  } from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    findProfileListEvent,
    getPrimaryProfileListRef,
  } from "@app/core/community-permissions"
  import {ENABLE_ZAPS} from "@app/core/state"
  import {notifications} from "@app/util/notifications"
  import {
    makeCommunityCalendarPath,
    makeCommunityGoalPath,
    makeCommunityPath,
    makeCommunityRoomPath,
    makeCommunityThreadPath,
  } from "@app/util/routes"

  type Props = {
    community: string
  }

  const {community}: Props = $props()

  const communityName = $derived(
    $activeCommunityProfile?.display_name || $activeCommunityProfile?.name || "Community",
  )
  const communityPicture = $derived($activeCommunityProfile?.picture || "")
  const mainRelay = $derived($activeCommunityDefinition?.relays[0] || $activeCommunityRelays[0] || "")
  const homePath = $derived(makeCommunityPath(community))
  const roomsPath = $derived(makeCommunityPath(community, "rooms"))
  const roomCreatePath = $derived(`${roomsPath}?create=1`)
  const threadsPath = $derived(makeCommunityThreadPath(community))
  const calendarPath = $derived(makeCommunityCalendarPath(community))
  const goalsPath = $derived(makeCommunityGoalPath(community))
  const adminPath = $derived(makeCommunityPath(community, "admin"))
  const gitPath = "/git"
  const roomFilters = $derived(
    community
      ? [
          makeCommunityRoomRootsFilter(community),
          makeCommunityExclusiveFilter(community, [COMMUNITY_ROOM_LABEL_KIND], {
            "#L": [COMMUNITY_ROOM_LABEL_NAMESPACE],
          }),
        ]
      : [],
  )
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const roomLabels = $derived($roomEvents.filter(event => event.kind === COMMUNITY_ROOM_LABEL_KIND))
  const rooms = $derived(readCommunityRoomRoots($roomEvents, community))
  const authoritativeArchivePubkeys = $derived.by(() => {
    if (!$activeCommunityDefinition) return []

    const section = findCommunitySection($activeCommunityDefinition, COMMUNITY_SECTION_GENERAL)
    const listEvent = findProfileListEvent(getPrimaryProfileListRef(section), $activeCommunityProfileListEvents)

    return getProfileListPubkeys(listEvent)
  })
  const activeRooms = $derived(
    rooms.filter(
      room =>
        !isCommunityRoomArchived({
          roomId: room.id,
          labels: roomLabels,
          authoritativePubkeys: authoritativeArchivePubkeys,
        }),
    ),
  )
  const canCreateRoom = $derived(
    Boolean(
      $pubkey &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target: COMMUNITY_WRITE_TARGETS.roomRoot,
        }),
    ),
  )

  const goHome = () => goto(homePath, {replaceState})
  const createRoom = () => {
    if (canCreateRoom) goto(roomCreatePath, {replaceState})
  }

  let replaceState = $state(false)
  let element: Element | undefined = $state()

  onMount(() => {
    replaceState = Boolean(element?.closest(".drawer"))
  })

  $effect(() => {
    if (!community || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: roomFilters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<div bind:this={element} class="flex h-full flex-col justify-between">
  <SecondaryNavSection>
    <Button class="flex w-full flex-col rounded-xl p-3 transition-all hover:bg-base-100" onclick={goHome}>
      <div class="flex items-center gap-3">
        <div class="center h-9 w-9 shrink-0 overflow-hidden rounded-full bg-base-300">
          {#if communityPicture}
            <img alt="" src={communityPicture} class="h-full w-full object-cover" />
          {:else}
            <Icon icon={Ghost} />
          {/if}
        </div>
        <div class="min-w-0">
          <strong class="ellipsize block">{communityName}</strong>
          {#if mainRelay}
            <span class="ellipsize block text-xs text-primary">{mainRelay}</span>
          {/if}
        </div>
      </div>
    </Button>

    <div class="flex max-h-[calc(100vh-170px)] min-h-0 flex-col gap-1 overflow-auto">
      <SecondaryNavItem {replaceState} href={homePath}>
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
          <Icon icon={StarFallMinimalistic} /> Fundraisers
        </SecondaryNavItem>
      {/if}

      <SecondaryNavItem {replaceState} href={adminPath}>
        <Icon icon={ShieldUser} /> Admin
      </SecondaryNavItem>

      <SecondaryNavHeader>Rooms</SecondaryNavHeader>

      <SecondaryNavItem {replaceState} href={roomsPath} notification={$notifications.has(roomsPath)}>
        <Icon icon={Hashtag} /> Rooms
      </SecondaryNavItem>

      {#if canCreateRoom}
        <SecondaryNavItem {replaceState} onclick={createRoom}>
          <Icon icon={AddCircle} /> Create room
        </SecondaryNavItem>
      {/if}

      {#each activeRooms as room (room.id)}
        {@const roomPath = makeCommunityRoomPath(community, room.id)}
        <SecondaryNavItem {replaceState} href={roomPath} notification={$notifications.has(roomPath)}>
          <Icon icon={Hashtag} />
          <span class="ellipsize">{room.name}</span>
        </SecondaryNavItem>
      {/each}
    </div>
  </SecondaryNavSection>

  {#if mainRelay}
    <div class="flex flex-col gap-2 p-4">
      <div class="btn btn-neutral btn-sm">
        <SocketStatusIndicator url={mainRelay} />
      </div>
    </div>
  {/if}
</div>
