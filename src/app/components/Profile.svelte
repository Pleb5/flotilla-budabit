<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {removeUndefined} from "@welshman/lib"
  import {displayPubkey} from "@welshman/util"
  import {deriveHandleForPubkey, displayHandle, deriveProfileDisplay} from "@welshman/app"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"
  import {clip} from "@app/util/toast"
  import Copy from "@assets/icons/copy.svg?dataurl"

  type Props = {
    pubkey: string
    url?: string
    relays?: string[]
    showPubkey?: boolean
    avatarSize?: number
    hideDetails?: boolean
  }

  const {
    pubkey,
    url,
    relays = [],
    showPubkey,
    avatarSize = 10,
    hideDetails = false,
  }: Props = $props()

  const relayHints = $derived(removeUndefined([url, ...relays]))
  const profileDisplay = $derived(deriveProfileDisplay(pubkey, relayHints))
  const handle = $derived(deriveHandleForPubkey(pubkey))

  const openProfile = () =>
    pushModal(ProfileDetail, {pubkey, url: relayHints[0], relays: relayHints})

  const copyPubkey = () => clip(nip19.npubEncode(pubkey))
</script>

<div class="flex max-w-full items-start gap-3">
  <Button onclick={openProfile} class="py-1">
    <ProfileCircle {pubkey} relays={relayHints} size={avatarSize} />
  </Button>
  {#if !hideDetails}
    <div class="flex min-w-0 flex-col">
      <div class="flex items-center gap-2">
        <Button
          onclick={openProfile}
          class="text-bold overflow-hidden text-ellipsis whitespace-nowrap">
          {$profileDisplay}
        </Button>
      </div>
      {#if $handle}
        <div class="overflow-hidden text-ellipsis text-sm opacity-75">
          {displayHandle($handle)}
        </div>
      {/if}
      {#if showPubkey}
        <div class="flex items-center gap-2 overflow-hidden text-ellipsis text-sm opacity-70">
          {displayPubkey(pubkey)}
          <Button onclick={copyPubkey} class="shrink-0 p-1">
            <Icon size={4} icon={Copy} />
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</div>
