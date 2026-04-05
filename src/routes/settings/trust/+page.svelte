<script lang="ts">
  import {onMount} from "svelte"
  import {getFollows, getWotGraph, loadProfile, pubkey as sessionPubkey} from "@welshman/app"
  import ShieldCheck from "@assets/icons/shield-check.svg?dataurl"
  import Refresh from "@assets/icons/refresh.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Global from "@assets/icons/global.svg?dataurl"
  import Lock from "@assets/icons/lock.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import ProviderRecommendationRow from "./ProviderRecommendationRow.svelte"
  import {
    discoverNip85ExtraCapabilities,
    NIP85_USER_ASSERTION_KIND,
    getNip85CapabilityDescription,
    getNip85CapabilityLabel,
    getNip85ConfiguredProvidersByCapability,
    getNip85ProviderKey,
    getNip85RecommenderWeight,
    isNip85KnownCapability,
    nip85DiscoveredProviderCapabilities,
    nip85ExtraCapabilityDiscoveryState,
    loadNip85RecommendedUserProviders,
    nip85RecommendedUserProviders,
    nip85RecommendationState,
    parseNip85ProviderTag,
    removeNip85ConfiguredProvider,
    saveUserNip85ProviderConfig,
    setNip85ProviderVisibility,
    type Nip85ConfiguredProvider,
    type Nip85Provider,
    type Nip85ProviderVisibility,
    type Nip85ProviderVerificationResult,
    type Nip85RecommendedProvider,
    upsertNip85ConfiguredProvider,
    userNip85ConfiguredProviders,
    verifyNip85SelectedProviders,
  } from "@lib/budabit/nip85"

  type CapabilityRow = {
    provider: Nip85Provider | Nip85ConfiguredProvider | Nip85RecommendedProvider
    usageCount: number
    score: number
    recommenders: Array<{pubkey: string; weight: number}>
    selectedProvider?: Nip85ConfiguredProvider
  }

  type ProviderVerification = {
    status: "verified" | "missing" | "no_data" | "error"
    matchedPubkeys: string[]
    targetsWithData: string[]
    samplePubkeys: string[]
    availableTags: string[]
    error?: string
  }

  type CapabilityOption = {
    kindTag: string
    label: string
    description: string
    isKnown: boolean
    selectedCount: number
    recommendedCount: number
    rows: CapabilityRow[]
  }

  let providers = $state<Nip85ConfiguredProvider[]>([])
  let dirty = $state(false)
  let saving = $state(false)
  let refreshing = $state(false)
  let verifying = $state(false)
  let selectedCapability = $state("")
  let customKindTag = $state("30382:rank")
  let customKindTagOverride = $state("")
  let customServiceKey = $state("")
  let customRelayHint = $state("")
  let customVisibility = $state<Nip85ProviderVisibility>("public")
  let verificationResults = $state<Map<string, Nip85ProviderVerificationResult>>(new Map())
  let verificationSamplePubkeys = $state<string[]>([])
  let verificationState = $state<"idle" | "running" | "done" | "error">("idle")
  let verificationError = $state<string | null>(null)

  const softBadgePrimary = "badge border border-primary/25 bg-primary/15 text-primary"
  const softBadgeAccent = "badge border border-accent/25 bg-accent/15 text-accent"
  const softBadgeInfo = "badge border border-info/25 bg-info/15 text-info"
  const softBadgeSuccess = "badge border border-success/25 bg-success/15 text-success"
  const softBadgeWarning = "badge border border-warning/30 bg-warning/15 text-warning"
  const softBadgeError = "badge border border-error/25 bg-error/15 text-error"
  const softBadgeNeutral = "badge border border-base-content/10 bg-base-200/80 text-base-content/75"

  const managedProviders = $derived.by(() =>
    providers.filter(provider => provider.kind === NIP85_USER_ASSERTION_KIND),
  )

  const unmanagedProvidersCount = $derived.by(
    () => providers.filter(provider => provider.kind !== NIP85_USER_ASSERTION_KIND).length,
  )

  const providersByCapability = $derived.by(() =>
    getNip85ConfiguredProvidersByCapability(managedProviders),
  )

  const recommendedProvidersByCapability = $derived.by(() => {
    const byCapability = new Map<string, Nip85RecommendedProvider[]>()

    for (const [kindTag, recommendedProviders] of $nip85RecommendedUserProviders.entries()) {
      if (kindTag.startsWith("30382:")) {
        byCapability.set(kindTag, recommendedProviders)
      }
    }

    return byCapability
  })

  const recommendedEntries = $derived.by(() => Array.from(recommendedProvidersByCapability.values()).flat())

  const recommendedEntryCount = $derived.by(() => recommendedEntries.length)

  const recommendedServiceCount = $derived.by(
    () => new Set(recommendedEntries.map(provider => provider.serviceKey)).size,
  )

  const selectedServiceCount = $derived.by(
    () => new Set(managedProviders.map(provider => provider.serviceKey)).size,
  )

  const providerCatalogByServiceKey = $derived.by(() => {
    const providersByServiceKey = new Map<
      string,
      Nip85ConfiguredProvider | Nip85RecommendedProvider
    >()

    for (const provider of managedProviders) {
      if (!providersByServiceKey.has(provider.serviceKey)) {
        providersByServiceKey.set(provider.serviceKey, provider)
      }
    }

    for (const provider of recommendedEntries) {
      if (!providersByServiceKey.has(provider.serviceKey)) {
        providersByServiceKey.set(provider.serviceKey, provider)
      }
    }

    return providersByServiceKey
  })

  const capabilityOptions = $derived.by<CapabilityOption[]>(() => {
    const follows = $sessionPubkey ? getFollows($sessionPubkey) : []
    const wotGraph = getWotGraph()
    const capabilityKeys = new Set<string>()

    for (const provider of managedProviders) {
      capabilityKeys.add(provider.kindTag)
    }

    for (const kindTag of recommendedProvidersByCapability.keys()) {
      capabilityKeys.add(kindTag)
    }

    for (const kindTags of $nip85DiscoveredProviderCapabilities.values()) {
      for (const kindTag of kindTags) {
        if (kindTag.startsWith("30382:")) {
          capabilityKeys.add(kindTag)
        }
      }
    }

    return Array.from(capabilityKeys)
      .map(kindTag => {
        const selectedProviders = providersByCapability.get(kindTag) || []
        const selectedByKey = new Map(
          selectedProviders.map(provider => [getNip85ProviderKey(provider), provider]),
        )
        const recommendedProviders = recommendedProvidersByCapability.get(kindTag) || []
        const rows = new Map<string, CapabilityRow>()

        for (const provider of recommendedProviders) {
          rows.set(getNip85ProviderKey(provider), {
            provider,
            usageCount: provider.usageCount,
            score: provider.score,
            recommenders: provider.recommenders
              .map(pubkey => ({
                pubkey,
                weight: getNip85RecommenderWeight(pubkey, $sessionPubkey || "", follows, wotGraph),
              }))
              .sort((a, b) => b.weight - a.weight || a.pubkey.localeCompare(b.pubkey)),
            selectedProvider: selectedByKey.get(getNip85ProviderKey(provider)),
          })
        }

        for (const provider of selectedProviders) {
          const key = getNip85ProviderKey(provider)
          const existing = rows.get(key)

          rows.set(key, {
            provider: existing?.provider || provider,
            usageCount: existing?.usageCount || 0,
            score: existing?.score || 0,
            recommenders: existing?.recommenders || [],
            selectedProvider: provider,
          })
        }

        for (const [serviceKey, kindTags] of $nip85DiscoveredProviderCapabilities.entries()) {
          if (!kindTags.has(kindTag)) continue

          const existingProvider = providerCatalogByServiceKey.get(serviceKey)

          if (!existingProvider) continue

          const key = `${serviceKey}:${kindTag}`
          const existing = rows.get(key)

          rows.set(key, {
            provider: {
              kindTag,
              kind: NIP85_USER_ASSERTION_KIND,
              tag: kindTag.split(":")[1] || kindTag,
              serviceKey,
              relayHint: existingProvider.relayHint,
            },
            usageCount: existing?.usageCount || 0,
            score: existing?.score || 0,
            recommenders: existing?.recommenders || [],
            selectedProvider: existing?.selectedProvider || selectedByKey.get(key),
          })
        }

        return {
          kindTag,
          label: getNip85CapabilityLabel(kindTag),
          description: getNip85CapabilityDescription(kindTag),
          isKnown: isNip85KnownCapability(kindTag),
          selectedCount: selectedProviders.length,
          recommendedCount: recommendedProviders.length,
          rows: Array.from(rows.values()).sort((a, b) => {
            const aSelected = Boolean(a.selectedProvider)
            const bSelected = Boolean(b.selectedProvider)

            if (aSelected !== bSelected) return aSelected ? -1 : 1
            if (a.score !== b.score) return b.score - a.score
            if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount

            return a.provider.serviceKey.localeCompare(b.provider.serviceKey)
          }),
        }
      })
      .sort((a, b) => {
        const aSelected = a.selectedCount > 0
        const bSelected = b.selectedCount > 0

        if (aSelected !== bSelected) return aSelected ? -1 : 1
        if (a.selectedCount !== b.selectedCount) return b.selectedCount - a.selectedCount
        if (a.recommendedCount !== b.recommendedCount) return b.recommendedCount - a.recommendedCount
        if (a.isKnown !== b.isKnown) return a.isKnown ? -1 : 1

        return a.label.localeCompare(b.label)
      })
  })

  const extraCapabilityCount = $derived.by(
    () => capabilityOptions.filter(option => !option.isKnown).length,
  )

  const verificationByProviderKey = $derived.by(() => {
    const byProviderKey = new Map<string, ProviderVerification>()

    for (const provider of managedProviders) {
      const verification = verificationResults.get(provider.serviceKey)

      if (!verification) {
        continue
      }

      if (verification.status === "error") {
        byProviderKey.set(getNip85ProviderKey(provider), {
          status: "error",
          matchedPubkeys: [],
          targetsWithData: [],
          samplePubkeys: verification.samplePubkeys,
          availableTags: verification.availableTags,
          error: verification.error,
        })
        continue
      }

      if (verification.status === "no_data") {
        byProviderKey.set(getNip85ProviderKey(provider), {
          status: "no_data",
          matchedPubkeys: [],
          targetsWithData: [],
          samplePubkeys: verification.samplePubkeys,
          availableTags: [],
        })
        continue
      }

      const matchedPubkeys = verification.matchedTargetsByTag[provider.tag] || []

      byProviderKey.set(getNip85ProviderKey(provider), {
        status: matchedPubkeys.length > 0 ? "verified" : "missing",
        matchedPubkeys,
        targetsWithData: verification.targetsWithData,
        samplePubkeys: verification.samplePubkeys,
        availableTags: verification.availableTags,
      })
    }

    return byProviderKey
  })

  const verificationSummary = $derived.by(() => {
    let verified = 0
    let missing = 0
    let noData = 0
    let error = 0
    let unverified = 0

    for (const provider of managedProviders) {
      const verification = verificationByProviderKey.get(getNip85ProviderKey(provider))

      if (!verification) {
        unverified += 1
        continue
      }

      switch (verification.status) {
        case "verified":
          verified += 1
          break
        case "missing":
          missing += 1
          break
        case "no_data":
          noData += 1
          break
        case "error":
          error += 1
          break
      }
    }

    return {verified, missing, noData, error, unverified}
  })

  const verificationStatusText = $derived.by(() => {
    const sampleSize = verificationSamplePubkeys.length || 3

    if (verificationState === "running") {
      return `Verifying selected providers against a ${sampleSize}-profile sample from your WoT...`
    }

    if (verificationState === "error") {
      return verificationError || "Provider verification failed."
    }

    if (verificationState === "done") {
      return `Checked ${managedProviders.length} selected entries against a ${sampleSize}-profile sample from your WoT.`
    }

    return `Verify selected providers against a ${sampleSize}-profile sample from your WoT.`
  })

  const extraCapabilityDiscoveryStatus = $derived.by(() => {
    const state = $nip85ExtraCapabilityDiscoveryState

    if (state.status === "running") {
      return `Discovering extra capabilities: ${state.scannedProviders}/${state.totalProviders} providers`
    }

    if (state.status === "error") {
      return state.error || "Extra capability discovery failed."
    }

    if (state.status === "done") {
      if (state.discoveredCapabilities > 0) {
        return `Discovered ${state.discoveredCapabilities} capabilities from provider assertions.`
      }

      return "No extra capabilities discovered yet."
    }

    return "Scan recent provider assertions to discover additional capability tags beyond public 10040 declarations."
  })

  const suggestedKindTags = $derived.by(() => {
    const kindTags = new Set<string>()

    for (const provider of managedProviders) {
      kindTags.add(provider.kindTag)
    }

    for (const option of capabilityOptions) {
      kindTags.add(option.kindTag)
    }

    kindTags.add("30382:rank")
    kindTags.add("30382:followers")
    kindTags.add("30382:post_cnt")
    kindTags.add("30382:reply_cnt")
    kindTags.add("30382:reactions_cnt")
    kindTags.add("30382:first_created_at")
    kindTags.add("30382:zap_amt_recd")
    kindTags.add("30382:zap_amt_sent")
    kindTags.add("30382:zap_cnt_recd")
    kindTags.add("30382:zap_cnt_sent")
    kindTags.add("30382:zap_avg_amt_day_recd")
    kindTags.add("30382:zap_avg_amt_day_sent")
    kindTags.add("30382:reports_cnt_recd")
    kindTags.add("30382:reports_cnt_sent")
    kindTags.add("30382:t")
    kindTags.add("30382:active_hours_start")
    kindTags.add("30382:active_hours_end")

    return Array.from(kindTags).sort((a, b) =>
      getNip85CapabilityLabel(a).localeCompare(getNip85CapabilityLabel(b)),
    )
  })

  const activeCapability = $derived.by(
    () => capabilityOptions.find(option => option.kindTag === selectedCapability) || null,
  )

  const recommendationStatus = $derived.by(() => {
    const state = $nip85RecommendationState

    if (state.status === "loading" && state.phase === "relay_lists") {
      return `Analyzing relay lists for ${state.loadedAuthors}/${state.authors} trusted profiles...`
    }

    if (state.status === "loading" && state.phase === "provider_configs") {
      if (state.usedCachedRelays) {
        return `Using ${state.relayCount} cached relays to fetch provider configs${state.fetchedEvents > 0 ? ` (${state.fetchedEvents} events)` : ""}...`
      }

      return `Scanning ${state.relayCount} relays for provider configs${state.fetchedEvents > 0 ? ` (${state.fetchedEvents} events)` : ""}...`
    }

    if (state.status === "ready") {
      if (recommendedEntryCount === 0) {
        return state.relayCount > 0
          ? `No public provider configs were found on ${state.relayCount} discovery relays.`
          : "No discovery relays were available for trusted provider recommendations."
      }

      return `Found ${recommendedEntryCount} provider recommendations from ${recommendedServiceCount} unique services across ${capabilityOptions.length} visible capabilities using ${state.relayCount} relays.`
    }

    if (state.status === "error") {
      return state.error || "Unable to load provider recommendations."
    }

    return "Recommendations come from public kind 10040 selections in your follows and the stronger edges in your web of trust."
  })

  $effect(() => {
    if (dirty) return

    providers = [...$userNip85ConfiguredProviders]
  })

  $effect(() => {
    if (capabilityOptions.length === 0) {
      selectedCapability = ""
      return
    }

    if (!capabilityOptions.some(option => option.kindTag === selectedCapability)) {
      selectedCapability = capabilityOptions.find(option => option.selectedCount > 0)?.kindTag || capabilityOptions[0].kindTag
    }
  })

  const refreshRecommendations = async () => {
    refreshing = true

    try {
      await loadNip85RecommendedUserProviders()
    } catch (error: any) {
      pushToast({
        theme: "error",
        message: error?.message || "Unable to refresh trusted provider recommendations",
      })
    } finally {
      refreshing = false
    }
  }

  onMount(() => {
    refreshRecommendations()
  })

  const discoverExtras = async () => {
    try {
      await discoverNip85ExtraCapabilities()
    } catch (error: any) {
      pushToast({
        theme: "error",
        message: error?.message || "Unable to discover extra capabilities",
      })
    }
  }

  const verifySelectedProviders = async () => {
    if (managedProviders.length === 0) {
      pushToast({theme: "error", message: "Select one or more providers to verify."})
      return
    }

    verifying = true
    verificationState = "running"
    verificationError = null

    try {
      const verification = await verifyNip85SelectedProviders(managedProviders)

      verificationResults = verification.results
      verificationSamplePubkeys = verification.samplePubkeys
      verificationState = "done"

      await Promise.all(
        verification.samplePubkeys.map(pubkey => loadProfile(pubkey).catch(() => undefined)),
      )
    } catch (error: any) {
      const message = error?.message || "Provider verification failed"

      verificationResults = new Map()
      verificationSamplePubkeys = []
      verificationState = "error"
      verificationError = message
      pushToast({theme: "error", message})
    } finally {
      verifying = false
    }
  }

  const reset = () => {
    providers = [...$userNip85ConfiguredProviders]
    dirty = false
  }

  const switchProviderTag = (provider: Nip85ConfiguredProvider, tag: string) => {
    if (!tag || tag === provider.tag) return

    const nextProvider: Nip85ConfiguredProvider = {
      ...provider,
      tag,
      kindTag: `${provider.kind}:${tag}`,
    }

    providers = upsertNip85ConfiguredProvider(removeNip85ConfiguredProvider(providers, provider), nextProvider)
    selectedCapability = nextProvider.kindTag
    dirty = true
  }

  const selectProvider = (
    provider: Nip85Provider | Nip85ConfiguredProvider | Nip85RecommendedProvider,
    visibility: Nip85ProviderVisibility,
  ) => {
    providers = upsertNip85ConfiguredProvider(providers, {...provider, visibility})
    selectedCapability = provider.kindTag
    dirty = true
  }

  const setVisibility = (
    provider: Nip85Provider | Nip85ConfiguredProvider | Nip85RecommendedProvider,
    visibility: Nip85ProviderVisibility,
  ) => {
    providers = setNip85ProviderVisibility(providers, provider, visibility)
    selectedCapability = provider.kindTag
    dirty = true
  }

  const removeProvider = (provider: Nip85Provider | Nip85ConfiguredProvider | Nip85RecommendedProvider) => {
    providers = removeNip85ConfiguredProvider(providers, provider)
    dirty = true
  }

  const addCustomProvider = async () => {
    const effectiveKindTag = customKindTagOverride.trim() || customKindTag
    const provider = parseNip85ProviderTag(
      [effectiveKindTag, customServiceKey, customRelayHint],
      customVisibility,
    )

    if (!provider) {
      pushToast({
        theme: "error",
        message: "Enter a valid 30382:tag capability, provider pubkey/npub, and relay hint.",
      })
      return
    }

    if (provider.kind !== NIP85_USER_ASSERTION_KIND) {
      pushToast({
        theme: "error",
        message: "This page currently supports user assertion capabilities (30382:*).",
      })
      return
    }

    providers = upsertNip85ConfiguredProvider(providers, provider)
    selectedCapability = provider.kindTag
    dirty = true
    customServiceKey = ""
    customRelayHint = ""
    customKindTagOverride = ""

    await loadProfile(provider.serviceKey, [provider.relayHint]).catch(() => undefined)

    pushToast({message: `Added ${getNip85CapabilityLabel(provider.kindTag)} provider`})
  }

  const save = async () => {
    saving = true

    try {
      await saveUserNip85ProviderConfig(providers)
      dirty = false
      pushToast({message: "Trusted assertion providers saved"})
    } catch (error: any) {
      pushToast({
        theme: "error",
        message: error?.message || "Failed to save trusted assertion providers",
      })
    } finally {
      saving = false
    }
  }
