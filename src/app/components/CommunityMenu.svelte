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
  import {makeCommunityRoomRootsFilter} from "@app/core/community-feeds"
  import {readCommunityRoomRoots} from "@app/core/community-rooms"
  import {normalizePubkey} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getGrantCapability,
  } from "@app/core/community-permissions"
  import {ENABLE_ZAPS} from "@app/core/state"
  import {notifications} from "@app/util/notifications"
  import {formatShortNpub} from "@app/util/pubkeys"
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

  const shortCommunity = $derived(formatShortNpub(community) || "Community")
  const communityName = $derived(
    $activeCommunityProfile?.display_name || $activeCommunityProfile?.name || shortCommunity,
  )
  const communityPicture = $derived($activeCommunityProfile?.picture || "")
  const mainRelay = $derived($activeCommunityDefinition?.relays[0] || "")
  const homePath = $derived(makeCommunityPath(community))
  const roomsPath = $derived(makeCommunityPath(community, "rooms"))
  const roomCreatePath = $derived(`${roomsPath}?create=1`)
  const threadsPath = $derived(makeCommunityThreadPath(community))
  const calendarPath = $derived(makeCommunityCalendarPath(community))
  const goalsPath = $derived(makeCommunityGoalPath(community))
  const adminPath = $derived(makeCommunityPath(community, "admin"))
  const accessPath = $derived(makeCommunityPath(community, "access"))
  const moderationPath = $derived(makeCommunityPath(community, "moderation"))
  const gitPath = "/git"
  const roomFilters = $derived(community ? [makeCommunityRoomRootsFilter(community)] : [])
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const rooms = $derived(readCommunityRoomRoots($roomEvents, community))
  const canModerate = $derived.by(() => {
    const definition = $activeCommunityDefinition
    const userPubkey = $pubkey

    if (!definition || !userPubkey) return false

    return definition.sections.some(
      section => getGrantCapability({definition, userPubkey, sectionName: section.name}).canGrant,
    )
  })
  const canViewAdmin = $derived(
    Boolean($pubkey && normalizePubkey($pubkey) === normalizePubkey(community)),
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
    <Button
      class="flex w-full flex-col rounded-xl p-3 transition-all hover:bg-base-100"
      onclick={goHome}>
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
          <span class="ellipsize block text-xs text-primary">{mainRelay || shortCommunity}</span>
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

      {#if ENABLE_ZAPS}
        <SecondaryNavItem
          {replaceState}
          href={goalsPath}
          notification={$notifications.has(goalsPath)}>
          <Icon icon={StarFallMinimalistic} /> Fundraisers
        </SecondaryNavItem>
      {/if}

      {#if rooms.length > 0 || canCreateRoom}
        <SecondaryNavHeader>Rooms</SecondaryNavHeader>
      {/if}

      {#each rooms as room (room.id)}
        {@const roomPath = makeCommunityRoomPath(community, room.id)}
        <SecondaryNavItem
          {replaceState}
          href={roomPath}
          notification={$notifications.has(roomPath)}>
          <Icon icon={Hashtag} />
          <span class="ellipsize">{room.name}</span>
        </SecondaryNavItem>
      {/each}

      {#if canCreateRoom}
        <SecondaryNavItem {replaceState} onclick={createRoom}>
          <Icon icon={AddCircle} /> Create room
        </SecondaryNavItem>
      {/if}

      <div aria-hidden="true" class="mx-4 my-1 border-t border-base-300/50"></div>

      <SecondaryNavHeader>Manage</SecondaryNavHeader>

      <SecondaryNavItem {replaceState} href={accessPath}>
        <Icon icon={ShieldUser} /> Access Requests
      </SecondaryNavItem>

      {#if canModerate}
        <SecondaryNavItem {replaceState} href={moderationPath}>
          <Icon icon={ShieldUser} /> Moderation
        </SecondaryNavItem>
      {/if}

      {#if canViewAdmin}
        <SecondaryNavItem {replaceState} href={adminPath}>
          <Icon icon={ShieldUser} /> Admin
        </SecondaryNavItem>
      {/if}
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
