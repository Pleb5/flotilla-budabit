import {derived, readable, type Readable} from "svelte/store"
import {load, request} from "@welshman/net"
import {repository} from "@welshman/app"
import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
import type {Filter, TrustedEvent} from "@welshman/util"
import {INDEXER_RELAYS, SMART_WIDGET_RELAYS} from "@app/core/state"
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

const fallbackWidgetUpdateRelays = Array.from(new Set([...SMART_WIDGET_RELAYS, ...INDEXER_RELAYS]))

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

const widgetUpdateEvents: Readable<TrustedEvent[]> = readable<TrustedEvent[]>([], set => {
  let previousKey = ""
  let controller: AbortController | undefined
  let unsubscribeEvents: (() => void) | undefined

  const unsubscribeTargets = installedWidgetUpdateTargets.subscribe(targets => {
    const key = getTargetKey(targets)
    if (key === previousKey) return
    previousKey = key

    controller?.abort()
    unsubscribeEvents?.()
    controller = undefined
    unsubscribeEvents = undefined

    if (targets.length === 0) {
      set([])
      return
    }

    const relays = Array.from(new Set(targets.flatMap(target => target.relays).filter(Boolean)))
    const filters = targets.map(target => target.filter)
    const cacheFilters = filters.map(getCacheFilter)

    unsubscribeEvents = deriveEventsAsc(
      deriveEventsById({repository, filters: cacheFilters}),
    ).subscribe(events => set(events as TrustedEvent[]))

    if (relays.length === 0) return

    const nextController = new AbortController()
    controller = nextController

    load({relays, filters, signal: nextController.signal}).catch(error => {
      if (!nextController.signal.aborted) {
        console.warn("[widget-update-notifications] Failed to load widget updates", error)
      }
    })
    request({
      relays,
      filters: filters.map(filter => ({...filter, limit: 0})),
      signal: nextController.signal,
    }).catch(error => {
      if (!nextController.signal.aborted) {
        console.warn("[widget-update-notifications] Failed to subscribe to widget updates", error)
      }
    })
  })

  return () => {
    controller?.abort()
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
