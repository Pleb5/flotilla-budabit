import {
  loadCommunityCuratedWidgets,
  type CommunityCuratedExtensionsResult,
} from "@app/extensions/community-curation"
import {normalizePubkey} from "@app/core/community"
import type {SmartWidgetEvent, WidgetCommunitySlotType} from "@app/extensions/types"
import {logCommunityWidgetDebug} from "./community-widget-debug"
import {getWidgetLineId} from "./widget-identity"

export const COMMUNITY_WIDGET_EMPTY_CACHE_TTL_MS = 30_000
export const COMMUNITY_WIDGET_SUCCESS_CACHE_TTL_MS = 5 * 60_000
export const COMMUNITY_SHARED_CONFIG_KIND = 30078
export const COMMUNITY_SHARED_CONFIG_PREFIX = "budabit-community-config"

type CuratedWidgetLoad = ReturnType<typeof loadCommunityCuratedWidgets>
type CuratedWidgetCacheEntry = {
  promise: CuratedWidgetLoad
  settledAt?: number
  ttlMs?: number
}

type LoadCachedCommunityCuratedWidgetsOptions = {
  force?: boolean
  now?: number
}

const curatedWidgetLoads = new Map<string, CuratedWidgetCacheEntry>()

const getCuratedWidgetResultTtl = (result: CommunityCuratedExtensionsResult | undefined) =>
  result?.status === "community" && result.widgets.length > 0
    ? COMMUNITY_WIDGET_SUCCESS_CACHE_TTL_MS
    : COMMUNITY_WIDGET_EMPTY_CACHE_TTL_MS

const isFreshCacheEntry = (entry: CuratedWidgetCacheEntry, now: number) =>
  entry.settledAt === undefined || now - entry.settledAt < (entry.ttlMs || 0)

export const loadCachedCommunityCuratedWidgets = (
  input: string,
  {force = false, now = Date.now()}: LoadCachedCommunityCuratedWidgetsOptions = {},
) => {
  const key = input.trim()
  if (!key) return Promise.resolve(undefined)

  const existing = curatedWidgetLoads.get(key)
  if (!force && existing && isFreshCacheEntry(existing, now)) return existing.promise

  const pending = loadCommunityCuratedWidgets(key)
    .then(result => {
      const entry = curatedWidgetLoads.get(key)
      if (entry?.promise === pending) {
        entry.settledAt = Date.now()
        entry.ttlMs = getCuratedWidgetResultTtl(result)
      }

      return result
    })
    .catch(error => {
      if (curatedWidgetLoads.get(key)?.promise === pending) curatedWidgetLoads.delete(key)
      throw error
    })
  curatedWidgetLoads.set(key, {promise: pending})

  return pending
}

export const clearCommunityWidgetSlotCache = () => {
  curatedWidgetLoads.clear()
}

export const shouldPreserveCuratedWidgetView = (
  currentWidgets: SmartWidgetEvent[],
  nextWidgets: SmartWidgetEvent[],
  sameCommunity: boolean,
) => sameCommunity && currentWidgets.length > 0 && nextWidgets.length === 0

type InstalledWidgetMatch = {
  key: string
  widget: SmartWidgetEvent
}

type CommunitySharedConfigEvent = {
  kind?: number
  tags?: string[][]
}

