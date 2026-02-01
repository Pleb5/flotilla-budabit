<script lang="ts">
  import {deriveRelay} from "@welshman/app"
  import {fade} from "@lib/transition"
  import CompassBig from "@assets/icons/compass-big.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Lock from "@assets/icons/lock-keyhole.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import ChatRound from "@assets/icons/chat-round.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import RoomCreate from "@app/components/RoomCreate.svelte"
  import ChannelName from "@app/components/ChannelName.svelte"
  import {makeRoomPath, makeSpacePath} from "@app/util/routes"
  import {
    hasNip29,
    deriveOtherRooms,
    makeChannelId,
  } from "@app/core/state"
  import {channelsById} from "@lib/budabit/state"
  import {notifications} from "@app/util/notifications"
  import {pushModal} from "@app/util/modal"
  import {deriveUserRooms} from "@lib/budabit/state"

  type Props = {
    url: string
  }

  const {url}: Props = $props()
  const relay = deriveRelay(url)
  const userRooms = deriveUserRooms(url)
  const otherRooms = deriveOtherRooms(url)
  const chatPath = makeSpacePath(url, "chat")
  const goalsPath = makeSpacePath(url, "goals")
  const threadsPath = makeSpacePath(url, "threads")
  const calendarPath = makeSpacePath(url, "calendar")
  const gitPath = makeSpacePath(url, "git")

  const addRoom = () => pushModal(RoomCreate, {url})

  const filteredRooms = $derived(() => {
    if (!term) return [...$userRooms, ...$otherRooms]

    const query = term.toLowerCase()
    const allRooms = [...$userRooms, ...$otherRooms]

    return allRooms.filter(room => {
      const channel = $channelsById.get(makeChannelId(url, room))
      const roomName = channel?.name || room
      return roomName.toLowerCase().includes(query)
    })
  })

  let term = $state("")
</script>

<div class="card2 bg-alt md:hidden">
  <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
    <Icon icon={CompassBig} />
    Quick Links
  </h3>
  <div class="flex flex-col gap-2">
    <Link href={chatPath} class="btn btn-neutral w-full justify-start">
      <div class="relative flex items-center gap-2">
        <Icon icon={ChatRound} />
        Chat
        {#if $notifications.has(chatPath)}
          <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary" transition:fade>
          </div>
        {/if}
      </div>
    </Link>
    <Link href={goalsPath} class="btn btn-neutral w-full justify-start">
      <div class="relative flex items-center gap-2">
        <Icon icon={StarFallMinimalistic} />
        Goals
        {#if $notifications.has(goalsPath)}
          <div
            class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-neutral-content"
            transition:fade>
          </div>
        {/if}
      </div>
    </Link>
  </div>
</div>
