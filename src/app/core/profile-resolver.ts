import {forceLoadProfile, loadProfile, profilesByPubkey, repository, tracker} from "@welshman/app"
import {request as welshmanRequest} from "@welshman/net"
import {LRUCache} from "@welshman/lib"
import {
  displayProfile,
  displayPubkey,
  type PublishedProfile,
  type TrustedEvent,
} from "@welshman/util"
import {derived, get, readable, type Readable} from "svelte/store"
import {normalizePubkey, normalizeRelays} from "@app/core/community"
import {INDEXER_RELAYS} from "@app/core/state"
import {
  activeUserCommunityRelays,
  getActiveUserCommunityRelays,
  getPubkeyOutboxRelays,
} from "@app/core/community-relays"

export type ProfileResolutionOptions = {
  url?: string
  relays?: string[]
  communityRelays?: string[]
  includeActiveCommunityRelays?: boolean
  load?: boolean
}

// Bounded LRUs: profile attempt/completion bookkeeping is keyed by pubkey and
// pubkey-plus-relay-list permutations, which otherwise grow for the app lifetime.
const attemptedRelaysByPubkey = new LRUCache<string, Set<string>>(2000)
const attemptedExplicitRelaysByPubkey = new LRUCache<string, Map<string, number>>(2000)
const profileLoadPromisesByKey = new Map<string, Promise<PublishedProfile | undefined>>()
const explicitProfileLoadPromisesByKey = new Map<string, Promise<void>>()
const completedProfileLoadTimesByKey = new LRUCache<string, number>(2000)
const PROFILE_LOAD_RETRY_MS = 60_000
export const PROFILE_BATCH_CONCURRENCY = 3
export const MAX_EXPLICIT_PROFILE_RELAYS = 3

export type ProfileBatchTarget = {
  pubkey: string
  relays: string[]
}

export type ProfileBatchGroup = {
  pubkeys: string[]
  relays: string[]
}

type ProfileBatchDependencies = {
  hasProfile?: (pubkey: string) => boolean
  requestGroup?: (group: ProfileBatchGroup, signal?: AbortSignal) => Promise<unknown>
}

const hasProfileDisplayData = (profile: PublishedProfile | undefined) =>
  Boolean(profile?.display_name || profile?.name || profile?.picture)

export const buildBudabitProfileBatchPlan = (targets: ProfileBatchTarget[]) => {
  const relaysByPubkey = new Map<string, Set<string>>()
  for (const target of targets) {
    const pubkey = normalizePubkey(target.pubkey)
    if (!pubkey) continue
    const relays = relaysByPubkey.get(pubkey) || new Set<string>()
    for (const relay of normalizeRelays(target.relays)) relays.add(relay)
    relaysByPubkey.set(pubkey, relays)
  }

  const groups = new Map<string, ProfileBatchGroup>()
  for (const [pubkey, relaySet] of relaysByPubkey) {
    const relays = Array.from(relaySet).sort()
    if (relays.length === 0) continue
    const key = relays.join("\n")
    const group = groups.get(key) || {pubkeys: [], relays}
    group.pubkeys.push(pubkey)
    groups.set(key, group)
  }

  return Array.from(groups.values()).map(group => ({
    ...group,
    pubkeys: group.pubkeys.sort(),
  }))
}

const requestProfileGroup = async (group: ProfileBatchGroup, signal?: AbortSignal) => {
  const admit = (event: TrustedEvent, relay: string) => {
    if (signal?.aborted) return
    if (relay && !tracker.hasRelay(event.id, relay)) tracker.addRelay(event.id, relay)
    if (!repository.hasEvent(event)) repository.publish(event)
  }
  await welshmanRequest({
    relays: group.relays,
    filters: [{kinds: [0], authors: group.pubkeys, limit: group.pubkeys.length}],
    signal,
    autoClose: true,
    lifetime: "finite",
    owner: "git-list:profiles",
    tracker,
    onEvent: admit,
    onDuplicate: admit,
  })
}

