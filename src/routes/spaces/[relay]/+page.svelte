<script lang="ts">
  import {page} from "$app/stores"
  import {displayRelayUrl} from "@welshman/util"
  import {deriveRelay} from "@welshman/app"
  import {fade} from "@lib/transition"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import ChannelName from "@app/components/ChannelName.svelte"
  import SpaceJoin from "@app/components/SpaceJoin.svelte"
  import RelayName from "@app/components/RelayName.svelte"
  import RoomCreate from "@app/components/RoomCreate.svelte"
  import RelayDescription from "@app/components/RelayDescription.svelte"
  import {
    decodeRelay,
    channelIsLocked,
    makeChannelId,
    channelsById,
    deriveUserRooms,
    deriveOtherRooms,
    userRoomsByUrl,
  } from "@app/state"
  import {
    makeChatPath,
    makeThreadPath,
    makeCalendarPath,
    makeJobPath,
    makeGitPath,
    makeRoomPath
  } from "@app/routes"
  import {notifications} from "@app/notifications"
  import {pushModal} from "@app/modal"

  const url = decodeRelay($page.params.relay)
  const relay = deriveRelay(url)
  const userRooms = deriveUserRooms(url)
  const otherRooms = deriveOtherRooms(url)
  const threadsPath = makeThreadPath(url)
  const calendarPath = makeCalendarPath(url)
  const jobsPath = makeJobPath(url)
  const gitPath = makeGitPath(url)

  const joinSpace = () => pushModal(SpaceJoin, {url})

  const addRoom = () => pushModal(RoomCreate, {url})

  const pubkey = $derived($relay?.profile?.pubkey)
</script>

<div class="relative flex flex-col">
  <PageBar>
    {#snippet icon()}
      <div class="center">
        <Icon icon="home-smile" />
      </div>
    {/snippet}
    {#snippet title()}
      <strong>Home</strong>
    {/snippet}
    {#snippet action()}
      <div class="row-2">
        {#if !$userRoomsByUrl.has(url)}
          <Button class="btn btn-primary btn-sm" onclick={joinSpace}>
            <Icon icon="login-2" />
            Join Space
          </Button>
        {:else if pubkey}
          <Link class="btn btn-primary btn-sm" href={makeChatPath([pubkey])}>
            <Icon icon="letter" />
            Contact Owner
          </Link>
        {/if}
        <MenuSpaceButton {url} />
      </div>
    {/snippet}
  </PageBar>
  <div class="col-2 p-2">
    <div class="card2 bg-alt col-4 text-left">
      <div class="relative flex gap-4">
        <div class="relative">
          <div class="avatar relative">
            <div
              class="center !flex h-12 w-12 min-w-12 rounded-full border-2 border-solid border-base-300 bg-base-300">
              {#if $relay?.profile?.icon}
                <img alt="" src={$relay.profile.icon} />
              {:else}
                <Icon icon="ghost" size={5} />
              {/if}
            </div>
          </div>
        </div>
        <div class="min-w-0">
          <h2 class="ellipsize whitespace-nowrap text-xl">
            <RelayName {url} />
          </h2>
          <p class="ellipsize text-sm opacity-75">{displayRelayUrl(url)}</p>
        </div>
      </div>
      <RelayDescription {url} />
      {#if $relay?.profile}
        {@const {software, version, supported_nips, limitation} = $relay.profile}
        <div class="flex flex-wrap gap-1">
          {#if limitation?.auth_required}
            <p class="badge badge-neutral">
              <span class="ellipsize">Authentication Required</span>
            </p>
          {/if}
          {#if limitation?.payment_required}
            <p class="badge badge-neutral"><span class="ellipsize">Payment Required</span></p>
          {/if}
          {#if limitation?.min_pow_difficulty}
            <p class="badge badge-neutral">
              <span class="ellipsize">Requires PoW {limitation?.min_pow_difficulty}</span>
            </p>
          {/if}
          {#if Array.isArray(supported_nips)}
            <p class="badge badge-neutral">
              <span class="ellipsize">NIPs: {supported_nips.join(", ")}</span>
            </p>
          {/if}
          {#if software}
            <p class="badge badge-neutral"><span class="ellipsize">Software: {software}</span></p>
          {/if}
          {#if version}
            <p class="badge badge-neutral"><span class="ellipsize">Version: {version}</span></p>
          {/if}
        </div>
      {/if}
    </div>
    <div class="grid grid-cols-3 gap-2">
      <Link href={threadsPath} class="btn btn-primary">
        <div class="relative flex items-center gap-2">
          <Icon icon="notes-minimalistic" />
          Threads
          {#if $notifications.has(threadsPath)}
            <div
              class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
              transition:fade>
            </div>
          {/if}
        </div>
      </Link>
      <Link href={calendarPath} class="btn btn-secondary">
        <div class="relative flex items-center gap-2">
          <Icon icon="notes-minimalistic" />
          Calendar
          {#if $notifications.has(calendarPath)}
            <div
              class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
              transition:fade>
            </div>
          {/if}
        </div>
      </Link>
      <!-- <Link href={jobsPath} class="btn btn-success"> -->
      <!--   <div class="relative flex items-center gap-2"> -->
      <!--     <Icon icon="jobs" /> -->
      <!--     Jobs -->
      <!--     {#if $notifications.has(jobsPath)} -->
      <!--       <div -->
      <!--         class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content" -->
      <!--         transition:fade> -->
      <!--       </div> -->
      <!--     {/if} -->
      <!--   </div> -->
      <!-- </Link> -->
      <Link href={gitPath} class="btn btn-info">
        <div class="relative flex items-center gap-2">
          <Icon icon="git" />
          Git
          {#if $notifications.has(gitPath)}
            <div
              class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary-content"
              transition:fade>
            </div>
          {/if}
        </div>
      </Link>
      {#each $userRooms as room (room)}
        {@const roomPath = makeRoomPath(url, room)}
        <Link href={roomPath} class="btn btn-neutral relative">
          <div class="flex min-w-0 items-center gap-2 overflow-hidden text-nowrap">
            {#if channelIsLocked($channelsById.get(makeChannelId(url, room)))}
              <Icon icon="lock" size={4} />
            {:else}
              <Icon icon="hashtag" />
            {/if}
            <ChannelName {url} {room} />
          </div>
          {#if $notifications.has(roomPath)}
            <div class="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" transition:fade>
            </div>
          {/if}
        </Link>
      {/each}
      {#each $otherRooms as room (room)}
        <Link href={makeRoomPath(url, room)} class="btn btn-neutral">
          <div class="relative flex min-w-0 items-center gap-2 overflow-hidden text-nowrap">
            {#if channelIsLocked($channelsById.get(makeChannelId(url, room)))}
              <Icon icon="lock" size={4} />
            {:else}
              <Icon icon="hashtag" />
            {/if}
            <ChannelName {url} {room} />
          </div>
        </Link>
      {/each}
      <Button onclick={addRoom} class="btn btn-neutral whitespace-nowrap">
        <Icon icon="add-circle" />
        Create
      </Button>
    </div>
  </div>
</div>
