import {derived, get, writable} from "svelte/store"
import {chunk} from "@welshman/lib"
import {load, makeLoader} from "@welshman/net"
import {Router} from "@welshman/router"
import {deriveItemsByKey, getter, makeLoadItem} from "@welshman/store"
import {
  Address,
  RELAYS,
  RelayMode,
  asDecryptedEvent,
  getIdFilters,
  getRelaysFromList,
  makeList,
  readList,
  type PublishedList,
  type TrustedEvent,
  updateList,
} from "@welshman/util"
import {
  ensurePlaintext,
  getFollows,
  getWotGraph,
  loadProfile,
  makeOutboxLoader,
  makeUserData,
  makeUserLoader,
  nip44EncryptToSelf,
  pubkey,
  publishThunk,
  repository,
  signer,
} from "@welshman/app"
import {
  NIP85_PROVIDER_CONFIG_KIND,
  NIP85_USER_ASSERTION_KIND,
  aggregateNip85RecommendedProviders,
  aggregateNip85UserAssertions,
  dedupeNip85ConfiguredProviders,
  extractNip85AssertionTagNames,
  getNip85RecommendationAuthors,
  getNip85VerificationSamplePubkeys,
  getNip85UserAssertionAvailableTags,
  normalizeNip85RelayHint,
  parseNip85ProviderTags,
  parseNip85UserAssertion,
  rankNip85Relays,
  splitNip85ConfiguredProviders,
  type Nip85ConfiguredProvider,
  type Nip85FetchedUserAssertion,
  type Nip85RecommendedProvider,
  type Nip85UserAssertionSummary,
} from "./nip85-core"

export * from "./nip85-core"

export type Nip85ProviderConfigItem = {
  event: TrustedEvent
  list: PublishedList
  publicProviders: Nip85ConfiguredProvider[]
  privateProviders: Nip85ConfiguredProvider[]
  providers: Nip85ConfiguredProvider[]
}

export type Nip85RecommendationState = {
  status: "idle" | "loading" | "ready" | "error"
  phase?: "relay_lists" | "provider_configs"
  authors: number
  loadedAuthors: number
  relayCount: number
  fetchedEvents: number
  providerCount: number
  capabilityCount: number
  usedCachedRelays: boolean
  error?: string
}

export type Nip85ExtraCapabilityDiscoveryState = {
  status: "idle" | "running" | "done" | "error"
  totalProviders: number
  scannedProviders: number
  discoveredCapabilities: number
  errors: number
  lastRun?: number
  error?: string
}

export type Nip85ProviderVerificationResult = {
  serviceKey: string
  samplePubkeys: string[]
  targetsWithData: string[]
  matchedTargetsByTag: Record<string, string[]>
  availableTags: string[]
  status: "data" | "no_data" | "error"
  updatedAt: number
  error?: string
}

const defaultRecommendationState: Nip85RecommendationState = {
  status: "idle",
  authors: 0,
  loadedAuthors: 0,
  relayCount: 0,
  fetchedEvents: 0,
  providerCount: 0,
  capabilityCount: 0,
  usedCachedRelays: false,
}

const defaultExtraCapabilityDiscoveryState: Nip85ExtraCapabilityDiscoveryState = {
  status: "idle",
  totalProviders: 0,
  scannedProviders: 0,
  discoveredCapabilities: 0,
  errors: 0,
}

const NIP85_RECOMMENDATION_RELAY_LIMIT = 8
const NIP85_RECOMMENDATION_RELAY_LIST_BATCH_SIZE = 25
const NIP85_RECOMMENDATION_RELAY_CACHE_TTL = 1000 * 60 * 30
const NIP85_RECOMMENDATION_RELAY_CACHE_PREFIX = "budabit:nip85:recommendation-relays:"
const nip85DiscoveryLoad = makeLoader({delay: 200, timeout: 6000, threshold: 0.5})
const nip85ExtraCapabilityLoad = makeLoader({delay: 200, timeout: 5000, threshold: 0.5})
const NIP85_EXTRA_CAPABILITY_EVENT_LIMIT = 10

