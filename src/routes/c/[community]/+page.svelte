<script lang="ts">
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import BillList from "@assets/icons/bill-list.svg?dataurl"
  import ShieldUser from "@assets/icons/shield-user.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import {fade} from "@lib/transition"
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
  import {COMMUNITY_SECTION_GENERAL, findCommunitySection, getProfileListPubkeys} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    findProfileListEvent,
    getPrimaryProfileListRef,
  } from "@app/core/community-permissions"
  import {APP_NAME} from "@app/core/state"
  import {notifications} from "@app/util/notifications"
  import {
    makeCommunityCalendarPath,
    makeCommunityGoalPath,
    makeCommunityPath,
    makeCommunityRoomPath,
    makeCommunityThreadPath,
    parseCommunityRouteParam,
  } from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityId = $derived(parsedCommunity?.pubkey || $activeCommunityDefinition?.pubkey || "")
  const communityName = $derived(
    $activeCommunityProfile?.display_name || $activeCommunityProfile?.name || $APP_NAME || "Community",
  )
  const communityDescription = $derived(
    $activeCommunityProfile?.about ||
      $activeCommunityDefinition?.description ||
      "A BudaBit community workspace.",
  )
  const communityPicture = $derived($activeCommunityProfile?.picture || "")
  const mainRelay = $derived($activeCommunityDefinition?.relays[0] || parsedCommunity?.relays[0] || "")
  const shortCommunity = $derived(
    communityId ? `${communityId.slice(0, 8)}...${communityId.slice(-8)}` : "Unknown community",
  )
  const roomsPath = $derived(communityId ? makeCommunityPath(communityId, "rooms") : "")
  const roomCreatePath = $derived(roomsPath ? `${roomsPath}?create=1` : "")
  const threadsPath = $derived(communityId ? makeCommunityThreadPath(communityId) : "")
  const calendarPath = $derived(communityId ? makeCommunityCalendarPath(communityId) : "")
  const goalsPath = $derived(communityId ? makeCommunityGoalPath(communityId) : "")
  const gitPath = "/git"
  const accessPath = $derived(communityId ? makeCommunityPath(communityId, "access") : "")
  const moderationPath = $derived(communityId ? makeCommunityPath(communityId, "moderation") : "")
  const adminPath = $derived(communityId ? makeCommunityPath(communityId, "admin") : "")
  const roomFilters = $derived(
    communityId
      ? [
          makeCommunityRoomRootsFilter(communityId),
          makeCommunityExclusiveFilter(communityId, [COMMUNITY_ROOM_LABEL_KIND], {
            "#L": [COMMUNITY_ROOM_LABEL_NAMESPACE],
          }),
        ]
      : [],
  )
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const roomLabels = $derived($roomEvents.filter(event => event.kind === COMMUNITY_ROOM_LABEL_KIND))
  const rooms = $derived(readCommunityRoomRoots($roomEvents, communityId))
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

  $effect(() => {
    if (!communityId || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: roomFilters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={HomeSmile} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Home</strong>
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-2 p-2 pt-4">
  <div class="card2 bg-alt flex flex-col items-center gap-4 text-left">
    <div class="relative flex gap-4">
      <div class="relative">
        <div class="avatar relative">
          <div
            class="center !flex h-20 w-20 min-w-16 overflow-hidden rounded-full border-2 border-solid border-base-300 bg-base-300">
            {#if communityPicture}
              <img alt="" src={communityPicture} class="h-full w-full object-cover" />
            {:else}
              <Icon icon={Ghost} size={6} />
            {/if}
          </div>
        </div>
      </div>
      <div class="flex min-w-0 flex-col justify-center gap-1">
        <h1 class="ellipsize whitespace-nowrap text-2xl font-bold">{communityName}</h1>
        <p class="ellipsize text-sm opacity-75">{mainRelay || shortCommunity}</p>
      </div>
    </div>
    <div class="max-w-3xl text-center md:text-xl">
      {communityDescription}
    </div>
    {#if $activeCommunityDefinition?.tos}
      <div class="flex flex-wrap justify-center gap-3">
        {#if $activeCommunityDefinition?.tos}
          <Link href={$activeCommunityDefinition.tos.relay || "#"} class="badge badge-neutral flex gap-2">
            <Icon icon={BillList} size={4} />
            Terms
          </Link>
        {/if}
      </div>
    {/if}
  </div>

  <div class="grid gap-2 max-sm:grid-cols-2 sm:grid-cols-3">
    {#each activeRooms as room (room.id)}
      {@const roomPath = makeCommunityRoomPath(communityId, room.id)}
      <Link href={roomPath} class="btn btn-neutral relative">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden text-nowrap md:text-lg">
          <Icon icon={Hashtag} />
          <span class="ellipsize">{room.name}</span>
        </div>
        {#if $notifications.has(roomPath)}
          <div class="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" transition:fade></div>
        {/if}
      </Link>
    {/each}
    {#if roomsPath && activeRooms.length === 0}
      <div class="card2 bg-alt col-span-full flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h3 class="flex items-center gap-2 text-lg font-semibold">
            <Icon icon={Hashtag} />
            No rooms found
          </h3>
          <p class="text-sm opacity-70">Create the first room for this community.</p>
        </div>
        {#if canCreateRoom}
          <button class="btn btn-primary" type="button" onclick={() => goto(roomCreatePath)}>
            Create Room
          </button>
        {/if}
      </div>
    {/if}
    <Link href={gitPath} class="btn btn-info md:text-lg">
      <div class="relative flex items-center gap-2">
        <Icon icon={Git} />
        Git
        {#if $notifications.has(gitPath)}
          <div
            class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
            transition:fade>
          </div>
        {/if}
      </div>
    </Link>
    {#if threadsPath}
      <Link href={threadsPath} class="btn btn-primary text-black md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={NotesMinimalistic} size={6} />
          Threads
          {#if $notifications.has(threadsPath)}
            <div
              class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
              transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if calendarPath}
      <Link href={calendarPath} class="btn btn-secondary text-black md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={CalendarMinimalistic} size={6} />
          Calendar
          {#if $notifications.has(calendarPath)}
            <div
              class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
              transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if goalsPath}
      <Link href={goalsPath} class="btn btn-neutral md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={StarFallMinimalistic} />
          Fundraisers
          {#if $notifications.has(goalsPath)}
            <div
              class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-neutral-content"
              transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
  </div>

  {#if adminPath}
    <div class="card2 bg-alt flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <h3 class="flex items-center gap-2 text-lg font-semibold">
          <Icon icon={ShieldUser} />
          Community Admin
        </h3>
        <p class="text-sm opacity-70">Manage publishing lists and role badges for this community.</p>
      </div>
      <Link href={adminPath} class="btn btn-neutral">Open Admin</Link>
    </div>
  {/if}

  {#if accessPath}
    <div class="card2 bg-alt flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <h3 class="flex items-center gap-2 text-lg font-semibold">
          <Icon icon={ShieldUser} />
          Access Requests
        </h3>
        <p class="text-sm opacity-70">Request publishing permissions and review your current applications.</p>
      </div>
      <Link href={accessPath} class="btn btn-primary">Open Access</Link>
    </div>
  {/if}

  {#if moderationPath}
    <div class="card2 bg-alt flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <h3 class="flex items-center gap-2 text-lg font-semibold">
          <Icon icon={ShieldUser} />
          Community Moderation
        </h3>
        <p class="text-sm opacity-70">Create application forms and review permission requests.</p>
      </div>
      <Link href={moderationPath} class="btn btn-neutral">Open Moderation</Link>
    </div>
  {/if}
</PageContent>
