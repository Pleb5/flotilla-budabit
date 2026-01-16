import {writable, get, derived} from "svelte/store"
import type {
  ExtensionManifest,
  LoadedExtension,
  LoadedNip89Extension,
  LoadedWidgetExtension,
  SmartWidgetEvent,
  WidgetButtonType,
  RepoContext,
} from "./types"
import {getRepoAddress} from "./types"

const getTag = (tags: string[][], name: string) => tags.find(t => t[0] === name)
const getTags = (tags: string[][], name: string) => tags.filter(t => t[0] === name)

export const parseSmartWidget = (event: any): SmartWidgetEvent => {
  if (!event || event.kind !== 30033 || !Array.isArray(event.tags)) {
    throw new Error("Invalid smart widget event: wrong kind or missing tags")
  }
  const tags: string[][] = event.tags
  const identifier = getTag(tags, "d")?.[1] || event.id
  const widgetTypeRaw = (getTag(tags, "l")?.[1] || "basic") as SmartWidgetEvent["widgetType"]
  const widgetType: SmartWidgetEvent["widgetType"] =
    widgetTypeRaw === "action" || widgetTypeRaw === "tool" ? widgetTypeRaw : "basic"

  const imageUrl = getTag(tags, "image")?.[1]
  // YakiHonne spec: image is only required for action/tool widgets, not basic
  if (!imageUrl && widgetType !== "basic") {
    throw new Error("Action/Tool widget missing required image tag")
  }

  const iconUrl = getTag(tags, "icon")?.[1]
  const inputLabel = getTag(tags, "input")?.[1]

  const permissions =
    getTags(tags, "permission")
      .map(t => t[1])
      .filter(Boolean) ||
    getTags(tags, "perm")
      .map(t => t[1])
      .filter(Boolean)

  const buttons = getTags(tags, "button").reduce<SmartWidgetEvent["buttons"]>((acc, t, idx) => {
    const [, label, typeRaw, url] = t
    if (!label || !typeRaw || !url) return acc
    const type = typeRaw as WidgetButtonType
    acc.push({index: idx + 1, label, type, url})
    return acc
  }, [])

  const appUrl = buttons.find(b => b.type === "app")?.url
  if (widgetType !== "basic" && !appUrl) {
    throw new Error("Action/Tool widget missing app URL")
  }

  const originHint = getTag(tags, "client")?.[2]

  return {
    id: event.id,
    kind: 30033,
    content: event.content || "",
    pubkey: event.pubkey,
    created_at: event.created_at,
    tags,
    identifier,
    widgetType,
    imageUrl,
    iconUrl,
    inputLabel,
    buttons,
    appUrl,
    permissions,
    originHint,
  }
}

const deriveWidgetOrigin = (widget: SmartWidgetEvent): string => {
  const candidates = [widget.appUrl, widget.originHint, widget.iconUrl, widget.imageUrl].filter(Boolean) as string[]
  for (const url of candidates) {
    try {
      return new URL(url).origin
    } catch {
      // ignore invalid URL
    }
  }
  return window.location.origin
}

class ExtensionRegistry {
  private store = writable<Map<string, LoadedExtension>>(new Map())

  static instance: ExtensionRegistry

  static get(): ExtensionRegistry {
    if (!ExtensionRegistry.instance) {
      ExtensionRegistry.instance = new ExtensionRegistry()
    }
    return ExtensionRegistry.instance
  }

  register(manifest: ExtensionManifest): LoadedNip89Extension {
    const extensions = new Map(get(this.store))
    // Handle empty entrypoint (for built-in extensions like Pipelines)
    let origin = window.location.origin
    if (manifest.entrypoint) {
      try {
        origin = new URL(manifest.entrypoint).origin
      } catch {
        // Keep default origin for invalid URLs
      }
    }
    const ext: LoadedNip89Extension = {type: "nip89", id: manifest.id, manifest, origin}
    extensions.set(manifest.id, ext)
    this.store.set(extensions)
    return ext
  }

  registerWidget(event: SmartWidgetEvent): LoadedWidgetExtension {
    const extensions = new Map(get(this.store))
    const ext: LoadedWidgetExtension = {
      type: "widget",
      id: event.identifier,
      widget: event,
      origin: deriveWidgetOrigin(event),
    }
    extensions.set(ext.id, ext)
    this.store.set(extensions)
    return ext
  }

