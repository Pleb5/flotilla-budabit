<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {repository, publishThunk, pubkey} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, THREAD} from "@welshman/util"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {makeCommunityExclusiveFilter, makeCommunityRoomRootsFilter} from "@app/core/community-feeds"
  import {
    COMMUNITY_ROOM_LABEL_KIND,
    COMMUNITY_ROOM_LABEL_NAMESPACE,
    isCommunityRoomArchived,
    makeCommunityRoomArchiveLabel,
    makeCommunityRoomRoot,
    readCommunityRoomRoots,
  } from "@app/core/community-rooms"
  import {
    COMMUNITY_SECTION_GENERAL,
    COMMUNITY_SECTION_ROOMS,
    findCommunitySection,
    getProfileListPubkeys,
  } from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    findProfileListEvent,
    getCommunitySectionWriterPubkeys,
    getPrimaryProfileListRef,
  } from "@app/core/community-permissions"
  import {makeCommunityRoomPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const roomAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_ROOMS,
        })
      : [],
  )
  const filters = $derived(
    communityPubkey && roomAuthorPubkeys.length
      ? [
          makeCommunityRoomRootsFilter(communityPubkey, {authors: roomAuthorPubkeys}),
          makeCommunityExclusiveFilter(communityPubkey, [COMMUNITY_ROOM_LABEL_KIND], {
            "#L": [COMMUNITY_ROOM_LABEL_NAMESPACE],
          }),
        ]
      : [],
  )
  const events = $derived(deriveEventsAsc(deriveEventsById({repository, filters})))
  const roomLabels = $derived($events.filter(event => event.kind === COMMUNITY_ROOM_LABEL_KIND))
  const rooms = $derived(readCommunityRoomRoots($events, communityPubkey))
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
  const archivedRooms = $derived(
    rooms.filter(room =>
      isCommunityRoomArchived({
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
  const canArchiveRoom = $derived(
    Boolean(
      $pubkey &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target: COMMUNITY_WRITE_TARGETS.label,
        }),
      ),
  )
  const createRequested = $derived($page.url.searchParams.get("create") === "1")

  const createRoom = () => {
    if (!communityPubkey) return
    if (!canCreateRoom) {
      pushToast({theme: "error", message: "You do not have permission to create rooms."})
      return
    }
    const trimmed = roomName.trim()
    if (!trimmed) return

    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    publishThunk({
      relays,
      event: makeEvent(
        THREAD,
        makeCommunityRoomRoot({communityPubkey, name: trimmed, about: roomDescription.trim()}),
      ),
    })
    roomName = ""
    roomDescription = ""
    pushToast({message: "Room published."})
  }

  const setRoomArchived = (room: (typeof rooms)[number], archived: boolean) => {
    if (!communityPubkey) return
    if (!canArchiveRoom) {
      pushToast({theme: "error", message: "You do not have permission to archive rooms."})
      return
    }

    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    publishThunk({
      relays,
      event: makeEvent(
        COMMUNITY_ROOM_LABEL_KIND,
        makeCommunityRoomArchiveLabel({
          communityPubkey,
          room,
          archived,
          relay: relays[0],
        }),
      ),
    })
    pushToast({message: archived ? "Room archived." : "Room unarchived."})
  }

  let roomName = $state("")
  let roomDescription = $state("")
  let createRoomForm = $state<HTMLFormElement | undefined>()
  let roomNameInput = $state<HTMLInputElement | undefined>()
  let lastCreateRequestHref = $state("")

  $effect(() => {
    if (!communityPubkey || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters, signal: controller.signal})

    return () => controller.abort()
  })

  $effect(() => {
    if (!createRequested) {
      lastCreateRequestHref = ""
      return
    }

    const href = $page.url.href

    if (lastCreateRequestHref === href) return
    lastCreateRequestHref = href

    requestAnimationFrame(() => {
      createRoomForm?.scrollIntoView({block: "start", behavior: "smooth"})
      roomNameInput?.focus()
    })
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={HomeSmile} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Rooms</strong>
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form
    bind:this={createRoomForm}
    class="card2 bg-alt col-3 p-4 shadow-md"
    onsubmit={preventDefault(createRoom)}>
    <strong>Create room</strong>
    <Field>
      {#snippet label()}
        <p>Name</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={Hashtag} />
          <input bind:this={roomNameInput} bind:value={roomName} class="grow" type="text" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Description</p>
      {/snippet}
      {#snippet input()}
        <textarea bind:value={roomDescription} class="textarea textarea-bordered" rows="3"></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end">
      <PublishGate target={COMMUNITY_WRITE_TARGETS.roomRoot} action="create rooms" submit disabled={!roomName.trim()}>
        Create room
      </PublishGate>
    </div>
  </form>

  <div class="col-2">
    {#each activeRooms as room (room.id)}
      <div class="card2 bg-alt p-4 shadow-md">
        <a href={makeCommunityRoomPath(communityPubkey, room.id)} class="col-1">
          <strong>{room.name}</strong>
          {#if room.about}
            <p class="text-sm opacity-70">{room.about}</p>
          {/if}
        </a>
        <div class="flex justify-end">
          <Button class="btn btn-ghost btn-xs" disabled={!canArchiveRoom} onclick={() => setRoomArchived(room, true)}>
            Archive
          </Button>
        </div>
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">No rooms found.</p>
    {/each}
  </div>

  {#if archivedRooms.length > 0}
    <div class="col-2">
      <strong>Archived rooms</strong>
      {#each archivedRooms as room (room.id)}
        <div class="card2 bg-alt p-4 opacity-70 shadow-md">
          <a href={makeCommunityRoomPath(communityPubkey, room.id)} class="col-1">
            <strong>{room.name}</strong>
            {#if room.about}
              <p class="text-sm">{room.about}</p>
            {/if}
          </a>
          <div class="flex justify-end">
            <Button class="btn btn-ghost btn-xs" disabled={!canArchiveRoom} onclick={() => setRoomArchived(room, false)}>
              Unarchive
            </Button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</PageContent>
