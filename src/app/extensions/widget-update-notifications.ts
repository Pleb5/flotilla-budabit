import {derived, readable, type Readable} from "svelte/store"
import {request} from "@welshman/net"
import {repository, tracker} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import {isRelayUrl, normalizeRelayUrl, type Filter, type TrustedEvent} from "@welshman/util"
import {INDEXER_RELAYS, SMART_WIDGET_RELAYS} from "@app/core/state"
import {
  catchUpThenSetBackgroundLive,
  createBackgroundLiveCoordinator,
} from "@app/core/background-live"
import {notificationBackgroundEnabled} from "@app/util/notification-background"
import {parseSmartWidget} from "./registry"
import {
  defaultExtensionWidgets,
  effectiveExtensionSettings,
  type ExtensionSettings,
} from "./settings"
import type {SmartWidgetEvent} from "./types"
import {getWidgetLineId} from "./widget-identity"
import {
  buildWidgetUpdate,
  getWidgetUpdateFilter,
  getWidgetUpdateRelays,
  type WidgetUpdate,
} from "./widget-updates"

export type InstalledWidgetUpdateTarget = {
  id: string
  installed: SmartWidgetEvent
  filter: Filter
  relays: string[]
}

export type InstalledWidgetUpdate = WidgetUpdate & {
  id: string
}

export type WidgetUpdateRelayGroup = {
  relay: string
  filters: Filter[]
}

const fallbackWidgetUpdateRelays = Array.from(new Set([...SMART_WIDGET_RELAYS, ...INDEXER_RELAYS]))
const WIDGET_UPDATE_FILTER_CHUNK_SIZE = 100

const getCacheFilter = (filter: Filter): Filter => {
  const {limit: _limit, ...rest} = filter

  return rest
}

const getTargetKey = (targets: InstalledWidgetUpdateTarget[]) =>
  JSON.stringify(
    targets.map(target => ({
      id: target.id,
      created_at: target.installed.created_at || 0,
      filter: target.filter,
      relays: target.relays,
    })),
  )

const normalizeWidgetUpdateRelay = (relay: string) => {
  try {
    const normalized = normalizeRelayUrl(relay)
    return isRelayUrl(normalized) ? normalized : ""
  } catch {
    return ""
  }
}

const chunkBySize = <T>(items: T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size))
  return chunks
}

const getCompatibleWidgetFilterKey = (filter: Filter) => {
  const {authors: _authors, "#d": _identifiers, limit: _limit, ...compatible} = filter
  return JSON.stringify(
    Object.fromEntries(Object.entries(compatible).sort(([a], [b]) => a.localeCompare(b))),
  )
}

const groupCompatibleWidgetFilters = (filters: Filter[]) => {
  const filtersByCompatibility = new Map<string, Filter[]>()
  const standalone: Filter[] = []

  for (const filter of filters) {
    if (!filter.authors?.length || !filter["#d"]?.length) {
      standalone.push(filter)
      continue
    }

    const key = getCompatibleWidgetFilterKey(filter)
    const compatible = filtersByCompatibility.get(key) || []
    compatible.push(filter)
    filtersByCompatibility.set(key, compatible)
  }

  const grouped = [...standalone]
  for (const filters of filtersByCompatibility.values()) {
    for (const chunk of chunkBySize(filters, WIDGET_UPDATE_FILTER_CHUNK_SIZE)) {
      const {authors: _authors, "#d": _identifiers, limit: _limit, ...base} = chunk[0]
      grouped.push({
        ...base,
        authors: Array.from(new Set(chunk.flatMap(filter => filter.authors || []))).sort(),
        "#d": Array.from(new Set(chunk.flatMap(filter => filter["#d"] || []))).sort(),
        limit: chunk.length,
      })
    }
  }

  return grouped
}

export const groupInstalledWidgetUpdateTargetsByRelay = (
  targets: InstalledWidgetUpdateTarget[],
): WidgetUpdateRelayGroup[] => {
  const filtersByRelay = new Map<string, Filter[]>()

  for (const target of targets) {
    for (const relay of target.relays.map(normalizeWidgetUpdateRelay).filter(Boolean)) {
      const filters = filtersByRelay.get(relay) || []
      filters.push(target.filter)
      filtersByRelay.set(relay, filters)
    }
  }

  return Array.from(filtersByRelay, ([relay, filters]) => ({
    relay,
    filters: groupCompatibleWidgetFilters(filters),
  })).sort((a, b) => a.relay.localeCompare(b.relay))
}