type CommunitySharedConfigRef = {
  communityPubkey: string
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

const normalizeSharedConfigMatchPart = (value: string | undefined) => value?.trim().toLowerCase() || ""

const parseCommunitySharedConfigRef = (
  event: CommunitySharedConfigEvent,
): CommunitySharedConfigRef | undefined => {
  if (!event || event.kind !== COMMUNITY_SHARED_CONFIG_KIND) return undefined

  const d = getTagValue(event.tags, "d")
  let communityPubkey = normalizePubkey(getTagValue(event.tags, "p"))
  let namespace = getTagValue(event.tags, "namespace")
  let key = getTagValue(event.tags, "key")
  const prefix = `${COMMUNITY_SHARED_CONFIG_PREFIX}:`

  if (d.startsWith(prefix)) {
    const parts = d.slice(prefix.length).split(":")
    communityPubkey ||= normalizePubkey(parts[0] || "")
    namespace ||= parts[1] || ""
    key ||= parts.slice(2).join(":")
  }

  if (!communityPubkey || !namespace || !key) return undefined

  return {communityPubkey, namespace, key}
}

const widgetDeclaresSharedConfigRef = (
  widget: SmartWidgetEvent,
  ref: CommunitySharedConfigRef,
) => {
  const namespace = normalizeSharedConfigMatchPart(ref.namespace)
  const key = normalizeSharedConfigMatchPart(ref.key)

  return getTags(widget.tags, "shared-config").some(tag => {
    const declaredNamespace = normalizeSharedConfigMatchPart(tag[1])
    const declaredKey = normalizeSharedConfigMatchPart(tag[2])

    return declaredNamespace === namespace && declaredKey === key
  })
}

const widgetMatchesSharedConfigRef = (widget: SmartWidgetEvent, ref: CommunitySharedConfigRef) => {
  if (widgetDeclaresSharedConfigRef(widget, ref)) return true

  const names = new Set([
    normalizeSharedConfigMatchPart(widget.identifier),
    normalizeSharedConfigMatchPart(getWidgetLineId(widget)),
  ])

  return names.has(normalizeSharedConfigMatchPart(ref.key)) || names.has(normalizeSharedConfigMatchPart(ref.namespace))
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
  communityPubkey,
  sharedConfigEvents,
  installedWidgets,
  enabledIds,
  slotType,
}: {
  communityPubkey: string
  sharedConfigEvents: CommunitySharedConfigEvent[]
  installedWidgets: Record<string, SmartWidgetEvent>
  enabledIds: Set<string>
  slotType: WidgetCommunitySlotType
}) => {
  const normalizedCommunityPubkey = normalizePubkey(communityPubkey)
  const sharedConfigRefs = sharedConfigEvents
    .map(parseCommunitySharedConfigRef)
    .filter(
      (ref): ref is CommunitySharedConfigRef =>
        Boolean(ref && normalizePubkey(ref.communityPubkey) === normalizedCommunityPubkey),
    )

  if (sharedConfigRefs.length === 0) return []

  return getEnabledInstalledCommunitySlotWidgets({installedWidgets, enabledIds, slotType}).filter(widget => {
    if (!(widget.permissions || []).includes("community:querySharedConfig")) return false

    return sharedConfigRefs.some(ref => widgetMatchesSharedConfigRef(widget, ref))
  })
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

  logCommunityWidgetDebug("selecting slot widgets", {
    slotType,
    curatedWidgets: curatedWidgets.map(widget => ({
      id: getWidgetLineId(widget),
      identifier: widget.identifier,
      pubkey: widget.pubkey,
      slot: widget.slot,
    })),
    installedKeys: Object.keys(installedWidgets),
    enabledIds: Array.from(enabledIds),
  })

  for (const widget of curatedWidgets) {
    const id = getWidgetLineId(widget)
    if (widget.slot?.type !== slotType) {
      logCommunityWidgetDebug("rejecting curated widget for slot mismatch", {
        requestedSlotType: slotType,
        widgetId: id,
        widgetSlot: widget.slot,
      })
      continue
    }

    const installed = findInstalledWidgetMatch(widget, installedWidgets, installedIndex)
    if (!installed) {
      logCommunityWidgetDebug("rejecting curated widget missing installed match", {
        widgetId: id,
        identifier: widget.identifier,
        pubkey: widget.pubkey,
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

    selected.push({...installed.widget, slot: widget.slot || installed.widget.slot})
    logCommunityWidgetDebug("selected curated widget for slot", {
      slotType,
      widgetId: id,
      installedKey: installed.key,
      installedLineId,
    })
  }

  logCommunityWidgetDebug("selected slot widgets result", {
    slotType,
    selected: selected.map(widget => ({
      id: getWidgetLineId(widget),
      identifier: widget.identifier,
      pubkey: widget.pubkey,
      slot: widget.slot,
    })),
  })

  return selected
}
