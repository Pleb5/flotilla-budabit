<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {repository, publishThunk} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, MESSAGE, THREAD} from "@welshman/util"
  import ChatRound from "@assets/icons/chat-round.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {activeCommunityRelays} from "@app/core/community-state"
  import {makeCommunityRoomMessagesFilter} from "@app/core/community-feeds"
  import {makeCommunityRoomMessage, readCommunityRoomMessages} from "@app/core/community-messages"
  import {readCommunityRoomRoot} from "@app/core/community-rooms"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const roomId = $derived($page.params.room || "")
  const roomFilters = $derived(roomId ? [{kinds: [THREAD], ids: [roomId]}] : [])
  const messageFilters = $derived(
    communityPubkey && roomId ? [makeCommunityRoomMessagesFilter(communityPubkey, roomId)] : [],
  )
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const messageEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: messageFilters})),
  )
  const room = $derived($roomEvents[0] ? readCommunityRoomRoot($roomEvents[0], communityPubkey) : undefined)
  const messages = $derived(readCommunityRoomMessages($messageEvents, communityPubkey, roomId))

  const sendMessage = () => {
    const trimmed = message.trim()
    if (!trimmed || !communityPubkey || !roomId) return

    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    publishThunk({
      relays,
      event: makeEvent(
        MESSAGE,
        makeCommunityRoomMessage({
          communityPubkey,
          room: {id: roomId, creatorPubkey: room?.creatorPubkey || ""},
          relay: relays[0],
          content: trimmed,
        }),
      ),
    })
    message = ""
  }

  let message = $state("")

  onMount(() => {
    if (!communityPubkey || !roomId || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: [...roomFilters, ...messageFilters], signal: controller.signal})

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div>
      <a href={makeCommunityPath(communityPubkey, "rooms")} class="btn btn-neutral btn-sm">
        <Icon icon={AltArrowLeft} />
      </a>
    </div>
  {/snippet}
  {#snippet title()}
    <strong>{room?.name || "Room"}</strong>
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-4 p-4">
  <div class="flex min-h-80 flex-col-reverse gap-2">
    {#each messages as item (item.id)}
      <div class="card2 bg-alt p-3 shadow-sm">
        <p class="text-xs opacity-50">{item.event.pubkey.slice(0, 8)}</p>
        <p class="whitespace-pre-wrap">{item.event.content}</p>
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">No messages yet.</p>
    {/each}
  </div>

  <form class="flex gap-2" onsubmit={preventDefault(sendMessage)}>
    <label class="input input-bordered flex flex-1 items-center gap-2">
      <Icon icon={ChatRound} />
      <input bind:value={message} class="grow" type="text" placeholder="Message this room" />
    </label>
    <Button type="submit" class="btn btn-primary" disabled={!message.trim()}>Send</Button>
  </form>
</PageContent>
