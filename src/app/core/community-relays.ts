import {Router} from "@welshman/router"
import {derived, get, type Readable} from "svelte/store"
import {normalizePubkey, normalizeRelays, type CommunityDefinition} from "@app/core/community"
import {INDEXER_RELAYS} from "@app/core/state"
import {activeUserCommunityRefs} from "@app/core/community-state"
import {logPublishRelaySummary} from "@app/core/diagnostics"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"

export type CommunityRelayRef = {
  communityPubkey: string
  relayHints: string[]
}

export const getPubkeyOutboxRelays = (pubkey: string | undefined) => {
  const normalizedPubkey = normalizePubkey(pubkey || "")
  if (!normalizedPubkey) return []

  try {
    return Router.get().FromPubkeys([normalizedPubkey]).getUrls() || []
  } catch {
    return []
  }
}

export const getCommunityScopedPublishRelays = (
  definition: Pick<CommunityDefinition, "relays"> | undefined,
) => normalizeRelays(definition?.relays || [])

export const getCommunityRootPublishRelays = (
  communityRelays: string[],
  communityPubkey: string | undefined,
  options: {indexerRelays?: string[]; outboxRelays?: string[]} = {},
) =>
  normalizeRelays([
    ...communityRelays,
    ...(options.indexerRelays ?? INDEXER_RELAYS),
    ...(options.outboxRelays ?? getPubkeyOutboxRelays(communityPubkey)),
  ])

export const getActiveUserCommunityRelaysFromRefs = (refs: CommunityRelayRef[]) =>
  normalizeRelays(refs.flatMap(ref => ref.relayHints))

export const activeUserCommunityRelays: Readable<string[]> = derived(
  activeUserCommunityRefs,
  getActiveUserCommunityRelaysFromRefs,
  [] as string[],
)

export const getActiveUserCommunityRelays = () => get(activeUserCommunityRelays)

export const PROFILE_COMMUNITY_RELAY_LIMIT = 4
export const PROFILE_RELAYS_PER_COMMUNITY_LIMIT = 2

export const getProfileCommunityRelaysFromRefs = (
  refs: Pick<ActiveUserCommunityRef, "communityPubkey" | "definition">[],
) => {
  const relaysByCommunity = new Map<string, string[]>()

  for (const ref of refs) {
    const communityPubkey = normalizePubkey(ref.communityPubkey)
    if (!communityPubkey) continue

    relaysByCommunity.set(
      communityPubkey,
      normalizeRelays([...(relaysByCommunity.get(communityPubkey) || []), ...ref.definition.relays])
        .sort((a, b) => a.localeCompare(b))
        .slice(0, PROFILE_RELAYS_PER_COMMUNITY_LIMIT),
    )
  }

  const communities = Array.from(relaysByCommunity, ([communityPubkey, relays]) => ({
    communityPubkey,
    relays,
  }))
    .filter(ref => ref.relays.length > 0)
    .sort((a, b) => a.communityPubkey.localeCompare(b.communityPubkey))
  const selected: string[] = []

  for (let relayIndex = 0; relayIndex < PROFILE_RELAYS_PER_COMMUNITY_LIMIT; relayIndex += 1) {
    for (const community of communities) {
      const relay = community.relays[relayIndex]
      if (relay && !selected.includes(relay)) selected.push(relay)
      if (selected.length === PROFILE_COMMUNITY_RELAY_LIMIT) return selected
    }
  }

  return selected
}

export const getProfileCommunityRelays = (
  refs: Pick<ActiveUserCommunityRef, "communityPubkey" | "definition">[] = get(
    activeUserCommunityRefs,
  ),
) => getProfileCommunityRelaysFromRefs(refs)

export const getUserDataPublishRelays = (
  baseRelays: string[] = [],
  activeCommunityRelays = getActiveUserCommunityRelays(),
) => {
  const relays = normalizeRelays([...baseRelays, ...activeCommunityRelays])

  logPublishRelaySummary({
    category: "personal-user-data",
    relays,
    baseRelays,
    activeCommunityRelays,
  })

  return relays
}

export const getScopedCommunityPublishRelays = (
  communityPubkeys: string[] = [],
  communityRefs: CommunityRelayRef[] = get(activeUserCommunityRefs),
) => {
  const scopedPubkeys = new Set(communityPubkeys.map(normalizePubkey).filter(Boolean))
  if (scopedPubkeys.size === 0) return []

  return normalizeRelays(
    communityRefs.flatMap(ref =>
      scopedPubkeys.has(normalizePubkey(ref.communityPubkey)) ? ref.relayHints : [],
    ),
  )
}
