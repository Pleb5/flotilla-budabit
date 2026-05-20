<script lang="ts">
  import {deriveProfile, deriveProfileDisplay} from "@welshman/app"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import {normalizeRelays} from "@app/core/community"
  import {hydratePubkeyProfiles} from "@app/core/community-state"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"
  import {formatShortNpub} from "@app/util/pubkeys"

  type Props = {
    pubkey: string
    relayHints?: string[]
    shareRelayHints?: string[]
    label: string
    emptyInfo: string
    onOpen: () => void
    inputValue?: string
    showInput?: boolean
    inputLabel?: string
    inputInfo?: string
    inputPlaceholder?: string
    showActions?: boolean
    loading?: boolean
    opening?: boolean
    notFound?: boolean
    onSubmit?: () => void
  }

  const EMPTY_PUBKEY = "0".repeat(64)

  let {
    pubkey,
    relayHints = [],
    shareRelayHints = relayHints,
    label,
    emptyInfo,
    onOpen,
    inputValue = $bindable(""),
    showInput = false,
    inputLabel = "Community npub, hex, or ncommunity",
    inputInfo = "Entering a community makes it your current community on this device.",
    inputPlaceholder = "npub1... or ncommunity://...",
    showActions = true,
    loading = false,
    opening = false,
    notFound = false,
    onSubmit = onOpen,
  }: Props = $props()

  const profilePubkey = $derived(pubkey || EMPTY_PUBKEY)
  const profileRelays = $derived(normalizeRelays(relayHints))
  const shareRelays = $derived(normalizeRelays(shareRelayHints))
  const profile = $derived(deriveProfile(profilePubkey, profileRelays))
  const profileDisplay = $derived(deriveProfileDisplay(profilePubkey, profileRelays))
  const fallbackName = $derived(
    pubkey ? formatShortNpub(pubkey) || "Unknown community" : "No community selected",
  )
  const name = $derived(
    notFound ? "Community not found" : pubkey ? $profileDisplay || fallbackName : fallbackName,
  )
  const info = $derived(
    notFound
      ? "No kind 10222 community definition was found for this npub."
      : opening
        ? "Opening community..."
        : loading
          ? "Looking for a community definition..."
          : pubkey
            ? $profile?.about || profileRelays[0] || fallbackName
            : emptyInfo,
  )

  const submit = () => onSubmit?.()

  let profileHydrationKey = ""

  $effect(() => {
    const key = pubkey ? `${pubkey}:${profileRelays.join(",")}` : ""
    if (!key || profileHydrationKey === key) return

    profileHydrationKey = key
    hydratePubkeyProfiles({pubkeys: [pubkey], relayHints: profileRelays}).catch(() => {})
  })
</script>

{#snippet preview()}
  <div class="flex items-stretch gap-2">
    <button
      type="button"
      class="group flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left transition-colors hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60 sm:gap-4 sm:p-2"
      class:bg-base-300={opening}
      aria-busy={loading || opening}
      disabled={!pubkey || loading || opening || notFound}
      onclick={onOpen}>
      <div
        class="center !flex h-12 w-12 shrink-0 overflow-hidden rounded-full border border-solid border-base-300 bg-base-300 sm:h-16 sm:w-16">
        {#if pubkey && !notFound && $profile?.picture}
          <img alt="" src={$profile.picture} class="h-full w-full object-cover" />
        {:else}
          <Icon icon={Ghost} size={7} />
        {/if}
      </div>
      <div class="min-w-0 flex-1">
        <p
          class="truncate text-[0.7rem] font-semibold uppercase tracking-wide opacity-60 sm:text-xs">
          {label}
        </p>
        <h2 class="truncate text-lg font-bold leading-snug sm:text-xl">{name}</h2>
        <p class="truncate text-xs opacity-70 sm:text-sm">{info}</p>
      </div>
      {#if loading || opening}
        <span class="loading loading-spinner loading-sm hidden opacity-60 sm:block"></span>
      {:else if !notFound}
        <div
          class="hidden text-3xl opacity-50 transition-transform group-hover:translate-x-1 sm:block">
          &gt;
        </div>
      {/if}
    </button>
    {#if pubkey && showActions}
      <CommunityShareButton
        communityPubkey={pubkey}
        relayHints={shareRelays}
        class="btn btn-square self-center" />
      <CommunityStarButton
        communityPubkey={pubkey}
        relayHints={profileRelays}
        class="btn btn-square self-center" />
    {/if}
  </div>
{/snippet}

{#if showInput}
  <form
    class="card2 bg-alt flex w-full flex-col gap-3 !p-3 shadow-md sm:!p-4"
    onsubmit={preventDefault(submit)}>
    <Field>
      {#snippet label()}
        <p>{inputLabel}</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={HomeSmile} />
          <input bind:value={inputValue} class="grow" type="text" placeholder={inputPlaceholder} />
        </label>
      {/snippet}
      {#snippet info()}
        {inputInfo}
      {/snippet}
    </Field>
    {@render preview()}
  </form>
{:else}
  <div class="card2 bg-alt flex w-full items-stretch gap-2 p-2 shadow-md">
    {@render preview()}
  </div>
{/if}
