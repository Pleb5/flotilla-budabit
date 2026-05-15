<script lang="ts">
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import BillList from "@assets/icons/bill-list.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"
  import {fade} from "@lib/transition"
  import {
    activeCommunityDefinition,
    activeCommunityProfile,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
    getCommunityDefinitionRelayHints,
  } from "@app/core/community-state"
  import {makeCommunityRoomRootsFilter} from "@app/core/community-feeds"
  import {readCommunityRoomRoots} from "@app/core/community-rooms"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
  } from "@app/core/community-permissions"
  import {notifications} from "@app/util/notifications"
  import {formatShortNpub} from "@app/util/pubkeys"
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
  const shortCommunity = $derived(formatShortNpub(communityId) || "Unknown community")
  const communityName = $derived(
    $activeCommunityProfile?.display_name || $activeCommunityProfile?.name || shortCommunity,
  )
  const communityDescription = $derived(
    $activeCommunityProfile?.about || $activeCommunityDefinition?.description || "",
  )
  const communityPicture = $derived($activeCommunityProfile?.picture || "")
  const mainRelay = $derived($activeCommunityDefinition?.relays[0] || parsedCommunity?.relays[0] || "")
  const communityShareRelays = $derived(
    $activeCommunityDefinition?.pubkey === communityId
      ? getCommunityDefinitionRelayHints($activeCommunityDefinition, parsedCommunity?.relays || [])
      : parsedCommunity?.relays || [],
  )
  const communityActionRelays = $derived(
    communityShareRelays.length > 0 ? communityShareRelays : $activeCommunityRelays,
  )
  const roomsPath = $derived(communityId ? makeCommunityPath(communityId, "rooms") : "")
  const roomCreatePath = $derived(roomsPath ? `${roomsPath}?create=1` : "")
  const threadsPath = $derived(communityId ? makeCommunityThreadPath(communityId) : "")
  const calendarPath = $derived(communityId ? makeCommunityCalendarPath(communityId) : "")
  const goalsPath = $derived(communityId ? makeCommunityGoalPath(communityId) : "")
  const gitPath = "/git"
  const roomFilters = $derived(communityId ? [makeCommunityRoomRootsFilter(communityId)] : [])
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const rooms = $derived(readCommunityRoomRoots($roomEvents, communityId))
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
  {#snippet action()}
    <CommunityMenuButton community={communityId} />
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-2 p-2 pt-4">
  <div class="card2 bg-alt relative flex flex-col items-center gap-4 text-left">
    {#if communityId}
      <div class="absolute left-3 top-3">
        <CommunityStarButton communityPubkey={communityId} relayHints={communityActionRelays} />
      </div>
      <div class="absolute right-3 top-3">
        {#if $activeCommunityDefinition?.pubkey === communityId}
          <CommunityShareButton communityPubkey={communityId} relayHints={communityShareRelays} />
        {/if}
      </div>
    {/if}
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
    {#if communityDescription}
      <div class="max-w-3xl text-center md:text-xl">
        {communityDescription}
      </div>
    {/if}
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
    {#each rooms as room (room.id)}
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
    {#if roomsPath && rooms.length === 0}
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
    <Link href={gitPath} class="btn border-none bg-[#0284c7] text-white hover:bg-[#0369a1] md:text-lg">
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
      <Link href={threadsPath} class="btn border-none bg-[#4f46e5] text-white hover:bg-[#4338ca] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={NotesMinimalistic} size={6} />
          Threads
          {#if $notifications.has(threadsPath)}
            <div
              class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white"
              transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if calendarPath}
      <Link href={calendarPath} class="btn border-none bg-[#c2410c] text-white hover:bg-[#9a3412] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={CalendarMinimalistic} size={6} />
          Calendar
          {#if $notifications.has(calendarPath)}
            <div
              class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white"
              transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if goalsPath}
      <Link href={goalsPath} class="btn border-none bg-[#a16207] text-white hover:bg-[#854d0e] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={StarFallMinimalistic} />
          Goals
          {#if $notifications.has(goalsPath)}
            <div
              class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white"
              transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
  </div>
</PageContent>
