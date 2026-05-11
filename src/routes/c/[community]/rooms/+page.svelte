<script lang="ts">
  import {onMount} from "svelte"
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
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {makeCommunityRoomRootsFilter} from "@app/core/community-feeds"
  import {makeCommunityRoomRoot, readCommunityRoomRoots} from "@app/core/community-rooms"
  import {COMMUNITY_WRITE_TARGETS, canWriteCommunityTarget} from "@app/core/community-permissions"
  import {makeCommunityRoomPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const filters = $derived(communityPubkey ? [makeCommunityRoomRootsFilter(communityPubkey)] : [])
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

  onMount(() => {
    if (!communityPubkey || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters, signal: controller.signal})

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
    <strong>Rooms</strong>
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createRoom)}>
    <strong>Create room</strong>
    <Field>
      {#snippet label()}
        <p>Name</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={Hashtag} />
          <input bind:value={roomName} class="grow" type="text" />
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
      <Button type="submit" class="btn btn-primary" disabled={!roomName.trim() || !canCreateRoom}>Create room</Button>
    </div>
  </form>

  <div class="col-2">
    {#each rooms as room (room.id)}
      <a href={makeCommunityRoomPath(communityPubkey, room.id)} class="card2 bg-alt p-4 shadow-md">
        <strong>{room.name}</strong>
        {#if room.about}
          <p class="text-sm opacity-70">{room.about}</p>
        {/if}
      </a>
    {:else}
      <p class="py-8 text-center opacity-70">No rooms found.</p>
    {/each}
  </div>
</PageContent>
