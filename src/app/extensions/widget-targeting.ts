import {publishThunk, repository} from "@welshman/app"
import {randomId} from "@welshman/lib"
import {makeEvent, type EventTemplate, type TrustedEvent} from "@welshman/util"
import {
  TARGETED_PUBLICATION_KIND,
  buildTargetedPublication,
  normalizePubkey,
  normalizeRelays,
  parseTargetedPublication,
} from "@app/core/community"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {makeAddressablePublicationRef} from "@app/core/community-targeting"
import type {SmartWidgetEvent} from "@app/extensions/types"

export type WidgetCommunityOption = {
  pubkey: string
  label?: string
  relay?: string
  relays?: string[]
}

export const getWidgetAddress = (widget: Pick<SmartWidgetEvent, "pubkey" | "identifier">) => {
  const pubkey = normalizePubkey(widget.pubkey || "")
  const identifier = widget.identifier?.trim()

  return pubkey && identifier ? `${SMART_WIDGET_KIND}:${pubkey}:${identifier}` : ""
}

export const getWidgetCommunityOptionRelayHints = (option?: WidgetCommunityOption) =>
  normalizeRelays([option?.relay || "", ...(option?.relays || [])])

export const getWidgetCommunityTargets = (
  communityOptions: WidgetCommunityOption[],
  communityPubkeys: string[],
) => {
  const byPubkey = new Map(communityOptions.map(option => [normalizePubkey(option.pubkey), option]))

  return Array.from(new Set(communityPubkeys.map(normalizePubkey).filter(Boolean)))
    .map(pubkey => byPubkey.get(pubkey))
    .filter((option): option is WidgetCommunityOption => Boolean(option))
}

export const getWidgetTargetPublishRelays = ({
  baseRelays = [],
  communityOptions,
  communityPubkeys,
}: {
  baseRelays?: string[]
  communityOptions: WidgetCommunityOption[]
  communityPubkeys: string[]
}) =>
  normalizeRelays([
    ...baseRelays,
    ...getWidgetCommunityTargets(communityOptions, communityPubkeys).flatMap(option =>
      getWidgetCommunityOptionRelayHints(option),
    ),
  ])

export const getWidgetTargetEventRelayHints = (event: TrustedEvent) => {
  const targeting = parseTargetedPublication(event)

  return normalizeRelays([
    targeting?.ref?.relay || "",
    ...(targeting?.communities || []).map(community => community.relay || ""),
  ])
}

export const publishWidgetEventToTargets = ({
  event,
  baseRelays = [],
  communityOptions,
  communityPubkeys,
}: {
  event: EventTemplate | TrustedEvent
  baseRelays?: string[]
  communityOptions: WidgetCommunityOption[]
  communityPubkeys: string[]
}) => {
  const relays = getWidgetTargetPublishRelays({baseRelays, communityOptions, communityPubkeys})
  const thunk = publishThunk({event, relays})

  if (thunk?.event) repository.publish(thunk.event as TrustedEvent)

  return thunk
}

export const publishWidgetTargetingEvent = ({
  widget,
  widgetPubkey = widget.pubkey || "",
  widgetIdentifier = widget.identifier,
  baseRelays = [],
  communityOptions,
  communityPubkeys,
  originalRelay,
  createdAt = Math.floor(Date.now() / 1000),
  targetingId = randomId(),
}: {
  widget: Pick<SmartWidgetEvent, "pubkey" | "identifier">
  widgetPubkey?: string
  widgetIdentifier?: string
  baseRelays?: string[]
  communityOptions: WidgetCommunityOption[]
  communityPubkeys: string[]
  originalRelay?: string
  createdAt?: number
  targetingId?: string
}) => {
  const pubkey = normalizePubkey(widgetPubkey || "")
  const identifier = widgetIdentifier?.trim()
  const communities = getWidgetCommunityTargets(communityOptions, communityPubkeys)
  const relays = getWidgetTargetPublishRelays({baseRelays, communityOptions, communityPubkeys})

  if (!pubkey || !identifier || communities.length === 0 || relays.length === 0) return undefined

  const event = makeEvent(TARGETED_PUBLICATION_KIND, {
    ...buildTargetedPublication({
      id: targetingId,
      kind: SMART_WIDGET_KIND,
      ref: makeAddressablePublicationRef({
        kind: SMART_WIDGET_KIND,
        pubkey,
        identifier,
        relay: originalRelay || relays[0],
      }),
      communities: communities.map(option => ({
        pubkey: option.pubkey,
        relay: getWidgetCommunityOptionRelayHints(option)[0],
      })),
    }),
    created_at: createdAt,
  })
  const thunk = publishThunk({event, relays})

  if (thunk?.event) repository.publish(thunk.event as TrustedEvent)

  return thunk
}
