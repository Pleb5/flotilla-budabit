import {loadCommunityCuratedWidgets} from "@app/extensions/community-curation"
import type {SmartWidgetEvent, WidgetCommunitySlotType} from "@app/extensions/types"
import {logCommunityWidgetDebug} from "./community-widget-debug"
import {getWidgetLineId} from "./widget-identity"

const curatedWidgetLoads = new Map<
  string,
  ReturnType<typeof loadCommunityCuratedWidgets>
>()

export const loadCachedCommunityCuratedWidgets = (input: string) => {
  const key = input.trim()
  if (!key) return Promise.resolve(undefined)

  const existing = curatedWidgetLoads.get(key)
  if (existing) return existing

  const pending = loadCommunityCuratedWidgets(key).catch(error => {
    curatedWidgetLoads.delete(key)
    throw error
  })
  curatedWidgetLoads.set(key, pending)

  return pending
}

export const clearCommunityWidgetSlotCache = () => {
  curatedWidgetLoads.clear()
}

type InstalledWidgetMatch = {
  key: string
  widget: SmartWidgetEvent
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
