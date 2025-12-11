<script lang="ts">
  import {page} from "$app/stores"
  import {displayRelayUrl} from "@welshman/util"
  import {deriveRelay} from "@welshman/app"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Letter from "@assets/icons/letter-opened.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import BillList from "@assets/icons/bill-list.svg?dataurl"
  import ShieldUser from "@assets/icons/shield-user.svg?dataurl"
  import UserRounded from "@assets/icons/user-rounded.svg?dataurl"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import ProfileLatest from "@app/components/ProfileLatest.svelte"
  import RelayName from "@app/components/RelayName.svelte"
  import RelayDescription from "@app/components/RelayDescription.svelte"
  import SpaceQuickLinks from "@app/components/SpaceQuickLinks.svelte"
  import SpaceRecentActivity from "@app/components/SpaceRecentActivity.svelte"
  import SpaceRelayStatus from "@app/components/SpaceRelayStatus.svelte"
  import {decodeRelay} from "@app/core/state"
  import {makeThreadPath, makeCalendarPath, makeChatPath, makeRoomPath} from "@app/util/routes"
  import {makeGitPath} from "@lib/budabit/routes"
  import {notifications} from "@app/util/notifications"
  import {fade} from "@lib/transition"
  import MenuSpaceButton from "@src/lib/budabit/components/MenuSpaceButton.svelte"
  import { channelsByUrl } from "@lib/budabit/state"
  import ChannelName from "@src/lib/budabit/components/ChannelName.svelte"

  const url = decodeRelay($page.params.relay!)
  const relay = deriveRelay(url)
  const threadsPath = makeThreadPath(url)
  const calendarPath = makeCalendarPath(url)
  const gitPath = makeGitPath(url)
  const owner = $derived($relay?.profile?.pubkey)

  const channelNamesByUrl = $derived.by(() => {
    const channels = $channelsByUrl.get(url) || []

    return channels.map((ch) => ch.name).reverse()
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
    <div class="row-2">
      {#if owner}
        <Link class="btn btn-primary btn-sm" href={makeChatPath([owner])}>
          <Icon icon={Letter} />
          Contact Owner
        </Link>
      {/if}
      <MenuSpaceButton {url} />
    </div>
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-2 p-2 pt-4">
  <div class="card2 bg-alt flex flex-col gap-4 text-left">
    <div class="relative flex gap-4">
      <div class="relative">
        <div class="avatar relative">
          <div
            class="center !flex h-16 w-16 min-w-16 rounded-full border-2 border-solid border-base-300 bg-base-300">
            {#if $relay?.profile?.icon}
              <img alt="" src={$relay.profile.icon} />
            {:else}
              <Icon icon={Ghost} size={6} />
            {/if}
          </div>
        </div>
      </div>
      <div class="flex min-w-0 flex-col gap-1">
        <h1 class="ellipsize whitespace-nowrap text-2xl font-bold">
          <RelayName {url} />
        </h1>
        <p class="ellipsize text-sm opacity-75">{displayRelayUrl(url)}</p>
      </div>
    </div>
    {#if $relay?.profile?.terms_of_service || $relay?.profile?.privacy_policy}
      <div class="flex gap-3">
        {#if $relay.profile.terms_of_service}
          <Link href={$relay.profile.terms_of_service} class="badge badge-neutral flex gap-2">
            <Icon icon={BillList} size={4} />
            Terms of Service
          </Link>
        {/if}
        {#if $relay.profile.privacy_policy}
          <Link href={$relay?.profile?.privacy_policy} class="badge badge-neutral flex gap-2">
            <Icon icon={ShieldUser} size={4} />
            Privacy Policy
          </Link>
        {/if}
      </div>
    {/if}
  </div>
  <div class="grid grid-cols-3 gap-2">
    {#each channelNamesByUrl as room (room)}
      {@const roomPath = makeRoomPath(url, room)}
      <Link href={roomPath} class="btn btn-neutral relative">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden text-nowrap">
          <Icon icon={Hashtag} />
          <ChannelName {url} {room} />
        </div>
        {#if $notifications.has(roomPath)}
          <div class="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" transition:fade>
          </div>
        {/if}
      </Link>
    {/each}
    <Link href={gitPath} class="btn btn-info">
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
    <Link href={threadsPath} class="btn btn-primary">
      <div class="relative flex items-center gap-2">
        <Icon icon={NotesMinimalistic} />
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
        <Icon icon={CalendarMinimalistic} />
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
  <SpaceQuickLinks {url} />
  <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
    <div class="flex flex-col gap-2">
      <SpaceRecentActivity {url} />
    </div>
    <div class="flex flex-col gap-2">
      {#if owner}
        <div class="card2 bg-alt">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Icon icon={UserRounded} />
            Latest Updates
          </h3>
          <ProfileLatest {url} pubkey={owner}>
            {#snippet fallback()}
              <p class="text-sm opacity-60">No recent posts from the relay admin</p>
            {/snippet}
          </ProfileLatest>
        </div>
      {/if}
    </div>
  </div>
</PageContent>
