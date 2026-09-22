import type {AddressPointer} from "nostr-tools/nip19"
import {repository} from "@welshman/app"
import {matchFilters, type Filter, type TrustedEvent} from "@welshman/util"
import {normalizeRelays} from "@app/core/community"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import {loadCommunityEventsWithStatus} from "@app/core/community-state"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {SMART_WIDGET_RELAYS} from "@app/core/state"
import {parseDefaultWidgetNaddrs} from "./default-widget-config"
import {parseSmartWidget} from "./registry"
import type {SmartWidgetEvent} from "./types"

export {parseDefaultWidgetNaddrs}

const selectWidget = (events: TrustedEvent[], filters: Filter[]) => {
  const candidates = events
    .filter(event => matchFilters(filters, event))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))

  for (const event of candidates) {
    try {
      return parseSmartWidget(event)
    } catch {
      // A malformed replacement must not hide an otherwise usable widget.
    }
  }

  return undefined
}

const loadConfiguredDefaultWidget = async (pointer: AddressPointer) => {
  const filters: Filter[] = [
    {kinds: [SMART_WIDGET_KIND], authors: [pointer.pubkey], "#d": [pointer.identifier]},
  ]
  const events = [...repository.query(filters)]
  const hints = pointer.relays || []
  const fallback = normalizeRelays(SMART_WIDGET_RELAYS.map(relay => relay.trim())).filter(
    relay => !hints.includes(relay),
  )

  for (const relays of [hints, fallback]) {
    if (relays.length === 0) continue

    try {
      const result = await loadCommunityEventsWithStatus(
        relays,
        filters.map(filter => ({...filter, limit: 1})),
        {priority: RELAY_REQUEST_PRIORITY.background},
      )
      events.push(...result.events)
    } catch (error) {
      console.warn("[extensions] Failed to fetch configured default widget", pointer, error)
    }

    const widget = selectWidget(events, filters)
    if (widget) return widget
  }

  const cached = selectWidget(events, filters)
  if (cached) return cached
  throw new Error("Configured default widget not found or invalid")
}

export const loadConfiguredDefaultWidgets = async (
  input: string,
  onWidget?: (widget: SmartWidgetEvent) => void,
): Promise<SmartWidgetEvent[]> => {
  const widgets = await Promise.all(
    parseDefaultWidgetNaddrs(input).map(async pointer => {
      try {
        const widget = await loadConfiguredDefaultWidget(pointer)
        onWidget?.(widget)
        return widget
      } catch (error) {
        console.warn("[extensions] Failed to load configured default widget", pointer, error)
        return undefined
      }
    }),
  )

  return widgets.filter((widget): widget is SmartWidgetEvent => Boolean(widget))
}
