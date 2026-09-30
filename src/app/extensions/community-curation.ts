import {matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
import {getDeletedTargetEventIds} from "@app/core/deletion-rules"
import {makeDeletionTargetFilters as makeTargetDeleteFilters} from "@app/core/deletion-hydration"
import {repository} from "@welshman/app"
import {
  normalizeRelays,
  normalizePubkey,
  parseCommunityNaddr,
  parseTargetedPublication,
  type CommunityDefinition,
} from "@app/core/community"
import {
  getCommunityBootstrapRelays,
  loadCommunityEventsWithStatus,
  makeExactCommunityDefinitionFilter,
  makeCommunityProfileListFilters,
  selectExactCommunityDefinition,
  type CommunityRelayLoadOptions,
  type CommunityRelayLoadResult,
} from "@app/core/community-state"
import {
  SMART_WIDGET_KIND,
  makeCommunityContentFilterPlan,
  makeCommunityTargetingFilter,
  makeTargetedPublicationOriginalFilterPlan,
} from "@app/core/community-feeds"
import {
  COMMUNITY_WRITE_TARGETS,
  filterAuthorizedCommunityTargetingEvents,
  getCommunityTargetAuthorityPubkeys,
  getCommunityTargetWriterPubkeys,
  getCommunityWriteTargetSections,
} from "@app/core/community-permissions"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {loadBoundedCommunityHistory} from "@app/core/requests"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import {parseSmartWidget} from "@app/extensions/registry"
import type {SmartWidgetEvent} from "@app/extensions/types"
import {recordCommunityWidgetRecommendationContext} from "./recommendation-context"
import {logCommunityWidgetDebug} from "./community-widget-debug"
import {getWidgetLineId} from "./widget-identity"
import {measurePerformanceDiagnosticsWork} from "@app/core/performance-diagnostics"

export type CommunityCuratedExtensionsStatus = "invalid-input" | "not-community" | "community"

type CommunityCuratedExtensionsResultBase = {
  complete: boolean
  relayHints: string[]
  trustedWidgetAuthorPubkeys: string[]
  widgets: SmartWidgetEvent[]
}

export type CommunityCuratedExtensionsResult = CommunityCuratedExtensionsResultBase &
  (
    | {status: "invalid-input"}
    | {
        status: Exclude<CommunityCuratedExtensionsStatus, "invalid-input">
        community: import("@app/core/community").CommunityPointer
      }
  )

export type CommunityCuratedExtensionsLoadOptions = {
  priority?: number
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  signal?: AbortSignal
  batchSize?: number
  yieldTask?: () => Promise<void>
  onWidgets?: (widgets: SmartWidgetEvent[]) => void
}

const defaultYieldTask = () => {
  const taskScheduler = (
    globalThis as typeof globalThis & {scheduler?: {yield?: () => Promise<void>}}
  ).scheduler
  return taskScheduler?.yield
    ? taskScheduler.yield()
    : new Promise<void>(resolve => setTimeout(resolve, 0))
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Widget curation cancelled", "AbortError")
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
    void loadCommunityEventsWithStatus(relays, filters, options).catch(() => undefined)

    return {events: cachedEvents, complete: true, timedOutRelays: [], failedRelays: []}
  }

  const loaded = await loadCommunityEventsWithStatus(relays, filters, options)

  return {...loaded, events: dedupeEvents([...cachedEvents, ...loaded.events])}
}

const loadTargetingEvents = async ({
  relays,
  relayFilters,
  localFilters,
  priority,
  owner,
  signal,
}: {
  relays: string[]
  relayFilters: Filter[]
  localFilters: Filter[]
  priority: number
  owner: string
  signal?: AbortSignal
}): Promise<CommunityRelayLoadResult> => {
  const cachedEvents = queryCachedEvents(localFilters).filter(event =>
    matchFilters(localFilters, event),
  )
  const result = await loadBoundedCommunityHistory({
    relays,
    relayFilters,
    localFilters,
    priority,
    owner,
    signal,
  })

  return {
    events: dedupeEvents([...cachedEvents, ...result.events]),
    complete: result.complete,
    timedOutRelays: result.timedOut ? relays : [],
    failedRelays: [],
  }
}

const getTargetingRelayHints = (events: TrustedEvent[]) =>
  events.flatMap(event => {
    const ref = parseTargetedPublication(event)?.source

    return ref?.relay ? [ref.relay] : []
  })

