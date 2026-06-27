import {synced, localStorageProvider} from "@welshman/store"
import {derived, get, writable} from "svelte/store"
import {signer, pubkey} from "@welshman/app"
import {APP_DATA, makeEvent} from "@welshman/util"
import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"
import {postExtensionSettings} from "@app/core/git-commands"
import {EXTENSION_SETTINGS_DTAG} from "@app/core/git-requests"
import type {ExtensionManifest, SmartWidgetEvent, WidgetDisplayLocation} from "./types"
import {getWidgetLineId} from "./widget-identity"

export const EXTENSION_SETTINGS_KEY = "flotilla/extensions"

// Track if we're currently applying remote settings to avoid publish loops
let isApplyingRemoteSettings = false
let hasAppliedRemoteExtensionSettings = false
// Track the last published timestamp to avoid re-publishing the same data
let lastPublishedAt = 0

export type WidgetDisplayConfig = {
  location: WidgetDisplayLocation
  menuLabel?: string // Custom label for menu-route display
}

export type InstalledExtensions = {
  nip89: Record<string, ExtensionManifest>
  widget: Record<string, SmartWidgetEvent>
  legacy?: Record<string, any>
}

export type WidgetInstallSource = {
  naddr?: string
  relays?: string[]
}

export const normalizeWidgetInstallSource = (
  source: WidgetInstallSource | undefined,
): WidgetInstallSource | undefined => {
  const naddr = source?.naddr?.trim()
  const relays = Array.from(
    new Set(
      (source?.relays || [])
        .map(relay => relay.trim())
        .filter(isRelayUrl)
        .map(normalizeRelayUrl),
    ),
  )

  if (!naddr && relays.length === 0) return undefined

  return {
    ...(naddr ? {naddr} : {}),
    ...(relays.length ? {relays} : {}),
  }
}

type NormalizedInstalled = {
  installed: InstalledExtensions
  widgetKeyMap: Map<string, string>
}

const buildWidgetKeyMap = (entries: Array<[string, SmartWidgetEvent]>) => {
  const keyMap = new Map<string, string>()
  const identifierTargets = new Map<string, Set<string>>()

  for (const [id, widget] of entries) {
    const identifier = widget.identifier?.trim() || id
    const widgetId = getWidgetLineId({...widget, identifier}) || id

    keyMap.set(id, widgetId)

    if (identifier) {
      const targets = identifierTargets.get(identifier) || new Set<string>()
      targets.add(widgetId)
      identifierTargets.set(identifier, targets)
    }
  }

  for (const [identifier, targets] of identifierTargets) {
    if (targets.size === 1) keyMap.set(identifier, Array.from(targets)[0])
  }

  return keyMap
}

const getWidgetVersion = (widget: SmartWidgetEvent | undefined) =>
  widget?.version || widget?.tags?.find(tag => tag[0] === "version")?.[1] || ""

const parseVersionParts = (version: string) => {
  const normalized = version.trim().replace(/^v/i, "")
  if (!/^\d+(?:\.\d+)*(?:[-+].*)?$/.test(normalized)) return undefined

  return normalized
    .split(/[+-]/)[0]
    .split(".")
    .map(part => Number.parseInt(part, 10))
}

const compareVersionStrings = (left: string, right: string) => {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)

  if (leftParts && !rightParts) return 1
  if (!leftParts && rightParts) return -1
  if (!leftParts || !rightParts) return 0

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] || 0
    const rightPart = rightParts[index] || 0
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1
  }

  return 0
}

const compareWidgetSnapshots = (
  left: SmartWidgetEvent | undefined,
  right: SmartWidgetEvent | undefined,
) => {
  if (left && !right) return 1
  if (!left && right) return -1
  if (!left || !right) return 0

  const versionCompare = compareVersionStrings(getWidgetVersion(left), getWidgetVersion(right))
  if (versionCompare !== 0) return versionCompare

  const leftCreated = left.created_at || 0
  const rightCreated = right.created_at || 0
  if (leftCreated !== rightCreated) return leftCreated > rightCreated ? 1 : -1

  if (left.id && right.id && left.id !== right.id) return left.id > right.id ? 1 : -1

  return 0
}

const isWidgetSnapshotNewer = (
  candidate: SmartWidgetEvent | undefined,
  current: SmartWidgetEvent | undefined,
) => compareWidgetSnapshots(candidate, current) > 0

const chooseFresherWidgetSnapshot = (
  current: SmartWidgetEvent | undefined,
  candidate: SmartWidgetEvent | undefined,
) => (isWidgetSnapshotNewer(candidate, current) ? candidate : current)

