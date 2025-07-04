<script lang="ts">
  import {page} from "$app/stores"
  import {displayRelayUrl, MESSAGE, THREAD} from "@welshman/util"
  import {deriveRelay, pubkey} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import MenuSpaceButton from "@app/components/MenuSpaceButton.svelte"
  import ProfileLatest from "@app/components/ProfileLatest.svelte"
  import SpaceJoin from "@app/components/SpaceJoin.svelte"
  import RelayName from "@app/components/RelayName.svelte"
  import RelayDescription from "@app/components/RelayDescription.svelte"
  import SpaceQuickLinks from "@app/components/SpaceQuickLinks.svelte"
  import SpaceRelayStatus from "@app/components/SpaceRelayStatus.svelte"
  import {
    channelsById,
    decodeRelay,
    deriveEventsForUrl,
    deriveOtherRooms,
    makeChannelId,
    userRoomsByUrl,
  } from "@app/state"
  import {makeChatPath, makeThreadPath, makeCalendarPath, makeGitPath} from "@app/routes"
  import {pushModal} from "@app/modal"
  import ChannelName from "@src/app/components/ChannelName.svelte"

  const url = decodeRelay($page.params.relay)
  const relay = deriveRelay(url)
  const otherRooms = deriveOtherRooms(url)
  const threadsPath = makeThreadPath(url)
  const calendarPath = makeCalendarPath(url)
  const gitPath = makeGitPath(url)
  const mentions = deriveEventsForUrl(url, [{"#p": [$pubkey!], kinds: [MESSAGE, THREAD]}])

  const joinSpace = () => pushModal(SpaceJoin, {url})

  const owner = $derived($relay?.profile?.pubkey)
</script>

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
      {:else if $pubkey}
        <Link class="btn btn-primary btn-sm" href={makeChatPath([$pubkey])}>
          <Icon icon="letter" />
          Contact Owner
        </Link>
      {/if}
      <MenuSpaceButton {url} />
    </div>
  {/snippet}
</PageBar>

<PageContent class="flex flex-col gap-2 p-2 pt-4">
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
      <div class="flex min-w-0 flex-col gap-1">
        <h2 class="ellipsize whitespace-nowrap text-xl">
          <RelayName {url} />
        </h2>
        <p class="ellipsize text-sm opacity-75">{displayRelayUrl(url)}</p>
      </div>
    </div>
    <RelayDescription {url} />
    {#if $relay?.profile?.terms_of_service || $relay?.profile?.privacy_policy}
      <div class="flex gap-3">
        {#if $relay.profile.terms_of_service}
          <Link href={$relay.profile.terms_of_service} class="badge badge-neutral flex gap-2">
            <Icon icon="bill-list" size={4} />
            Terms of Service
          </Link>
        {/if}
        {#if $relay.profile.privacy_policy}
          <Link href={$relay?.profile?.privacy_policy} class="badge badge-neutral flex gap-2">
            <Icon icon="shield-user" size={4} />
            Privacy Policy
          </Link>
        {/if}
      </div>
    {/if}
  </div>
  <SpaceQuickLinks {url} />
  <div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
    <div class="flex flex-col gap-2">
      <div class="card2 bg-alt">
        <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Icon icon="chat-round" />
          Recent Activity
        </h3>
        <div class="flex flex-col gap-3">
          {#if $otherRooms.length > 0}
            {#each $otherRooms.slice(0, 3) as room (room)}
              {@const channel = $channelsById.get(makeChannelId(url, room))}
              <div class="flex items-center gap-3 rounded bg-base-100">
                <div class="flex items-center gap-2">
                  {#if channel?.closed || channel?.private}
                    <Icon icon="lock" size={4} />
                  {:else}
                    <Icon icon="hashtag" />
                  {/if}
                  <span class="font-medium">
                    <ChannelName {url} {room} />
                  </span>
                </div>
                <span class="ml-auto text-sm opacity-60">Active conversations</span>
              </div>
            {/each}
          {:else}
            <p class="text-sm opacity-60">No recent activity</p>
          {/if}
        </div>
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <SpaceRelayStatus {url} />
      {#if owner}
        <div class="card2 bg-alt">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Icon icon="user-rounded" />
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
