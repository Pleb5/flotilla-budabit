import type {TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_SECTION_WIDGETS,
  normalizeRelays,
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
import {getCommunitySectionWriterPubkeys} from "@app/core/community-permissions"
import {parseSmartWidget} from "@app/extensions/registry"
import type {SmartWidgetEvent} from "@app/extensions/types"

export type CommunityCuratedExtensionsStatus = "invalid-input" | "not-community" | "community"

export type CommunityCuratedExtensionsResult = {
  status: CommunityCuratedExtensionsStatus
  communityPubkey?: string
  relayHints: string[]
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
    const current = byId.get(widget.identifier)
    if (!current || (widget.created_at || 0) > (current.created_at || 0)) {
      byId.set(widget.identifier, widget)
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => (b.created_at || 0) - (a.created_at || 0) || a.identifier.localeCompare(b.identifier),
  )
}

export const loadCommunityCuratedWidgets = async (
  input: string,
): Promise<CommunityCuratedExtensionsResult> => {
  const parsed = parseCommunityInput(input)

  if (!parsed) return {status: "invalid-input", relayHints: [], widgets: []}

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
  const widgetAuthorPubkeys = getCommunitySectionWriterPubkeys({
    definition,
    profileListEvents,
    sectionName: COMMUNITY_SECTION_WIDGETS,
  })
  const widgetFilters = makeTargetedPublicationOriginalFilters(targetingEvents, widgetAuthorPubkeys)

  if (widgetFilters.length === 0) {
    return {
      status: "community",
      communityPubkey: definition.pubkey,
      relayHints: communityRelays,
      widgets: [],
    }
  }

  const widgetEvents = await loadCommunityEvents(
    normalizeRelays([...communityRelays, ...getTargetingRelayHints(targetingEvents)]),
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
    widgets: dedupeWidgets(widgets),
  }
}
