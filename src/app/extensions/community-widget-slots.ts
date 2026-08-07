import {
  loadCommunityCuratedWidgets,
  type CommunityCuratedExtensionsResult,
} from "@app/extensions/community-curation"
import {LRUCache} from "@welshman/lib"
import {pubkey} from "@welshman/app"
import {normalizePubkey, normalizeRelays, parseCommunityInput} from "@app/core/community"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
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
  priority: number
  settledAt?: number
  ttlMs?: number
}

export type LoadCachedCommunityCuratedWidgetsOptions = {
  force?: boolean
  now?: number
  priority?: number
}

// Bounded LRUs: entries hold full widget events and load promises, keyed by
// community and evolving relay lists, so they must not grow for the app lifetime.
const curatedWidgetLoads = new LRUCache<string, CuratedWidgetCacheEntry>(32)
const curatedWidgetSnapshots = new LRUCache<string, SmartWidgetEvent[]>(32)

const getCurationCacheKey = (input: string, viewerPubkey: string) => {
  const trimmed = input.trim()
  const parsed = parseCommunityInput(trimmed)

  return parsed
    ? `${normalizePubkey(viewerPubkey)}:${normalizePubkey(parsed.pubkey)}:${normalizeRelays(parsed.relays).join(",")}`
    : `${normalizePubkey(viewerPubkey)}:${trimmed}`
}

const getCurationSnapshotKey = (input: string, viewerPubkey: string) => {
  const trimmed = input.trim()
  const parsed = parseCommunityInput(trimmed)

  return `${normalizePubkey(viewerPubkey)}:${parsed ? normalizePubkey(parsed.pubkey) : trimmed}`
}

const getCuratedWidgetResultTtl = (result: CommunityCuratedExtensionsResult | undefined) =>
  result?.status === "community" && result.widgets.length > 0
    ? COMMUNITY_WIDGET_SUCCESS_CACHE_TTL_MS
    : COMMUNITY_WIDGET_EMPTY_CACHE_TTL_MS

const isFreshCacheEntry = (entry: CuratedWidgetCacheEntry, now: number) =>
  entry.settledAt === undefined || now - entry.settledAt < (entry.ttlMs || 0)

export const loadCachedCommunityCuratedWidgets = (
  input: string,
  {
    force = false,
    now = Date.now(),
    priority = RELAY_REQUEST_PRIORITY.interactive,
  }: LoadCachedCommunityCuratedWidgetsOptions = {},
) => {
  const viewerPubkey = normalizePubkey(pubkey.get() || "")
  const key = getCurationCacheKey(input, viewerPubkey)
  const snapshotKey = getCurationSnapshotKey(input, viewerPubkey)
  if (!key) return Promise.resolve(undefined)

  const existing = curatedWidgetLoads.get(key)
  if (existing && existing.settledAt === undefined && existing.priority >= priority) {
    return existing.promise
  }
  if (!force && existing?.settledAt !== undefined && isFreshCacheEntry(existing, now)) {
    return existing.promise
  }

  const pending = loadCommunityCuratedWidgets(input.trim(), {priority})
    .then(result => {
      const entry = curatedWidgetLoads.get(key)
      if (entry?.promise === pending) {
        if (result?.status === "community" && result.widgets.length > 0) {
          curatedWidgetSnapshots.set(snapshotKey, result.widgets)
        } else if (result?.complete) {
          curatedWidgetSnapshots.pop(snapshotKey)
        }

        if (!result?.complete) {
          curatedWidgetLoads.pop(key)
          return result
        }

        entry.settledAt = Date.now()
        entry.ttlMs = getCuratedWidgetResultTtl(result)
      }

      return result
    })
    .catch(error => {
      if (curatedWidgetLoads.get(key)?.promise === pending) curatedWidgetLoads.pop(key)
      throw error
    })
  curatedWidgetLoads.set(key, {promise: pending, priority})

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
) => [...(curatedWidgetSnapshots.get(getCurationSnapshotKey(input, viewerPubkey)) || [])]

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

const normalizeSharedConfigMatchPart = (value: string | undefined) =>
  value?.trim().toLowerCase() || ""

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
  if (widgetDeclaresSharedConfigRef(widget, ref)) return true

  const names = new Set([
    normalizeSharedConfigMatchPart(widget.identifier),
    normalizeSharedConfigMatchPart(getWidgetLineId(widget)),
  ])

  return (
    names.has(normalizeSharedConfigMatchPart(ref.key)) ||
    names.has(normalizeSharedConfigMatchPart(ref.namespace))
  )
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
  authorizedPubkeys,
  installedWidgets,
  enabledIds,
  slotType,
}: {
  communityPubkey: string
  sharedConfigEvents: CommunitySharedConfigEvent[]
  authorizedPubkeys: Set<string>
  installedWidgets: Record<string, SmartWidgetEvent>
  enabledIds: Set<string>
  slotType: WidgetCommunitySlotType
}) => {
  const normalizedCommunityPubkey = normalizePubkey(communityPubkey)
  const normalizedAuthorizedPubkeys = new Set(
    Array.from(authorizedPubkeys, author => normalizePubkey(author)).filter(Boolean),
  )
  const sharedConfigRefs = sharedConfigEvents
    .filter(event => normalizedAuthorizedPubkeys.has(normalizePubkey(event.pubkey || "")))
    .map(parseCommunitySharedConfigRef)
    .filter((ref): ref is CommunitySharedConfigRef =>
      Boolean(ref && normalizePubkey(ref.communityPubkey) === normalizedCommunityPubkey),
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
