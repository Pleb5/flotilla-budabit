import {publishThunk, repository} from "@welshman/app"
import {randomId} from "@welshman/lib"
import {makeEvent, type EventTemplate, type TrustedEvent} from "@welshman/util"
import {
  TARGETED_PUBLICATION_KIND,
  buildTargetedPublication,
  makeCommunityPointer,
  normalizePubkey,
  normalizeRelays,
  parseTargetedPublication,
} from "@app/core/community"
import type {CommunityPointer} from "@app/core/community"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {makeAddressablePublicationRef} from "@app/core/community-targeting"
import type {SmartWidgetEvent} from "@app/extensions/types"

export type WidgetCommunityOption = {
  community: CommunityPointer
  label?: string
  relay?: string
  relays?: string[]
  relayHints?: string[]
}

export const getWidgetAddress = (widget: Pick<SmartWidgetEvent, "pubkey" | "identifier">) => {
  const pubkey = normalizePubkey(widget.pubkey || "")
  const identifier = widget.identifier?.trim()

  return pubkey && identifier ? `${SMART_WIDGET_KIND}:${pubkey}:${identifier}` : ""
}

export const getWidgetCommunityOptionRelays = (option?: WidgetCommunityOption) =>
  normalizeRelays([option?.relay || "", ...(option?.relays || [])])

export const getWidgetCommunityOptionRelayHints = (option?: WidgetCommunityOption) =>
  normalizeRelays([...(option?.relayHints || []), ...getWidgetCommunityOptionRelays(option)])

export const getWidgetCommunityTargets = (
  communityOptions: WidgetCommunityOption[],
  communityAddresses: string[],
) => {
  const byAddress = new Map(communityOptions.map(option => [option.community.address, option]))

  return Array.from(new Set(communityAddresses.map(address => address.trim()).filter(Boolean)))
    .map(address => byAddress.get(address))
    .filter((option): option is WidgetCommunityOption => Boolean(option))
}

const getNormalizedTargetAddresses = (communityAddresses: string[]) =>
  Array.from(new Set(communityAddresses.map(address => address.trim()).filter(Boolean)))

export const getWidgetTargetsMissingCommunityRelays = (
  communityOptions: WidgetCommunityOption[],
  communityAddresses: string[],
) =>
  getWidgetCommunityTargets(communityOptions, communityAddresses).filter(
    option => getWidgetCommunityOptionRelays(option).length === 0,
  )

const assertWidgetTargetCommunityRelays = (
  communityOptions: WidgetCommunityOption[],
  communityAddresses: string[],
) => {
  const byAddress = new Map(communityOptions.map(option => [option.community.address, option]))
  const missingTargets = getNormalizedTargetAddresses(communityAddresses).filter(
    address => !byAddress.has(address),
  )
  const missing = getWidgetTargetsMissingCommunityRelays(communityOptions, communityAddresses)

  if (missingTargets.length > 0) {
    throw new Error(
      `Target communities are not available for widget publishing: ${missingTargets.join(", ")}`,
    )
  }

  if (missing.length > 0) {
    const labels = missing.map(option => option.label || option.community.address).join(", ")
    throw new Error(`Target communities must declare relays before publishing widgets: ${labels}`)
  }
}

export const getWidgetTargetPublishRelays = ({
  baseRelays = [],
  communityOptions,
  communityAddresses,
}: {
  baseRelays?: string[]
  communityOptions: WidgetCommunityOption[]
  communityAddresses: string[]
}) => {
  assertWidgetTargetCommunityRelays(communityOptions, communityAddresses)

  return normalizeRelays([
    ...baseRelays,
    ...getWidgetCommunityTargets(communityOptions, communityAddresses).flatMap(option =>
      getWidgetCommunityOptionRelays(option),
    ),
  ])
}

export const getWidgetTargetEventRelayHints = (event: TrustedEvent) => {
  const targeting = parseTargetedPublication(event)

  return normalizeRelays([
    targeting?.source?.relay || "",
    ...(targeting?.communities || []).flatMap(community => community.relayHints),
  ])
}

export const publishWidgetEventToTargets = ({
  event,
  baseRelays = [],
  communityOptions,
  communityAddresses,
}: {
  event: EventTemplate | TrustedEvent
  baseRelays?: string[]
  communityOptions: WidgetCommunityOption[]
  communityAddresses: string[]
}) => {
  const relays = getWidgetTargetPublishRelays({baseRelays, communityOptions, communityAddresses})
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
  communityAddresses,
  originalRelay,
  createdAt = Math.floor(Date.now() / 1000),
  targetingId = randomId(),
}: {
  widget: Pick<SmartWidgetEvent, "pubkey" | "identifier">
  widgetPubkey?: string
  widgetIdentifier?: string
  baseRelays?: string[]
  communityOptions: WidgetCommunityOption[]
  communityAddresses: string[]
  originalRelay?: string
  createdAt?: number
  targetingId?: string
}) => {
  const pubkey = normalizePubkey(widgetPubkey || "")
  const identifier = widgetIdentifier?.trim()
  const communities = getWidgetCommunityTargets(communityOptions, communityAddresses)
  const relays = getWidgetTargetPublishRelays({baseRelays, communityOptions, communityAddresses})

  if (!pubkey || !identifier || communities.length === 0 || relays.length === 0) return undefined

  const event = makeEvent(TARGETED_PUBLICATION_KIND, {
    ...buildTargetedPublication({
      id: targetingId,
      kind: SMART_WIDGET_KIND,
      source: makeAddressablePublicationRef({
        kind: SMART_WIDGET_KIND,
        pubkey,
        identifier,
        relay: originalRelay || relays[0],
      }),
      communities: communities.map(
        option =>
          makeCommunityPointer({
            ownerPubkey: option.community.ownerPubkey,
            communityId: option.community.communityId,
            relayHints: [getWidgetCommunityOptionRelays(option)[0]],
          })!,
      ),
    }),
    created_at: createdAt,
  })
  const thunk = publishThunk({event, relays})

  if (thunk?.event) repository.publish(thunk.event as TrustedEvent)

  return thunk
}
