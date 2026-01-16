export type ExtensionSlotConfig = {
  type: "repo-tab"
  label: string
  path: string // URL path segment (e.g., "kanban", "pipelines")
  builtinRoute?: string // For built-in extensions, the actual route path (e.g., "cicd")
}

export type ExtensionManifest = {
  id: string
  name: string
  description?: string
  author?: string
  homepage?: string
  version?: string
  permissions?: string[]
  entrypoint: string
  icon?: string
  sha256?: string
  kind?: number
  slot?: ExtensionSlotConfig
}

export type WidgetButtonType = "redirect" | "nostr" | "zap" | "post" | "app"

export type WidgetButton = {
  index: number
  label: string
  type: WidgetButtonType
  url: string
}

export type SmartWidgetEvent = {
  id: string
  kind: 30033
  content: string
  pubkey?: string
  created_at?: number
  tags: string[][]
  identifier: string
  widgetType: "basic" | "action" | "tool"
  imageUrl?: string // Optional for basic widgets per YakiHonne spec
  iconUrl?: string
  inputLabel?: string
  buttons: WidgetButton[]
  appUrl?: string
  permissions?: string[]
  originHint?: string
}

export type ExtensionPolicy = {
  pubkey: string
  signature: string
  manifestId: string
  granted: boolean
}

/**
 * Repository context for repo-scoped extensions/widgets.
 * Used to scope storage and Nostr queries to a specific repository.
 */
export type RepoContext = {
  /** Repository owner's pubkey */
  pubkey: string
  /** Repository name (d-tag identifier) */
  name: string
  /** Full naddr for the repository */
  naddr?: string
  /** Relays associated with this repository */
  relays?: string[]
}

/**
 * Get the canonical repo address tag value (for use in #a tag filters).
 * Format: "30617:pubkey:name"
 */
export const getRepoAddress = (ctx: RepoContext): string =>
  `30617:${ctx.pubkey}:${ctx.name}`

export type LoadedNip89Extension = {
  type: "nip89"
  id: string
  manifest: ExtensionManifest
  origin: string
  iframe?: HTMLIFrameElement
  bridge?: import("./bridge").ExtensionBridge
  /** Repository context when loaded as a repo-tab extension */
  repoContext?: RepoContext
}

export type LoadedWidgetExtension = {
  type: "widget"
  id: string
  widget: SmartWidgetEvent
  origin: string
  iframe?: HTMLIFrameElement
  bridge?: import("./bridge").ExtensionBridge
  /** Repository context when loaded for a specific repository */
  repoContext?: RepoContext
}

export type LoadedExtension = LoadedNip89Extension | LoadedWidgetExtension

export type ExtensionSlotId =
  | "chat:composer:actions"
  | "chat:message:actions"
  | "room:header:actions"
  | "room:panel"
  | "global:menu"
  | "settings:panel"
  | "space:sidebar:widgets"

export type ExtensionSlotHandler = (args: {
  root: HTMLElement
  context: Record<string, unknown>
  extension?: LoadedExtension
}) => void