</script>

<form class="content column gap-3 pb-24 sm:gap-4 sm:pb-12" onsubmit={preventDefault(save)}>
  <div class="card2 bg-alt flex flex-col gap-3 shadow-md sm:gap-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex flex-col gap-2">
        <strong class="flex items-center gap-3 text-base sm:text-lg">
          <Icon icon={ShieldCheck} /> Trusted Assertions
        </strong>
        <p class="max-w-3xl text-sm opacity-75 sm:text-sm">
          Budabit uses NIP-85 user assertions when you open a profile. Pick which providers you
          trust for each capability. Public selections help your network discover providers; private
          selections are stored with NIP-44 encryption in your kind 10040 config.
        </p>
      </div>
      <Button
        type="button"
        class="btn btn-neutral btn-sm inline-flex w-full items-center justify-center gap-2 text-center sm:w-auto sm:flex-none"
        onclick={refreshRecommendations}>
        {#if refreshing || $nip85RecommendationState.status === "loading"}
          <span class="loading loading-spinner loading-sm shrink-0"></span>
        {:else}
          <Icon icon={Refresh} size={4} class="shrink-0" />
        {/if}
        <span class="leading-none">Refresh recommendations</span>
      </Button>
    </div>

    <div class="flex flex-wrap gap-2 text-xs">
      <span class={softBadgePrimary}>{managedProviders.length} selected entries</span>
      <span class={softBadgeAccent}>{selectedServiceCount} selected services</span>
      <span class={softBadgeInfo}>{recommendedEntryCount} recommended entries</span>
      <span class={softBadgeSuccess}>{recommendedServiceCount} discovered services</span>
      <span class={softBadgeNeutral}>{capabilityOptions.length} capabilities</span>
      {#if extraCapabilityCount > 0}
        <span class={softBadgeWarning}>{extraCapabilityCount} extra capabilities</span>
      {/if}
    </div>

    <p class="text-sm opacity-75">{recommendationStatus}</p>
    <p class="text-xs opacity-60">
      Recommendation counts are per capability. A single provider service can appear more than once
      if people in your WoT use it for multiple capabilities.
    </p>

    {#if unmanagedProvidersCount > 0}
      <div class="rounded-box bg-base-200/60 p-3 text-sm opacity-80">
        Budabit is preserving {unmanagedProvidersCount}
        {unmanagedProvidersCount === 1 ? " non-profile entry" : " non-profile entries"} already
        present in your NIP-85 config.
      </div>
    {/if}
  </div>

  <div class="card2 bg-alt flex flex-col gap-3 shadow-md sm:gap-4">
    <div class="flex items-center gap-3">
      <Icon icon={AddCircle} />
      <strong class="text-base sm:text-lg">Custom Provider</strong>
    </div>
    <p class="text-sm opacity-75">
      Add a provider directly if it is not yet recommended by your web of trust.
    </p>
    <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
      <label class="flex flex-col gap-2">
        <span class="text-sm font-medium">Known capability</span>
        <select class="select select-bordered select-sm sm:select-md" bind:value={customKindTag}>
          {#each suggestedKindTags as kindTag (kindTag)}
            <option value={kindTag}>{getNip85CapabilityLabel(kindTag)}</option>
          {/each}
        </select>
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-sm font-medium">Provider pubkey or npub</span>
        <input
          class="input input-bordered input-sm sm:input-md"
          bind:value={customServiceKey}
          placeholder="npub1... or hex pubkey" />
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-sm font-medium">Relay hint</span>
        <input
          class="input input-bordered input-sm sm:input-md"
          bind:value={customRelayHint}
          placeholder="wss://relay.example.com" />
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-sm font-medium">Custom capability override</span>
        <input
          class="input input-bordered input-sm sm:input-md"
          bind:value={customKindTagOverride}
          placeholder="30382:personalizedPageRank" />
        <span class="text-xs opacity-60">
          Optional. Use this if the capability you want is not in the known list yet.
        </span>
      </label>

      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium">Visibility</span>
        <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button
            type="button"
            class={customVisibility === "public"
              ? "btn btn-primary btn-sm inline-flex items-center justify-center gap-2 sm:btn-md"
              : "btn btn-neutral btn-sm inline-flex items-center justify-center gap-2 sm:btn-md"}
            onclick={() => (customVisibility = "public")}>
            <Icon icon={Global} /> Public
          </Button>
          <Button
            type="button"
            class={customVisibility === "private"
              ? "btn btn-primary btn-sm inline-flex items-center justify-center gap-2 sm:btn-md"
              : "btn btn-neutral btn-sm inline-flex items-center justify-center gap-2 sm:btn-md"}
            onclick={() => (customVisibility = "private")}>
            <Icon icon={Lock} /> Private
          </Button>
        </div>
      </div>
    </div>
    <div class="flex justify-end">
      <Button
        type="button"
        class="btn btn-primary btn-sm inline-flex w-full items-center justify-center gap-2 sm:w-auto sm:btn-md"
        onclick={addCustomProvider}>
        <Icon icon={AddCircle} /> Add Provider
      </Button>
    </div>
  </div>

  {#if capabilityOptions.length > 0}
    <div class="card2 bg-alt flex flex-col gap-3 shadow-md sm:gap-4">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label class="flex flex-1 flex-col gap-2">
          <span class="text-sm font-medium">Select Capability</span>
          <select class="select select-bordered select-sm sm:select-md" bind:value={selectedCapability}>
            {#each capabilityOptions as option (option.kindTag)}
              <option value={option.kindTag}>{option.label}</option>
            {/each}
          </select>
        </label>

        {#if activeCapability}
          <div class="flex flex-wrap gap-2 text-xs">
            {#if activeCapability.selectedCount > 0}
              <span class={softBadgePrimary}>{activeCapability.selectedCount} selected</span>
            {/if}
            <span class={softBadgeInfo}>
              {activeCapability.recommendedCount} recommended
            </span>
            <span class={softBadgeAccent}>{activeCapability.rows.length} shown</span>
            {#if !activeCapability.isKnown}
              <span class={softBadgeWarning}>Extra capability</span>
            {/if}
          </div>
        {/if}
      </div>

      <div class="flex flex-col gap-2 rounded-box bg-base-200/40 p-3 sm:gap-3 sm:p-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="text-sm font-medium">Extra Capability Discovery</div>
            <div class="text-xs opacity-70">
              Scan recent provider assertions to surface additional `30382:*` tags that do not
              appear in public kind 10040 declarations.
            </div>
          </div>

          <Button
            type="button"
            class="btn btn-neutral btn-sm inline-flex w-full items-center justify-center gap-2 text-center sm:w-auto"
            onclick={discoverExtras}
            disabled={$nip85ExtraCapabilityDiscoveryState.status === "running" || recommendedServiceCount === 0}>
            {#if $nip85ExtraCapabilityDiscoveryState.status === "running"}
              <span class="loading loading-spinner loading-sm shrink-0"></span>
            {/if}
            <span class="leading-none">Discover extra capabilities</span>
          </Button>
        </div>

        <div class="text-xs opacity-75 sm:text-sm">{extraCapabilityDiscoveryStatus}</div>
      </div>

      <div class="flex flex-col gap-2 rounded-box bg-base-200/40 p-3 sm:gap-3 sm:p-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="text-sm font-medium">Provider Verification</div>
            <div class="text-xs opacity-70">
              Checks your selected providers against a 3-profile sample from your WoT.
            </div>
          </div>

          <Button
            type="button"
            class="btn btn-neutral btn-sm inline-flex w-full items-center justify-center gap-2 text-center sm:w-auto"
            onclick={verifySelectedProviders}
            disabled={verifying || managedProviders.length === 0}>
            {#if verifying}
              <span class="loading loading-spinner loading-sm shrink-0"></span>
            {/if}
            <span class="leading-none">Verify selected providers</span>
          </Button>
        </div>

        <div class="text-xs opacity-75 sm:text-sm">{verificationStatusText}</div>

        {#if verificationState !== "idle"}
          <div class="flex flex-wrap gap-2 text-xs">
            <span class={softBadgeSuccess}>{verificationSummary.verified} verified</span>
            <span class={softBadgeWarning}>{verificationSummary.missing} mismatched</span>
            <span class={softBadgeInfo}>{verificationSummary.noData} no data</span>
            <span class={softBadgeError}>{verificationSummary.error} errors</span>
            {#if verificationSummary.unverified > 0}
              <span class={softBadgeNeutral}>{verificationSummary.unverified} unchecked</span>
            {/if}
          </div>
        {/if}
      </div>

      {#if activeCapability}
        <div class="flex flex-col gap-2">
          <strong class="break-words text-base sm:text-lg">
            Providers for {activeCapability.label}
          </strong>
          <p class="text-sm opacity-75">{activeCapability.description}</p>
          <p class="text-xs opacity-60">
            User counts show how many people in your current WoT sample publicly selected each
            provider for this capability. WoT score weights those endorsements by self, follows,
            and stronger graph edges.
          </p>
        </div>

        <div class="flex flex-col gap-3">
          {#each activeCapability.rows as row (getNip85ProviderKey(row.provider))}
            <ProviderRecommendationRow
              provider={row.provider}
              usageCount={row.usageCount}
              score={row.score}
              recommenders={row.recommenders}
              selectedProvider={row.selectedProvider}
              verification={
                row.selectedProvider
                  ? verificationByProviderKey.get(getNip85ProviderKey(row.selectedProvider))
                  : undefined
              }
              onSelect={visibility => selectProvider(row.provider, visibility)}
              onSetVisibility={visibility => setVisibility(row.provider, visibility)}
              onSwitchTag={tag => row.selectedProvider && switchProviderTag(row.selectedProvider, tag)}
              onRemove={() => removeProvider(row.provider)} />
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="card2 bg-alt flex flex-col gap-3 shadow-md">
      <strong class="text-base sm:text-lg">No Provider Capabilities Yet</strong>
      <p class="text-sm opacity-75">
        Refresh recommendations to scan your web of trust, or add a provider manually above.
      </p>
    </div>
  {/if}

  <div class="mt-2 flex flex-col-reverse gap-2 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
    <Button
      type="button"
      class="btn btn-neutral btn-sm inline-flex w-full items-center justify-center gap-2 sm:w-auto sm:btn-md"
      onclick={reset}
      disabled={!dirty || saving}>
      Discard Changes
    </Button>
    <Button
      type="submit"
      class="btn btn-primary btn-sm inline-flex w-full items-center justify-center gap-2 sm:w-auto sm:btn-md"
      disabled={!dirty || saving}>
      {#if saving}
        <span class="loading loading-spinner loading-sm shrink-0"></span>
      {/if}
      <span class="leading-none">Save Providers</span>
    </Button>
  </div>
</form>