const getLatestEvent = (events: Iterable<TrustedEvent>) => {
  let latest: TrustedEvent | undefined

  for (const event of events) {
    if (!latest || event.created_at > latest.created_at) {
      latest = event
    }
  }

  return latest
}

const getLatestEventsByPubkey = (events: Iterable<TrustedEvent>) => {
  const latestByPubkey = new Map<string, TrustedEvent>()

  for (const event of events) {
    const existing = latestByPubkey.get(event.pubkey)

    if (!existing || event.created_at > existing.created_at) {
      latestByPubkey.set(event.pubkey, event)
    }
  }

  return latestByPubkey
}

const normalizeRelayList = (relays: string[]) => {
  const normalized = new Set<string>()

  for (const relay of relays) {
    const url = normalizeNip85RelayHint(relay)

    if (url) {
      normalized.add(url)
    }
  }

  return Array.from(normalized)
}

const getNip85RecommendationRelayCacheKey = (pubkey: string) =>
  `${NIP85_RECOMMENDATION_RELAY_CACHE_PREFIX}${pubkey}`

const readNip85RecommendationRelays = (pubkey: string) => {
  if (typeof sessionStorage === "undefined") return []

  try {
    const raw = sessionStorage.getItem(getNip85RecommendationRelayCacheKey(pubkey))

    if (!raw) return []

    const parsed = JSON.parse(raw) as {ts?: number; relays?: string[]}

    if ((parsed.ts || 0) < Date.now() - NIP85_RECOMMENDATION_RELAY_CACHE_TTL) {
      sessionStorage.removeItem(getNip85RecommendationRelayCacheKey(pubkey))
      return []
    }

    return normalizeRelayList(parsed.relays || []).slice(0, NIP85_RECOMMENDATION_RELAY_LIMIT)
  } catch {
    return []
  }
}

const writeNip85RecommendationRelays = (pubkey: string, relays: string[]) => {
  if (typeof sessionStorage === "undefined") return

  try {
    sessionStorage.setItem(
      getNip85RecommendationRelayCacheKey(pubkey),
      JSON.stringify({ts: Date.now(), relays: relays.slice(0, NIP85_RECOMMENDATION_RELAY_LIMIT)}),
    )
  } catch {
    // pass
  }
}

const getNip85BootstrapRelays = () =>
  normalizeRelayList([...Router.get().Index().getUrls(), ...Router.get().FromUser().getUrls()])

const countNip85RelayUsage = (events: Iterable<TrustedEvent>) => {
  const relayCounts = new Map<string, number>()

  for (const event of events) {
    const relays = normalizeRelayList(
      getRelaysFromList(readList(asDecryptedEvent(event)), RelayMode.Write),
    )

    for (const relay of relays) {
      relayCounts.set(relay, (relayCounts.get(relay) || 0) + 1)
    }
  }

  return relayCounts
}

const updateRecommendationProgress = (updates: Partial<Nip85RecommendationState>) =>
  nip85RecommendationState.update(state => ({...state, ...updates}))

const countDiscoveredCapabilities = (discovered: Map<string, Set<string>>) => {
  const capabilities = new Set<string>()

  for (const kindTags of discovered.values()) {
    for (const kindTag of kindTags) {
      capabilities.add(kindTag)
    }
  }

  return capabilities.size
}

