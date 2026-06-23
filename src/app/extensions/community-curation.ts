import {DELETE, type Filter, type TrustedEvent} from "@welshman/util"
import {
  normalizeRelays,
  normalizePubkey,
  parseCommunityInput,
  parseTargetedPublication,
} from "@app/core/community"
import {
  getCommunityBootstrapRelays,
  loadCommunityEvents,
  makeCommunityDefinitionFilter,
  makeCommunityProfileListFilters,
  selectLatestCommunityDefinition,
} from "@app/core/community-state"
import {
  SMART_WIDGET_KIND,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilters,
} from "@app/core/community-feeds"
import {
  COMMUNITY_WRITE_TARGETS,
  getCommunityTargetAuthorityPubkeys,
  getCommunityTargetWriterPubkeys,
} from "@app/core/community-permissions"
import {parseSmartWidget} from "@app/extensions/registry"
import type {SmartWidgetEvent} from "@app/extensions/types"
import {getWidgetLineId} from "./widget-identity"

export type CommunityCuratedExtensionsStatus = "invalid-input" | "not-community" | "community"

export type CommunityCuratedExtensionsResult = {
  status: CommunityCuratedExtensionsStatus
  communityPubkey?: string
  relayHints: string[]
  trustedWidgetAuthorPubkeys: string[]
  widgets: SmartWidgetEvent[]
}

const getTargetingRelayHints = (events: TrustedEvent[]) =>
  events.flatMap(event => {
    const ref = parseTargetedPublication(event)?.ref

    return ref?.relay ? [ref.relay] : []
  })

const dedupeWidgets = (widgets: SmartWidgetEvent[]) => {
  const byId = new Map<string, SmartWidgetEvent>()

  for (const widget of widgets) {
    const id = getWidgetLineId(widget)
    const current = byId.get(id)
    if (!current || (widget.created_at || 0) > (current.created_at || 0)) {
      byId.set(id, widget)
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => (b.created_at || 0) - (a.created_at || 0) || a.identifier.localeCompare(b.identifier),
  )
}

const makeTargetDeleteFilters = (events: TrustedEvent[]): Filter[] => {
  const ids = events.map(event => event.id).filter(Boolean)

  return ids.length ? [{kinds: [DELETE], "#e": ids, limit: ids.length * 2}] : []
}

const getDeletedTargetEventIds = (targetEvents: TrustedEvent[], deleteEvents: TrustedEvent[]) => {
  const targetAuthors = new Map(
    targetEvents.map(event => [event.id, normalizePubkey(event.pubkey)]),
  )
  const deleted = new Set<string>()

  for (const event of deleteEvents) {
    if (event.kind !== DELETE) continue
    const author = normalizePubkey(event.pubkey)

    for (const tag of event.tags || []) {
      if (tag[0] !== "e" || !tag[1]) continue
      if (targetAuthors.get(tag[1]) === author) deleted.add(tag[1])
    }
  }

  return deleted
}

export const loadCommunityCuratedWidgets = async (
  input: string,
): Promise<CommunityCuratedExtensionsResult> => {
  const parsed = parseCommunityInput(input)

  if (!parsed)
    return {status: "invalid-input", relayHints: [], trustedWidgetAuthorPubkeys: [], widgets: []}

  const definitionEvents = await loadCommunityEvents(
    getCommunityBootstrapRelays(parsed.relays),
    [makeCommunityDefinitionFilter(parsed.pubkey)],
    {authenticate: true},
  )
  const definition = selectLatestCommunityDefinition(definitionEvents, parsed.pubkey)

  if (!definition) {
    return {
      status: "not-community",
      communityPubkey: parsed.pubkey,
      relayHints: parsed.relays,
      trustedWidgetAuthorPubkeys: [],
      widgets: [],
    }
  }

  const communityRelays = normalizeRelays(
    definition.relays.length ? definition.relays : parsed.relays,
  )
  if (communityRelays.length === 0) {
    return {
      status: "community",
      communityPubkey: definition.pubkey,
      relayHints: communityRelays,
      trustedWidgetAuthorPubkeys: [],
      widgets: [],
    }
  }

  const [profileListEvents, targetingEvents] = await Promise.all([
    loadCommunityEvents(communityRelays, makeCommunityProfileListFilters(definition), {
      authenticate: true,
    }),
    loadCommunityEvents(
      communityRelays,
      [makeCommunityTargetingFilter(definition.pubkey, [SMART_WIDGET_KIND])],
      {authenticate: true},
    ),
  ])
  const deleteFilters = makeTargetDeleteFilters(targetingEvents)
  const targetDeleteEvents = deleteFilters.length
    ? await loadCommunityEvents(communityRelays, deleteFilters, {authenticate: true})
    : []
  const deletedTargetIds = getDeletedTargetEventIds(targetingEvents, targetDeleteEvents)
  const widgetTargetAuthorPubkeys = getCommunityTargetWriterPubkeys({
    definition,
    profileListEvents,
    target: COMMUNITY_WRITE_TARGETS.widget,
  })
  const trustedWidgetAuthorPubkeys = getCommunityTargetAuthorityPubkeys({
    definition,
    profileListEvents,
    target: COMMUNITY_WRITE_TARGETS.widget,
  })
  const widgetTargetAuthorSet = new Set(widgetTargetAuthorPubkeys.map(normalizePubkey))
  const eligibleTargetingEvents = targetingEvents.filter(
    event =>
      widgetTargetAuthorSet.has(normalizePubkey(event.pubkey)) && !deletedTargetIds.has(event.id),
  )
  const widgetFilters = makeTargetedPublicationOriginalFilters(eligibleTargetingEvents)

  if (widgetFilters.length === 0) {
    return {
      status: "community",
      communityPubkey: definition.pubkey,
      relayHints: communityRelays,
      trustedWidgetAuthorPubkeys,
      widgets: [],
    }
  }

  const widgetEvents = await loadCommunityEvents(
    normalizeRelays([...communityRelays, ...getTargetingRelayHints(eligibleTargetingEvents)]),
    widgetFilters,
    {authenticate: true},
  )
  const widgets: SmartWidgetEvent[] = []

  for (const event of widgetEvents) {
    try {
      widgets.push(parseSmartWidget(event))
    } catch {
      // Ignore malformed or unsupported widget events.
    }
  }

  return {
    status: "community",
    communityPubkey: definition.pubkey,
    relayHints: communityRelays,
    trustedWidgetAuthorPubkeys,
    widgets: dedupeWidgets(widgets),
  }
}
