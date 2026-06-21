import {synced, localStorageProvider} from "@welshman/store"
import {derived, get, writable} from "svelte/store"
import {signer, pubkey} from "@welshman/app"
import {APP_DATA, makeEvent} from "@welshman/util"
import {isRelayUrl, normalizeRelayUrl} from "@welshman/util"
import {postExtensionSettings} from "@app/core/git-commands"
import {EXTENSION_SETTINGS_DTAG} from "@app/core/git-requests"
import type {ExtensionManifest, SmartWidgetEvent, WidgetDisplayLocation} from "./types"

export const EXTENSION_SETTINGS_KEY = "flotilla/extensions"

// Track if we're currently applying remote settings to avoid publish loops
let isApplyingRemoteSettings = false
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

const normalizeInstalled = (installed: any): InstalledExtensions => {
  const nip89: Record<string, ExtensionManifest> = installed?.nip89 || {}
  const widget: Record<string, SmartWidgetEvent> = installed?.widget || {}
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

  return {
    nip89: mergedNip89,
    widget,
    legacy: Object.keys(remainingLegacy).length ? remainingLegacy : undefined,
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
    const current = byId.get(widget.identifier)
    if (!current || (widget.created_at || 0) > (current.created_at || 0)) {
      byId.set(widget.identifier, widget)
    }
  }

  defaultExtensionWidgets.set(Array.from(byId.values()))
}

export const getDefaultExtensionIds = (widgets = get(defaultExtensionWidgets)) =>
  widgets.map(widget => widget.identifier).filter(Boolean)

export const isDefaultExtension = (id: string): boolean => getDefaultExtensionIds().includes(id)

const getDefaultWidgetMap = (widgets = get(defaultExtensionWidgets)) =>
  Object.fromEntries(widgets.map(widget => [widget.identifier, widget])) as Record<
    string,
    SmartWidgetEvent
  >

export const getEffectiveInstalledExtensions = (
  settings = get(extensionSettings),
  widgets = get(defaultExtensionWidgets),
): InstalledExtensions => ({
  nip89: settings.installed?.nip89 || {},
  widget: {
    ...(settings.installed?.widget || {}),
    ...getDefaultWidgetMap(widgets),
  },
  legacy: settings.installed?.legacy,
})

export const getEffectiveEnabledExtensionIds = (
  settings = get(extensionSettings),
  widgets = get(defaultExtensionWidgets),
) => {
  const installed = getEffectiveInstalledExtensions(settings, widgets)
  const installedIds = new Set([...Object.keys(installed.nip89), ...Object.keys(installed.widget)])
  const disabledDefaults = new Set(settings.disabledDefaultIds || [])
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
  disabledDefaultIds: settings.disabledDefaultIds || [],
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
  extensionSettings.update(s => ({
    ...s,
    disabledDefaultIds: (s.disabledDefaultIds || []).filter(disabledId => disabledId !== id),
  }))
}

export const disableDefaultExtension = (id: string): void => {
  extensionSettings.update(s => ({
    ...s,
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

const normalizeExtensionSettings = (settings: Partial<ExtensionSettings>): ExtensionSettings => {
  const installed = normalizeInstalled(settings.installed)
  const installedIds = new Set([...Object.keys(installed.nip89), ...Object.keys(installed.widget)])
  const nip89Ids = new Set(Object.keys(installed.nip89))
  const widgetIds = new Set(Object.keys(installed.widget))
  const manifestUrls = Object.fromEntries(
    Object.entries(settings.manifestUrls || {}).filter(([id]) => nip89Ids.has(id)),
  )
  const widgetInstallSources = Object.fromEntries(
    Object.entries(settings.widgetInstallSources || {})
      .filter(([id]) => widgetIds.has(id))
      .map(([id, source]) => [id, normalizeWidgetInstallSource(source)])
      .filter((entry): entry is [string, WidgetInstallSource] => Boolean(entry[1])),
  )

  return {
    enabled: (settings.enabled || []).filter(id => installedIds.has(id)),
    disabledDefaultIds: settings.disabledDefaultIds || [],
    installed,
    widgetDisplay: settings.widgetDisplay || {},
    manifestUrls,
    widgetInstallSources,
  }
}

extensionSettings.update(s => normalizeExtensionSettings(s))

// Apply settings loaded from relay
export const applyRemoteExtensionSettings = (remoteSettings: Partial<ExtensionSettings>) => {
  isApplyingRemoteSettings = true
  try {
    extensionSettings.set(normalizeExtensionSettings(remoteSettings))
    console.log("[applyRemoteExtensionSettings] Applied remote settings")
  } finally {
    isApplyingRemoteSettings = false
  }
}

// Publish current settings to relay
export const publishExtensionSettings = async (): Promise<boolean> => {
  const currentPubkey = get(pubkey)
  const currentSigner = get(signer)

  if (!currentPubkey || !currentSigner) {
    console.warn("[publishExtensionSettings] No pubkey or signer available")
    return false
  }

  // Debounce: don't publish more than once per second
  const now = Date.now()
  if (now - lastPublishedAt < 1000) {
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

    await postExtensionSettings(event)
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

export const startExtensionSettingsAutoSync = () => {
  return extensionSettings.subscribe(() => {
    // Don't publish if we're applying remote settings (would cause loop)
    if (isApplyingRemoteSettings) return

    // Don't publish if no user is logged in
    if (!get(pubkey) || !get(signer)) return

    // Debounce publishes
    if (publishDebounceTimer) {
      clearTimeout(publishDebounceTimer)
    }
    publishDebounceTimer = setTimeout(() => {
      publishExtensionSettings()
    }, 2000) // 2 second debounce
  })
}
