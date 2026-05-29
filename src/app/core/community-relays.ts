import {Router} from "@welshman/router"
import {derived, get, type Readable} from "svelte/store"
import {normalizePubkey, normalizeRelays, type CommunityDefinition} from "@app/core/community"
import {INDEXER_RELAYS} from "@app/core/state"
import {activeUserCommunityRefs} from "@app/core/community-state"
import {logPublishRelaySummary} from "@app/core/diagnostics"

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
