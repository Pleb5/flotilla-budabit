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
  import Field from "@lib/components/Field.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import RoomImage from "@app/components/RoomImage.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {makeCommunityRoomRootsFilter} from "@app/core/community-feeds"
  import {makeCommunityRoomRoot, readCommunityRoomRoots} from "@app/core/community-rooms"
  import {COMMUNITY_SECTION_ROOMS} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
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
      ? [makeCommunityRoomRootsFilter(communityPubkey, {authors: roomAuthorPubkeys})]
      : [],
  )
  const events = $derived(deriveEventsAsc(deriveEventsById({repository, filters})))
  const rooms = $derived(readCommunityRoomRoots($events, communityPubkey))
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

  let roomName = $state("")
  let roomDescription = $state("")
  let createRoomForm = $state<HTMLFormElement | undefined>()
  let roomNameInput = $state<HTMLInputElement | undefined>()
  let lastCreateRequestHref = $state("")

  $effect(() => {
    if (!communityPubkey || $activeCommunityRelays.length === 0) return
    if (filters.length === 0) return

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
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
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
        <textarea bind:value={roomDescription} class="textarea textarea-bordered" rows="3"
        ></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.roomRoot}
        action="create rooms"
        submit
        disabled={!roomName.trim()}>
        Create room
      </PublishGate>
    </div>
  </form>

  <div class="col-2">
    {#each rooms as room (room.id)}
      <div class="card2 bg-alt p-4 shadow-md">
        <a href={makeCommunityRoomPath(communityPubkey, room.id)} class="flex gap-3">
          <div class="center h-10 w-10 shrink-0 rounded-xl bg-base-300">
            <RoomImage {room} size={6} />
          </div>
          <div class="min-w-0 flex-1">
            <strong class="ellipsize block"><RoomName {room} /></strong>
            {#if room.about}
              <p class="line-clamp-2 text-sm opacity-70">{room.about}</p>
            {/if}
          </div>
        </a>
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">No rooms found.</p>
    {/each}
  </div>
</PageContent>
