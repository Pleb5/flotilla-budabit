<script lang="ts">
  import {deriveProfile, deriveProfileDisplay} from "@welshman/app"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import {normalizeRelays} from "@app/core/community"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"
  import {formatShortNpub} from "@app/util/pubkeys"

  type Props = {
    pubkey: string
    relayHints?: string[]
    label: string
    emptyInfo: string
    onOpen: () => void
    inputValue?: string
    showInput?: boolean
    inputLabel?: string
    inputInfo?: string
    inputPlaceholder?: string
    onSubmit?: () => void
  }

  const EMPTY_PUBKEY = "0".repeat(64)

  let {
    pubkey,
    relayHints = [],
    label,
    emptyInfo,
    onOpen,
    inputValue = $bindable(""),
    showInput = false,
    inputLabel = "Community npub, hex, or ncommunity",
    inputInfo = "Entering a community makes it your current community on this device.",
    inputPlaceholder = "npub1... or ncommunity://...",
    onSubmit = onOpen,
  }: Props = $props()

  const profilePubkey = $derived(pubkey || EMPTY_PUBKEY)
  const profileRelays = $derived(normalizeRelays(relayHints))
  const profile = $derived(deriveProfile(profilePubkey, profileRelays))
  const profileDisplay = $derived(deriveProfileDisplay(profilePubkey, profileRelays))
  const fallbackName = $derived(
    pubkey ? formatShortNpub(pubkey) || "Unknown community" : "No community selected",
  )
  const name = $derived(pubkey ? $profileDisplay || fallbackName : fallbackName)
  const info = $derived(pubkey ? $profile?.about || profileRelays[0] || fallbackName : emptyInfo)

  const submit = () => onSubmit?.()
</script>

{#snippet preview()}
  <div class="flex items-stretch gap-2">
    <button
      type="button"
      class="group flex min-w-0 flex-1 items-center gap-4 rounded-xl p-2 text-left transition-colors hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={!pubkey}
      onclick={onOpen}>
      <div
        class="center !flex h-16 w-16 shrink-0 overflow-hidden rounded-full border border-solid border-base-300 bg-base-300">
        {#if pubkey && $profile?.picture}
          <img alt="" src={$profile.picture} class="h-full w-full object-cover" />
        {:else}
          <Icon icon={Ghost} size={7} />
        {/if}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-semibold uppercase tracking-wide opacity-60">{label}</p>
        <h2 class="ellipsize text-xl font-bold">{name}</h2>
        <p class="ellipsize text-sm opacity-70">{info}</p>
      </div>
      <div
        class="hidden text-3xl opacity-50 transition-transform group-hover:translate-x-1 sm:block">
        &gt;
      </div>
    </button>
    {#if pubkey}
      <CommunityStarButton
        communityPubkey={pubkey}
        relayHints={profileRelays}
        class="btn btn-square self-center" />
    {/if}
  </div>
{/snippet}

{#if showInput}
  <form
    class="card2 bg-alt flex w-full flex-col gap-3 p-4 shadow-md"
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
