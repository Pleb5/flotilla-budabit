export type ExtensionSlotConfig = {
  type: "repo-tab"
  label: string
  path: string // URL path segment (e.g., "kanban", "pipelines")
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

export type WidgetDisplayLocation = "modal" | "menu-route" | "top-menu"

export type WidgetHomeSlotType =
  | "community-home-before-quicklinks"
  | "community-home-after-quicklinks"

export type WidgetActionSlotType = "chat-message-actions" | "global-menu"

export type WidgetCommunitySlotType = WidgetHomeSlotType | WidgetActionSlotType

export type WidgetSlotConfig =
  | {
      type: "repo-tab"
      label: string
      path: string
    }
  | {
      type: WidgetCommunitySlotType
      label: string
    }

export type CommunityEventDescriptor = {
  kind: number
  subtype?: string
}

export type CommunityWriteCapability = {
  descriptor: CommunityEventDescriptor
  sectionNames: string[]
  writableSectionNames: string[]
  moderatorSectionNames: string[]
  canWrite: boolean
  canModerate: boolean
}

export type CommunitySharedConfigScope = {
  namespace: string
  key: string
  descriptors: CommunityEventDescriptor[]
}

export type CommunityQuerySharedConfigRequest = CommunitySharedConfigScope & {
  limit?: number
}

export type CommunityQuerySharedConfigResponse =
  | {
      status: "ok"
      event?: unknown
      config?: unknown
      relays: string[]
      contextSessionId: string
      contextVersion: number
    }
  | {error: string; code?: string}

export type CommunityPublishSharedConfigRequest = CommunitySharedConfigScope & {
  config: unknown
}

export type CommunityPublishSharedConfigResponse =
  | {
      status: "ok"
      eventId?: string
      relays: string[]
      contextSessionId: string
      contextVersion: number
    }
  | {error: string; code?: string}

export type CommunitySectionContext = {
  name: string
  kinds: Array<{kind: number; subtype?: string}>
}

export type CommunityWidgetContext = {
  version: 1
  contextSessionId: string
  contextVersion: number
  pubkey: string
  ncommunity: string
  relays: string[]
  relayHints: string[]
  blossomServers: string[]
  profile?: {
    name?: string
    displayName?: string
    picture?: string
    about?: string
  }
  sections: CommunitySectionContext[]
  viewer: {
    pubkey?: string
    isOwner: boolean
    isBanned: boolean
  }
}

export type CommunityCheckWriteCapabilitiesRequest = {
  descriptors: CommunityEventDescriptor[]
}

export type CommunityCheckWriteCapabilitiesResponse =
  | {
      status: "ok"
      capabilities: CommunityWriteCapability[]
      contextSessionId: string
      contextVersion: number
    }
  | {error: string; code?: string}

export type CommunityQueryEventsRequest = {
  descriptors: CommunityEventDescriptor[]
  limit?: number
  since?: number
  until?: number
}

export type CommunityQueryEventsResponse =
  | {
      status: "ok"
      events: unknown[]
      relays: string[]
      descriptors: CommunityEventDescriptor[]
      contextSessionId: string
      contextVersion: number
    }
  | {error: string; code?: string}

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
  appUrls?: string[]
  permissions?: string[]
  originHint?: string
  version?: string
  changelog?: string
  slot?: WidgetSlotConfig
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
export const getRepoAddress = (ctx: RepoContext): string => `30617:${ctx.pubkey}:${ctx.name}`

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
  communityContext?: CommunityWidgetContext
  /** Repository context when loaded for a specific repository */
  repoContext?: RepoContext
}

export type LoadedExtension = LoadedNip89Extension | LoadedWidgetExtension

export type ExtensionSlotId = WidgetActionSlotType

export type ExtensionSlotHandler = (args: {
  root: HTMLElement
  context: Record<string, unknown>
  extension?: LoadedExtension
}) => void
