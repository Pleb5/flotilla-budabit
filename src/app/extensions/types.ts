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
  imageUrl: string
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

export type LoadedNip89Extension = {
  type: "nip89"
  id: string
  manifest: ExtensionManifest
  origin: string
  iframe?: HTMLIFrameElement
  bridge?: import("./bridge").ExtensionBridge
}

export type LoadedWidgetExtension = {
  type: "widget"
  id: string
  widget: SmartWidgetEvent
  origin: string
  iframe?: HTMLIFrameElement
  bridge?: import("./bridge").ExtensionBridge
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
