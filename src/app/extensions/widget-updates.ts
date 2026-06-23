import {getTagValue} from "@welshman/util"
import {normalizeRelays} from "@app/core/community"
import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
import type {SmartWidgetEvent, WidgetSlotConfig} from "./types"
import type {WidgetInstallSource} from "./settings"

export type WidgetUpdateDiff = {
  version?: {
    from?: string
    to?: string
  }
  changelog?: string
  appUrlChanged: boolean
  permissionsAdded: string[]
  permissionsRemoved: string[]
  slotChanged: boolean
  widgetTypeChanged: boolean
}

export type WidgetUpdate = {
  installed: SmartWidgetEvent
  latest: SmartWidgetEvent
  diff: WidgetUpdateDiff
  relays: string[]
}

const normalizePubkey = (pubkey?: string) => pubkey?.trim().toLowerCase() || ""

const getCreatedAt = (widget: SmartWidgetEvent) => widget.created_at || 0

const normalizeList = (values: string[] = []) => Array.from(new Set(values.filter(Boolean))).sort()

const serializeSlot = (slot?: WidgetSlotConfig) => JSON.stringify(slot || null)

const getWidgetAppUrls = (widget: SmartWidgetEvent) =>
  widget.appUrls?.length ? widget.appUrls : widget.appUrl ? [widget.appUrl] : []

export const getWidgetVersion = (widget: SmartWidgetEvent) =>
  widget.version || getTagValue("version", widget.tags || [])

export const getWidgetChangelog = (widget: SmartWidgetEvent) =>
  widget.changelog || getTagValue("changelog", widget.tags || [])

export const isSameWidgetLine = (installed: SmartWidgetEvent, candidate: SmartWidgetEvent) =>
  Boolean(
    installed.identifier &&
    candidate.identifier === installed.identifier &&
    normalizePubkey(installed.pubkey) &&
    normalizePubkey(installed.pubkey) === normalizePubkey(candidate.pubkey),
  )

export const getLatestWidgetUpdateCandidate = (
  installed: SmartWidgetEvent,
  candidates: SmartWidgetEvent[],
) =>
  candidates
    .filter(candidate => isSameWidgetLine(installed, candidate))
    .filter(candidate => getCreatedAt(candidate) > getCreatedAt(installed))
    .sort((a, b) => getCreatedAt(b) - getCreatedAt(a) || b.id.localeCompare(a.id))[0]

export const getWidgetUpdateDiff = (
  installed: SmartWidgetEvent,
  latest: SmartWidgetEvent,
): WidgetUpdateDiff => {
  const installedPermissions = normalizeList(installed.permissions || [])
  const latestPermissions = normalizeList(latest.permissions || [])
  const installedPermissionSet = new Set(installedPermissions)
  const latestPermissionSet = new Set(latestPermissions)
  const fromVersion = getWidgetVersion(installed)
  const toVersion = getWidgetVersion(latest)

  return {
    ...(fromVersion || toVersion ? {version: {from: fromVersion, to: toVersion}} : {}),
    changelog: getWidgetChangelog(latest),
    appUrlChanged:
      JSON.stringify(getWidgetAppUrls(installed)) !== JSON.stringify(getWidgetAppUrls(latest)),
    permissionsAdded: latestPermissions.filter(
      permission => !installedPermissionSet.has(permission),
    ),
    permissionsRemoved: installedPermissions.filter(
      permission => !latestPermissionSet.has(permission),
    ),
    slotChanged: serializeSlot(installed.slot) !== serializeSlot(latest.slot),
    widgetTypeChanged: installed.widgetType !== latest.widgetType,
  }
}

export const getWidgetUpdateFilter = (widget: SmartWidgetEvent) => {
  const pubkey = normalizePubkey(widget.pubkey)
  const identifier = widget.identifier?.trim()

  if (!pubkey || !identifier) return undefined

  return {kinds: [SMART_WIDGET_KIND], authors: [pubkey], "#d": [identifier], limit: 1}
}

export const getWidgetUpdateRelays = ({
  source,
  fallbackRelays,
}: {
  source?: WidgetInstallSource
  fallbackRelays: string[]
}) => normalizeRelays([...(source?.relays || []), ...fallbackRelays])

export const buildWidgetUpdate = ({
  installed,
  candidates,
  relays,
}: {
  installed: SmartWidgetEvent
  candidates: SmartWidgetEvent[]
  relays: string[]
}): WidgetUpdate | null => {
  const latest = getLatestWidgetUpdateCandidate(installed, candidates)

  return latest ? {installed, latest, diff: getWidgetUpdateDiff(installed, latest), relays} : null
}
