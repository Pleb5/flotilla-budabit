<script lang="ts">
  import {writable} from "svelte/store"
  import type {Instance} from "tippy.js"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Field from "@lib/components/Field.svelte"
  import Suggestions from "@lib/components/Suggestions.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import {preventDefault} from "@lib/html"
  import {
    normalizeRelays,
    type CommunityDefinition,
    type CommunityPointer,
  } from "@app/core/community"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"
  import CommunityStarButton from "@app/components/community/CommunityStarButton.svelte"
  import CommunitySuggestion from "@app/components/community/CommunitySuggestion.svelte"

  type Props = {
    community?: CommunityPointer
    definition?: CommunityDefinition
    relayHints?: string[]
    shareRelayHints?: string[]
    publishRelayHints?: string[]
    label: string
    emptyInfo: string
    onOpen: () => void
    inputValue?: string
    showInput?: boolean
    inputLabel?: string
    inputPlaceholder?: string
    showActions?: boolean
    loading?: boolean
    opening?: boolean
    notFound?: boolean
    unavailable?: boolean
    onSubmit?: () => void
    inputSearch?: (term: string) => string[]
    onInputSelect?: (pubkey: string) => void
    inputSuggestionDefinitions?: CommunityDefinition[]
  }

  let {
    community,
    definition,
    relayHints = [],
    shareRelayHints = relayHints,
    publishRelayHints = [],
    label,
    emptyInfo,
    onOpen,
    inputValue = $bindable(""),
    showInput = false,
    inputLabel = "Community naddr, owner, NIP-05, or name",
    inputPlaceholder = "naddr1..., npub1..., name, or NIP-05",
    showActions = true,
    loading = false,
    opening = false,
    notFound = false,
    unavailable = false,
    onSubmit = onOpen,
    inputSearch,
    onInputSelect,
    inputSuggestionDefinitions = [],
  }: Props = $props()

  const inputTerm = writable(inputValue)

  const shareRelays = $derived(normalizeRelays(shareRelayHints))
  const fallbackName = $derived(
    community
      ? `${community.naddr.slice(0, 18)}...${community.naddr.slice(-8)}`
      : "No community selected",
  )
  const name = $derived(
    notFound
      ? "Community not found"
      : unavailable
        ? "Community unavailable"
        : community
          ? definition?.metadata.name || fallbackName
          : fallbackName,
  )
  const info = $derived(
    notFound
      ? "No matching kind 32222 community definition was found."
      : unavailable
        ? "Relays did not return the community definition. Tap to retry."
        : opening
          ? "Opening community..."
          : loading
            ? "Looking for a community definition..."
            : community
              ? definition?.metadata.description || "Community definition metadata unavailable."
              : emptyInfo,
  )
  let failedPicture = $state("")
  let inputElement: Element | undefined = $state()
  let inputPopover: Instance | undefined = $state()
  let inputSuggestions: {onKeyDown?: (event: Event) => boolean} | undefined = $state()

  const picture = $derived(String(definition?.metadata.picture || "").trim())
  const showPicture = $derived(Boolean(picture && failedPicture !== picture))

  const submit = () => onSubmit?.()
  const searchInputSuggestions = (term: string) => {
    const items = inputSearch?.(term) || []

    if (term.trim() && items.length > 0) inputPopover?.show()
    else inputPopover?.hide()

    return items
  }
  const selectInputSuggestion = (value: string) => {
    if (onInputSelect) onInputSelect(value)
    else inputTerm.set(value)

    inputPopover?.hide()
  }
  const onInputKeyDown = (event: Event) => {
    if (inputSuggestions?.onKeyDown?.(event)) {
      event.preventDefault()
    }
  }

  $effect(() => {
    const value = inputValue

    inputTerm.update(current => (current === value ? current : value))
  })

  $effect(() => {
    const value = $inputTerm

    if (inputValue !== value) inputValue = value
  })
</script>

{#snippet preview()}
  <div class="flex w-full min-w-0 items-stretch gap-2">
    <button
      type="button"
      class="group flex min-w-0 flex-1 flex-col items-stretch gap-1 rounded-xl p-1 text-left transition-colors hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60 sm:p-2"
      class:bg-base-300={opening}
      aria-busy={loading || opening}
      disabled={!community || loading || opening || notFound}
      onclick={onOpen}>
      <p
        class="break-words text-[0.7rem] font-semibold uppercase leading-snug tracking-wide opacity-60 sm:text-xs">
        {label}
      </p>
      <div class="flex min-w-0 items-center gap-2 sm:gap-4">
        <div
          class="center !flex h-10 w-10 shrink-0 overflow-hidden rounded-full border border-solid border-base-300 bg-base-300 sm:h-16 sm:w-16">
          {#if community && !notFound && !unavailable && showPicture}
            <img
              alt=""
              src={picture}
              class="h-full w-full object-cover"
              onerror={() => (failedPicture = picture)} />
          {:else}
            <Icon icon={Ghost} size={7} />
          {/if}
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-lg font-bold leading-snug sm:text-xl">{name}</h2>
        </div>
        {#if loading || opening}
          <span class="loading loading-spinner loading-sm hidden shrink-0 opacity-60 sm:block"
          ></span>
        {:else if !notFound}
          <div
            class="hidden shrink-0 text-3xl opacity-50 transition-transform group-hover:translate-x-1 sm:block">
            &gt;
          </div>
        {/if}
      </div>
      <p class="break-words text-xs leading-snug opacity-70 sm:text-sm">{info}</p>
    </button>
    {#if community}
      <CommunityShareButton
        value={community}
        definitionRelays={shareRelays}
        class="btn btn-square btn-sm shrink-0 self-center" />
      {#if showActions}
        <CommunityStarButton
          {community}
          {publishRelayHints}
          class="btn btn-square btn-sm shrink-0 self-center" />
      {/if}
    {/if}
  </div>
{/snippet}

{#if showInput}
  <form
    class="card2 bg-alt flex w-full min-w-0 flex-col gap-3 !p-3 shadow-md sm:!p-4"
    onsubmit={preventDefault(submit)}>
    <Field>
      {#snippet label()}
        <p>{inputLabel}</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2" bind:this={inputElement}>
          <Icon icon={HomeSmile} />
          <input
            bind:value={$inputTerm}
            class="grow"
            type="text"
            aria-label={inputLabel}
            placeholder={inputPlaceholder}
            onkeydown={onInputKeyDown} />
        </label>
        {#if inputSearch}
          <Tippy
            bind:popover={inputPopover}
            bind:instance={inputSuggestions}
            component={Suggestions}
            props={{
              term: inputTerm,
              search: searchInputSuggestions,
              select: selectInputSuggestion,
              component: CommunitySuggestion,
              componentProps: {definitions: inputSuggestionDefinitions},
              showEmpty: false,
              throttleMs: 0,
              style: `left: 4px; width: ${(inputElement?.clientWidth || 0) + 12}px`,
            }}
            params={{
              trigger: "manual",
              placement: "bottom-start",
              offset: [0, 4],
              interactive: true,
              maxWidth: "none",
              getReferenceClientRect: () => inputElement!.getBoundingClientRect(),
            }} />
        {/if}
      {/snippet}
    </Field>
    {@render preview()}
  </form>
{:else}
  <div class="card2 bg-alt flex w-full min-w-0 items-stretch gap-2 p-2 shadow-md">
    {@render preview()}
  </div>
{/if}