export const buildInstalledWidgetUpdateTargets = ({
  settings,
  defaultWidgets = [],
  fallbackRelays = fallbackWidgetUpdateRelays,
}: {
  settings: ExtensionSettings
  defaultWidgets?: SmartWidgetEvent[]
  fallbackRelays?: string[]
}): InstalledWidgetUpdateTarget[] => {
  const defaultIds = new Set(defaultWidgets.map(getWidgetLineId).filter(Boolean))

  return Object.entries(settings.installed?.widget || {}).flatMap(([id, installed]) => {
    if (!installed || defaultIds.has(id)) return []

    const filter = getWidgetUpdateFilter(installed)
    if (!filter) return []

    const relays = getWidgetUpdateRelays({
      source: settings.widgetInstallSources?.[id],
      fallbackRelays,
    })
    if (relays.length === 0) return []

    return [{id, installed, filter, relays}]
  })
}

export const buildInstalledWidgetUpdates = ({
  targets,
  events,
}: {
  targets: InstalledWidgetUpdateTarget[]
  events: TrustedEvent[]
}): InstalledWidgetUpdate[] => {
  const candidates: SmartWidgetEvent[] = []

  for (const event of events) {
    try {
      candidates.push(parseSmartWidget(event))
    } catch {
      // Ignore malformed widget update candidates.
    }
  }

  return targets.flatMap(target => {
    const update = buildWidgetUpdate({
      installed: target.installed,
      candidates,
      relays: target.relays,
    })

    return update ? [{id: target.id, ...update}] : []
  })
}

export const installedWidgetUpdateTargets = derived(
  [effectiveExtensionSettings, defaultExtensionWidgets],
  ([$effectiveExtensionSettings, $defaultExtensionWidgets]) =>
    buildInstalledWidgetUpdateTargets({
      settings: $effectiveExtensionSettings,
      defaultWidgets: $defaultExtensionWidgets,
    }),
)

const receiveWidgetUpdateEvent = (event: TrustedEvent, relay: string) => {
  if (!tracker.hasRelay(event.id, relay)) tracker.addRelay(event.id, relay)
  repository.publish(event)
}

const widgetUpdateLiveCoordinator = createBackgroundLiveCoordinator({
  request,
  onEvent: receiveWidgetUpdateEvent,
  onError: (relay, error) => {
    console.warn(`[widget-update-notifications] Failed to subscribe on ${relay}`, error)
  },
})

const widgetUpdateEvents: Readable<TrustedEvent[]> = readable<TrustedEvent[]>([], set => {
  let previousTargetsKey = ""
  let previousNetworkKey = ""
  const controllersByRelay = new Map<string, AbortController>()
  let unsubscribeEvents: (() => void) | undefined
  const liveSource = {}

  const stopNetwork = () => {
    for (const controller of controllersByRelay.values()) controller.abort()
    controllersByRelay.clear()
    widgetUpdateLiveCoordinator.clear(liveSource)
  }

  const unsubscribeTargets = derived(
    [installedWidgetUpdateTargets, notificationBackgroundEnabled],
    ([$targets, $enabled]) => ({targets: $targets, enabled: $enabled}),
  ).subscribe(({targets, enabled}) => {
    const targetsKey = getTargetKey(targets)
    if (targetsKey !== previousTargetsKey) {
      previousTargetsKey = targetsKey
      unsubscribeEvents?.()
      unsubscribeEvents = undefined

      const cacheFilters = targets.map(target => getCacheFilter(target.filter))
      if (cacheFilters.length > 0) {
        unsubscribeEvents = deriveEventsAsc(
          deriveEventsById({repository, filters: cacheFilters}),
        ).subscribe(events => set(events as TrustedEvent[]))
      } else {
        set([])
      }
    }

    const groups = groupInstalledWidgetUpdateTargetsByRelay(targets)
    const networkKey = JSON.stringify({enabled, groups})
    if (networkKey === previousNetworkKey) return
    previousNetworkKey = networkKey
    stopNetwork()

    if (!enabled) return

    for (const group of groups) {
      const controller = new AbortController()
      controllersByRelay.set(group.relay, controller)

      void catchUpThenSetBackgroundLive({
        request,
        coordinator: widgetUpdateLiveCoordinator,
        source: liveSource,
        relay: group.relay,
        filters: group.filters,
        liveFilters: group.filters,
        signal: controller.signal,
        onEvent: receiveWidgetUpdateEvent,
        onError: error => {
          if (!controller.signal.aborted) {
            console.warn("[widget-update-notifications] Failed to load widget updates", error)
          }
        },
      })
    }
  })

  return () => {
    stopNetwork()
    unsubscribeEvents?.()
    unsubscribeTargets()
  }
})

export const installedWidgetUpdates = derived(
  [installedWidgetUpdateTargets, widgetUpdateEvents],
  ([$targets, $events]) => buildInstalledWidgetUpdates({targets: $targets, events: $events}),
)

export const installedWidgetUpdatesById = derived(
  installedWidgetUpdates,
  $updates =>
    Object.fromEntries($updates.map(update => [update.id, update])) as Record<
      string,
      InstalledWidgetUpdate
    >,
)

export const setupWidgetUpdateNotifications = () =>
  installedWidgetUpdates.subscribe(() => undefined)
