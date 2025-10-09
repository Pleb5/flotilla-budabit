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

export type ExtensionPolicy = {
  pubkey: string
  signature: string
  manifestId: string
  granted: boolean
}

export type LoadedExtension = {
  manifest: ExtensionManifest
  iframe?: HTMLIFrameElement
  origin: string
  bridge?: import("./bridge").ExtensionBridge
}

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
