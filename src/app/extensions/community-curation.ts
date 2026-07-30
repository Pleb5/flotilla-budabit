import {DELETE, type Filter, type TrustedEvent} from "@welshman/util"
import {repository} from "@welshman/app"
import {
  normalizeRelays,
  normalizePubkey,
  parseCommunityInput,
  parseTargetedPublication,
  type CommunityDefinition,
} from "@app/core/community"
import {
  getCommunityBootstrapRelays,
  loadCommunityEventsWithStatus,
  makeCommunityDefinitionFilter,
  makeCommunityProfileListFilters,
  selectLatestCommunityDefinition,
  type CommunityRelayLoadOptions,
  type CommunityRelayLoadResult,
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
  getCommunityWriteTargetSections,
} from "@app/core/community-permissions"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {parseSmartWidget} from "@app/extensions/registry"
import type {SmartWidgetEvent} from "@app/extensions/types"
import {recordCommunityWidgetRecommendationContext} from "./recommendation-context"
import {logCommunityWidgetDebug} from "./community-widget-debug"
import {getWidgetLineId} from "./widget-identity"

export type CommunityCuratedExtensionsStatus = "invalid-input" | "not-community" | "community"

export type CommunityCuratedExtensionsResult = {
  status: CommunityCuratedExtensionsStatus
  complete: boolean
  communityPubkey?: string
  relayHints: string[]
  trustedWidgetAuthorPubkeys: string[]
  widgets: SmartWidgetEvent[]
}

export type CommunityCuratedExtensionsLoadOptions = {
  priority?: number
}

const dedupeEvents = (events: TrustedEvent[]) =>
  Array.from(new Map(events.filter(event => event.id).map(event => [event.id, event])).values())

const queryCachedEvents = (filters: Filter[]) => {
  try {
    return filters.length ? repository.query(filters) : []
  } catch {
    return []
  }
}

const filtersCoveredByCache = (filters: Filter[]) =>
  filters.length > 0 && filters.every(filter => queryCachedEvents([filter]).length > 0)

const loadCurationEvents = async (
  relays: string[],
  filters: Filter[],
  options: CommunityRelayLoadOptions,
  cachedIsSufficient: (events: TrustedEvent[]) => boolean = events => events.length > 0,
): Promise<CommunityRelayLoadResult> => {
  const cachedEvents = queryCachedEvents(filters)

  if (cachedIsSufficient(cachedEvents)) {
    void loadCommunityEventsWithStatus(relays, filters, options)

    return {events: cachedEvents, complete: true, timedOutRelays: [], failedRelays: []}
  }

  const loaded = await loadCommunityEventsWithStatus(relays, filters, options)

  return {...loaded, events: dedupeEvents([...cachedEvents, ...loaded.events])}
}

const getTargetingRelayHints = (events: TrustedEvent[]) =>
  events.flatMap(event => {
    const ref = parseTargetedPublication(event)?.ref

    return ref?.relay ? [ref.relay] : []
  })

const getWidgetTargetingEvents = (widget: SmartWidgetEvent, targetingEvents: TrustedEvent[]) => {
  const widgetPubkey = normalizePubkey(widget.pubkey || "")
  const widgetAddress = widgetPubkey
    ? `${SMART_WIDGET_KIND}:${widgetPubkey}:${widget.identifier}`
    : ""

  return targetingEvents.filter(event => {
    const target = parseTargetedPublication(event)
    if (!target || target.kind !== SMART_WIDGET_KIND || !target.ref) return false

    if (target.ref.type === "e") {
      const refPubkey = normalizePubkey(target.ref.pubkey || "")

      return target.ref.value === widget.id && (!refPubkey || refPubkey === widgetPubkey)
    }

    if (target.ref.type === "a") {
      const [kind, pubkey, identifier] = target.ref.value.split(":")

      return (
        Number(kind) === SMART_WIDGET_KIND &&
        normalizePubkey(pubkey || "") === widgetPubkey &&
        identifier === widget.identifier &&
        target.ref.value.toLowerCase() === widgetAddress.toLowerCase()
      )
    }

    return false
  })
}

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

