import type {EventContent, TrustedEvent} from "@welshman/util"
import {getTagValue} from "@welshman/util"
import {randomId} from "@welshman/lib"
import {
  MAX_TARGET_COMMUNITIES,
  TARGETED_PUBLICATION_KINDS,
  type CommunityTarget,
  type TargetedPublicationRef,
  buildTargetedPublication,
  normalizePubkey,
  parseTargetedPublication,
} from "@app/core/community"

export const TARGETING_TAG = "h"

export const shouldTargetPublicationKind = (kind: number) =>
  TARGETED_PUBLICATION_KINDS.includes(kind as (typeof TARGETED_PUBLICATION_KINDS)[number])

export const getPublicationTargetingId = (event: TrustedEvent | EventContent) =>
  getTagValue(TARGETING_TAG, event.tags || []) || ""

export const withPublicationTargetingId = <T extends EventContent>(
  template: T,
  targetingId = randomId(),
): T & {targetingId: string} => ({
  ...template,
  tags: [[TARGETING_TAG, targetingId], ...(template.tags || []).filter(tag => tag[0] !== TARGETING_TAG)],
  targetingId,
})

export const makeTargetedPublicationForCommunity = ({
  targetingId,
  originalKind,
  originalRef,
  communityPubkey,
  communityRelay,
}: {
  targetingId: string
  originalKind: number
  originalRef?: TargetedPublicationRef
  communityPubkey: string
  communityRelay?: string
}): EventContent =>
  buildTargetedPublication({
    id: targetingId,
    kind: originalKind,
    ref: originalRef,
    communities: [{pubkey: communityPubkey, relay: communityRelay}],
  })

export const makeAddressablePublicationRef = ({
  kind,
  pubkey,
  identifier,
  relay,
}: {
  kind: number
  pubkey: string
  identifier: string
  relay?: string
}): TargetedPublicationRef => ({
  type: "a",
  value: `${kind}:${normalizePubkey(pubkey)}:${identifier}`,
  relay,
})

export const makeEventPublicationRef = ({
  id,
  relay,
  pubkey,
}: {
  id: string
  relay?: string
  pubkey?: string
}): TargetedPublicationRef => ({type: "e", value: id, relay, pubkey})

export const upsertCommunityTarget = (
  event: TrustedEvent,
  target: CommunityTarget,
): EventContent | undefined => {
  const parsed = parseTargetedPublication(event)
  if (!parsed) return undefined

  const targetPubkey = normalizePubkey(target.pubkey)
  if (!targetPubkey) return undefined

  const communities = parsed.communities.filter(community => community.pubkey !== targetPubkey)
  communities.push({pubkey: targetPubkey, relay: target.relay})

  return buildTargetedPublication({
    id: parsed.id,
    kind: parsed.kind,
    ref: parsed.ref,
    communities: communities.slice(0, MAX_TARGET_COMMUNITIES),
  })
}

export const removeCommunityTarget = (
  event: TrustedEvent,
  communityPubkey: string,
): EventContent | undefined => {
  const parsed = parseTargetedPublication(event)
  if (!parsed) return undefined

  const targetPubkey = normalizePubkey(communityPubkey)
  if (!targetPubkey) return undefined

  return buildTargetedPublication({
    id: parsed.id,
    kind: parsed.kind,
    ref: parsed.ref,
    communities: parsed.communities.filter(community => community.pubkey !== targetPubkey),
  })
}
