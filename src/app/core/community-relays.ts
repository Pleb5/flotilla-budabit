import {Router} from "@welshman/router"
import {derived, get, type Readable} from "svelte/store"
import {normalizePubkey, normalizeRelays, type CommunityDefinition} from "@app/core/community"
import {INDEXER_RELAYS} from "@app/core/state"
import {activeUserCommunityRefs} from "@app/core/community-state"
import {logPublishRelaySummary} from "@app/core/diagnostics"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"

export type CommunityRelayRef = {
  communityId: string
  communityAddress: string
  relayHints: string[]
  definition?: Pick<CommunityDefinition, "relays">
}

export type CommunityRelayScope = {
  communityId: string
  communityAddress?: string
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

export const getActiveUserCommunityRelaysFromRefs = (
  refs: Pick<CommunityRelayRef, "relayHints">[],
) => normalizeRelays(refs.flatMap(ref => ref.relayHints))

export const activeUserCommunityRelays: Readable<string[]> = derived(
  activeUserCommunityRefs,
  refs => getActiveUserCommunityRelaysFromRefs(refs),
  [] as string[],
)

export const getActiveUserCommunityRelays = () => get(activeUserCommunityRelays)

export const PROFILE_COMMUNITY_RELAY_LIMIT = 4
export const PROFILE_RELAYS_PER_COMMUNITY_LIMIT = 2

export const getProfileCommunityRelaysFromRefs = (
  refs: Pick<ActiveUserCommunityRef, "community" | "definition">[],
) => {
  const relaysByCommunity = new Map<string, string[]>()

  for (const ref of refs) {
    const communityAddress = ref.community.address
    if (!communityAddress) continue

    relaysByCommunity.set(
      communityAddress,
      normalizeRelays([
        ...(relaysByCommunity.get(communityAddress) || []),
        ...ref.definition.relays,
      ])
        .sort((a, b) => a.localeCompare(b))
        .slice(0, PROFILE_RELAYS_PER_COMMUNITY_LIMIT),
    )
  }

  const communities = Array.from(relaysByCommunity, ([communityAddress, relays]) => ({
    communityAddress,
    relays,
  }))
    .filter(ref => ref.relays.length > 0)
    .sort((a, b) => a.communityAddress.localeCompare(b.communityAddress))
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
  refs: Pick<ActiveUserCommunityRef, "community" | "definition">[] = get(activeUserCommunityRefs),
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
  communityScopes: CommunityRelayScope[] = [],
  communityRefs: CommunityRelayRef[] = get(activeUserCommunityRefs).map(ref => ({
    communityId: ref.community.communityId,
    communityAddress: ref.community.address,
    relayHints: ref.relayHints,
    definition: ref.definition,
  })),
) => {
  const scopes = communityScopes
    .map(scope => ({
      communityId: normalizePubkey(scope.communityId),
      communityAddress: scope.communityAddress?.trim().toLowerCase(),
    }))
    .filter(scope => scope.communityId)
  if (scopes.length === 0) return []

  return normalizeRelays(
    communityRefs.flatMap(ref =>
      scopes.some(
        scope =>
          scope.communityId === normalizePubkey(ref.communityId) &&
          (!scope.communityAddress ||
            scope.communityAddress === ref.communityAddress.trim().toLowerCase()),
      )
        ? ref.definition?.relays || []
        : [],
    ),
  )
}