const makeWidgetProfileListFilters = (definition: CommunityDefinition) => {
  const sections = getCommunityWriteTargetSections(definition, COMMUNITY_WRITE_TARGETS.widget)

  return makeCommunityProfileListFilters({...definition, sections})
}

const getWidgetProfileListOwnerPubkeys = (definition: CommunityDefinition) =>
  Array.from(
    new Set(
      getCommunityWriteTargetSections(definition, COMMUNITY_WRITE_TARGETS.widget)
        .flatMap(section => section.profileLists.map(ref => normalizePubkey(ref.pubkey)))
        .filter(Boolean),
    ),
  )

export const loadCommunityCuratedWidgets = async (
  input: string,
  {priority = RELAY_REQUEST_PRIORITY.interactive}: CommunityCuratedExtensionsLoadOptions = {},
): Promise<CommunityCuratedExtensionsResult> => {
  const parsed = parseCommunityInput(input)

  if (!parsed) {
    logCommunityWidgetDebug("invalid community input", {input})
    return {
      status: "invalid-input",
      complete: true,
      relayHints: [],
      trustedWidgetAuthorPubkeys: [],
      widgets: [],
    }
  }

  const definitionResult = await loadCurationEvents(
    getCommunityBootstrapRelays(parsed.relays),
    [makeCommunityDefinitionFilter(parsed.pubkey)],
    {authenticate: true, priority},
  )
  const definitionEvents = definitionResult.events
  const definition = selectLatestCommunityDefinition(definitionEvents, parsed.pubkey)

  if (!definition) {
    logCommunityWidgetDebug("community definition not found", {
      communityPubkey: parsed.pubkey,
      relayHints: parsed.relays,
      definitionEvents: definitionEvents.length,
    })

    return {
      status: "not-community",
      complete: definitionResult.complete,
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
    logCommunityWidgetDebug("community has no relays for widget curation", {
      communityPubkey: definition.pubkey,
      parsedRelays: parsed.relays,
    })

    return {
      status: "community",
      complete: definitionResult.complete,
      communityPubkey: definition.pubkey,
      relayHints: communityRelays,
      trustedWidgetAuthorPubkeys: [],
      widgets: [],
    }
  }

  const profileListFilters = makeWidgetProfileListFilters(definition)
  const targetingFilters = [makeCommunityTargetingFilter(definition.pubkey, [SMART_WIDGET_KIND])]
  const profileListPromise = loadCurationEvents(
    communityRelays,
    profileListFilters,
    {authenticate: true, priority},
    () => filtersCoveredByCache(profileListFilters),
  )
  const targetingPromise = loadCurationEvents(communityRelays, targetingFilters, {
    authenticate: true,
    priority,
  })
  const [profileListResult, targetingResult] = await Promise.all([
    profileListPromise,
    targetingPromise,
  ])
  const profileListEvents = profileListResult.events
  const targetingEvents = targetingResult.events
  logCommunityWidgetDebug("loaded curation sources", {
    communityPubkey: definition.pubkey,
    communityRelays,
    profileListEvents: profileListEvents.map(event => ({id: event.id, pubkey: event.pubkey})),
    targetingEvents: targetingEvents.map(event => ({id: event.id, pubkey: event.pubkey})),
  })

  const deleteFilters = makeTargetDeleteFilters(targetingEvents)
  const deleteResult = deleteFilters.length
    ? await loadCurationEvents(
        communityRelays,
        deleteFilters,
        {authenticate: true, priority},
        () => false,
      )
    : {events: [], complete: true, timedOutRelays: [], failedRelays: []}
  const targetDeleteEvents = deleteResult.events
  const deletedTargetIds = getDeletedTargetEventIds(targetingEvents, targetDeleteEvents)
  const fallbackAuthorityPubkeys = profileListEvents.length
    ? []
    : getWidgetProfileListOwnerPubkeys(definition)
  const widgetTargetAuthorPubkeys = Array.from(
    new Set([
      ...getCommunityTargetWriterPubkeys({
        definition,
        profileListEvents,
        target: COMMUNITY_WRITE_TARGETS.widget,
      }),
      ...fallbackAuthorityPubkeys,
    ]),
  )
  const trustedWidgetAuthorPubkeys = Array.from(
    new Set([
      ...getCommunityTargetAuthorityPubkeys({
        definition,
        profileListEvents,
        target: COMMUNITY_WRITE_TARGETS.widget,
      }),
      ...fallbackAuthorityPubkeys,
    ]),
  )
  const widgetTargetAuthorSet = new Set(widgetTargetAuthorPubkeys.map(normalizePubkey))
  const eligibleTargetingEvents = targetingEvents.filter(
    event =>
      widgetTargetAuthorSet.has(normalizePubkey(event.pubkey)) && !deletedTargetIds.has(event.id),
  )
  logCommunityWidgetDebug("filtered targeting events", {
    communityPubkey: definition.pubkey,
    fallbackAuthorityPubkeys,
    widgetTargetAuthorPubkeys,
    trustedWidgetAuthorPubkeys,
    deletedTargetIds: Array.from(deletedTargetIds),
    eligibleTargetingEvents: eligibleTargetingEvents.map(event => ({
      id: event.id,
      pubkey: event.pubkey,
      ref: parseTargetedPublication(event)?.ref,
    })),
  })

  const widgetFilters = makeTargetedPublicationOriginalFilters(eligibleTargetingEvents)

  if (widgetFilters.length === 0) {
    logCommunityWidgetDebug("no widget filters after curation filtering", {
      communityPubkey: definition.pubkey,
      targetingEvents: targetingEvents.length,
      eligibleTargetingEvents: eligibleTargetingEvents.length,
    })

    return {
      status: "community",
      complete:
        definitionResult.complete &&
        profileListResult.complete &&
        targetingResult.complete &&
        deleteResult.complete,
      communityPubkey: definition.pubkey,
      relayHints: communityRelays,
      trustedWidgetAuthorPubkeys,
      widgets: [],
    }
  }

  const widgetRelays = normalizeRelays([
    ...communityRelays,
    ...getTargetingRelayHints(eligibleTargetingEvents),
  ])
  const widgetResult = await loadCurationEvents(
    widgetRelays,
    widgetFilters,
    {authenticate: true, priority, settle: "first-non-empty"},
    () => filtersCoveredByCache(widgetFilters),
  )
  const widgetEvents = widgetResult.events
  const widgets: SmartWidgetEvent[] = []

  for (const event of widgetEvents) {
    try {
      widgets.push(parseSmartWidget(event))
    } catch {
      // Ignore malformed or unsupported widget events.
    }
  }

  logCommunityWidgetDebug("loaded curated widget events", {
    communityPubkey: definition.pubkey,
    widgetFilters,
    widgetEvents: widgetEvents.map(event => ({id: event.id, pubkey: event.pubkey})),
    widgets: widgets.map(widget => ({
      id: getWidgetLineId(widget),
      identifier: widget.identifier,
      pubkey: widget.pubkey,
      slot: widget.slot,
      appUrl: widget.appUrl,
    })),
  })

  const dedupedWidgets = dedupeWidgets(widgets)
  const relayHints = normalizeRelays([
    ...parsed.relays,
    ...communityRelays,
    ...getTargetingRelayHints(eligibleTargetingEvents),
  ])

  for (const widget of dedupedWidgets) {
    const targetingSources = getWidgetTargetingEvents(widget, eligibleTargetingEvents)

    recordCommunityWidgetRecommendationContext(getWidgetLineId(widget), {
      communityPubkey: definition.pubkey,
      relays: communityRelays,
      relayHints,
      definition,
      profileListEvents,
      trustedWidgetAuthorPubkeys,
      widgetTargetAuthorPubkeys,
      fallbackAuthorityPubkeys,
      targetingEventIds: targetingSources.map(event => event.id).filter(Boolean),
      targetingRelayHints: getTargetingRelayHints(targetingSources),
    })
  }

  return {
    status: "community",
    complete:
      definitionResult.complete &&
      profileListResult.complete &&
      targetingResult.complete &&
      deleteResult.complete &&
      widgetResult.complete,
    communityPubkey: definition.pubkey,
    relayHints: communityRelays,
    trustedWidgetAuthorPubkeys,
    widgets: dedupedWidgets,
  }
}