const normalizeInstalled = (installed: any): NormalizedInstalled => {
  const nip89: Record<string, ExtensionManifest> = installed?.nip89 || {}
  const widget: Record<string, SmartWidgetEvent> = {}
  const widgetEntries = Object.entries(installed?.widget || {}).filter(
    (entry): entry is [string, SmartWidgetEvent] =>
      Boolean(entry[1]) && typeof entry[1] === "object",
  )
  const widgetKeyMap = buildWidgetKeyMap(widgetEntries)
  const legacyFlat =
    installed && typeof installed === "object" && !installed.nip89 && !installed.widget
      ? installed
      : {}
  const mergedNip89 = {...nip89}
  const remainingLegacy: Record<string, any> = {}

  for (const [id, value] of Object.entries(legacyFlat)) {
    if (value && typeof value === "object" && "entrypoint" in (value as ExtensionManifest)) {
      mergedNip89[id] = value as ExtensionManifest
    } else {
      remainingLegacy[id] = value
    }
  }

  for (const [id, value] of widgetEntries) {
    const widgetId = widgetKeyMap.get(id) || id
    const current = widget[widgetId]

    if (!current || compareWidgetSnapshots(value, current) >= 0) {
      widget[widgetId] = value.identifier ? value : {...value, identifier: id}
    }
  }

  return {
    installed: {
      nip89: mergedNip89,
      widget,
      legacy: Object.keys(remainingLegacy).length ? remainingLegacy : undefined,
    },
    widgetKeyMap,
  }
}

export type ExtensionSettings = {
  enabled: string[]
  disabledDefaultIds: string[]
  installed: InstalledExtensions
  widgetDisplay: Record<string, WidgetDisplayConfig>
  manifestUrls: Record<string, string> // Track manifest URLs for update checking
  widgetInstallSources: Record<string, WidgetInstallSource>
}

export const defaultExtensionSettings: ExtensionSettings = {
  enabled: [],
  disabledDefaultIds: [],
  installed: {
    nip89: {},
    widget: {},
  },
  widgetDisplay: {},
  manifestUrls: {},
  widgetInstallSources: {},
}

export const extensionSettings = synced({
  key: EXTENSION_SETTINGS_KEY,
  defaultValue: defaultExtensionSettings,
  storage: localStorageProvider,
})

export const defaultExtensionWidgets = writable<SmartWidgetEvent[]>([])

export const setDefaultExtensionWidgets = (widgets: SmartWidgetEvent[]): void => {
  const byId = new Map<string, SmartWidgetEvent>()

  for (const widget of widgets) {
    const id = getWidgetLineId(widget)
    const current = byId.get(id)
    if (!current || (widget.created_at || 0) > (current.created_at || 0)) {
      byId.set(id, widget)
    }
  }

  const defaultWidgets = Array.from(byId.values())
  defaultExtensionWidgets.set(defaultWidgets)
  let shouldSync = false
  extensionSettings.update(s => {
    const result = normalizeExtensionSettingsWithDefaultSnapshots(s, defaultWidgets)
    shouldSync = result.materialized

    return result.settings
  })
  if (shouldSync && hasAppliedRemoteExtensionSettings) void syncExtensionSettingsNow()
}

export const getDefaultExtensionIds = (widgets = get(defaultExtensionWidgets)) =>
  widgets.map(getWidgetLineId).filter(Boolean)

export const isDefaultExtension = (id: string): boolean => getDefaultExtensionIds().includes(id)

const getDefaultWidgetMap = (widgets = get(defaultExtensionWidgets)) =>
  Object.fromEntries(widgets.map(widget => [getWidgetLineId(widget), widget])) as Record<
    string,
    SmartWidgetEvent
  >

const getEffectiveWidgetMap = (
  installedWidgets: Record<string, SmartWidgetEvent> = {},
  widgets = get(defaultExtensionWidgets),
) => {
  const effective = getDefaultWidgetMap(widgets)

  for (const [id, widget] of Object.entries(installedWidgets)) {
    effective[id] = widget
  }

  return effective
}

export const getEffectiveInstalledExtensions = (
  settings = get(extensionSettings),
  widgets = get(defaultExtensionWidgets),
): InstalledExtensions => ({
  nip89: settings.installed?.nip89 || {},
  widget: getEffectiveWidgetMap(settings.installed?.widget, widgets),
  legacy: settings.installed?.legacy,
})

