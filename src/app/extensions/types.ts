import type {TrustedEvent} from "@welshman/util"
import type {CommunityDefinition} from "@app/core/community"
import type {EffectiveCommunityReportState} from "@app/core/community-reports"

export type WidgetButtonType = "redirect" | "nostr" | "zap" | "post" | "app"

export type WidgetButton = {
  index: number
  label: string
  type: WidgetButtonType
  url: string
}

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
  expectedRevision?: string | null
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

export type CommunityWidgetProfile = {
  name?: string
  display_name?: string
  picture?: string
  about?: string
}

export type CommunityWidgetContext = {
  version: 2
  contextSessionId: string
  contextVersion: number
  communityId: import("@app/core/community").CommunityId
  ownerPubkey: import("@app/core/community").OwnerPubkey
  definitionAddress: string
  naddr: string
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

export type CommunityWidgetRuntimeContext = {
  community: import("@app/core/community").CommunityPointer
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  authorityEvidenceSettled?: boolean
  reportState?: EffectiveCommunityReportState
  relays: string[]
  relayHints: string[]
  communityContext?: CommunityWidgetContext
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
  refs?: string[]
  limit?: number
  since?: number
  until?: number
  calendarStart?: number
  calendarDate?: string
}

export type CommunityQueryEventsResponse =
  | {
      status: "ok"
      events: unknown[]
      hasMore: boolean
      nextUntil?: number
      relays: string[]
      descriptors: CommunityEventDescriptor[]
      contextSessionId: string
      contextVersion: number
    }
  | {error: string; code?: string}

export type CommunityQueryLiveStreamsRequest = {
  descriptors: CommunityEventDescriptor[]
  limit?: number
  since?: number
  until?: number
}

export type CommunityQueryLiveStreamsResponse =
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

/**
 * Repository context for repo-scoped extensions/widgets.
 * Used to scope storage and Nostr queries to a specific repository.
 */
export type RepoContext = {
  /** Repository owner's pubkey */
  pubkey: string
  /** Exact d-tag identifier (legacy field name; never presentation text). */
  name: string
  /** Human-readable display name, independent of repository identity. */
  displayName?: string
  /** Full naddr for the repository */
  naddr?: string
  /** Relays associated with this repository */
  relays?: string[]
  /** Declared repo maintainer pubkeys */
  maintainers?: string[]
}

/**
 * Get the canonical repo address tag value (for use in #a tag filters).
 * Format: "30617:pubkey:name"
 */
export const getRepoAddress = (ctx: RepoContext): string => `30617:${ctx.pubkey}:${ctx.name}`

export type WidgetResizeRequest = {
  height?: number
  width?: number
}

export type LoadedWidgetExtension = {
  type: "widget"
  id: string
  widget: SmartWidgetEvent
  origin: string
  iframe?: HTMLIFrameElement
  bridge?: import("./bridge").ExtensionBridge
  communityContext?: CommunityWidgetContext
  communityRuntimeContext?: CommunityWidgetRuntimeContext
  communityRuntimeContextProvider?: () => CommunityWidgetRuntimeContext | undefined
  /** Internal host callback for SDK ui:resize requests. */
  onResizeRequest?: (request: WidgetResizeRequest) => void
  /** Repository context when loaded for a specific repository */
  repoContext?: RepoContext
}

export type LoadedExtension = LoadedWidgetExtension

export type ExtensionSlotId = WidgetActionSlotType

export type ExtensionSlotHandler = (args: {
  root: HTMLElement
  context: Record<string, unknown>
  extension?: LoadedExtension
}) => void
