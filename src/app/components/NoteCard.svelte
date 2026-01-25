<script lang="ts">
  import type {Snippet} from "svelte"
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
    ...restProps
  }: {
    event: TrustedEvent
    children: Snippet
    minimal?: boolean
    hideProfile?: boolean
    hideDate?: boolean
    url?: string
    class?: string
  } = $props()

  const ignoreMute = () => {
    muted = false
  }

  // Format date as dd/mm/yy
  const formatShortDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000)
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const yy = String(date.getFullYear()).slice(-2)
    return `${dd}/${mm}/${yy}`
  }

  let muted = $state(getPubkeyTagValues(getListTags($userMuteList)).includes(event.pubkey))
</script>

<div class="flex flex-col gap-2 {restProps.class}">
  {#if muted}
    <div class="flex items-center justify-between">
      <div class="row-2 relative">
        <Icon icon={Danger} class="mt-1" />
        <p>You have muted this person.</p>
      </div>
      <Button class="link ml-8" onclick={ignoreMute}>Show anyway</Button>
    </div>
  {:else}
    <div class="flex justify-between gap-2">
      {#if !hideProfile}
        <div class="flex gap-2">
          {#if minimal}
            @<ProfileName pubkey={event.pubkey} {url} />
          {:else}
            <Profile pubkey={event.pubkey} {url} />
          {/if}
        </div>
      {/if}
      {#if !hideDate}
        <Button
          class="shrink-0 whitespace-nowrap text-xs opacity-75"
          onclick={() => goToEvent(event)}>
          {formatShortDate(event.created_at)}
        </Button>
      {/if}
    </div>
    {@render children()}
  {/if}
</div>