export const getEffectiveEnabledExtensionIds = (
  settings = get(extensionSettings),
  widgets = get(defaultExtensionWidgets),
) => {
  const installed = getEffectiveInstalledExtensions(settings, widgets)
  const installedIds = new Set([...Object.keys(installed.nip89), ...Object.keys(installed.widget)])
  const disabledDefaults = new Set(
    normalizeDisabledDefaultIds(settings.disabledDefaultIds, new Map(), widgets),
  )
  const defaultIds = new Set(getDefaultExtensionIds(widgets))
  const enabled = new Set(settings.enabled || [])

  for (const id of defaultIds) {
    if (!disabledDefaults.has(id)) enabled.add(id)
  }

  return Array.from(enabled).filter(
    id => installedIds.has(id) && !(defaultIds.has(id) && disabledDefaults.has(id)),
  )
}

export const getEffectiveExtensionSettings = (
  settings = get(extensionSettings),
  widgets = get(defaultExtensionWidgets),
): ExtensionSettings => ({
  ...settings,
  enabled: getEffectiveEnabledExtensionIds(settings, widgets),
  installed: getEffectiveInstalledExtensions(settings, widgets),
  disabledDefaultIds: normalizeDisabledDefaultIds(settings.disabledDefaultIds, new Map(), widgets),
})

export const effectiveExtensionSettings = derived(
  [extensionSettings, defaultExtensionWidgets],
  ([$extensionSettings, $defaultExtensionWidgets]) =>
    getEffectiveExtensionSettings($extensionSettings, $defaultExtensionWidgets),
)

export const getInstalledExtensions = () => getEffectiveInstalledExtensions()
export const getInstalledExtension = (id: string) => {
  const installed = getEffectiveInstalledExtensions()
  return installed.nip89[id] ?? installed.widget[id]
}

export const isExtensionEnabled = (id: string): boolean => {
  const settings = get(effectiveExtensionSettings)
  return settings.enabled.includes(id)
}

export const isExtensionInstalled = (id: string): boolean => {
  const installed = getEffectiveInstalledExtensions()
  return !!(installed.nip89[id] ?? installed.widget[id])
}

export const enableDefaultExtension = (id: string): void => {
  const defaultWidget = getDefaultWidgetMap()[id]

  extensionSettings.update(s => ({
    ...s,
    installed: defaultWidget
      ? {
          nip89: s.installed?.nip89 || {},
          widget: {
            ...(s.installed?.widget || {}),
            [id]: s.installed?.widget?.[id] || defaultWidget,
          },
          legacy: s.installed?.legacy,
        }
      : s.installed,
    disabledDefaultIds: (s.disabledDefaultIds || []).filter(disabledId => disabledId !== id),
  }))
}

export const disableDefaultExtension = (id: string): void => {
  const defaultWidget = getDefaultWidgetMap()[id]

  extensionSettings.update(s => ({
    ...s,
    installed: defaultWidget
      ? {
          nip89: s.installed?.nip89 || {},
          widget: {
            ...(s.installed?.widget || {}),
            [id]: s.installed?.widget?.[id] || defaultWidget,
          },
          legacy: s.installed?.legacy,
        }
      : s.installed,
    disabledDefaultIds: Array.from(new Set([...(s.disabledDefaultIds || []), id])),
  }))
}

export const getWidgetDisplayConfig = (id: string): WidgetDisplayConfig => {
  const settings = get(extensionSettings)
  const widgetDisplay = settings.widgetDisplay || {}
  return widgetDisplay[id] || {location: "modal"}
}

export const setWidgetDisplayConfig = (id: string, config: WidgetDisplayConfig): void => {
  extensionSettings.update(s => ({
    ...s,
    widgetDisplay: {...(s.widgetDisplay || {}), [id]: config},
  }))
  void syncExtensionSettingsNow()
}

export const getWidgetsForLocation = (location: WidgetDisplayLocation): SmartWidgetEvent[] => {
  const settings = get(effectiveExtensionSettings)
  const widgets: SmartWidgetEvent[] = []
  const installedWidgets = settings.installed?.widget || {}
  const widgetDisplay = settings.widgetDisplay || {}
  const enabled = settings.enabled || []
  for (const [id, widget] of Object.entries(installedWidgets)) {
    if (enabled.includes(id)) {
      const displayConfig = widgetDisplay[id] || {location: "modal"}
      if (displayConfig.location === location) {
        widgets.push(widget)
      }
    }
  }
  return widgets
}

export const getManifestUrl = (id: string): string | undefined => {
  const settings = get(extensionSettings)
  return settings.manifestUrls?.[id]
}

