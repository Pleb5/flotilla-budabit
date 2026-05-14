<script lang="ts">
  import {deriveProfile, deriveProfileDisplay} from "@welshman/app"
  import {normalizeRelays} from "@app/core/community"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"
  import {formatShortNpub} from "@app/util/pubkeys"

  type Props = {
    pubkey: string
    relayHints?: string[]
    isCurrent?: boolean
    onOpen: () => void
  }

  const {pubkey, relayHints = [], isCurrent = false, onOpen}: Props = $props()

  const profileRelays = $derived(normalizeRelays(relayHints))
  const profile = $derived(deriveProfile(pubkey, profileRelays))
  const profileDisplay = $derived(deriveProfileDisplay(pubkey, profileRelays))
  const fallbackName = $derived(formatShortNpub(pubkey) || "Unknown community")
  const name = $derived($profileDisplay || fallbackName)
  const info = $derived($profile?.about || profileRelays[0] || fallbackName)
</script>

<div class="flex items-center gap-2 rounded-xl border border-base-300 bg-base-100 p-2">
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-base-200"
    onclick={onOpen}>
    <div class="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-base-300">
      <ProfileCircle {pubkey} relays={profileRelays} size={10} />
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        <strong class="ellipsize">{name}</strong>
        {#if isCurrent}
          <span class="badge badge-primary badge-sm shrink-0">Last visited</span>
        {/if}
      </div>
      <p class="ellipsize text-xs opacity-70">{info}</p>
    </div>
  </button>
  <CommunityStarButton communityPubkey={pubkey} relayHints={profileRelays} />
</div>
