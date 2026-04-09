<script lang="ts">
  import {loadProfile, profilesByPubkey} from "@welshman/app"
  import {displayProfile, displayPubkey} from "@welshman/util"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import type {TrustGraphMetricSource} from "@lib/budabit/trust-graph-config"

  export type MetricSourcePickerOption = {
    value: string
    source: TrustGraphMetricSource
    capabilityLabel: string
    providerLabel: string
    unavailable?: boolean
    searchText: string
  }

  interface Props {
    value: string
    options: MetricSourcePickerOption[]
    onChange: (value: string) => void
  }

  const {value, options, onChange}: Props = $props()

  let isOpen = $state(false)
  let term = $state("")

  const selectedOption = $derived.by(() => options.find(option => option.value === value) || null)
  const filteredOptions = $derived.by(() => {
    const query = term.trim().toLowerCase()

    if (!query) return options

    return options.filter(option => option.searchText.includes(query))
  })

  const getProviderDisplay = (option: MetricSourcePickerOption) => {
    if (option.source.type === "basic_wot") {
      return option.providerLabel
    }

    const profile = $profilesByPubkey.get(option.source.serviceKey)

    return displayProfile(profile, displayPubkey(option.source.serviceKey))
  }

  const selectOption = (nextValue: string) => {
    onChange(nextValue)
    isOpen = false
    term = ""
  }

  $effect(() => {
    if (!isOpen) return

    for (const option of filteredOptions.slice(0, 12)) {
      if (option.source.type === "nip85") {
        loadProfile(option.source.serviceKey).catch(() => undefined)
      }
    }
  })
</script>

<div class="relative min-w-0">
  <button
    type="button"
    class="flex min-h-[3.5rem] w-full items-center justify-between gap-3 rounded-btn border border-base-300 bg-base-100 px-3 py-2 text-left"
    onclick={() => (isOpen = !isOpen)}>
    <div class="min-w-0 flex-1">
      {#if selectedOption}
        <div class="truncate text-sm font-medium">{selectedOption.capabilityLabel}</div>
        <div class="truncate text-xs opacity-65">{getProviderDisplay(selectedOption)}</div>
      {:else}
        <div class="text-sm opacity-60">Select a metric source</div>
      {/if}
    </div>

    <div class:rotate-180={isOpen} class="shrink-0 transition-transform opacity-70">
      <Icon icon={AltArrowDown} />
    </div>
  </button>

  {#if isOpen}
    <InlinePopover onClose={() => (isOpen = false)} align="left" widthClass="w-[min(32rem,calc(100vw-2rem))]">
      <div class="flex flex-col gap-3">
        <label class="input input-bordered input-sm flex w-full items-center gap-2">
          <Icon icon={Magnifier} size={4} class="opacity-60" />
          <input
            class="min-w-0 grow"
            type="text"
            bind:value={term}
            placeholder="Search capability or provider" />
        </label>

        <div class="max-h-[18rem] overflow-y-auto overscroll-contain">
          {#if filteredOptions.length > 0}
            <div class="flex flex-col gap-1">
              {#each filteredOptions as option (option.value)}
                <button
                  type="button"
                  class={`flex w-full items-center gap-3 rounded-box px-3 py-2 text-left transition-colors ${option.value === value ? "bg-primary/15 text-primary" : "hover:bg-base-200/70"}`}
                  onclick={() => selectOption(option.value)}>
                  {#if option.source.type === "nip85"}
                    <ProfileCircle pubkey={option.source.serviceKey} size={7} />
                  {:else}
                    <div class="flex h-7 w-7 items-center justify-center rounded-full bg-base-200 text-xs font-semibold">
                      W
                    </div>
                  {/if}

                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{option.capabilityLabel}</div>
                    <div class="truncate text-xs opacity-70">{getProviderDisplay(option)}</div>
                  </div>

                  {#if option.unavailable}
                    <span class="badge badge-neutral shrink-0 text-[10px]">Unavailable</span>
                  {/if}
                </button>
              {/each}
            </div>
          {:else}
            <div class="rounded-box bg-base-200/50 p-3 text-sm opacity-70">No metric sources match that search.</div>
          {/if}
        </div>
      </div>
    </InlinePopover>
  {/if}
</div>