const mapWidgetScopedRecord = <T>(
  record: Record<string, T> | undefined,
  widgetIds: Set<string>,
  widgetKeyMap: Map<string, string>,
): Record<string, T> => {
  const mapped: Record<string, T> = {}

  for (const [id, value] of Object.entries(record || {})) {
    const widgetId = widgetIds.has(id) ? id : widgetKeyMap.get(id)
    if (widgetId && widgetIds.has(widgetId)) mapped[widgetId] = value
  }

  return mapped
}

const normalizeExtensionIds = (
  ids: string[] | undefined,
  installedIds: Set<string>,
  nip89Ids: Set<string>,
  widgetIds: Set<string>,
  widgetKeyMap: Map<string, string>,
) =>
  Array.from(
    new Set(
      (ids || [])
        .map(id => {
          if (nip89Ids.has(id) || widgetIds.has(id)) return id
          return widgetKeyMap.get(id) || id
        })
        .filter(id => installedIds.has(id)),
    ),
  )

function normalizeDisabledDefaultIds(
  ids: string[] | undefined,
  widgetKeyMap: Map<string, string>,
  widgets = get(defaultExtensionWidgets),
) {
  const defaultWidgetKeyMap = buildWidgetKeyMap(
    widgets.map(widget => [getWidgetLineId(widget), widget] as [string, SmartWidgetEvent]),
  )

  return Array.from(
    new Set((ids || []).map(id => defaultWidgetKeyMap.get(id) || widgetKeyMap.get(id) || id)),
  )
}

const normalizeExtensionSettings = (
  settings: Partial<ExtensionSettings>,
  widgets = get(defaultExtensionWidgets),
): ExtensionSettings => {
  const {installed, widgetKeyMap} = normalizeInstalled(settings.installed)
  const installedIds = new Set([...Object.keys(installed.nip89), ...Object.keys(installed.widget)])
  const nip89Ids = new Set(Object.keys(installed.nip89))
  const widgetIds = new Set(Object.keys(installed.widget))
  const defaultWidgetEntries = widgets.map(
    widget => [getWidgetLineId(widget), widget] as [string, SmartWidgetEvent],
  )
  const widgetDisplayIds = new Set([...widgetIds, ...defaultWidgetEntries.map(([id]) => id)])
  const widgetDisplayKeyMap = buildWidgetKeyMap([
    ...Object.entries(installed.widget),
    ...defaultWidgetEntries,
  ])
  const widgetDisplay = mapWidgetScopedRecord(
    settings.widgetDisplay,
    widgetDisplayIds,
    widgetDisplayKeyMap,
  )
  const manifestUrls = Object.fromEntries(
    Object.entries(settings.manifestUrls || {}).filter(([id]) => nip89Ids.has(id)),
  )
  const widgetInstallSources = Object.fromEntries(
    Object.entries(mapWidgetScopedRecord(settings.widgetInstallSources, widgetIds, widgetKeyMap))
      .map(([id, source]) => [id, normalizeWidgetInstallSource(source as WidgetInstallSource)])
      .filter((entry): entry is [string, WidgetInstallSource] => Boolean(entry[1])),
  )

  return {
    enabled: normalizeExtensionIds(
      settings.enabled,
      installedIds,
      nip89Ids,
      widgetIds,
      widgetKeyMap,
    ),
    disabledDefaultIds: normalizeDisabledDefaultIds(
      settings.disabledDefaultIds,
      widgetKeyMap,
      widgets,
    ),
    installed,
    widgetDisplay,
    manifestUrls,
    widgetInstallSources,
  }
}

const normalizeExtensionSettingsWithDefaultSnapshots = (
  settings: Partial<ExtensionSettings>,
  widgets = get(defaultExtensionWidgets),
): {settings: ExtensionSettings; materialized: boolean} => {
  const normalized = normalizeExtensionSettings(settings, widgets)
  const disabledDefaults = new Set(normalized.disabledDefaultIds || [])
  const widgetSnapshots = {...(normalized.installed?.widget || {})}
  let materialized = false

  for (const widget of widgets) {
    const id = getWidgetLineId(widget)
    if (!id || disabledDefaults.has(id)) continue

    if (isWidgetSnapshotNewer(widget, widgetSnapshots[id])) {
      widgetSnapshots[id] = widget
      materialized = true
    }
  }

  if (!materialized) return {settings: normalized, materialized}

  return {
    settings: {
      ...normalized,
      installed: {
        ...normalized.installed,
        widget: widgetSnapshots,
      },
    },
    materialized,
  }
}