  // Helper method for updating the internal extension store.
  private setExtension(ext: LoadedExtension): void {
    const extensions = new Map(get(this.store))
    extensions.set(ext.id, ext)
    this.store.set(extensions)
  }

  unregister(id: string): void {
    const extensions = new Map(get(this.store))
    extensions.delete(id)
    this.store.set(extensions)
  }

  get(id: string): LoadedExtension | undefined {
    return get(this.store).get(id)
  }

  list(): LoadedExtension[] {
    return Array.from(get(this.store).values())
  }

  /**
   * Set or update the repository context for an extension.
   * This scopes storage and provides repo info to the widget.
   * Call this before loadRuntime to have context available in widget:init.
   */
  setRepoContext(id: string, repoContext: RepoContext | undefined): void {
    const ext = this.get(id)
    if (!ext) return

    const updated = {...ext, repoContext}
    this.setExtension(updated as LoadedExtension)

    // If the extension has a bridge, notify it of the context update
    if (ext.bridge && repoContext) {
      ext.bridge.post("context:repoUpdate", {
        pubkey: repoContext.pubkey,
        name: repoContext.name,
        naddr: repoContext.naddr,
        relays: repoContext.relays,
        address: getRepoAddress(repoContext),
      })
    }
  }

  /**
   * Fetch and validate an extension manifest before registering.
   */
  async load(manifestUrl: string): Promise<ExtensionManifest> {
    const res = await fetch(manifestUrl)
    if (!res.ok) {
      throw new Error(`Failed to fetch manifest: ${res.status}`)
    }
    const manifest: ExtensionManifest = await res.json()

    if (manifest.sha256) {
      const bodyText = JSON.stringify(manifest)
      const enc = new TextEncoder().encode(bodyText)
      const buf = await crypto.subtle.digest("SHA-256", enc)
      const hashArray = Array.from(new Uint8Array(buf))
      const hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
      if (hash !== manifest.sha256) {
        throw new Error("Manifest integrity check failed")
      }
    }

    this.register(manifest)
    return manifest
  }

