import type {ExtensionManifest} from "./types"
import {extensionSettings} from "./settings"
import {extensionRegistry} from "./registry"

const BUILTIN_EXTENSIONS: ExtensionManifest[] = [
  // Pipelines extension is now a separate Smart Widget (kind 30033)
  // Install via naddr or discover from relays in Settings > Extensions
  // Kanban extension is now loaded from Nostr events (kind 30033)
  // Install via naddr or discover from relays in Settings > Extensions
]

export const installBuiltinExtensions = () => {
  const settings = extensionSettings
  let needsUpdate = false
  const updates: {installed: any; enabled: string[]; widgetDisplay: Record<string, any>} = {
    installed: {nip89: {}, widget: {}},
    enabled: [],
    widgetDisplay: {},
  }

  settings.subscribe(s => {
    updates.installed = {...s.installed}
    updates.enabled = [...s.enabled]
    updates.widgetDisplay = {...s.widgetDisplay}
  })()

  for (const manifest of BUILTIN_EXTENSIONS) {
    // Install if not already installed
    if (!updates.installed.nip89[manifest.id]) {
      updates.installed.nip89[manifest.id] = manifest
      extensionRegistry.register(manifest)
      needsUpdate = true
    }

    // Enable if not already enabled
    if (!updates.enabled.includes(manifest.id)) {
      updates.enabled.push(manifest.id)
      needsUpdate = true
    }
  }

  if (needsUpdate) {
    extensionSettings.update(() => updates)
  }
}
