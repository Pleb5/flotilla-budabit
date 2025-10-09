import {synced, localStorageProvider} from "@welshman/store"
import type {ExtensionManifest} from "./types"

export const EXTENSION_SETTINGS_KEY = "flotilla/extensions"

export type ExtensionSettings = {
  enabled: string[]
  installed: Record<string, ExtensionManifest>
}

export const defaultExtensionSettings: ExtensionSettings = {
  enabled: [],
  installed: {},
}

export const extensionSettings = synced({
  key: EXTENSION_SETTINGS_KEY,
  defaultValue: defaultExtensionSettings,
  storage: localStorageProvider,
})