const loadNip85RecommendationRelays = async (
  authors: string[],
  currentPubkey: string,
  currentRun: number,
  {preferCache = true}: {preferCache?: boolean} = {},
) => {
  const cachedRelays = preferCache ? readNip85RecommendationRelays(currentPubkey) : []

  if (cachedRelays.length > 0) {
    updateRecommendationProgress({
      phase: "provider_configs",
      relayCount: cachedRelays.length,
      usedCachedRelays: true,
    })

    return cachedRelays
  }

  const bootstrapRelays = getNip85BootstrapRelays()
  let loadedAuthors = 0
  const relayCounts = new Map<string, number>()

  updateRecommendationProgress({
    phase: "relay_lists",
    relayCount: bootstrapRelays.length,
    usedCachedRelays: false,
  })

  for (const pubkeys of chunk(NIP85_RECOMMENDATION_RELAY_LIST_BATCH_SIZE, authors)) {
    if (bootstrapRelays.length === 0) break

    await nip85DiscoveryLoad({
      filters: [{kinds: [RELAYS], authors: pubkeys}],
      relays: bootstrapRelays,
    })

    if (currentRun !== recommendationRun) {
      return []
    }

    const latestRelayLists = getLatestEventsByPubkey(
      repository.query([{kinds: [RELAYS], authors: pubkeys}]),
    )

    for (const [relay, count] of countNip85RelayUsage(latestRelayLists.values()).entries()) {
      relayCounts.set(relay, (relayCounts.get(relay) || 0) + count)
    }

    loadedAuthors += pubkeys.length

    updateRecommendationProgress({
      phase: "relay_lists",
      loadedAuthors: Math.min(authors.length, loadedAuthors),
      relayCount: bootstrapRelays.length,
      usedCachedRelays: false,
    })
  }

  const topRelays = rankNip85Relays(relayCounts, NIP85_RECOMMENDATION_RELAY_LIMIT)
  const recommendationRelays =
    topRelays.length > 0 ? topRelays : bootstrapRelays.slice(0, NIP85_RECOMMENDATION_RELAY_LIMIT)

  writeNip85RecommendationRelays(currentPubkey, recommendationRelays)

  updateRecommendationProgress({
    phase: "provider_configs",
    relayCount: recommendationRelays.length,
    loadedAuthors: authors.length,
    usedCachedRelays: false,
  })

  return recommendationRelays
}

const loadNip85RecommendationConfigs = async (
  authors: string[],
  relays: string[],
  currentRun: number,
  usedCachedRelays: boolean,
) => {
  const authorsSet = new Set(authors)
  let fetchedEvents = 0

  updateRecommendationProgress({
    phase: "provider_configs",
    relayCount: relays.length,
    loadedAuthors: authors.length,
    fetchedEvents: 0,
    usedCachedRelays,
  })

  if (relays.length === 0) {
    return new Map<string, TrustedEvent>()
  }

  const events = await nip85DiscoveryLoad({
    filters: [{kinds: [NIP85_PROVIDER_CONFIG_KIND]}],
    relays,
  })

  if (currentRun !== recommendationRun) {
    return new Map<string, TrustedEvent>()
  }

  fetchedEvents += events.length

  updateRecommendationProgress({
    phase: "provider_configs",
    relayCount: relays.length,
    loadedAuthors: authors.length,
    fetchedEvents,
    usedCachedRelays,
  })

  const latestEvents = new Map<string, TrustedEvent>()

  for (const [author, event] of getLatestEventsByPubkey(events)) {
    if (authorsSet.has(author)) {
      latestEvents.set(author, event)
    }
  }

  return latestEvents
}

const readNip85ProviderConfigList = async (event: TrustedEvent) => {
  let plaintext: string | undefined

  try {
    plaintext = await ensurePlaintext(event)
  } catch {
    // pass
  }

  return readList(asDecryptedEvent(event, plaintext ? {content: plaintext} : {}))
}

export const nip85ProviderConfigsByPubkey = deriveItemsByKey<Nip85ProviderConfigItem>({
  repository,
  filters: [{kinds: [NIP85_PROVIDER_CONFIG_KIND]}],
  getKey: item => item.event.pubkey,
  eventToItem: async event => {
    const list = await readNip85ProviderConfigList(event)
    const publicProviders = parseNip85ProviderTags(list.publicTags, "public")
    const privateProviders = parseNip85ProviderTags(list.privateTags, "private")
    const providers = dedupeNip85ConfiguredProviders([...publicProviders, ...privateProviders])

    return {event, list, publicProviders, privateProviders, providers}
  },
})

