import type {TrustedEvent} from "@welshman/util"
import {normalizePubkey, type CommunityDefinition, type CommunityPointer} from "./community"
import {prepareUserCommunityRefSelection} from "./community-membership"
import type {EffectiveCommunityReportState} from "./community-reports"

export type CommunityReaderOptions = {
  community: CommunityPointer
  definition?: CommunityDefinition
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  ready: boolean
}

/** Protocol eligibility only. AUTH and complete authority intake are separate.
 * Do not pass personal renunciations/exclusions as relay authorization rules.
 * A complete empty projection lets the pinned owner bootstrap, not other keys.
 * Inputs must come from a deletion-aware retained view, not an append-only log
 * containing bodies already removed by NIP-09. `ready` is the caller's evidence.
 */
export const prepareCommunityReaderEligibility = ({
  community,
  definition,
  profileListEvents = [],
  reportState,
  ready,
}: CommunityReaderOptions) => {
  const select = prepareUserCommunityRefSelection({
    definitions: definition ? [definition] : [],
    profileListEvents,
    reportStates: {[community.address]: reportState},
  })
  return (author?: string) => {
    const pubkey = normalizePubkey(author || "")
    if (!ready || !pubkey || (definition && definition.pointer.address !== community.address))
      return false
    if (pubkey === community.ownerPubkey) return true
    return Boolean(
      definition && select(pubkey).some(ref => ref.community.address === community.address),
    )
  }
}
