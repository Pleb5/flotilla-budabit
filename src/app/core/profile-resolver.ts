import {forceLoadProfile, loadProfile, profilesByPubkey} from "@welshman/app"
import {displayProfile, displayPubkey, type PublishedProfile} from "@welshman/util"
import {derived, get, readable, type Readable} from "svelte/store"
import {normalizePubkey, normalizeRelays} from "@app/core/community"
import {INDEXER_RELAYS} from "@app/core/state"
import {
  activeUserCommunityRelays,
  getActiveUserCommunityRelays,
  getPubkeyOutboxRelays,
} from "@app/core/community-relays"
import {logProfileLoadSummary, type ProfileLoadReason} from "@app/core/diagnostics"

export type ProfileResolutionOptions = {
  url?: string
  relays?: string[]
  communityRelays?: string[]
  includeActiveCommunityRelays?: boolean
}

const attemptedRelaySetsByPubkey = new Map<string, Set<string>>()
const attemptedRelaysByPubkey = new Map<string, Set<string>>()
const profileLoadPromisesByKey = new Map<string, Promise<PublishedProfile | undefined>>()
const completedProfileLoadTimesByKey = new Map<string, number>()
const PROFILE_LOAD_RETRY_MS = 60_000

const hasProfileDisplayData = (profile: PublishedProfile | undefined) =>
  Boolean(profile?.display_name || profile?.name || profile?.picture)

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

const getBudabitProfileLoadRelays = (
  pubkey: string,
  options: ProfileResolutionOptions = {},
  activeCommunityRelays?: string[],
) =>
  normalizeRelays([
    ...getBudabitProfileRelays(options, activeCommunityRelays),
    ...getPubkeyOutboxRelays(pubkey),
  ])

const rememberProfileLoadAttempt = (pubkey: string, relays: string[]) => {
  const relayKey = relays.join("\n")
  const relaySets = attemptedRelaySetsByPubkey.get(pubkey) || new Set<string>()
  const attemptedRelays = attemptedRelaysByPubkey.get(pubkey) || new Set<string>()
  const hasPreviousAttempt = relaySets.size > 0
  const hasNewRelays = relays.some(relay => !attemptedRelays.has(relay))
  const reason: ProfileLoadReason = !hasPreviousAttempt
    ? "first-load"
    : hasNewRelays
      ? "improved-hints"
      : "same-relays"

  relaySets.add(relayKey)
  for (const relay of relays) attemptedRelays.add(relay)

  attemptedRelaySetsByPubkey.set(pubkey, relaySets)
  attemptedRelaysByPubkey.set(pubkey, attemptedRelays)

  return {reason, shouldForceLoad: hasPreviousAttempt && hasNewRelays}
}

export const loadBudabitProfile = async (
  pubkey: string,
  options: ProfileResolutionOptions = {},
  activeCommunityRelays?: string[],
) => {
  const normalizedPubkey = normalizePubkey(pubkey)
  if (!normalizedPubkey) return undefined

  const relays = getBudabitProfileLoadRelays(normalizedPubkey, options, activeCommunityRelays)
  const currentProfile = get(profilesByPubkey).get(normalizedPubkey)
  if (hasProfileDisplayData(currentProfile)) return currentProfile

  const attempt = rememberProfileLoadAttempt(normalizedPubkey, relays)
  const loadKey = `${normalizedPubkey}\n${relays.join("\n")}`
  logProfileLoadSummary({
    pubkey: normalizedPubkey,
    relays,
    reason: attempt.reason,
    force: attempt.shouldForceLoad,
  })
  const loader = attempt.shouldForceLoad ? forceLoadProfile : loadProfile

  if (!attempt.shouldForceLoad) {
    const inFlight = profileLoadPromisesByKey.get(loadKey)
    if (inFlight) return inFlight
    const lastLoadAt = completedProfileLoadTimesByKey.get(loadKey)
    if (lastLoadAt && Date.now() - lastLoadAt < PROFILE_LOAD_RETRY_MS) return undefined
  }

  const promise = loader(normalizedPubkey, relays)
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
  let lastRequestedRelayKey: string | undefined

  const requestLoad = (activeCommunityRelays?: string[]) => {
    if (hasProfileDisplayData(get(profilesByPubkey).get(normalizedPubkey))) return

    const relays = getBudabitProfileLoadRelays(normalizedPubkey, options, activeCommunityRelays)
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

      if (!$profile) {
        requestLoad($activeUserCommunityRelays)
      }
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
