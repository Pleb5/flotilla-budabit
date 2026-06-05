<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, type TrustedEvent} from "@welshman/util"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import BillList from "@assets/icons/bill-list.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Link from "@lib/components/Link.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Content from "@app/components/Content.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import CommunityRoomCreate from "@app/components/community/CommunityRoomCreate.svelte"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"
  import {fade} from "@lib/transition"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfile,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    getCommunityDefinitionRelayHints,
    hasCommunityHydrationCompleted,
    markCommunityHydrationCompleted,
  } from "@app/core/community-state"
  import {makeCommunityRoomRootsFilter} from "@app/core/community-feeds"
  import {readCommunityRoomRoots} from "@app/core/community-rooms"
  import {
    getPendingCommunityModeratorInvites,
    makeModeratorInviteResponseProfileList,
  } from "@app/core/community-admin"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {notifications} from "@app/util/notifications"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {formatShortNpub} from "@app/util/pubkeys"
  import {
    makeCommunityCalendarPath,
    makeCommunityGoalPath,
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
  const communityDescriptionEvent = $derived({content: communityDescription, tags: []})
  const communityPicture = $derived($activeCommunityProfile?.picture || "")
  const mainRelay = $derived(
    $activeCommunityDefinition?.relays[0] || parsedCommunity?.relays[0] || "",
  )
  const communityShareRelays = $derived(
    $activeCommunityDefinition?.pubkey === communityId
      ? getCommunityDefinitionRelayHints($activeCommunityDefinition, parsedCommunity?.relays || [])
      : parsedCommunity?.relays || [],
  )
  const communityActionRelays = $derived(
    communityShareRelays.length > 0 ? communityShareRelays : $activeCommunityRelays,
  )
  const threadsPath = $derived(communityId ? makeCommunityThreadPath(communityId) : "")
  const calendarPath = $derived(communityId ? makeCommunityCalendarPath(communityId) : "")
  const goalsPath = $derived(communityId ? makeCommunityGoalPath(communityId) : "")
  const gitPath = "/git"
  const roomAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.roomRoot,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityId &&
      $activeCommunityDefinition?.pubkey === communityId &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityId && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const roomFilters = $derived(
    communityBootstrapReady && communityId && roomAuthorPubkeys.length
      ? [makeCommunityRoomRootsFilter(communityId, {authors: roomAuthorPubkeys})]
      : [],
  )
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const rooms = $derived(
    readCommunityRoomRoots($roomEvents, communityId).filter(
      room => !isCommunityPersonBanned($activeCommunityReportState, room.event.pubkey),
    ),
  )
  const canCreateRoom = $derived(
    Boolean(
      $pubkey &&
      communityBootstrapReady &&
      $activeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.roomRoot,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const pendingModeratorInvites = $derived.by(() => {
    return getPendingCommunityModeratorInvites({
      definition: $activeCommunityDefinition,
      moderatorPubkey: $pubkey || undefined,
      profileListEvents: $activeCommunityProfileListEvents,
    })
  })
  const ROOM_ROOT_LOAD_TIMEOUT_MS = 8_000
  const ROOM_ROOT_EMPTY_RETRY_DELAY_MS = 2_000
  const ROOM_ROOT_EMPTY_RETRY_LIMIT = 2
  let roomRootsLoading = $state(false)
  let roomRootsLoaded = $state(false)
  let roomLoadKey = ""
  let roomLoadHydrationKey = ""
  let roomLoadRetryNonce = $state(0)
  let roomLoadEmptyRetries = 0
  let roomLoadRetryTimer: ReturnType<typeof setTimeout> | undefined
  const roomsLoading = $derived(communityBootstrapLoading || roomRootsLoading || !roomRootsLoaded)

  const clearRoomLoadRetry = () => {
    if (!roomLoadRetryTimer) return

    clearTimeout(roomLoadRetryTimer)
    roomLoadRetryTimer = undefined
  }

  const scheduleRoomLoadRetry = () => {
    if (roomLoadRetryTimer || roomLoadEmptyRetries >= ROOM_ROOT_EMPTY_RETRY_LIMIT) return false

    roomLoadEmptyRetries += 1
    roomRootsLoading = true
    roomRootsLoaded = false
    roomLoadRetryTimer = setTimeout(() => {
      roomLoadRetryTimer = undefined
      roomLoadKey = ""
      roomLoadRetryNonce += 1
    }, ROOM_ROOT_EMPTY_RETRY_DELAY_MS * roomLoadEmptyRetries)

    return true
  }

  const createRoom = () => {
    if (communityId) pushModal(CommunityRoomCreate, {communityPubkey: communityId})
  }

  const respondToModeratorInvite = (declined: boolean) => {
    const invites = pendingModeratorInvites
    if (invites.length === 0) return

    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    pushModal(Confirm, {
      title: declined ? "Decline moderation request" : "Accept moderation request",
      message: declined
        ? `Are you sure you decline moderator role in ${communityName} community?`
        : `Do you really accept moderator role in ${communityName} community?`,
      confirm: () => {
        for (const invite of invites) {
          const response = makeModeratorInviteResponseProfileList({
            profileList: invite.profileList,
            declined,
          })

          publishThunk({relays, event: makeEvent(response.kind, response)})
        }

        pushToast({
          theme: declined ? "warning" : "success",
          message: declined
            ? `You will still remain a member with full access to ${communityName}`
            : "Moderator role accepted.",
        })
        history.back()
      },
    })
  }

  $effect(() => {
    if (
      !communityBootstrapReady ||
      !communityId ||
      $activeCommunityRelays.length === 0 ||
      roomFilters.length === 0
    ) {
      roomRootsLoading = false
      roomRootsLoaded = false
      roomLoadKey = ""
      roomLoadHydrationKey = ""
      roomLoadEmptyRetries = 0
      clearRoomLoadRetry()
      return
    }

    const key = JSON.stringify({relays: $activeCommunityRelays, filters: roomFilters})
    if (roomLoadHydrationKey !== key) {
      roomLoadHydrationKey = key
      roomLoadEmptyRetries = 0
      clearRoomLoadRetry()
      roomLoadRetryNonce = 0
    }

    const requestKey = `${key}:${roomLoadRetryNonce}`

    if (roomLoadKey === requestKey) return
    if (hasCommunityHydrationCompleted(key)) {
      roomLoadKey = requestKey
      roomRootsLoading = false
      roomRootsLoaded = true
      clearRoomLoadRetry()
      return
    }

    const controller = new AbortController()
    let disposed = false
    let interrupted = false
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, ROOM_ROOT_LOAD_TIMEOUT_MS)

    roomLoadKey = requestKey
    roomRootsLoading = true
    roomRootsLoaded = false

    const finishRoomLoad = (events: TrustedEvent[] = []) => {
      if (disposed || roomLoadKey !== requestKey) return

      const loadedRooms = readCommunityRoomRoots(events, communityId).filter(
        room => !isCommunityPersonBanned($activeCommunityReportState, room.event.pubkey),
      )
      const hasLoadedRooms = loadedRooms.length > 0 || rooms.length > 0

      if (hasLoadedRooms) {
        markCommunityHydrationCompleted(key)
        clearRoomLoadRetry()
        roomRootsLoading = false
        roomRootsLoaded = true
        return
      }

      const shouldRetryEmpty = roomLoadEmptyRetries === 0 || interrupted || timedOut
      if (shouldRetryEmpty && scheduleRoomLoadRetry()) return

      roomRootsLoading = false
      roomRootsLoaded = true
    }

    request({
      relays: $activeCommunityRelays,
      autoClose: true,
      filters: roomFilters,
      signal: controller.signal,
      onDisconnect: () => {
        interrupted = true
      },
    })
      .then(finishRoomLoad)
      .catch(error => {
        if (!controller.signal.aborted) console.warn("[community-home] Failed to load rooms", error)
        interrupted = true
        finishRoomLoad()
      })
      .finally(() => clearTimeout(timeout))

    return () => {
      disposed = true
      clearTimeout(timeout)
      clearRoomLoadRetry()
      controller.abort()
    }
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
      <div class="flex w-full justify-end gap-2">
        {#if $activeCommunityDefinition?.pubkey === communityId}
          <CommunityShareButton communityPubkey={communityId} relayHints={communityShareRelays} />
        {/if}
        <CommunityStarButton communityPubkey={communityId} relayHints={communityActionRelays} />
      </div>
    {/if}
    <div class="relative flex gap-4">
      <div class="relative">
        <div class="avatar relative">
          <div
            class="center !flex h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-solid border-base-300 bg-base-300 sm:h-20 sm:w-20">
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
      <div class="w-full min-w-0 max-w-3xl break-words text-center md:text-xl">
        <Content event={communityDescriptionEvent} showEntire />
      </div>
    {/if}
    {#if $activeCommunityDefinition?.tos}
      <div class="flex flex-wrap justify-center gap-3">
        {#if $activeCommunityDefinition?.tos}
          <Link
            href={$activeCommunityDefinition.tos.relay || "#"}
            class="badge badge-neutral flex gap-2">
            <Icon icon={BillList} size={4} />
            Terms
          </Link>
        {/if}
      </div>
    {/if}
  </div>

  {#if pendingModeratorInvites.length > 0}
    <section class="card2 border-warning bg-warning/10 p-4 shadow-md">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-warning">
            You have been requested to moderate this group
          </h2>
          <p class="mt-1 text-sm opacity-75">
            Accepting publishes empty moderator lists owned by your key, making the role active and
            helping the community load faster for everyone.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            {#each pendingModeratorInvites as invite (`${invite.profileList.address}:${invite.sectionName}`)}
              <span class="badge badge-warning">{invite.displayName}</span>
            {/each}
          </div>
        </div>
        <div class="grid shrink-0 grid-cols-1 gap-2 sm:w-40">
          <Button
            class="btn btn-warning justify-center"
            onclick={() => respondToModeratorInvite(false)}>
            Accept
          </Button>
          <Button
            class="btn btn-ghost justify-center"
            onclick={() => respondToModeratorInvite(true)}>
            Decline
          </Button>
        </div>
      </div>
    </section>
  {/if}

  <div class="grid gap-2 max-sm:grid-cols-2 sm:grid-cols-3">
    <Link
      href={gitPath}
      class="btn border-none bg-[#0284c7] text-white hover:bg-[#0369a1] md:text-lg">
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
      <Link
        href={threadsPath}
        class="btn border-none bg-[#4f46e5] text-white hover:bg-[#4338ca] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={NotesMinimalistic} size={6} />
          Threads
          {#if $notifications.has(threadsPath)}
            <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white" transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if calendarPath}
      <Link
        href={calendarPath}
        class="btn border-none bg-[#c2410c] text-white hover:bg-[#9a3412] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={CalendarMinimalistic} size={6} />
          Calendar
          {#if $notifications.has(calendarPath)}
            <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white" transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
    {#if goalsPath}
      <Link
        href={goalsPath}
        class="btn border-none bg-[#a16207] text-white hover:bg-[#854d0e] md:text-lg">
        <div class="relative flex items-center gap-2">
          <Icon icon={StarFallMinimalistic} />
          Goals
          {#if $notifications.has(goalsPath)}
            <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-white" transition:fade>
            </div>
          {/if}
        </div>
      </Link>
    {/if}
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
    {#if communityId && rooms.length === 0}
      <div class="card2 bg-alt col-span-full flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h3 class="flex items-center gap-2 text-lg font-semibold">
            <Icon icon={Hashtag} />
            {roomsLoading ? "Looking for rooms..." : "No rooms found"}
          </h3>
          <p class="text-sm opacity-70">
            {roomsLoading
              ? "Loading community rooms and permissions."
              : canCreateRoom
                ? "Create the first room for this community."
                : "No rooms have been published yet."}
          </p>
        </div>
        {#if canCreateRoom}
          <button class="btn btn-primary" type="button" onclick={createRoom}> Create Room </button>
        {/if}
      </div>
    {/if}
  </div>
</PageContent>
