import {
  loadCommunityCuratedWidgets,
  type CommunityCuratedExtensionsResult,
} from "@app/extensions/community-curation"
import {LRUCache} from "@welshman/lib"
import {pubkey} from "@welshman/app"
import {
  normalizePubkey,
  parseCommunityDefinitionAddress,
  parseCommunityNaddr,
} from "@app/core/community"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"
import type {TrustedEvent} from "@welshman/util"
import type {SmartWidgetEvent, WidgetCommunitySlotType} from "@app/extensions/types"
import {logCommunityWidgetDebug} from "./community-widget-debug"
import {getWidgetLineId} from "./widget-identity"
import {
  isAuthorizedCommunitySharedConfigEvent,
  type CommunitySharedConfigDescriptorAuthority,
} from "./community-shared-config"

export const COMMUNITY_WIDGET_EMPTY_CACHE_TTL_MS = 30_000
export const COMMUNITY_WIDGET_SUCCESS_CACHE_TTL_MS = 5 * 60_000
export const COMMUNITY_SHARED_CONFIG_KIND = 30078
export const COMMUNITY_SHARED_CONFIG_PREFIX = "budabit-community-config"

type CuratedWidgetLoad = ReturnType<typeof loadCommunityCuratedWidgets>
type CuratedWidgetCacheEntry = {
  promise: CuratedWidgetLoad
  priority: number
  controller: AbortController
  widgetListeners: Set<(widgets: SmartWidgetEvent[]) => void>
  signalConsumers: Set<AbortSignal>
  signalCleanups: Array<() => void>
  hasUnsignalledConsumer: boolean
  settledAt?: number
  ttlMs?: number
}

export type LoadCachedCommunityCuratedWidgetsOptions = {
  evidenceKey?: string
  force?: boolean
  now?: number
  priority?: number
  profileListEvents?: TrustedEvent[]
  reportState?: EffectiveCommunityReportState
  signal?: AbortSignal
  batchSize?: number
  yieldTask?: () => Promise<void>
  onWidgets?: (widgets: SmartWidgetEvent[]) => void
}

// Bounded LRUs: entries hold full widget events and load promises, keyed by
// community and evolving relay lists, so they must not grow for the app lifetime.
const curatedWidgetLoads = new LRUCache<string, CuratedWidgetCacheEntry>(32)
const curatedWidgetSnapshots = new LRUCache<string, SmartWidgetEvent[]>(32)

const getCurationCacheKey = (input: string, viewerPubkey: string, evidenceKey: string) => {
  const trimmed = input.trim()
  const parsed = parseCommunityNaddr(trimmed)

  return parsed
    ? `${normalizePubkey(viewerPubkey)}:${parsed.address}:${evidenceKey}`
    : `${normalizePubkey(viewerPubkey)}:${trimmed}:${evidenceKey}`
}

const getCurationSnapshotKey = (input: string, viewerPubkey: string, evidenceKey: string) => {
  const trimmed = input.trim()
  const parsed = parseCommunityNaddr(trimmed)

  return `${normalizePubkey(viewerPubkey)}:${parsed?.address || trimmed}:${evidenceKey}`
}

export const getCommunityWidgetCurationEvidenceKey = ({
  definitionEventId = "",
  profileListEvents = [],
  reportState,
}: {
  definitionEventId?: string
  profileListEvents?: Array<Pick<TrustedEvent, "id" | "created_at">>
  reportState?: EffectiveCommunityReportState
}) =>
  JSON.stringify({
    definitionEventId,
    profileLists: profileListEvents.map(event => `${event.id}:${event.created_at}`).sort(),
    reports: [...(reportState?.eventReports || []), ...(reportState?.personReports || [])]
      .map(report => report.event.id)
      .sort(),
  })

const getCuratedWidgetResultTtl = (result: CommunityCuratedExtensionsResult | undefined) =>
  result?.status === "community" && result.widgets.length > 0
    ? COMMUNITY_WIDGET_SUCCESS_CACHE_TTL_MS
    : COMMUNITY_WIDGET_EMPTY_CACHE_TTL_MS

const isFreshCacheEntry = (entry: CuratedWidgetCacheEntry, now: number) =>
  entry.settledAt === undefined || now - entry.settledAt < (entry.ttlMs || 0)