export const getNip85ProviderConfigsByPubkey = getter(nip85ProviderConfigsByPubkey)

export const getNip85ProviderConfig = (pubkey: string) =>
  getNip85ProviderConfigsByPubkey().get(pubkey)

export const loadNip85ProviderConfig = makeLoadItem(
  makeOutboxLoader(NIP85_PROVIDER_CONFIG_KIND),
  getNip85ProviderConfig,
)

export const userNip85ProviderConfig = makeUserData(
  nip85ProviderConfigsByPubkey,
  loadNip85ProviderConfig,
)

export const loadUserNip85ProviderConfig = makeUserLoader(loadNip85ProviderConfig)

export const userNip85ConfiguredProviders = derived(
  userNip85ProviderConfig,
  $config => $config?.providers || [],
)

export const userNip85ConfiguredUserProviders = derived(userNip85ConfiguredProviders, $providers =>
  $providers.filter(provider => provider.kind === NIP85_USER_ASSERTION_KIND),
)

export const nip85WotProviderConfigs = writable<Map<string, Nip85ConfiguredProvider[]>>(new Map())

export const nip85RecommendedUserProviders = writable<Map<string, Nip85RecommendedProvider[]>>(
  new Map(),
)

export const nip85RecommendationState = writable<Nip85RecommendationState>(
  defaultRecommendationState,
)

export const nip85DiscoveredProviderCapabilities = writable<Map<string, Set<string>>>(new Map())

export const nip85ExtraCapabilityDiscoveryState = writable<Nip85ExtraCapabilityDiscoveryState>(
  defaultExtraCapabilityDiscoveryState,
)

export const saveUserNip85ProviderConfig = async (providers: Nip85ConfiguredProvider[]) => {
  const $pubkey = pubkey.get()
  const $signer = signer.get()

  if (!$pubkey || !$signer) {
    throw new Error("Sign in to update trusted assertion providers.")
  }

  const current = get(userNip85ProviderConfig)?.list || makeList({kind: NIP85_PROVIDER_CONFIG_KIND})
  const nextProviders = dedupeNip85ConfiguredProviders(providers)
  const {publicTags, privateTags} = splitNip85ConfiguredProviders(nextProviders)
  const event = await updateList(current, {publicTags, privateTags}).reconcile(nip44EncryptToSelf)

  await publishThunk({event, relays: Router.get().FromUser().getUrls()})
}

let recommendationRun = 0