export const loadBudabitProfileBatch = async (
  targets: ProfileBatchTarget[],
  signal?: AbortSignal,
  dependencies: ProfileBatchDependencies = {},
) => {
  const hasProfile =
    dependencies.hasProfile ||
    ((pubkey: string) => hasProfileDisplayData(get(profilesByPubkey).get(pubkey)))
  const requestGroup = dependencies.requestGroup || requestProfileGroup
  const groups = buildBudabitProfileBatchPlan(targets)
    .map(group => ({...group, pubkeys: group.pubkeys.filter(pubkey => !hasProfile(pubkey))}))
    .filter(group => group.pubkeys.length > 0)
  let nextGroup = 0

  const worker = async () => {
    while (!signal?.aborted) {
      const group = groups[nextGroup++]
      if (!group) return
      await requestGroup(group, signal)
    }
  }

  await Promise.all(
    Array.from({length: Math.min(PROFILE_BATCH_CONCURRENCY, groups.length)}, () => worker()),
  )
  if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError")
}

export const getBudabitProfileRelays = (
  options: ProfileResolutionOptions = {},
  activeCommunityRelays = options.includeActiveCommunityRelays
    ? getActiveUserCommunityRelays()
    : [],
) =>
  normalizeRelays([
    ...INDEXER_RELAYS,
    options.url || "",
    ...(options.relays || []),
    ...(options.communityRelays || []),
    ...(options.includeActiveCommunityRelays ? activeCommunityRelays : []),
  ])

export const getBudabitExplicitProfileRelays = (options: ProfileResolutionOptions = {}) =>
  normalizeRelays([options.url || "", ...(options.relays || [])]).slice(
    0,
    MAX_EXPLICIT_PROFILE_RELAYS,
  )

const getBudabitProfileLoadRelays = (
  pubkey: string,
  options: ProfileResolutionOptions = {},
  activeCommunityRelays?: string[],
) =>
  normalizeRelays([
    ...INDEXER_RELAYS,
    ...(options.communityRelays || []),
    ...(options.includeActiveCommunityRelays
      ? activeCommunityRelays || getActiveUserCommunityRelays()
      : []),
    ...getPubkeyOutboxRelays(pubkey),
  ])

const requestNewExplicitProfileRelays = (pubkey: string, relays: string[]) => {
  const attemptedRelays = attemptedExplicitRelaysByPubkey.get(pubkey) || new Map<string, number>()
  const missingProfile = !hasProfileDisplayData(get(profilesByPubkey).get(pubkey))
  const newRelays = relays.filter(relay => {
    const completedAt = attemptedRelays.get(relay)
    return (
      completedAt === undefined ||
      (missingProfile && Date.now() - completedAt >= PROFILE_LOAD_RETRY_MS)
    )
  })
  if (newRelays.length === 0) return undefined

  // In-flight reads must not expire. Empty/failed reads may be retried by a later
  // row or profile modal, without permanently negative-caching community hints.
  for (const relay of newRelays) attemptedRelays.set(relay, Infinity)
  attemptedExplicitRelaysByPubkey.set(pubkey, attemptedRelays)

  const key = `${pubkey}\n${newRelays.join("\n")}`
  const inFlight = explicitProfileLoadPromisesByKey.get(key)
  if (inFlight) return inFlight

  const promise = requestProfileGroup({pubkeys: [pubkey], relays: newRelays})
    .catch(() => undefined)
    .finally(() => {
      for (const relay of newRelays) attemptedRelays.set(relay, Date.now())
      explicitProfileLoadPromisesByKey.delete(key)
    }) as Promise<void>
  explicitProfileLoadPromisesByKey.set(key, promise)
  return promise
}

const rememberProfileLoadAttempt = (pubkey: string, relays: string[]) => {
  const hasPreviousAttempt = attemptedRelaysByPubkey.has(pubkey)
  const attemptedRelays = attemptedRelaysByPubkey.get(pubkey) || new Set<string>()
  const hasNewRelays = relays.some(relay => !attemptedRelays.has(relay))

  for (const relay of relays) attemptedRelays.add(relay)

  attemptedRelaysByPubkey.set(pubkey, attemptedRelays)

  return {shouldForceLoad: hasPreviousAttempt && hasNewRelays}
}

