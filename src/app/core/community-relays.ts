import {Router} from "@welshman/router"
import {normalizePubkey, normalizeRelays, type CommunityDefinition} from "@app/core/community"
import {INDEXER_RELAYS} from "@app/core/state"

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