  /**
   * Wait for an iframe to load with timeout.
   */
  private waitForIframeLoad(iframe: HTMLIFrameElement, timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Iframe load timeout"))
      }, timeoutMs)

      const onLoad = () => {
        clearTimeout(timeout)
        iframe.removeEventListener("load", onLoad)
        iframe.removeEventListener("error", onError)
        resolve()
      }

      const onError = () => {
        clearTimeout(timeout)
        iframe.removeEventListener("load", onLoad)
        iframe.removeEventListener("error", onError)
        reject(new Error("Iframe failed to load"))
      }

      iframe.addEventListener("load", onLoad)
      iframe.addEventListener("error", onError)
    })
  }

  /**
   * Send lifecycle events to the extension after bridge is attached.
   */
  private sendLifecycleInit(ext: LoadedExtension): void {
    if (!ext.bridge) return

    // Build init payload with extension metadata
    const initPayload: Record<string, unknown> = {
      extensionId: ext.id,
      type: ext.type,
      origin: ext.origin,
      hostVersion: "1.0.0", // Could be pulled from package.json
    }

    if (ext.type === "widget") {
      initPayload.widget = {
        identifier: ext.widget.identifier,
        widgetType: ext.widget.widgetType,
        content: ext.widget.content,
        imageUrl: ext.widget.imageUrl,
        iconUrl: ext.widget.iconUrl,
        inputLabel: ext.widget.inputLabel,
        buttons: ext.widget.buttons,
        permissions: ext.widget.permissions,
      }
    } else {
      initPayload.manifest = {
        id: ext.manifest.id,
        name: ext.manifest.name,
        version: ext.manifest.version,
        permissions: ext.manifest.permissions,
      }
    }

    // Include repo context if available (for repo-scoped extensions)
    if (ext.repoContext) {
      initPayload.repoContext = {
        pubkey: ext.repoContext.pubkey,
        name: ext.repoContext.name,
        naddr: ext.repoContext.naddr,
        relays: ext.repoContext.relays,
        address: getRepoAddress(ext.repoContext),
      }
    }

    // Send init event followed by mounted
    ext.bridge.post("widget:init", initPayload)
    ext.bridge.post("widget:mounted", {timestamp: Date.now()})
  }

  private async loadRuntime(ext: LoadedExtension): Promise<LoadedExtension> {
    if (ext.type === "nip89") {
      const existing = this.get(ext.id) as LoadedNip89Extension | undefined
      if (existing?.iframe) return existing

      // Skip iframe loading for built-in extensions without entrypoint
      if (!ext.manifest.entrypoint) {
        this.setExtension(ext)
        return ext
      }

      const iframe = document.createElement("iframe")
      iframe.src = ext.manifest.entrypoint
      iframe.sandbox.add("allow-scripts", "allow-same-origin")
      iframe.classList.add("extension-frame")

      const container = document.getElementById("flotilla-extension-container") ?? document.body
      container.appendChild(iframe)

      // Wait for iframe to load before attaching bridge
      try {
        await this.waitForIframeLoad(iframe)
      } catch (err) {
        // Clean up on failure
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe)
        }
        console.error(`[registry] Failed to load extension ${ext.id}:`, err)
        throw err
      }

      const {ExtensionBridge} = await import("./bridge")
      const bridge = new ExtensionBridge(ext)
      bridge.attachHandlers(iframe.contentWindow)

      const updated: LoadedNip89Extension = {...ext, iframe, bridge}
      this.setExtension(updated)

      // Send lifecycle events after bridge is ready
      this.sendLifecycleInit(updated)

      return updated
    }

    // Smart Widget path
    if (ext.widget.widgetType === "basic") {
      // No iframe needed; just ensure registration is present
      this.setExtension(ext)
      return ext
    }

    // action/tool widgets require an appUrl
    if (!ext.widget.appUrl) {
      throw new Error("Action/Tool widget missing app URL")
    }
    const existing = this.get(ext.id) as LoadedWidgetExtension | undefined
    if (existing?.iframe) return existing

    const iframe = document.createElement("iframe")
    iframe.src = ext.widget.appUrl
    iframe.sandbox.add("allow-scripts", "allow-same-origin")
    iframe.classList.add("extension-frame")

    const container = document.getElementById("flotilla-extension-container") ?? document.body
    container.appendChild(iframe)

    // Wait for iframe to load before attaching bridge
    try {
      await this.waitForIframeLoad(iframe)
    } catch (err) {
      // Clean up on failure
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe)
      }
      console.error(`[registry] Failed to load widget ${ext.id}:`, err)
      throw err
    }

    const {ExtensionBridge} = await import("./bridge")
    const bridge = new ExtensionBridge(ext)
    bridge.attachHandlers(iframe.contentWindow)

    const updated: LoadedWidgetExtension = {...ext, iframe, bridge}
    this.setExtension(updated)

    // Send lifecycle events after bridge is ready
    this.sendLifecycleInit(updated)

    return updated
  }

  async loadWidget(event: SmartWidgetEvent): Promise<LoadedWidgetExtension> {
    const existing = this.get(event.identifier)
    if (existing && existing.type === "widget") {
      return existing as LoadedWidgetExtension
    }
    const ext = this.registerWidget(event)
    const loaded = await this.loadRuntime(ext)
    return loaded as LoadedWidgetExtension
  }

  async loadIframeExtension(manifest: ExtensionManifest): Promise<LoadedExtension> {
    const existing = this.get(manifest.id)
    const base = existing && existing.type === "nip89" ? (existing as LoadedNip89Extension) : this.register(manifest)
    return this.loadRuntime(base)
  }

  async unloadExtension(id: string): Promise<void> {
    const ext = this.get(id)
    if (!ext) return

    // Send unmounting lifecycle event before cleanup
    if (ext.bridge) {
      try {
        ext.bridge.post("widget:unmounting", {timestamp: Date.now()})
        // Brief delay to allow widget to perform cleanup
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch {
        // Ignore errors during unmount notification
      }
      ext.bridge.detach()
    }

    if (ext.iframe && ext.iframe.parentNode) {
      ext.iframe.parentNode.removeChild(ext.iframe)
    }
    this.unregister(id)
  }

  asStore() {
    return derived(this.store, s => Array.from(s.values()))
  }
}

export const extensionRegistry = ExtensionRegistry.get()