export const loadBudabitProfile = async (
  pubkey: string,
  options: ProfileResolutionOptions = {},
  activeCommunityRelays?: string[],
) => {
  const normalizedPubkey = normalizePubkey(pubkey)
  if (!normalizedPubkey) return undefined

  const explicitRelays = getBudabitExplicitProfileRelays(options)
  const explicitLoad = requestNewExplicitProfileRelays(normalizedPubkey, explicitRelays)
  const relays = getBudabitProfileLoadRelays(normalizedPubkey, options, activeCommunityRelays)
  const currentProfile = get(profilesByPubkey).get(normalizedPubkey)
  if (hasProfileDisplayData(currentProfile)) return currentProfile

  const attempt = rememberProfileLoadAttempt(normalizedPubkey, relays)
  const loadKey = `${normalizedPubkey}\n${relays.join("\n")}`
  const loader = attempt.shouldForceLoad ? forceLoadProfile : loadProfile

  if (!attempt.shouldForceLoad) {
    const inFlight = profileLoadPromisesByKey.get(loadKey)
    if (inFlight) return inFlight
    const lastLoadAt = completedProfileLoadTimesByKey.get(loadKey)
    if (lastLoadAt && Date.now() - lastLoadAt < PROFILE_LOAD_RETRY_MS) return undefined
  }

  const promise = Promise.all([loader(normalizedPubkey, relays), explicitLoad])
    .then(([profile]) => profile)
    .then(profile => {
      completedProfileLoadTimesByKey.set(loadKey, Date.now())
      return profile
    })
    .finally(() => {
      profileLoadPromisesByKey.delete(loadKey)
    }) as Promise<PublishedProfile | undefined>

  profileLoadPromisesByKey.set(loadKey, promise)

  return promise
}

export const deriveBudabitProfile = (
  pubkey: string | undefined,
  options: ProfileResolutionOptions = {},
): Readable<PublishedProfile | undefined> => {
  const normalizedPubkey = normalizePubkey(pubkey || "")
  if (!normalizedPubkey) return readable(undefined)

  const profile = derived(profilesByPubkey, $profiles => $profiles.get(normalizedPubkey))
  if (options.load === false) return profile
  let lastRequestedRelayKey: string | undefined

  const requestLoad = (activeCommunityRelays?: string[]) => {
    const currentProfile = get(profilesByPubkey).get(normalizedPubkey)
    const relays = hasProfileDisplayData(currentProfile)
      ? getBudabitExplicitProfileRelays(options)
      : getBudabitProfileLoadRelays(normalizedPubkey, options, activeCommunityRelays)
    const relayKey = relays.join("\n")
    if (relayKey === lastRequestedRelayKey) return

    lastRequestedRelayKey = relayKey
    loadBudabitProfile(normalizedPubkey, options, activeCommunityRelays).catch(() => undefined)
  }

  if (!options.includeActiveCommunityRelays) {
    requestLoad()
    return profile
  }

  return derived<
    [Readable<PublishedProfile | undefined>, Readable<string[]>],
    PublishedProfile | undefined
  >(
    [profile, activeUserCommunityRelays],
    ([$profile, $activeUserCommunityRelays], set) => {
      set($profile)

      requestLoad($activeUserCommunityRelays)
    },
    undefined as PublishedProfile | undefined,
  )
}

export const deriveBudabitProfileDisplay = (
  pubkey: string | undefined,
  options: ProfileResolutionOptions = {},
) => {
  const normalizedPubkey = normalizePubkey(pubkey || "")
  if (!normalizedPubkey) return readable("")

  return derived(deriveBudabitProfile(normalizedPubkey, options), $profile =>
    displayProfile($profile, displayPubkey(normalizedPubkey)),
  )
}
