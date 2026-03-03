import type {ExtensionManifest} from "./types"
import {extensionSettings} from "./settings"
import {extensionRegistry} from "./registry"

const BUILTIN_EXTENSIONS: ExtensionManifest[] = [
  {
    id: "budabit-pipelines",
    kind: 31990,
    name: "CI/CD Pipelines",
    description: "View and manage CI/CD pipeline runs for your repository.",
    author: "Budabit",
    homepage: "https://budabit.dev/extensions/pipelines",
    version: "1.0.0",
    permissions: ["nostr:query", "ui:toast"],
    entrypoint: "",
    icon: "Play",
    sha256: "",
    slot: {
      type: "repo-tab",
      label: "Pipelines",
      path: "pipelines",
      builtinRoute: "cicd",
    },
  },
  {
    id: "budabit-kanban",
    kind: 31990,
    name: "Repo Kanban",
    description: "NIP-100 Kanban board for repository issue tracking and project management.",
    author: "Budabit",
    homepage: "https://budabit.dev/extensions/kanban",
    version: "1.0.0",
    permissions: ["nostr:publish", "nostr:query", "ui:toast"],
    entrypoint: "http://localhost:5178",
    icon: "LayoutGrid",
    sha256: "",
    slot: {
      type: "repo-tab",
      label: "Kanban",
      path: "kanban",
    },
  },
]

export const installBuiltinExtensions = () => {
  const settings = extensionSettings
  let needsUpdate = false
  const updates: {installed: any; enabled: string[]} = {
    installed: {nip89: {}, widget: {}},
    enabled: [],
  }

  settings.subscribe(s => {
    updates.installed = {...s.installed}
    updates.enabled = [...s.enabled]
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