export const loadNip85RecommendedUserProviders = async () => {
  const $pubkey = pubkey.get()

  if (!$pubkey) {
    nip85WotProviderConfigs.set(new Map())
    nip85RecommendedUserProviders.set(new Map())
    nip85DiscoveredProviderCapabilities.set(new Map())
    nip85RecommendationState.set(defaultRecommendationState)
    nip85ExtraCapabilityDiscoveryState.set(defaultExtraCapabilityDiscoveryState)
    return
  }

  const follows = getFollows($pubkey)
  const wotGraph = getWotGraph()
  const authors = getNip85RecommendationAuthors($pubkey, follows, wotGraph)
  const currentRun = ++recommendationRun

  nip85WotProviderConfigs.set(new Map())
  nip85RecommendedUserProviders.set(new Map())
  nip85DiscoveredProviderCapabilities.set(new Map())
  nip85ExtraCapabilityDiscoveryState.set(defaultExtraCapabilityDiscoveryState)
  nip85RecommendationState.set({
    ...defaultRecommendationState,
    status: "loading",
    authors: authors.length,
  })

  try {
    let recommendationRelays = await loadNip85RecommendationRelays(authors, $pubkey, currentRun)

    if (currentRun !== recommendationRun) return

    let usedCachedRelays = get(nip85RecommendationState).usedCachedRelays
    let latestConfigEvents = await loadNip85RecommendationConfigs(
      authors,
      recommendationRelays,
      currentRun,
      usedCachedRelays,
    )

    if (currentRun !== recommendationRun) return

    const configsByAuthor = new Map<string, Nip85ConfiguredProvider[]>()

    for (const [author, event] of latestConfigEvents.entries()) {
      const publicProviders = parseNip85ProviderTags(event.tags || [], "public")

      if (publicProviders.length > 0) {
        configsByAuthor.set(author, publicProviders)
      }
    }

    if (usedCachedRelays && configsByAuthor.size === 0) {
      recommendationRelays = await loadNip85RecommendationRelays(authors, $pubkey, currentRun, {
        preferCache: false,
      })

      if (currentRun !== recommendationRun) return

      usedCachedRelays = false
      latestConfigEvents = await loadNip85RecommendationConfigs(
        authors,
        recommendationRelays,
        currentRun,
        false,
      )

      if (currentRun !== recommendationRun) return

      configsByAuthor.clear()

      for (const [author, event] of latestConfigEvents.entries()) {
        const publicProviders = parseNip85ProviderTags(event.tags || [], "public")

        if (publicProviders.length > 0) {
          configsByAuthor.set(author, publicProviders)
        }
      }
    }

    const recommendedProviders = aggregateNip85RecommendedProviders({
      currentPubkey: $pubkey,
      follows,
      wotGraph,
      configsByAuthor,
    })
    const providers = Array.from(recommendedProviders.values()).flat()

    nip85WotProviderConfigs.set(configsByAuthor)
    nip85RecommendedUserProviders.set(recommendedProviders)
    const progress = get(nip85RecommendationState)

    nip85RecommendationState.set({
      ...progress,
      status: "ready",
      authors: authors.length,
      loadedAuthors: authors.length,
      relayCount: recommendationRelays.length,
      usedCachedRelays,
      providerCount: providers.length,
      capabilityCount: recommendedProviders.size,
      error: undefined,
    })

    await Promise.all(
      providers.map(provider =>
        loadProfile(provider.serviceKey, [provider.relayHint]).catch(() => undefined),
      ),
    )
  } catch (error) {
    if (currentRun !== recommendationRun) return

    nip85WotProviderConfigs.set(new Map())
    nip85RecommendedUserProviders.set(new Map())
    nip85RecommendationState.set({
      ...defaultRecommendationState,
      status: "error",
      authors: authors.length,
      error:
        error instanceof Error ? error.message : "Failed to load trusted provider recommendations.",
    })
  }
}

