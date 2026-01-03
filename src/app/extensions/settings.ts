import {synced, localStorageProvider} from "@welshman/store"
import {get} from "svelte/store"
import type {ExtensionManifest, SmartWidgetEvent} from "./types"

export const EXTENSION_SETTINGS_KEY = "flotilla/extensions"

export type InstalledExtensions = {
  nip89: Record<string, ExtensionManifest>
  widget: Record<string, SmartWidgetEvent>
  legacy?: Record<string, any>
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
  installed: InstalledExtensions
}

export const defaultExtensionSettings: ExtensionSettings = {
  enabled: [],
  installed: {
    nip89: {},
    widget: {},
  },
}

export const extensionSettings = synced({
  key: EXTENSION_SETTINGS_KEY,
  defaultValue: defaultExtensionSettings,
  storage: localStorageProvider,
})

export const getInstalledExtensions = () => get(extensionSettings).installed
export const getInstalledExtension = (id: string) => {
  const installed = get(extensionSettings).installed
  return installed.nip89[id] ?? installed.widget[id]
}

extensionSettings.update(s => {
  return {
    enabled: s.enabled || [],
    installed: normalizeInstalled(s.installed),
  }
})
