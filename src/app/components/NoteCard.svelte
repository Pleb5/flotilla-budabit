<script lang="ts">
  import type {Snippet} from "svelte"
  import {formatDate, formatExactDateTime} from "@welshman/lib"
  import {getListTags, getPubkeyTagValues} from "@welshman/util"
  import type {TrustedEvent} from "@welshman/util"
  import {userMuteList} from "@welshman/app"
  import Danger from "@assets/icons/danger-triangle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Profile from "@app/components/Profile.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {goToEvent} from "@app/util/routes"

  const {
    event,
    children,
    minimal = false,
    hideProfile = false,
    hideDate = false,
    url,
    relays = [],
    profileRole,
    loadProfile = true,
    dateInteractive = true,
    profileAvatarSize = 10,
    profileHeaderClass = "",
    profileCenterDetails = false,
    ...restProps
  }: {
    event: TrustedEvent
    children: Snippet
    minimal?: boolean
    hideProfile?: boolean
    hideDate?: boolean
    url?: string
    relays?: string[]
    profileRole?: string
    loadProfile?: boolean
    dateInteractive?: boolean
    profileAvatarSize?: number
    profileHeaderClass?: string
    profileCenterDetails?: boolean
    class?: string
  } = $props()

  const ignoreMute = () => {
    muted = false
  }

  let muted = $state(getPubkeyTagValues(getListTags($userMuteList)).includes(event.pubkey))
</script>

<div class="flex w-full min-w-0 flex-col gap-2 {restProps.class}">
  {#if muted}
    <div class="flex items-center justify-between">
      <div class="row-2 relative">
        <Icon icon={Danger} class="mt-1" />
        <p>You have muted this person.</p>
      </div>
      <Button class="link ml-8" onclick={ignoreMute}>Show anyway</Button>
    </div>
  {:else}
    <div class="flex justify-between gap-2 {profileHeaderClass}">
      {#if !hideProfile}
        <div class="flex gap-2">
          {#if minimal}
            @<ProfileName pubkey={event.pubkey} {url} {relays} {loadProfile} />
          {:else}
            <Profile
              pubkey={event.pubkey}
              {url}
              {relays}
              roleLabel={profileRole}
              avatarSize={profileAvatarSize}
              centerDetails={profileCenterDetails}
              {loadProfile} />
          {/if}
        </div>
      {/if}
      {#if !hideDate}
        {#if dateInteractive}
          <Button
            class="shrink-0 whitespace-nowrap text-xs opacity-75"
            title={formatExactDateTime(event.created_at * 1000)}
            onclick={() => goToEvent(event)}>
            {formatDate(event.created_at * 1000)}
          </Button>
        {:else}
          <span class="mr-2 shrink-0 whitespace-nowrap text-xs opacity-60" title={formatExactDateTime(event.created_at * 1000)}>
            {formatDate(event.created_at * 1000)}
          </span>
        {/if}
      {/if}
    </div>
    {@render children()}
  {/if}
</div>