const mergeRemoteExtensionSettings = (
  remoteSettings: Partial<ExtensionSettings>,
  currentSettings = get(extensionSettings),
) => {
  const remote = normalizeExtensionSettingsWithDefaultSnapshots(remoteSettings)
  const current = normalizeExtensionSettings(currentSettings)
  const widgets = {...remote.settings.installed.widget}
  let changed = remote.materialized

  for (const [id, currentWidget] of Object.entries(current.installed.widget || {})) {
    if (!widgets[id]) continue

    const selected = chooseFresherWidgetSnapshot(widgets[id], currentWidget)
    if (selected && selected !== widgets[id]) {
      widgets[id] = selected
      changed = true
    }
  }

  if (!changed) return remote

  return {
    settings: {
      ...remote.settings,
      installed: {
        ...remote.settings.installed,
        widget: widgets,
      },
    },
    materialized: true,
  }
}

extensionSettings.update(s => normalizeExtensionSettings(s))

// Apply settings loaded from relay
export const applyRemoteExtensionSettings = (remoteSettings: Partial<ExtensionSettings>) => {
  isApplyingRemoteSettings = true
  let shouldSync = false
  try {
    const result = mergeRemoteExtensionSettings(remoteSettings)
    shouldSync = result.materialized
    extensionSettings.set(result.settings)
    hasAppliedRemoteExtensionSettings = true
    console.log("[applyRemoteExtensionSettings] Applied remote settings")
  } finally {
    isApplyingRemoteSettings = false
  }
  if (shouldSync) void syncExtensionSettingsNow()
}

// Publish current settings to relay
export const publishExtensionSettings = async ({
  force = false,
}: {force?: boolean} = {}): Promise<boolean> => {
  const currentPubkey = get(pubkey)
  const currentSigner = get(signer)

  if (!currentPubkey || !currentSigner) {
    console.warn("[publishExtensionSettings] No pubkey or signer available")
    return false
  }

  // Debounce: don't publish more than once per second
  const now = Date.now()
  if (!force && now - lastPublishedAt < 1000) {
    return false
  }

  try {
    const settings = get(extensionSettings)
    const dataToEncrypt = JSON.stringify(settings)
    const encrypted = await currentSigner.nip44.encrypt(currentPubkey, dataToEncrypt)

    const event = makeEvent(APP_DATA, {
      content: encrypted,
      tags: [["d", EXTENSION_SETTINGS_DTAG]],
    })

    const thunk = postExtensionSettings(event) as any
    const complete = thunk?.complete

    if (complete && typeof complete.then === "function") {
      await complete
    } else if (thunk && typeof thunk.then === "function") {
      await thunk
    }

    lastPublishedAt = Date.now()
    console.log("[publishExtensionSettings] Published extension settings to relay")
    return true
  } catch (error) {
    console.error("[publishExtensionSettings] Failed to publish:", error)
    return false
  }
}

// Subscribe to local changes and publish to relay (with debounce)
let publishDebounceTimer: ReturnType<typeof setTimeout> | null = null
let syncNowPromise: Promise<boolean> | undefined
let syncNowRequested = false

export const syncExtensionSettingsNow = (): Promise<boolean> => {
  syncNowRequested = true

  if (publishDebounceTimer) {
    clearTimeout(publishDebounceTimer)
    publishDebounceTimer = null
  }

  syncNowPromise ||= (async () => {
    let published = false

    try {
      while (syncNowRequested) {
        syncNowRequested = false

        if (isApplyingRemoteSettings || !get(pubkey) || !get(signer)) continue

        published = (await publishExtensionSettings({force: true})) || published
      }

      return published
    } finally {
      syncNowPromise = undefined
      if (syncNowRequested) void syncExtensionSettingsNow()
    }
  })()

  return syncNowPromise
}

export const startExtensionSettingsAutoSync = () => {
  let initialized = false
  hasAppliedRemoteExtensionSettings = false

  const unsubscribe = extensionSettings.subscribe(() => {
    if (!initialized) {
      initialized = true
      return
    }

    // Don't publish if we're applying remote settings (would cause loop)
    if (isApplyingRemoteSettings) return

    // Don't publish if no user is logged in
    if (!get(pubkey) || !get(signer)) return

    // Avoid republishing stale localStorage snapshots before relay app-data has hydrated.
    if (!hasAppliedRemoteExtensionSettings) return

    // Debounce publishes
    if (publishDebounceTimer) {
      clearTimeout(publishDebounceTimer)
    }
    publishDebounceTimer = setTimeout(() => {
      publishExtensionSettings()
    }, 2000) // 2 second debounce
  })

  return () => {
    unsubscribe()
    if (publishDebounceTimer) {
      clearTimeout(publishDebounceTimer)
      publishDebounceTimer = null
    }
  }
}