const getWidgetTargetingEvents = (widget: SmartWidgetEvent, targetingEvents: TrustedEvent[]) => {
  const widgetPubkey = normalizePubkey(widget.pubkey || "")
  const widgetAddress = widgetPubkey
    ? `${SMART_WIDGET_KIND}:${widgetPubkey}:${widget.identifier}`
    : ""

  return targetingEvents.filter(event => {
    const target = parseTargetedPublication(event)
    if (!target || target.kind !== SMART_WIDGET_KIND || !target.source) return false

    if (target.source.type === "e") {
      const refPubkey = normalizePubkey(target.source.pubkey || "")

      return target.source.value === widget.id && (!refPubkey || refPubkey === widgetPubkey)
    }

    if (target.source.type === "a") {
      const [kind, pubkey, identifier] = target.source.value.split(":")

      return (
        Number(kind) === SMART_WIDGET_KIND &&
        normalizePubkey(pubkey || "") === widgetPubkey &&
        identifier === widget.identifier &&
        target.source.value.toLowerCase() === widgetAddress.toLowerCase()
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

const makeWidgetProfileListFilters = (definition: CommunityDefinition) => {
  const sections = getCommunityWriteTargetSections(definition, COMMUNITY_WRITE_TARGETS.widget)

  return makeCommunityProfileListFilters({...definition, sections})
}

export const loadCommunityCuratedWidgets = async (
  input: string,
  {
    priority = RELAY_REQUEST_PRIORITY.interactive,
    profileListEvents: currentProfileListEvents,
    reportState,
    signal,
    batchSize = 8,
    yieldTask = defaultYieldTask,
    onWidgets,
  }: CommunityCuratedExtensionsLoadOptions = {},
): Promise<CommunityCuratedExtensionsResult> => {
  const yieldForInput = async () => {
    throwIfAborted(signal)
    await yieldTask()
    throwIfAborted(signal)
  }
  const community = parseCommunityNaddr(input)

  if (!community) {
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
    getCommunityBootstrapRelays(community.relayHints),
    [makeExactCommunityDefinitionFilter(community)],
    {authenticate: true, priority, signal},
  )
  const definitionEvents = definitionResult.events
  const definition = selectExactCommunityDefinition(definitionEvents, community)

  if (!definition) {
    logCommunityWidgetDebug("community definition not found", {
      community,
      relayHints: community.relayHints,
      definitionEvents: definitionEvents.length,
    })

    return {
      status: "not-community",
      complete: definitionResult.complete,
      community,
      relayHints: community.relayHints,
      trustedWidgetAuthorPubkeys: [],
      widgets: [],
    }
  }

  await yieldForInput()

  const communityRelays = normalizeRelays(
    definition.relays.length ? definition.relays : community.relayHints,
  )
  if (communityRelays.length === 0) {
    logCommunityWidgetDebug("community has no relays for widget curation", {
      community,
      parsedRelays: community.relayHints,
    })

    return {
      status: "community",
      complete: definitionResult.complete,
      community,
      relayHints: communityRelays,
      trustedWidgetAuthorPubkeys: [],
      widgets: [],
    }
  }

  const profileListFilters = makeWidgetProfileListFilters(definition)
  const profileListResult = await loadCurationEvents(
    communityRelays,
    profileListFilters,
    {authenticate: true, priority, signal},
    () => filtersCoveredByCache(profileListFilters),
  )
  const profileListEvents = currentProfileListEvents ?? profileListResult.events
  const widgetTargetAuthorPubkeys = Array.from(
    new Set([
      ...getCommunityTargetWriterPubkeys({
        definition,
        profileListEvents,
        target: COMMUNITY_WRITE_TARGETS.widget,
        reportState,
      }),
    ]),
  )
  const trustedWidgetAuthorPubkeys = Array.from(
    new Set([
      ...getCommunityTargetAuthorityPubkeys({
        definition,
        profileListEvents,
        target: COMMUNITY_WRITE_TARGETS.widget,
        reportState,
      }),
    ]),
  )
  await yieldForInput()
  const targetingFilterPlan = makeCommunityContentFilterPlan(
    [makeCommunityTargetingFilter(community.communityId, [SMART_WIDGET_KIND])],
    widgetTargetAuthorPubkeys,
  )
  const targetingResult = await loadTargetingEvents({
    relays: communityRelays,
    relayFilters: targetingFilterPlan.relayFilters,
    localFilters: targetingFilterPlan.localFilters,
    priority,
    owner: `community-widget-curation:${definition.pointer.address}`,
    signal,
  })
  const targetingEvents = targetingResult.events
  logCommunityWidgetDebug("loaded curation sources", () => ({
    community,
    communityRelays,
    profileListEvents: profileListEvents.map(event => ({id: event.id, pubkey: event.pubkey})),
    targetingEvents: targetingEvents.map(event => ({id: event.id, pubkey: event.pubkey})),
  }))

  const authorizedTargetingEvents = measurePerformanceDiagnosticsWork(
    {
      owner: "widget-curation",
      phase: "authority-filter",
      detail: {events: targetingEvents.length},
    },
    () =>
      filterAuthorizedCommunityTargetingEvents({
        community,
        definition,
        profileListEvents,
        events: targetingEvents,
        reportState,
        kinds: [SMART_WIDGET_KIND],
      }),
  )
  const deleteFilters = makeTargetDeleteFilters(authorizedTargetingEvents)
  const deleteResult = deleteFilters.length
    ? await loadCurationEvents(
        communityRelays,
        deleteFilters,
        {authenticate: true, priority, signal},
        () => false,
      )
    : {events: [], complete: true, timedOutRelays: [], failedRelays: []}
  const targetDeleteEvents = deleteResult.events
  const {deletedTargetIds, eligibleTargetingEvents} = measurePerformanceDiagnosticsWork(
    {
      owner: "widget-curation",
      phase: "target-deletion-filter",
      detail: {
        targets: authorizedTargetingEvents.length,
        deletes: targetDeleteEvents.length,
      },
    },
    () => {
      const deletedTargetIds = getDeletedTargetEventIds(
        authorizedTargetingEvents,
        targetDeleteEvents,
      )
      return {
        deletedTargetIds,
        eligibleTargetingEvents: authorizedTargetingEvents.filter(
          event => !deletedTargetIds.has(event.id),
        ),
      }
    },
  )
  await yieldForInput()
  logCommunityWidgetDebug("filtered targeting events", () => ({
    communityAddress: definition.pointer.address,
    widgetTargetAuthorPubkeys,
    trustedWidgetAuthorPubkeys,
    deletedTargetIds: Array.from(deletedTargetIds),
    eligibleTargetingEvents: eligibleTargetingEvents.map(event => ({
      id: event.id,
      pubkey: event.pubkey,
      ref: parseTargetedPublication(event)?.source,
    })),
  }))

  const widgetFilterPlan = makeTargetedPublicationOriginalFilterPlan(eligibleTargetingEvents)

  if (widgetFilterPlan.relayFilters.length === 0) {
    logCommunityWidgetDebug("no widget filters after curation filtering", {
      communityAddress: definition.pointer.address,
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
      community,
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
    widgetFilterPlan.relayFilters,
    {authenticate: true, priority, settle: "first-non-empty", signal},
    () => filtersCoveredByCache(widgetFilterPlan.localFilters),
  )
  const widgetEvents = measurePerformanceDiagnosticsWork(
    {
      owner: "widget-curation",
      phase: "widget-original-matching",
      detail: {events: widgetResult.events.length, filters: widgetFilterPlan.localFilters.length},
    },
    () => widgetResult.events.filter(event => matchFilters(widgetFilterPlan.localFilters, event)),
  )
  const widgets: SmartWidgetEvent[] = []

  for (let offset = 0; offset < widgetEvents.length; offset += Math.max(1, batchSize)) {
    const batch = widgetEvents.slice(offset, offset + Math.max(1, batchSize))
    measurePerformanceDiagnosticsWork(
      {
        owner: "widget-curation",
        phase: "parse-widget-batch",
        detail: {batch: batch.length, offset, total: widgetEvents.length},
      },
      () => {
        for (const event of batch) {
          try {
            widgets.push(parseSmartWidget(event))
          } catch {
            // Ignore malformed or unsupported widget events.
          }
        }
      },
    )
    const progressiveWidgets = dedupeWidgets(widgets)
    if (progressiveWidgets.length > 0) onWidgets?.(progressiveWidgets)
    if (offset + batch.length < widgetEvents.length) await yieldForInput()
  }

  logCommunityWidgetDebug("loaded curated widget events", () => ({
    communityAddress: definition.pointer.address,
    widgetFilters: widgetFilterPlan.relayFilters,
    widgetEvents: widgetEvents.map(event => ({id: event.id, pubkey: event.pubkey})),
    widgets: widgets.map(widget => ({
      id: getWidgetLineId(widget),
      identifier: widget.identifier,
      pubkey: widget.pubkey,
      slot: widget.slot,
      appUrl: widget.appUrl,
    })),
  }))

  const dedupedWidgets = measurePerformanceDiagnosticsWork(
    {owner: "widget-curation", phase: "deduplicate", detail: {widgets: widgets.length}},
    () => dedupeWidgets(widgets),
  )
  const relayHints = normalizeRelays([
    ...community.relayHints,
    ...communityRelays,
    ...getTargetingRelayHints(eligibleTargetingEvents),
  ])

  for (let offset = 0; offset < dedupedWidgets.length; offset += Math.max(1, batchSize)) {
    const batch = dedupedWidgets.slice(offset, offset + Math.max(1, batchSize))
    measurePerformanceDiagnosticsWork(
      {
        owner: "widget-curation",
        phase: "recommendation-context-batch",
        detail: {batch: batch.length, offset, total: dedupedWidgets.length},
      },
      () => {
        for (const widget of batch) {
          const targetingSources = getWidgetTargetingEvents(widget, eligibleTargetingEvents)

          recordCommunityWidgetRecommendationContext(getWidgetLineId(widget), {
            community,
            relays: communityRelays,
            relayHints,
            definition,
            profileListEvents,
            trustedWidgetAuthorPubkeys,
            widgetTargetAuthorPubkeys,
            targetingEventIds: targetingSources.map(event => event.id).filter(Boolean),
            targetingRelayHints: getTargetingRelayHints(targetingSources),
          })
        }
      },
    )
    if (offset + batch.length < dedupedWidgets.length) await yieldForInput()
  }

  return {
    status: "community",
    complete:
      definitionResult.complete &&
      profileListResult.complete &&
      targetingResult.complete &&
      deleteResult.complete &&
      widgetResult.complete,
    community,
    relayHints: communityRelays,
    trustedWidgetAuthorPubkeys,
    widgets: dedupedWidgets,
  }
}