const registerCuratedWidgetConsumer = (
  entry: CuratedWidgetCacheEntry,
  signal?: AbortSignal,
  onWidgets?: (widgets: SmartWidgetEvent[]) => void,
) => {
  if (onWidgets) entry.widgetListeners.add(onWidgets)
  if (!signal) {
    entry.hasUnsignalledConsumer = true
    return
  }
  if (signal.aborted || entry.signalConsumers.has(signal)) return

  entry.signalConsumers.add(signal)
  const onAbort = () => {
    if (
      !entry.hasUnsignalledConsumer &&
      Array.from(entry.signalConsumers).every(candidate => candidate.aborted)
    ) {
      entry.controller.abort()
    }
  }
  signal.addEventListener("abort", onAbort, {once: true})
  entry.signalCleanups.push(() => signal.removeEventListener("abort", onAbort))
}

const clearCuratedWidgetConsumers = (entry: CuratedWidgetCacheEntry) => {
  entry.signalCleanups.forEach(cleanup => cleanup())
  entry.signalCleanups = []
  entry.signalConsumers.clear()
  entry.widgetListeners.clear()
}

export const loadCachedCommunityCuratedWidgets = (
  input: string,
  {
    evidenceKey = "",
    force = false,
    now = Date.now(),
    priority = RELAY_REQUEST_PRIORITY.interactive,
    profileListEvents,
    reportState,
    signal,
    batchSize,
    yieldTask,
    onWidgets,
  }: LoadCachedCommunityCuratedWidgetsOptions = {},
) => {
  const viewerPubkey = normalizePubkey(pubkey.get() || "")
  const resolvedEvidenceKey =
    evidenceKey ||
    (profileListEvents !== undefined || reportState !== undefined
      ? getCommunityWidgetCurationEvidenceKey({profileListEvents, reportState})
      : "")
  const key = getCurationCacheKey(input, viewerPubkey, resolvedEvidenceKey)
  const snapshotKey = getCurationSnapshotKey(input, viewerPubkey, resolvedEvidenceKey)
  if (!key) return Promise.resolve(undefined)

  const existing = curatedWidgetLoads.get(key)
  if (
    existing &&
    existing.settledAt === undefined &&
    !existing.controller.signal.aborted &&
    existing.priority >= priority
  ) {
    registerCuratedWidgetConsumer(existing, signal, onWidgets)
    return existing.promise
  }
  if (!force && existing?.settledAt !== undefined && isFreshCacheEntry(existing, now)) {
    return existing.promise
  }

  if (existing && existing.settledAt === undefined) existing.controller.abort()
  const entry: CuratedWidgetCacheEntry = {
    promise: undefined as unknown as CuratedWidgetLoad,
    priority,
    controller: new AbortController(),
    widgetListeners: new Set(),
    signalConsumers: new Set(),
    signalCleanups: [],
    hasUnsignalledConsumer: false,
  }
  registerCuratedWidgetConsumer(entry, signal, onWidgets)
  const pending = loadCommunityCuratedWidgets(input.trim(), {
    priority,
    ...(profileListEvents === undefined ? {} : {profileListEvents}),
    ...(reportState === undefined ? {} : {reportState}),
    signal: entry.controller.signal,
    ...(batchSize === undefined ? {} : {batchSize}),
    ...(yieldTask === undefined ? {} : {yieldTask}),
    onWidgets: widgets => entry.widgetListeners.forEach(listener => listener(widgets)),
  })
    .then(result => {
      const current = curatedWidgetLoads.get(key)
      if (current?.promise === pending) {
        if (result?.status === "community" && result.widgets.length > 0) {
          curatedWidgetSnapshots.set(snapshotKey, result.widgets)
        } else if (result?.complete) {
          curatedWidgetSnapshots.pop(snapshotKey)
        }

        if (!result?.complete) {
          curatedWidgetLoads.pop(key)
          return result
        }

        current.settledAt = Date.now()
        current.ttlMs = getCuratedWidgetResultTtl(result)
      }

      return result
    })
    .catch(error => {
      if (curatedWidgetLoads.get(key)?.promise === pending) curatedWidgetLoads.pop(key)
      throw error
    })
    .finally(() => clearCuratedWidgetConsumers(entry))
  entry.promise = pending
  curatedWidgetLoads.set(key, entry)

  return pending
}

const clearLRUCache = <U>(cache: LRUCache<string, U>) => {
  cache.map.clear()
}

export const clearCommunityWidgetSlotCache = () => {
  clearLRUCache(curatedWidgetLoads)
  clearLRUCache(curatedWidgetSnapshots)
}

