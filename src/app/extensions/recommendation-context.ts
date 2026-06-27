import {normalizePubkey, normalizeRelays, type CommunityDefinition} from "@app/core/community"
import type {CommunityProfile} from "@app/core/community-state"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import {makeCommunityWidgetContext} from "@app/extensions/community-context"
import type {TrustedEvent} from "@welshman/util"
import type {CommunityWidgetRuntimeContext} from "./types"

export type CommunityWidgetRecommendationContext = {
  communityPubkey: string
  relays: string[]
  relayHints: string[]
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  trustedWidgetAuthorPubkeys: string[]
  widgetTargetAuthorPubkeys: string[]
  fallbackAuthorityPubkeys: string[]
  targetingEventIds: string[]
  targetingRelayHints: string[]
}

const recommendationContextsByWidgetLineId = new Map<
  string,
  CommunityWidgetRecommendationContext[]
>()

const uniqueStrings = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const uniquePubkeys = (values: string[]) => uniqueStrings(values.map(normalizePubkey))

const makeContextKey = (context: CommunityWidgetRecommendationContext) =>
  normalizePubkey(context.communityPubkey) || context.communityPubkey

const normalizeRecommendationContext = (
  context: CommunityWidgetRecommendationContext,
): CommunityWidgetRecommendationContext => ({
  ...context,
  communityPubkey: normalizePubkey(context.communityPubkey) || context.communityPubkey,
  relays: normalizeRelays(context.relays),
  relayHints: normalizeRelays(context.relayHints),
  trustedWidgetAuthorPubkeys: uniquePubkeys(context.trustedWidgetAuthorPubkeys),
  widgetTargetAuthorPubkeys: uniquePubkeys(context.widgetTargetAuthorPubkeys),
  fallbackAuthorityPubkeys: uniquePubkeys(context.fallbackAuthorityPubkeys),
  targetingEventIds: uniqueStrings(context.targetingEventIds),
  targetingRelayHints: normalizeRelays(context.targetingRelayHints),
})

export const recordCommunityWidgetRecommendationContext = (
  widgetLineId: string,
  context: CommunityWidgetRecommendationContext,
) => {
  const lineId = widgetLineId.trim()
  if (!lineId) return

  const normalized = normalizeRecommendationContext(context)
  const contextKey = makeContextKey(normalized)
  const existing = recommendationContextsByWidgetLineId.get(lineId) || []

  recommendationContextsByWidgetLineId.set(lineId, [
    normalized,
    ...existing.filter(context => makeContextKey(context) !== contextKey),
  ])
}

export const getCommunityWidgetRecommendationContexts = (
  widgetLineId: string,
): CommunityWidgetRecommendationContext[] => [
  ...(recommendationContextsByWidgetLineId.get(widgetLineId.trim()) || []),
]

export const clearCommunityWidgetRecommendationContexts = () => {
  recommendationContextsByWidgetLineId.clear()
}

export const makeCommunityWidgetRuntimeContext = (
  context: CommunityWidgetRecommendationContext,
  {
    userPubkey = "",
    profile,
    reportState,
  }: {
    userPubkey?: string
    profile?: CommunityProfile
    reportState?: EffectiveCommunityReportState
  } = {},
): CommunityWidgetRuntimeContext => ({
  definition: context.definition,
  profileListEvents: context.profileListEvents,
  reportState,
  relays: context.relays,
  relayHints: context.relayHints,
  communityContext: makeCommunityWidgetContext({
    definition: context.definition,
    profile,
    profileListEvents: context.profileListEvents,
    reportState,
    userPubkey,
    relays: context.relays,
    relayHints: context.relayHints,
  }),
})
