<script lang="ts">
  import {loadProfile} from "@welshman/app"
  import {displayPubkey, displayRelayUrl} from "@welshman/util"
  import Global from "@assets/icons/global.svg?dataurl"
  import Lock from "@assets/icons/lock.svg?dataurl"
  import CloseCircle from "@assets/icons/close-circle.svg?dataurl"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"
  import type {
    Nip85ConfiguredProvider,
    Nip85Provider,
    Nip85ProviderVisibility,
    Nip85RecommendedProvider,
  } from "@lib/budabit/nip85"

  type Recommender = {
    pubkey: string
  }

  type Verification = {
    status: "verified" | "missing" | "no_data" | "error"
    matchedPubkeys: string[]
    targetsWithData: string[]
    samplePubkeys: string[]
    availableTags: string[]
    error?: string
  }

  interface Props {
    provider: Nip85Provider | Nip85ConfiguredProvider | Nip85RecommendedProvider
    usageCount: number
    recommenders: Recommender[]
    selectedProvider?: Nip85ConfiguredProvider
    verification?: Verification
    onSelect: (visibility: Nip85ProviderVisibility) => void
    onSetVisibility: (visibility: Nip85ProviderVisibility) => void
    onSwitchTag?: (tag: string) => void
    onRemove: () => void
  }

  const {
    provider,
    usageCount,
    recommenders,
    selectedProvider,
    verification,
    onSelect,
    onSetVisibility,
    onSwitchTag,
    onRemove,
  }: Props = $props()

  let showRecommenders = $state(false)
  const softBadgeInfo = "badge border border-info/25 bg-info/15 text-info"
  const softBadgePrimary = "badge border border-primary/25 bg-primary/15 text-primary"
  const softBadgeSuccess = "badge border border-success/25 bg-success/15 text-success"
  const softBadgeWarning = "badge border border-warning/30 bg-warning/15 text-warning"
  const softBadgeError = "badge border border-error/25 bg-error/15 text-error"
  const softBadgeNeutral = "badge border border-base-content/10 bg-base-200/80 text-base-content/75"

  const usageLabel = $derived(usageCount === 1 ? "1 user" : `${usageCount} users`)
  const verificationSummary = $derived.by(() => {
    if (!verification) return ""

    const sampleSize = verification.samplePubkeys.length

    switch (verification.status) {
      case "verified":
        return `Matched ${verification.matchedPubkeys.length}/${sampleSize} sample profiles.`
      case "missing":
        return `Provider published other tags for ${verification.targetsWithData.length}/${sampleSize} sample profiles.`
      case "no_data":
        return `No assertions found for the ${sampleSize}-profile sample.`
      case "error":
        return verification.error || "Verification failed."
    }
  })
  const switchableTags = $derived.by(() =>
    (verification?.availableTags || []).filter(tag => tag !== provider.tag),
  )
  const visibilityBadgeClass = $derived.by(() => {
    if (!selectedProvider) return ""

    return selectedProvider.visibility === "public" ? softBadgePrimary : softBadgeNeutral
  })
  const verificationBadgeClass = $derived.by(() => {
    if (!verification) return softBadgeNeutral

    switch (verification.status) {
      case "verified":
        return softBadgeSuccess
      case "missing":
        return softBadgeWarning
      case "no_data":
        return softBadgeInfo
      case "error":
        return softBadgeError
    }
  })

  const openProfile = (pubkey: string) => pushModal(ProfileDetail, {pubkey})

  $effect(() => {
    if (!verification) return

    for (const pubkey of verification.matchedPubkeys) {
      loadProfile(pubkey).catch(() => undefined)
    }
  })

  $effect(() => {
    loadProfile(provider.serviceKey, [provider.relayHint]).catch(() => undefined)
  })

  $effect(() => {
    if (!showRecommenders) return

    for (const recommender of recommenders) {
      loadProfile(recommender.pubkey).catch(() => undefined)
    }
  })
</script>