export const getLastValidatedCommunityCuratedWidgets = (
  input: string,
  viewerPubkey = pubkey.get() || "",
  evidenceKey = "",
) => [
  ...(curatedWidgetSnapshots.get(getCurationSnapshotKey(input, viewerPubkey, evidenceKey)) || []),
]

export const shouldPreserveCuratedWidgetView = (
  currentWidgets: SmartWidgetEvent[],
  nextWidgets: SmartWidgetEvent[],
  sameCommunity: boolean,
  complete = true,
) => !complete && sameCommunity && currentWidgets.length > 0 && nextWidgets.length === 0

type InstalledWidgetMatch = {
  key: string
  widget: SmartWidgetEvent
}

type CommunitySharedConfigEvent = {
  kind?: number
  pubkey?: string
  tags?: string[][]
}

type CommunitySharedConfigRef = {
  communityAddress: string
  namespace: string
  key: string
}

const isNewerWidget = (candidate: SmartWidgetEvent, current: SmartWidgetEvent | undefined) =>
  !current || (candidate.created_at || 0) > (current.created_at || 0)

const buildInstalledWidgetIndex = (installedWidgets: Record<string, SmartWidgetEvent>) => {
  const byLineId = new Map<string, InstalledWidgetMatch>()
  const byIdentifier = new Map<string, InstalledWidgetMatch[]>()

  for (const [key, widget] of Object.entries(installedWidgets)) {
    const lineId = getWidgetLineId(widget)
    if (lineId && isNewerWidget(widget, byLineId.get(lineId)?.widget)) {
      byLineId.set(lineId, {key, widget})
    }

    const identifier = widget.identifier?.trim() || key.trim()
    if (identifier) {
      byIdentifier.set(identifier, [...(byIdentifier.get(identifier) || []), {key, widget}])
    }
  }

  return {byLineId, byIdentifier}
}

const getUniqueIdentifierMatch = (
  matches: InstalledWidgetMatch[] | undefined,
): InstalledWidgetMatch | undefined => {
  if (!matches?.length) return undefined

  const lineIds = new Set(matches.map(match => getWidgetLineId(match.widget) || match.key))
  if (lineIds.size !== 1) return undefined

  return matches.reduce<InstalledWidgetMatch | undefined>(
    (selected, match) => (isNewerWidget(match.widget, selected?.widget) ? match : selected),
    undefined,
  )
}

const findInstalledWidgetMatch = (
  widget: SmartWidgetEvent,
  installedWidgets: Record<string, SmartWidgetEvent>,
  index: ReturnType<typeof buildInstalledWidgetIndex>,
): InstalledWidgetMatch | undefined => {
  const id = getWidgetLineId(widget)
  const direct = id ? installedWidgets[id] : undefined
  if (direct) return {key: id, widget: direct}

  const byLineId = id ? index.byLineId.get(id) : undefined
  if (byLineId) return byLineId

  return getUniqueIdentifierMatch(index.byIdentifier.get(widget.identifier?.trim() || ""))
}

const isLegacyIdentifierEnabled = (
  identifier: string | undefined,
  enabledIds: Set<string>,
  index: ReturnType<typeof buildInstalledWidgetIndex>,
) => {
  const normalizedIdentifier = identifier?.trim()
  if (!normalizedIdentifier || !enabledIds.has(normalizedIdentifier)) return false

  return Boolean(getUniqueIdentifierMatch(index.byIdentifier.get(normalizedIdentifier)))
}

const isInstalledWidgetEnabled = (
  key: string,
  widget: SmartWidgetEvent,
  enabledIds: Set<string>,
  index: ReturnType<typeof buildInstalledWidgetIndex>,
) => {
  const lineId = getWidgetLineId(widget)

  return (
    enabledIds.has(key) ||
    enabledIds.has(lineId) ||
    isLegacyIdentifierEnabled(widget.identifier, enabledIds, index)
  )
}

const setPreferredWidget = (widgets: Map<string, SmartWidgetEvent>, widget: SmartWidgetEvent) => {
  const key = getWidgetLineId(widget) || widget.identifier
  const current = widgets.get(key)

  if (isNewerWidget(widget, current)) widgets.set(key, widget)
}

const getTagValue = (tags: string[][] | undefined, tagName: string) =>
  tags?.find(tag => tag[0] === tagName)?.[1] || ""

const getTags = (tags: string[][] | undefined, tagName: string) =>
  tags?.filter(tag => tag[0] === tagName) || []

