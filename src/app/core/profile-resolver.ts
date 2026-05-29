import {deriveProfile, forceLoadProfile, loadProfile, profilesByPubkey} from "@welshman/app"
import {displayProfile, displayPubkey, type PublishedProfile} from "@welshman/util"
import {derived, get, readable, type Readable} from "svelte/store"
import {normalizePubkey, normalizeRelays} from "@app/core/community"
import {INDEXER_RELAYS} from "@app/core/state"
import {activeUserCommunityRelays, getActiveUserCommunityRelays} from "@app/core/community-relays"

export type ProfileResolutionOptions = {
  url?: string
  relays?: string[]
  communityRelays?: string[]
  includeActiveCommunityRelays?: boolean
}

const attemptedRelaySetsByPubkey = new Map<string, Set<string>>()
const attemptedRelaysByPubkey = new Map<string, Set<string>>()

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

const rememberProfileLoadAttempt = (pubkey: string, relays: string[]) => {
  const relayKey = relays.join("\n")
  const relaySets = attemptedRelaySetsByPubkey.get(pubkey) || new Set<string>()
  const attemptedRelays = attemptedRelaysByPubkey.get(pubkey) || new Set<string>()
  const hasPreviousAttempt = relaySets.size > 0
  const hasNewRelays = relays.some(relay => !attemptedRelays.has(relay))

  relaySets.add(relayKey)
  for (const relay of relays) attemptedRelays.add(relay)

  attemptedRelaySetsByPubkey.set(pubkey, relaySets)
  attemptedRelaysByPubkey.set(pubkey, attemptedRelays)

  return hasPreviousAttempt && hasNewRelays
}

export const loadBudabitProfile = async (
  pubkey: string,
  options: ProfileResolutionOptions = {},
  activeCommunityRelays?: string[],
) => {
  const normalizedPubkey = normalizePubkey(pubkey)
  if (!normalizedPubkey) return undefined

  const currentProfile = get(profilesByPubkey).get(normalizedPubkey)
  if (currentProfile) return currentProfile

  const relays = getBudabitProfileRelays(options, activeCommunityRelays)
  const shouldForceLoad = rememberProfileLoadAttempt(normalizedPubkey, relays)
  const loader = shouldForceLoad ? forceLoadProfile : loadProfile

  return loader(normalizedPubkey, relays)
}

export const deriveBudabitProfile = (
  pubkey: string | undefined,
  options: ProfileResolutionOptions = {},
): Readable<PublishedProfile | undefined> => {
  const normalizedPubkey = normalizePubkey(pubkey || "")
  if (!normalizedPubkey) return readable(undefined)

  const initialRelays = getBudabitProfileRelays(options)
  const profile = deriveProfile(normalizedPubkey, initialRelays)
  let lastRequestedRelayKey: string | undefined = initialRelays.join("\n")
  rememberProfileLoadAttempt(normalizedPubkey, initialRelays)

  return derived<
    [Readable<PublishedProfile | undefined>, Readable<string[]>],
    PublishedProfile | undefined
  >(
    [profile, activeUserCommunityRelays],
    ([$profile, $activeUserCommunityRelays], set) => {
      set($profile)

      if (!$profile) {
        const relays = getBudabitProfileRelays(options, $activeUserCommunityRelays)
        const relayKey = relays.join("\n")
        if (relayKey === lastRequestedRelayKey) return

        lastRequestedRelayKey = relayKey
        loadBudabitProfile(normalizedPubkey, options, $activeUserCommunityRelays).catch(
          () => undefined,
        )
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
