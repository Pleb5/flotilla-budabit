<script lang="ts">
  import {page} from "$app/stores"
  import {displayRelayUrl} from "@welshman/util"
  import {deriveRelay} from "@welshman/app"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Letter from "@assets/icons/letter-opened.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import BillList from "@assets/icons/bill-list.svg?dataurl"
  import ShieldUser from "@assets/icons/shield-user.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import ChatRound from "@assets/icons/chat-round.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import ArchivedMinimalistic from "@assets/icons/archived-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import RelayName from "@app/components/RelayName.svelte"
  import RelayDescription from "@app/components/RelayDescription.svelte"
  import {decodeRelay, PLATFORM_NAME} from "@app/core/state"
  import {makeThreadPath, makeCalendarPath, makeChatPath, makeRoomPath, makeSpacePath} from "@app/util/routes"
  import {makeGitPath} from "@lib/budabit/routes"
  import {notifications} from "@app/util/notifications"
  import {fade} from "@lib/transition"
  import SpaceMenuButton from "@src/lib/budabit/components/SpaceMenuButton.svelte"
  import {channelsByUrl} from "@lib/budabit/state"
  import ChannelName from "@src/lib/budabit/components/ChannelName.svelte"
  import DemoDayPromo from "@src/lib/budabit/components/DemoDayPromo.svelte"
  import {partitionArchivedItems} from "@app/util/room-archive"

  const url = decodeRelay($page.params.relay!)
  const relay = deriveRelay(url)
  const chatPath = makeSpacePath(url, "chat")
  const threadsPath = makeThreadPath(url)
  const calendarPath = makeCalendarPath(url)
  const gitPath = makeGitPath(url)
  const owner = $derived($relay?.pubkey)

  const roomSections = $derived.by(() =>
    partitionArchivedItems(($channelsByUrl.get(url) || []).slice().reverse()),
  )
  const activeChannels = $derived.by(() => roomSections.active)
  const archivedChannels = $derived.by(() => roomSections.archived)
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
    <div class="row-2">
      {#if owner}
        <Link class="btn btn-primary btn-sm" href={makeChatPath(owner)}>
          <Icon icon={Letter} />
          Contact Owner
        </Link>
      {/if}
      <SpaceMenuButton {url} />
    </div>
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-2 p-2 pt-4">
  <div class="card2 bg-alt flex flex-col items-center gap-4 text-left">
    <div class="relative flex gap-4">
      <div class="relative">
        <div class="avatar relative">
          <div
            class="center !flex h-20 w-20 min-w-16 rounded-full border-2 border-solid border-base-300 bg-base-300">
            {#if $relay?.icon}
              <img alt="" src={$relay.icon} />
            {:else}
              <Icon icon={Ghost} size={6} />
            {/if}
          </div>
        </div>
      </div>
      <div class="flex min-w-0 flex-col justify-center gap-1">
        <h1 class="ellipsize whitespace-nowrap text-2xl font-bold">
          {#if PLATFORM_NAME}
            {PLATFORM_NAME}
          {:else}
            <RelayName {url} />
          {/if}
        </h1>
        <p class="ellipsize text-sm opacity-75">{displayRelayUrl(url)}</p>
      </div>
    </div>
    <div class="md:text-xl">
      <RelayDescription {url} />
    </div>
  </div>
  <DemoDayPromo {url}/>
  <div class="grid max-sm:grid-cols-2 sm:grid-cols-3 gap-2">
    {#each activeChannels as channel (channel.id)}
      {@const roomPath = makeRoomPath(url, channel.room)}
      <Link href={roomPath} class="btn btn-neutral relative">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden text-nowrap  md:text-lg">
          <Icon icon={Hashtag} />
          <ChannelName {url} room={channel.room} />
        </div>
        {#if $notifications.has(roomPath)}
          <div class="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" transition:fade>
          </div>
        {/if}
      </Link>
    {/each}
    {#if archivedChannels.length > 0}
      <details class="card2 bg-base-200/50 col-span-full overflow-hidden">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div class="flex items-center gap-2 md:text-lg">
            <Icon icon={ArchivedMinimalistic} />
            Archived Rooms
          </div>
          <span class="text-xs uppercase opacity-70">{archivedChannels.length} read-only</span>
        </summary>
        <div class="grid gap-2 px-3 pb-3 max-sm:grid-cols-2 sm:grid-cols-3">
          {#each archivedChannels as channel (channel.id)}
            {@const roomPath = makeRoomPath(url, channel.room)}
            <Link href={roomPath} class="btn btn-neutral relative opacity-80">
              <div class="flex min-w-0 items-center gap-2 overflow-hidden text-nowrap md:text-lg">
                <Icon icon={ArchivedMinimalistic} />
                <ChannelName {url} room={channel.room} />
              </div>
              <span class="badge badge-outline badge-xs absolute right-2 top-2">Archived</span>
            </Link>
          {/each}
        </div>
      </details>
    {/if}
    <Link href={chatPath} class="btn btn-success w-full">
      <div class="relative flex items-center gap-2 md:text-lg">
        <Icon icon={ChatRound} size={6}/>
        Chat
        {#if $notifications.has(chatPath)}
          <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary" transition:fade>
          </div>
        {/if}
      </div>
    </Link>
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
    <Link href={threadsPath} class="btn btn-primary text-black md:text-lg">
      <div class="relative flex items-center gap-2">
        <Icon icon={NotesMinimalistic} size={6}/>
        Threads
        {#if $notifications.has(threadsPath)}
          <div
            class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
            transition:fade>
          </div>
        {/if}
      </div>
    </Link>
    <Link href={calendarPath} class="btn btn-secondary text-black md:text-lg">
      <div class="relative flex items-center gap-2">
        <Icon icon={CalendarMinimalistic} size={6}/>
        Calendar
        {#if $notifications.has(calendarPath)}
          <div
            class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
            transition:fade>
          </div>
        {/if}
      </div>
    </Link>
  </div>
</PageContent>