const normalizeSharedConfigMatchPart = (value: string | undefined) => value?.trim() || ""

export const makeCommunitySharedConfigRecoveryFilter = (
  authorizedPubkeys: Iterable<string>,
  limit = 200,
) => ({
  kinds: [COMMUNITY_SHARED_CONFIG_KIND],
  authors: Array.from(
    new Set(Array.from(authorizedPubkeys, normalizePubkey).filter(Boolean)),
  ).sort(),
  limit,
})

export const shouldRetryCommunitySharedConfigRecovery = ({
  events,
  complete,
}: {
  events: unknown[]
  complete: boolean
}) => !complete || events.length === 0

const parseCommunitySharedConfigRef = (
  event: CommunitySharedConfigEvent,
): CommunitySharedConfigRef | undefined => {
  if (!event || event.kind !== COMMUNITY_SHARED_CONFIG_KIND) return undefined

  const community = parseCommunityDefinitionAddress(getTagValue(event.tags, "a"))
  const namespace = getTagValue(event.tags, "namespace")
  const key = getTagValue(event.tags, "key")
  if (!community || !namespace || !key) return undefined

  const expectedIdentifier = `${COMMUNITY_SHARED_CONFIG_PREFIX}:${community.address}:${namespace}:${key}`
  if (getTagValue(event.tags, "d") !== expectedIdentifier) return undefined

  return {communityAddress: community.address, namespace, key}
}

const widgetDeclaresSharedConfigRef = (widget: SmartWidgetEvent, ref: CommunitySharedConfigRef) => {
  const namespace = normalizeSharedConfigMatchPart(ref.namespace)
  const key = normalizeSharedConfigMatchPart(ref.key)

  return getTags(widget.tags, "shared-config").some(tag => {
    const declaredNamespace = normalizeSharedConfigMatchPart(tag[1])
    const declaredKey = normalizeSharedConfigMatchPart(tag[2])

    return declaredNamespace === namespace && declaredKey === key
  })
}

const widgetMatchesSharedConfigRef = (widget: SmartWidgetEvent, ref: CommunitySharedConfigRef) => {
  const declarations = getTags(widget.tags, "shared-config")
  if (declarations.length > 0) return widgetDeclaresSharedConfigRef(widget, ref)

  const names = new Set([
    normalizeSharedConfigMatchPart(widget.identifier),
    normalizeSharedConfigMatchPart(getWidgetLineId(widget)),
  ])

  return (
    names.has(normalizeSharedConfigMatchPart(ref.key)) ||
    names.has(normalizeSharedConfigMatchPart(ref.namespace))
  )
}

export const mergeCommunitySlotWidgets = (
  curatedWidgets: SmartWidgetEvent[],
  sharedConfigWidgets: SmartWidgetEvent[],
) => {
  const selected = new Map<string, SmartWidgetEvent>()
  for (const widget of [...curatedWidgets, ...sharedConfigWidgets]) {
    const lineId = getWidgetLineId(widget)
    if (!selected.has(lineId)) selected.set(lineId, widget)
  }

  return Array.from(selected.values())
}

export const getEnabledInstalledCommunitySlotWidgets = ({
  installedWidgets,
  enabledIds,
  slotType,
}: {
  installedWidgets: Record<string, SmartWidgetEvent>
  enabledIds: Set<string>
  slotType: WidgetCommunitySlotType
}) => {
  const selected = new Map<string, SmartWidgetEvent>()
  const installedIndex = buildInstalledWidgetIndex(installedWidgets)

  for (const [key, widget] of Object.entries(installedWidgets)) {
    if (widget.slot?.type !== slotType) continue
    if (!isInstalledWidgetEnabled(key, widget, enabledIds, installedIndex)) continue

    setPreferredWidget(selected, widget)
  }

  return Array.from(selected.values()).sort(
    (a, b) => (b.created_at || 0) - (a.created_at || 0) || a.identifier.localeCompare(b.identifier),
  )
}

