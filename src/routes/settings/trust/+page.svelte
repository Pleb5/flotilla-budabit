<script lang="ts">
  import {onMount} from "svelte"
  import {loadProfile, profilesByPubkey} from "@welshman/app"
  import ShieldCheck from "@assets/icons/shield-check.svg?dataurl"
  import Refresh from "@assets/icons/refresh.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Global from "@assets/icons/global.svg?dataurl"
  import Lock from "@assets/icons/lock.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import Link from "@lib/components/Link.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {displayProfile, displayPubkey} from "@welshman/util"
  import MetricSourcePicker, {type MetricSourcePickerOption} from "./MetricSourcePicker.svelte"
  import ProviderRecommendationRow from "./ProviderRecommendationRow.svelte"
  import {
    defaultTrustGraphConfig,
    getTrustGraphMetricSourceValue,
    hasEnabledTrustGraphRules,
    makeEmptyTrustGraphRule,
    makeTrustGraphMetricSourceOptions,
    makeTrustGraphPreset,
    normalizeTrustGraphConfig,
    parseTrustGraphMetricSourceValue,
    pruneUnavailableTrustGraphRules,
    removeTrustGraphRule,
    saveTrustGraphConfig,
    type TrustGraphConfig,
    type TrustGraphPreset,
    type TrustGraphRule,
    upsertTrustGraphRule,
    userTrustGraphConfigValues,
  } from "@lib/budabit/trust-graph-config"
  import {
    discoverNip85ExtraCapabilities,
    NIP85_USER_ASSERTION_KIND,
    getNip85CapabilityDescription,
    getNip85CapabilityLabel,
    getNip85ConfiguredProvidersByCapability,
    getNip85ProviderKey,
    isNip85KnownCapability,
    nip85DiscoveredProviderCapabilities,
    nip85ExtraCapabilityDiscoveryState,
    loadNip85RecommendedUserProviders,
    nip85RecommendedUserProviders,
    nip85RecommendationState,
    displayNip85ProviderWebsite,
    normalizeNip85ProviderWebsite,
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
    recommenders: Array<{pubkey: string}>
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

  type ServiceProviderWebsiteEntry = {
    serviceIdentity: string
    website: string
    websiteLabel: string
    providerKeys: string[]
    capabilityCount: number
    endorsementCount: number
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
  let graphConfig = $state<TrustGraphConfig>({...defaultTrustGraphConfig})
  let selectedGraphPreset = $state<TrustGraphPreset | "">("")
  let showServiceProviderHelp = $state(false)
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

  const graphMetricSourceOptions = $derived.by<MetricSourcePickerOption[]>(() => {
    const options: MetricSourcePickerOption[] = makeTrustGraphMetricSourceOptions(
      managedProviders,
    ).map(option => {
      if (option.source.type === "basic_wot") {
        return {
          ...option,
          capabilityLabel: "Basic WoT score",
          providerLabel: "Base social graph",
          unavailable: false,
          searchText: "basic wot score base social graph",
        }
      }

      const profile = $profilesByPubkey.get(option.source.serviceKey)
      const providerLabel = displayProfile(profile, displayPubkey(option.source.serviceKey))
      const capabilityLabel = getNip85CapabilityLabel(option.source.kindTag)

      return {
        ...option,
        capabilityLabel,
        providerLabel,
        unavailable: false,
        searchText: `${capabilityLabel} ${providerLabel}`.toLowerCase(),
      }
    })
    const byValue = new Map(options.map(option => [option.value, option]))

    for (const rule of graphConfig.rules) {
      const value = getTrustGraphMetricSourceValue(rule.source)

      if (!byValue.has(value)) {
        const providerLabel =
          rule.source.type === "basic_wot"
            ? "Basic WoT score"
            : displayProfile(
                $profilesByPubkey.get(rule.source.serviceKey),
                displayPubkey(rule.source.serviceKey),
              )
        const capabilityLabel =
          rule.source.type === "basic_wot"
            ? "Basic WoT score"
            : getNip85CapabilityLabel(rule.source.kindTag)

        byValue.set(value, {
          value,
          source: rule.source,
          capabilityLabel,
          providerLabel,
          unavailable: rule.source.type !== "basic_wot",
          searchText: `${capabilityLabel} ${providerLabel}`.toLowerCase(),
        })
      }
    }

    return Array.from(byValue.values()).sort((a, b) => {
      if (a.capabilityLabel !== b.capabilityLabel) {
        return a.capabilityLabel.localeCompare(b.capabilityLabel)
      }

      return a.providerLabel.localeCompare(b.providerLabel)
    })
  })

  const hasGraphAdjustments = $derived.by(() => hasEnabledTrustGraphRules(graphConfig))

  const graphAdjustmentStatus = $derived.by(() => {
    if (!hasGraphAdjustments) {
      return "Using basic WoT only. Add include/exclude rules to widen or narrow collaboration analysis."
    }

    return `${graphConfig.rules.filter(rule => rule.enabled).length} graph rule${graphConfig.rules.filter(rule => rule.enabled).length === 1 ? "" : "s"} active. Adjusted WoT will be used anywhere Budabit runs trust-based collaboration analysis.`
  })

  const graphAdjustmentHint = $derived.by(() => {
    const hasProviderSources = graphMetricSourceOptions.some(option => option.value !== "basic_wot")

    if (!hasProviderSources) {
      return "Select one or more trusted assertion providers below to unlock provider-based graph rules like rank, followers, and reports."
    }

    return "Presets use your selected providers for rank, followers, and report metrics when available."
  })

  const serviceProviderHelperText =
    "Budabit groups provider keys that share the same website in profile metadata into one service. Endorsed scores may be personalized to the endorser's viewpoint, so a provider-capability pair might reflect the view behind that key. To enforce your own view, visit the provider website and configure there. BudaBit should load your config automatically after setup."

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
    () =>
      new Set(
        recommendedEntries.map(provider =>
          "serviceIdentity" in provider && provider.serviceIdentity ? provider.serviceIdentity : provider.serviceKey,
        ),
      ).size,
  )

  const selectedServiceCount = $derived.by(
    () =>
      new Set(
        managedProviders.map(provider => {
          const profile = $profilesByPubkey.get(provider.serviceKey)

          return normalizeNip85ProviderWebsite(profile?.website) || provider.serviceKey
        }),
      ).size,
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

  const serviceProviderWebsiteEntries = $derived.by<ServiceProviderWebsiteEntry[]>(() => {
    const entries = new Map<
      string,
      {
        website?: string
        representativeServiceKey: string
        providerKeys: Set<string>
        capabilityLabels: Set<string>
        endorsementCount: number
        selectedCount: number
      }
    >()

    const upsertEntry = (
      provider: Nip85ConfiguredProvider | Nip85RecommendedProvider,
      source: "selected" | "recommended",
    ) => {
      const website =
        ("website" in provider && provider.website) ||
        normalizeNip85ProviderWebsite($profilesByPubkey.get(provider.serviceKey)?.website)
      const serviceIdentity =
        ("serviceIdentity" in provider && provider.serviceIdentity) || website || provider.serviceKey
      const existing =
        entries.get(serviceIdentity) ||
        {
          website: website || undefined,
          representativeServiceKey: provider.serviceKey,
          providerKeys: new Set<string>(),
          capabilityLabels: new Set<string>(),
          endorsementCount: 0,
          selectedCount: 0,
        }

      existing.website = existing.website || website || undefined

      const providerKeys =
        "providerKeys" in provider && provider.providerKeys?.length > 0
          ? provider.providerKeys
          : [provider.serviceKey]

      for (const providerKey of providerKeys) {
        existing.providerKeys.add(providerKey)
      }

      existing.capabilityLabels.add(getNip85CapabilityLabel(provider.kindTag))

      if (source === "recommended") {
        existing.endorsementCount +=
          "usageCount" in provider && typeof provider.usageCount === "number" ? provider.usageCount : 0
      } else {
        existing.selectedCount += 1
      }

      entries.set(serviceIdentity, existing)
    }

    for (const provider of recommendedEntries) {
      upsertEntry(provider, "recommended")
    }

    for (const provider of managedProviders) {
      upsertEntry(provider, "selected")
    }

    return Array.from(entries.entries())
      .map(([serviceIdentity, entry]) => {
        if (!entry.website) {
          return null
        }

        return {
          serviceIdentity,
          website: entry.website,
          websiteLabel: displayNip85ProviderWebsite(entry.website),
          providerKeys: Array.from(entry.providerKeys).sort((a, b) => a.localeCompare(b)),
          capabilityCount: entry.capabilityLabels.size,
          endorsementCount: entry.endorsementCount,
        }
      })
      .filter((entry): entry is ServiceProviderWebsiteEntry => Boolean(entry))
      .sort((a, b) => {
        if (a.endorsementCount !== b.endorsementCount) return b.endorsementCount - a.endorsementCount
        return a.websiteLabel.localeCompare(b.websiteLabel)
      })
  })

  const capabilityOptions = $derived.by<CapabilityOption[]>(() => {
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
            recommenders: provider.recommenders
              .map(pubkey => ({pubkey}))
              .sort((a, b) => a.pubkey.localeCompare(b.pubkey)),
            selectedProvider: selectedByKey.get(getNip85ProviderKey(provider)),
          })
        }

        for (const provider of selectedProviders) {
          const key = getNip85ProviderKey(provider)
          const existing = rows.get(key)

          rows.set(key, {
            provider: existing?.provider || provider,
            usageCount: existing?.usageCount || 0,
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
      if (recommendedEntryCount > 0) {
        return `Showing ${recommendedEntryCount} provider recommendation${recommendedEntryCount === 1 ? "" : "s"} so far while scanning ${state.relayCount} relays${state.fetchedEvents > 0 ? ` (${state.fetchedEvents} events)` : ""}...`
      }

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
    graphConfig = normalizeTrustGraphConfig($userTrustGraphConfigValues)
    selectedGraphPreset = $userTrustGraphConfigValues.preset || ""
  })

  $effect(() => {
    for (const provider of managedProviders) {
      loadProfile(provider.serviceKey, [provider.relayHint]).catch(() => undefined)
    }

    for (const option of graphMetricSourceOptions) {
      if (option.source.type === "nip85") {
        loadProfile(option.source.serviceKey).catch(() => undefined)
      }
    }
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

  const applyGraphPreset = (preset: TrustGraphPreset) => {
    const presetConfig = makeTrustGraphPreset(preset, managedProviders)

    if (presetConfig.rules.length === 0) {
      pushToast({
        theme: "error",
        message: "This preset needs selected rank, follower, or report providers first.",
      })
      return
    }

    graphConfig = presetConfig
    selectedGraphPreset = preset
    dirty = true
  }

  const addGraphRule = () => {
    graphConfig = normalizeTrustGraphConfig({
      ...upsertTrustGraphRule(graphConfig, makeEmptyTrustGraphRule(managedProviders)),
      preset: undefined,
    })
    selectedGraphPreset = ""
    dirty = true
  }

  const updateGraphRule = (ruleId: string, patch: Partial<TrustGraphRule>) => {
    const rule = graphConfig.rules.find(rule => rule.id === ruleId)

    if (!rule) return

    graphConfig = normalizeTrustGraphConfig({
      ...upsertTrustGraphRule(graphConfig, {...rule, ...patch}),
      preset: undefined,
    })
    selectedGraphPreset = ""
    dirty = true
  }

  const updateGraphRuleSource = (ruleId: string, value: string) => {
    const source = parseTrustGraphMetricSourceValue(value)

    if (!source) return

    updateGraphRule(ruleId, {
      source,
      threshold: source.type === "basic_wot" ? 1 : 50,
      operator: "gte",
    })
  }

  const deleteGraphRule = (ruleId: string) => {
    graphConfig = normalizeTrustGraphConfig({
      ...removeTrustGraphRule(graphConfig, ruleId),
      preset: undefined,
    })
    selectedGraphPreset = ""
    dirty = true
  }

  const reset = () => {
    providers = [...$userNip85ConfiguredProviders]
    graphConfig = normalizeTrustGraphConfig($userTrustGraphConfigValues)
    selectedGraphPreset = $userTrustGraphConfigValues.preset || ""
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
      const nextGraphConfig = pruneUnavailableTrustGraphRules(graphConfig, managedProviders)

      await saveUserNip85ProviderConfig(providers)
      await saveTrustGraphConfig(nextGraphConfig)

      graphConfig = nextGraphConfig
      dirty = false
      pushToast({message: "Trust settings saved"})
    } catch (error: any) {
      pushToast({
        theme: "error",
        message: error?.message || "Failed to save trust settings",
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
    <div class="flex items-start justify-between gap-3">
      <div class="flex flex-col gap-2">
        <strong class="text-base sm:text-lg">Service Provider Websites</strong>
        <p class="text-sm opacity-75">
          Aggregated from provider profiles Budabit has already collected from discovered service
          keys.
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-3">
        <span class={softBadgeNeutral}>{serviceProviderWebsiteEntries.length} discovered</span>
        <div class="relative shrink-0">
          <button
            type="button"
            class="text-sm text-primary underline-offset-2 hover:underline"
            onclick={() => (showServiceProviderHelp = !showServiceProviderHelp)}>
            How this works
          </button>

          {#if showServiceProviderHelp}
            <InlinePopover onClose={() => (showServiceProviderHelp = false)} align="right" widthClass="w-80">
              <div class="flex flex-col gap-3 text-sm">
                <div class="font-medium">Service grouping and view hints</div>
                <div class="text-xs leading-relaxed opacity-75">{serviceProviderHelperText}</div>
              </div>
            </InlinePopover>
          {/if}
        </div>
      </div>
    </div>

    <div class="rounded-box border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
      Endorsed scores may be personalized to the endorser's viewpoint.
    </div>

    {#if serviceProviderWebsiteEntries.length > 0}
      <div class="grid gap-3 lg:grid-cols-2">
        {#each serviceProviderWebsiteEntries as entry (entry.serviceIdentity)}
          <div class="rounded-box bg-base-100/40 p-4">
            <div class="flex flex-col gap-3">
              <div class="min-w-0">
                <Link
                  href={entry.website}
                  external
                  class="block truncate text-lg font-medium text-primary underline-offset-2 hover:underline">
                  {entry.websiteLabel}
                </Link>
                <div class="truncate text-sm opacity-65">{entry.website}</div>
              </div>

              <div class="flex flex-wrap gap-2 text-xs">
                {#if entry.endorsementCount > 0}
                  <span class={softBadgeInfo}>{entry.endorsementCount} endorsement{entry.endorsementCount === 1 ? "" : "s"}</span>
                {/if}
                <span class={softBadgeNeutral}>{entry.providerKeys.length} key{entry.providerKeys.length === 1 ? "" : "s"}</span>
                <span class={softBadgeNeutral}>{entry.capabilityCount} capabilit{entry.capabilityCount === 1 ? "y" : "ies"}</span>
              </div>

              <div class="text-xs opacity-70">
                To enforce your own view,
                <Link href={entry.website} external class="text-primary underline-offset-2 hover:underline">
                  visit the provider website
                </Link>
                and configure there. BudaBit should load your config automatically after setup.
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="rounded-box bg-base-200/60 p-3 text-sm opacity-80">No provider websites found.</div>
    {/if}
  </div>

  <div class="card2 bg-alt flex flex-col gap-3 shadow-md sm:gap-4">
    <div class="flex items-center gap-3">
      <Icon icon={ShieldCheck} />
      <strong class="text-base sm:text-lg">Graph Adjustments</strong>
    </div>
    <p class="text-sm opacity-75">
      Refine the basic WoT graph Budabit uses for collaboration analysis. These private rules can
      add or exclude people based on your selected scores; if you leave them empty, Budabit falls
      back to the basic WoT graph.
    </p>

    <div class="flex flex-wrap gap-2 text-xs">
      <span class={hasGraphAdjustments ? softBadgeSuccess : softBadgeWarning}>
        {hasGraphAdjustments ? "Adjusted WoT active" : "Basic WoT fallback"}
      </span>
      <span class={softBadgeNeutral}>{graphConfig.rules.length} rules</span>
    </div>

    <p class="text-sm opacity-75">{graphAdjustmentStatus}</p>
    <p class="text-xs opacity-60">{graphAdjustmentHint}</p>

    <div class="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
      <Button
        type="button"
        class={selectedGraphPreset === "balanced"
          ? "btn btn-primary btn-sm inline-flex items-center justify-center gap-2"
          : "btn btn-neutral btn-sm inline-flex items-center justify-center gap-2"}
        onclick={() => applyGraphPreset("balanced")}>
        Balanced
      </Button>
      <Button
        type="button"
        class={selectedGraphPreset === "conservative"
          ? "btn btn-primary btn-sm inline-flex items-center justify-center gap-2"
          : "btn btn-neutral btn-sm inline-flex items-center justify-center gap-2"}
        onclick={() => applyGraphPreset("conservative")}>
        Conservative
      </Button>
      <Button
        type="button"
        class={selectedGraphPreset === "open"
          ? "btn btn-primary btn-sm inline-flex items-center justify-center gap-2"
          : "btn btn-neutral btn-sm inline-flex items-center justify-center gap-2"}
        onclick={() => applyGraphPreset("open")}>
        Open
      </Button>
      <Button
        type="button"
        class="btn btn-neutral btn-sm inline-flex items-center justify-center gap-2"
        onclick={addGraphRule}>
        <Icon icon={AddCircle} /> Add rule
      </Button>
    </div>

    {#if graphConfig.rules.length > 0}
      <div class="flex flex-col gap-3">
        {#each graphConfig.rules as rule (rule.id)}
          <div class="rounded-box bg-base-100/40 p-3">
            <div class="grid gap-3 xl:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
              <label class="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  class="toggle toggle-sm"
                  checked={rule.enabled}
                  onchange={event =>
                    updateGraphRule(rule.id, {
                      enabled: (event.currentTarget as HTMLInputElement).checked,
                    })} />
                <span>Enabled</span>
              </label>

              <label class="flex flex-col gap-2">
                <span class="text-xs font-medium opacity-70">Metric source</span>
                <MetricSourcePicker
                  value={getTrustGraphMetricSourceValue(rule.source)}
                  options={graphMetricSourceOptions}
                  onChange={value => updateGraphRuleSource(rule.id, value)} />
              </label>

              <label class="flex flex-col gap-2">
                <span class="text-xs font-medium opacity-70">Action</span>
                <select
                  class="select select-bordered select-sm w-full"
                  value={rule.action}
                  onchange={event =>
                    updateGraphRule(rule.id, {
                      action: (event.currentTarget as HTMLSelectElement)
                        .value as TrustGraphRule["action"],
                    })}>
                  <option value="include">Include</option>
                  <option value="exclude">Exclude</option>
                </select>
              </label>

              <label class="flex flex-col gap-2">
                <span class="text-xs font-medium opacity-70">Comparison</span>
                <select
                  class="select select-bordered select-sm w-full"
                  value={rule.operator}
                  onchange={event =>
                    updateGraphRule(rule.id, {
                      operator: (event.currentTarget as HTMLSelectElement)
                        .value as TrustGraphRule["operator"],
                    })}>
                  <option value="gte">at least</option>
                  <option value="lte">at most</option>
                </select>
              </label>

              <label class="flex flex-col gap-2">
                <span class="text-xs font-medium opacity-70">Threshold</span>
                <input
                  type="number"
                  class="input input-bordered input-sm w-full"
                  value={rule.threshold}
                  step="1"
                  onchange={event =>
                    updateGraphRule(rule.id, {
                      threshold: Number((event.currentTarget as HTMLInputElement).value) || 0,
                    })} />
              </label>
            </div>

            <div class="mt-3 flex justify-end">
              <Button
                type="button"
                class="btn btn-neutral btn-xs inline-flex items-center justify-center gap-2 sm:btn-sm"
                onclick={() => deleteGraphRule(rule.id)}>
                Remove rule
              </Button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="rounded-box bg-base-200/60 p-3 text-sm opacity-80">
        No graph rules yet. Start with the Balanced preset or add a rule manually.
      </div>
    {/if}
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
            Endorsements count how many distinct people in your current WoT sample publicly
            selected each provider for this capability.
          </p>
        </div>

        <div class="flex flex-col gap-3">
          {#each activeCapability.rows as row (getNip85ProviderKey(row.provider))}
            <ProviderRecommendationRow
              provider={row.provider}
              usageCount={row.usageCount}
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
      <span class="leading-none">Save Trust Settings</span>
    </Button>
  </div>
</form>
