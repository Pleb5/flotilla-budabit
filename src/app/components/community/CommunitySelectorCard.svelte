<script lang="ts">
  import {deriveProfile, deriveProfileDisplay} from "@welshman/app"
  import {normalizeRelays} from "@app/core/community"
  import {hydratePubkeyProfiles} from "@app/core/community-state"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"
  import {formatShortNpub} from "@app/util/pubkeys"

  type Props = {
    pubkey: string
    relayHints?: string[]
    shareRelayHints?: string[]
    isCurrent?: boolean
    isAdmin?: boolean
    isModerator?: boolean
    loading?: boolean
    disabled?: boolean
    onOpen: () => void
  }

  const {
    pubkey,
    relayHints = [],
    shareRelayHints = relayHints,
    isCurrent = false,
    isAdmin = false,
    isModerator = false,
    loading = false,
    disabled = false,
    onOpen,
  }: Props = $props()

  const profileRelays = $derived(normalizeRelays(relayHints))
  const shareRelays = $derived(normalizeRelays(shareRelayHints))
  const profile = $derived(deriveProfile(pubkey, profileRelays))
  const profileDisplay = $derived(deriveProfileDisplay(pubkey, profileRelays))
  const fallbackName = $derived(formatShortNpub(pubkey) || "Unknown community")
  const name = $derived($profileDisplay || fallbackName)
  const info = $derived($profile?.about || profileRelays[0] || fallbackName)

  let profileHydrationKey = ""

  $effect(() => {
    const key = pubkey ? `${pubkey}:${profileRelays.join(",")}` : ""
    if (!key || profileHydrationKey === key) return

    profileHydrationKey = key
    hydratePubkeyProfiles({pubkeys: [pubkey], relayHints: profileRelays}).catch(() => {})
  })
</script>

<div
  class="flex items-center gap-1.5 rounded-xl border border-base-300 bg-base-100 p-1.5 sm:gap-2 sm:p-2">
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-70 sm:gap-3"
    class:bg-base-200={loading}
    aria-busy={loading}
    disabled={disabled || loading}
    onclick={onOpen}>
    <div
      class="center !flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-base-300 sm:h-10 sm:w-10">
      <ProfileCircle {pubkey} relays={profileRelays} size={10} />
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <strong class="truncate leading-tight">{name}</strong>
        <div class="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
          {#if isCurrent}
            <span class="badge badge-primary badge-sm shrink-0">Last visited</span>
          {/if}
          {#if isAdmin}
            <span class="badge badge-secondary badge-sm shrink-0">Admin</span>
          {/if}
          {#if isModerator}
            <span class="badge badge-accent badge-sm shrink-0">Moderator</span>
          {/if}
        </div>
      </div>
      <p class="truncate text-xs opacity-70">{info}</p>
    </div>
    {#if loading}
      <span class="loading loading-spinner loading-xs shrink-0 opacity-60"></span>
    {/if}
  </button>
  <CommunityShareButton communityPubkey={pubkey} relayHints={shareRelays} />
  <CommunityStarButton communityPubkey={pubkey} relayHints={profileRelays} />
</div>