export const getEnabledCommunitySlotWidgetsWithSharedConfig = ({
  communityAddress,
  sharedConfigEvents,
  authorizedPubkeys,
  descriptorAuthorities = [],
  installedWidgets,
  enabledIds,
  slotType,
}: {
  communityAddress: string
  sharedConfigEvents: CommunitySharedConfigEvent[]
  authorizedPubkeys: Set<string>
  descriptorAuthorities?: CommunitySharedConfigDescriptorAuthority[]
  installedWidgets: Record<string, SmartWidgetEvent>
  enabledIds: Set<string>
  slotType: WidgetCommunitySlotType
}) => {
  const exactCommunityAddress = parseCommunityDefinitionAddress(communityAddress)?.address
  if (!exactCommunityAddress) return []
  const normalizedAuthorizedPubkeys = new Set(
    Array.from(authorizedPubkeys, author => normalizePubkey(author)).filter(Boolean),
  )
  const sharedConfigRefs = sharedConfigEvents
    .filter(event => normalizedAuthorizedPubkeys.has(normalizePubkey(event.pubkey || "")))
    .filter(event =>
      isAuthorizedCommunitySharedConfigEvent({
        event,
        descriptorAuthorities,
        allowDescriptorChanges: true,
      }),
    )
    .map(parseCommunitySharedConfigRef)
    .filter((ref): ref is CommunitySharedConfigRef =>
      Boolean(ref && ref.communityAddress === exactCommunityAddress),
    )

  if (sharedConfigRefs.length === 0) return []

  return getEnabledInstalledCommunitySlotWidgets({installedWidgets, enabledIds, slotType}).filter(
    widget => {
      if (!(widget.permissions || []).includes("community:querySharedConfig")) return false

      return sharedConfigRefs.some(ref => widgetMatchesSharedConfigRef(widget, ref))
    },
  )
}

export const getEnabledCommunitySlotWidgets = ({
  curatedWidgets,
  installedWidgets,
  enabledIds,
  slotType,
}: {
  curatedWidgets: SmartWidgetEvent[]
  installedWidgets: Record<string, SmartWidgetEvent>
  enabledIds: Set<string>
  slotType: WidgetCommunitySlotType
}) => {
  const selected: SmartWidgetEvent[] = []
  const installedIndex = buildInstalledWidgetIndex(installedWidgets)

  logCommunityWidgetDebug("selecting slot widgets", () => ({
    slotType,
    curatedWidgets: curatedWidgets.map(widget => ({
      id: getWidgetLineId(widget),
      identifier: widget.identifier,
      pubkey: widget.pubkey,
      slot: widget.slot,
    })),
    installedKeys: Object.keys(installedWidgets),
    enabledIds: Array.from(enabledIds),
  }))

  for (const widget of curatedWidgets) {
    const id = getWidgetLineId(widget)
    const installed = findInstalledWidgetMatch(widget, installedWidgets, installedIndex)
    if (!installed) {
      logCommunityWidgetDebug("rejecting curated widget missing installed match", {
        widgetId: id,
        identifier: widget.identifier,
        pubkey: widget.pubkey,
      })
      continue
    }

    // A focus refresh may still return an older cached manifest. Resolve placement
    // before filtering so it cannot move a newer installed launcher back inline.
    // Legacy installed snapshots without slot metadata still inherit curation.
    const slot = isNewerWidget(installed.widget, widget)
      ? installed.widget.slot || widget.slot
      : widget.slot || installed.widget.slot
    if (slot?.type !== slotType) {
      logCommunityWidgetDebug("rejecting curated widget for slot mismatch", {
        requestedSlotType: slotType,
        widgetId: id,
        widgetSlot: slot,
      })
      continue
    }

    const installedLineId = getWidgetLineId(installed.widget)
    const enabled =
      enabledIds.has(id) ||
      enabledIds.has(installed.key) ||
      enabledIds.has(installedLineId) ||
      isLegacyIdentifierEnabled(widget.identifier, enabledIds, installedIndex) ||
      isLegacyIdentifierEnabled(installed.widget.identifier, enabledIds, installedIndex)
    if (!enabled) {
      logCommunityWidgetDebug("rejecting curated widget because it is not enabled", {
        widgetId: id,
        installedKey: installed.key,
        installedLineId,
        identifier: widget.identifier,
      })
      continue
    }

    selected.push({...installed.widget, slot})
    logCommunityWidgetDebug("selected curated widget for slot", {
      slotType,
      widgetId: id,
      installedKey: installed.key,
      installedLineId,
    })
  }

  logCommunityWidgetDebug("selected slot widgets result", () => ({
    slotType,
    selected: selected.map(widget => ({
      id: getWidgetLineId(widget),
      identifier: widget.identifier,
      pubkey: widget.pubkey,
      slot: widget.slot,
    })),
  }))

  return selected
}