export const discoverNip85ExtraCapabilities = async (
  limit = NIP85_EXTRA_CAPABILITY_EVENT_LIMIT,
) => {
  const currentState = get(nip85ExtraCapabilityDiscoveryState)

  if (currentState.status === "running") {
    return
  }

  const providerTargets = new Map<string, Set<string>>()

  for (const providers of get(nip85WotProviderConfigs).values()) {
    for (const provider of providers) {
      if (provider.kind !== NIP85_USER_ASSERTION_KIND) continue

      const relayHints = providerTargets.get(provider.serviceKey) || new Set<string>()

      if (provider.relayHint) {
        relayHints.add(provider.relayHint)
      }

      providerTargets.set(provider.serviceKey, relayHints)
    }
  }

  const totalProviders = providerTargets.size

  if (totalProviders === 0) {
    nip85ExtraCapabilityDiscoveryState.set({
      ...defaultExtraCapabilityDiscoveryState,
      status: "done",
      lastRun: Date.now(),
    })
    return
  }

  const discovered = new Map(get(nip85DiscoveredProviderCapabilities))

  nip85ExtraCapabilityDiscoveryState.set({
    status: "running",
    totalProviders,
    scannedProviders: 0,
    discoveredCapabilities: countDiscoveredCapabilities(discovered),
    errors: 0,
    lastRun: Date.now(),
  })

  let scannedProviders = 0
  let errors = 0

  try {
    for (const [serviceKey, relayHints] of providerTargets.entries()) {
      try {
        const relays = Array.from(relayHints).map(normalizeNip85RelayHint).filter(Boolean)

        if (relays.length === 0) {
          errors += 1
        } else {
          const events = await nip85ExtraCapabilityLoad({
            filters: [{kinds: [NIP85_USER_ASSERTION_KIND], authors: [serviceKey], limit}],
            relays,
          })
          const tagNames = new Set<string>()

          for (const event of events) {
            for (const tagName of extractNip85AssertionTagNames(event)) {
              tagNames.add(tagName)
            }
          }

          if (tagNames.size > 0) {
            const existing = discovered.get(serviceKey) || new Set<string>()

            for (const tagName of tagNames) {
              existing.add(`${NIP85_USER_ASSERTION_KIND}:${tagName}`)
            }

            discovered.set(serviceKey, existing)
          }

          loadProfile(serviceKey, relays).catch(() => undefined)
        }
      } catch {
        errors += 1
      }

      scannedProviders += 1
      nip85ExtraCapabilityDiscoveryState.set({
        status: "running",
        totalProviders,
        scannedProviders,
        discoveredCapabilities: countDiscoveredCapabilities(discovered),
        errors,
        lastRun: Date.now(),
      })
    }

    nip85DiscoveredProviderCapabilities.set(discovered)
    nip85ExtraCapabilityDiscoveryState.set({
      status: "done",
      totalProviders,
      scannedProviders,
      discoveredCapabilities: countDiscoveredCapabilities(discovered),
      errors,
      lastRun: Date.now(),
    })
  } catch (error) {
    nip85DiscoveredProviderCapabilities.set(discovered)
    nip85ExtraCapabilityDiscoveryState.set({
      status: "error",
      totalProviders,
      scannedProviders,
      discoveredCapabilities: countDiscoveredCapabilities(discovered),
      errors: errors + 1,
      lastRun: Date.now(),
      error: error instanceof Error ? error.message : "Capability discovery failed.",
    })
  }
}

export const verifyNip85SelectedProviders = async (providers: Nip85ConfiguredProvider[]) => {
  const currentPubkey = pubkey.get()

  if (!currentPubkey) {
    throw new Error("Sign in to verify trusted assertion providers.")
  }

  const samplePubkeys = getNip85VerificationSamplePubkeys(currentPubkey, getWotGraph())
  const providersByServiceKey = new Map<string, Set<string>>()

  for (const provider of providers.filter(
    provider => provider.kind === NIP85_USER_ASSERTION_KIND,
  )) {
    const relayHints = providersByServiceKey.get(provider.serviceKey) || new Set<string>()

    if (provider.relayHint) {
      relayHints.add(provider.relayHint)
    }

    providersByServiceKey.set(provider.serviceKey, relayHints)
  }

  const results = new Map<string, Nip85ProviderVerificationResult>()

  await Promise.all(
    Array.from(providersByServiceKey.entries()).map(async ([serviceKey, relayHintSet]) => {
      const relayHints = Array.from(relayHintSet).map(normalizeNip85RelayHint).filter(Boolean)

      if (relayHints.length === 0) {
        results.set(serviceKey, {
          serviceKey,
          samplePubkeys,
          targetsWithData: [],
          matchedTargetsByTag: {},
          availableTags: [],
          status: "error",
          updatedAt: Date.now(),
          error: "No relay hint configured for this provider.",
        })
        return
      }

      try {
        const events = await load({
          filters: [
            {kinds: [NIP85_USER_ASSERTION_KIND], authors: [serviceKey], "#d": samplePubkeys},
          ],
          relays: relayHints,
        })
        const latestByTarget = new Map<string, TrustedEvent>()

        for (const event of events) {
          const targetPubkey = event.tags.find(tag => tag[0] === "d")?.[1]

          if (!targetPubkey || !samplePubkeys.includes(targetPubkey)) {
            continue
          }

          const existing = latestByTarget.get(targetPubkey)

          if (!existing || event.created_at > existing.created_at) {
            latestByTarget.set(targetPubkey, event)
          }
        }

        if (latestByTarget.size === 0) {
          results.set(serviceKey, {
            serviceKey,
            samplePubkeys,
            targetsWithData: [],
            matchedTargetsByTag: {},
            availableTags: [],
            status: "no_data",
            updatedAt: Date.now(),
          })
          return
        }

        const availableTags = new Set<string>()
        const matchedTargetsByTag: Record<string, string[]> = {}

        for (const [targetPubkey, event] of latestByTarget.entries()) {
          for (const tagName of extractNip85AssertionTagNames(event)) {
            availableTags.add(tagName)
            matchedTargetsByTag[tagName] = [
              ...(matchedTargetsByTag[tagName] || []),
              targetPubkey,
            ].filter((pubkey, index, all) => all.indexOf(pubkey) === index)
          }
        }

        results.set(serviceKey, {
          serviceKey,
          samplePubkeys,
          targetsWithData: Array.from(latestByTarget.keys()),
          matchedTargetsByTag,
          availableTags: Array.from(availableTags).sort((a, b) => a.localeCompare(b)),
          status: "data",
          updatedAt: Date.now(),
        })
      } catch (error) {
        results.set(serviceKey, {
          serviceKey,
          samplePubkeys,
          targetsWithData: [],
          matchedTargetsByTag: {},
          availableTags: [],
          status: "error",
          updatedAt: Date.now(),
          error: error instanceof Error ? error.message : "Verification failed.",
        })
      }
    }),
  )

  return {samplePubkeys, results}
}