<div
  class={`rounded-box border bg-base-100/40 p-3 sm:p-4 ${selectedProvider ? "border-primary/50" : "border-base-300/60"}`}>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex min-w-0 gap-3">
        <Button type="button" class="shrink-0 p-0" onclick={() => openProfile(provider.serviceKey)}>
          <ProfileCircle pubkey={provider.serviceKey} size={8} />
        </Button>
        <div class="min-w-0">
          <Button
            type="button"
            class="truncate p-0 text-sm font-medium sm:text-base"
            onclick={() => openProfile(provider.serviceKey)}>
            <ProfileName pubkey={provider.serviceKey} />
          </Button>
          <div class="text-xs opacity-60">{displayPubkey(provider.serviceKey)}</div>
        </div>
      </div>

    <div class="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
      {#if usageCount > 0}
        <span class={softBadgeInfo}>{usageLabel}</span>
      {:else}
        <span class={softBadgeNeutral}>Custom only</span>
      {/if}

      {#if selectedProvider}
        <span class={visibilityBadgeClass}>
          {selectedProvider.visibility === "public" ? "Public" : "Private"}
        </span>
      {/if}
    </div>
  </div>

  <p class="mt-3 text-xs opacity-70">Publishes on {displayRelayUrl(provider.relayHint)}</p>

  {#if recommenders.length > 0}
    <div class="mt-3 rounded-box bg-base-200/50 p-2.5 sm:p-3">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 text-left"
        onclick={() => (showRecommenders = !showRecommenders)}>
        <div>
          <div class="text-sm font-medium">Recommended by</div>
          <div class="text-xs opacity-70">{usageLabel} in your current WoT sample</div>
        </div>

        <div class="flex items-center gap-2">
          <span class={softBadgeInfo}>{recommenders.length}</span>
          <div class:rotate-180={showRecommenders} class="transition-transform">
            <Icon icon={AltArrowDown} />
          </div>
        </div>
      </button>

      {#if showRecommenders}
        <div class="mt-3 flex flex-col gap-2">
          {#each recommenders as recommender (recommender.pubkey)}
            <div class="flex items-center justify-between gap-3 rounded-box bg-base-100/60 px-3 py-2">
              <div class="flex min-w-0 gap-3">
                <Button
                  type="button"
                  class="shrink-0 p-0"
                  onclick={() => openProfile(recommender.pubkey)}>
                  <ProfileCircle pubkey={recommender.pubkey} size={7} />
                </Button>
                <div class="min-w-0">
                  <Button
                    type="button"
                    class="truncate p-0 text-sm font-medium"
                    onclick={() => openProfile(recommender.pubkey)}>
                    <ProfileName pubkey={recommender.pubkey} />
                  </Button>
                  <div class="text-xs opacity-60">{displayPubkey(recommender.pubkey)}</div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if selectedProvider && verification}
    <div class="mt-3 rounded-box bg-base-200/50 p-2.5 sm:p-3">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div class="text-sm font-medium">Verification</div>
          <div class="text-xs opacity-70">3-profile sample from your WoT</div>
        </div>

        <span class={verificationBadgeClass}>
          {#if verification.status === "verified"}
            Verified
          {:else if verification.status === "missing"}
            Tag mismatch
          {:else if verification.status === "no_data"}
            No data
          {:else}
            Error
          {/if}
        </span>
      </div>

      <div class="mt-2 text-sm opacity-75">{verificationSummary}</div>

      {#if verification.status === "verified" && verification.matchedPubkeys.length > 0}
        <div class="mt-3 flex flex-col gap-2">
          {#each verification.matchedPubkeys as matchedPubkey (matchedPubkey)}
            <div class="flex items-center gap-3 rounded-box bg-base-100/60 px-3 py-2">
              <Button type="button" class="shrink-0 p-0" onclick={() => openProfile(matchedPubkey)}>
                <ProfileCircle pubkey={matchedPubkey} size={7} />
              </Button>
              <div class="min-w-0">
                <Button
                  type="button"
                  class="truncate p-0 text-sm font-medium"
                  onclick={() => openProfile(matchedPubkey)}>
                  <ProfileName pubkey={matchedPubkey} />
                </Button>
                <div class="text-xs opacity-60">{displayPubkey(matchedPubkey)}</div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if verification.status === "missing" && switchableTags.length > 0}
        <div class="mt-3 flex flex-col gap-2">
          <div class="text-xs opacity-70">Switch to a published tag from this provider:</div>
          <div class="flex flex-wrap gap-2">
            {#each switchableTags as tag (tag)}
              <Button
                type="button"
                class="btn btn-neutral btn-xs break-all"
                onclick={() => onSwitchTag?.(tag)}>
                {tag}
              </Button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <div class="mt-3 flex flex-wrap gap-2">
    {#if selectedProvider}
      <Button
        type="button"
        class={selectedProvider.visibility === "public"
          ? "btn btn-primary btn-xs inline-flex items-center justify-center gap-2 sm:btn-sm"
          : "btn btn-neutral btn-xs inline-flex items-center justify-center gap-2 sm:btn-sm"}
        onclick={() => onSetVisibility("public")}>
        <Icon icon={Global} /> Public
      </Button>
      <Button
        type="button"
        class={selectedProvider.visibility === "private"
          ? "btn btn-primary btn-xs inline-flex items-center justify-center gap-2 sm:btn-sm"
          : "btn btn-neutral btn-xs inline-flex items-center justify-center gap-2 sm:btn-sm"}
        onclick={() => onSetVisibility("private")}>
        <Icon icon={Lock} /> Private
      </Button>
      <Button
        type="button"
        class="btn btn-neutral btn-xs inline-flex items-center justify-center gap-2 sm:btn-sm"
        onclick={onRemove}>
        <Icon icon={CloseCircle} /> Remove
      </Button>
    {:else}
      <Button
        type="button"
        class="btn btn-primary btn-xs inline-flex items-center justify-center gap-2 sm:btn-sm"
        onclick={() => onSelect("public")}>
        <Icon icon={Global} /> Select Public
      </Button>
      <Button
        type="button"
        class="btn btn-neutral btn-xs inline-flex items-center justify-center gap-2 sm:btn-sm"
        onclick={() => onSelect("private")}>
        <Icon icon={Lock} /> Select Private
      </Button>
    {/if}
  </div>
</div>