export const loadNip85UserAssertions = async (
  targetPubkey: string,
  providers: Nip85ConfiguredProvider[],
) => {
  const results = new Map<string, Nip85FetchedUserAssertion>()
  const providersByServiceKey = new Map<
    string,
    {provider: Nip85ConfiguredProvider; relayHints: Set<string>}
  >()

  for (const provider of providers.filter(
    provider => provider.kind === NIP85_USER_ASSERTION_KIND,
  )) {
    const existing = providersByServiceKey.get(provider.serviceKey)

    if (existing) {
      existing.relayHints.add(provider.relayHint)
    } else {
      providersByServiceKey.set(provider.serviceKey, {
        provider,
        relayHints: new Set([provider.relayHint]),
      })
    }
  }

  await Promise.all(
    Array.from(providersByServiceKey.entries()).map(async ([serviceKey, entry]) => {
      const relayHints = Array.from(entry.relayHints).map(normalizeNip85RelayHint).filter(Boolean)

      if (relayHints.length === 0) {
        results.set(serviceKey, {
          serviceKey,
          relayHints: [],
          status: "error",
          availableTags: [],
          error: "No relay hint configured for this provider.",
        })
        return
      }

      const address = new Address(NIP85_USER_ASSERTION_KIND, serviceKey, targetPubkey).toString()

      try {
        await load({filters: getIdFilters([address]), relays: relayHints})

        const event = getLatestEvent(repository.query(getIdFilters([address])))
        const assertion = event ? parseNip85UserAssertion(event) : undefined
        const availableTags = getNip85UserAssertionAvailableTags(assertion)

        results.set(serviceKey, {
          serviceKey,
          relayHints,
          assertion,
          status: assertion && availableTags.length > 0 ? "data" : "no_data",
          availableTags,
        })
      } catch (error) {
        results.set(serviceKey, {
          serviceKey,
          relayHints,
          status: "error",
          availableTags: [],
          error: error instanceof Error ? error.message : "Failed to load assertion.",
        })
      }
    }),
  )

  return results
}

export const loadNip85ProfileSummary = async (
  targetPubkey: string,
  providers: Nip85ConfiguredProvider[],
): Promise<{
  results: Map<string, Nip85FetchedUserAssertion>
  summary: Nip85UserAssertionSummary
}> => {
  const results = await loadNip85UserAssertions(targetPubkey, providers)

  return {
    results,
    summary: aggregateNip85UserAssertions(results, providers),
  }
}
