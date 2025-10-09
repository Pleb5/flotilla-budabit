import {writable, get, derived} from "svelte/store"
import type {ExtensionManifest, LoadedExtension} from "./types"

class ExtensionRegistry {
  private store = writable<Map<string, LoadedExtension>>(new Map())

  static instance: ExtensionRegistry

  static get(): ExtensionRegistry {
    if (!ExtensionRegistry.instance) {
      ExtensionRegistry.instance = new ExtensionRegistry()
    }
    return ExtensionRegistry.instance
  }

  register(manifest: ExtensionManifest): void {
    const extensions = new Map(get(this.store))
    const origin = new URL(manifest.entrypoint).origin
    extensions.set(manifest.id, {manifest, origin})
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

  async loadIframeExtension(manifest: ExtensionManifest): Promise<LoadedExtension> {
    // If already loaded, return existing to avoid duplicate iframes
    const existing = this.get(manifest.id)
    if (existing?.iframe) return existing

    // TODO: Integrate actual policy approval flow (kind 31993)
    const policyApproved = true
    if (!policyApproved) throw new Error("Extension policy not approved")

    const origin = new URL(manifest.entrypoint).origin
    const iframe = document.createElement("iframe")
    iframe.src = manifest.entrypoint
    iframe.sandbox.add("allow-scripts", "allow-same-origin")
    iframe.classList.add("extension-frame")

    document.body.appendChild(iframe)

    const ext: LoadedExtension = {manifest, origin, iframe}
    const {ExtensionBridge} = await import("./bridge")
    ext.bridge = new ExtensionBridge(ext)
    ext.bridge!.attachHandlers(iframe.contentWindow)

    const extensions = new Map(get(this.store))
    extensions.set(manifest.id, ext)
    this.store.set(extensions)

    return ext
  }

  async unloadExtension(id: string): Promise<void> {
    const ext = this.get(id)
    if (!ext) return
    if (ext.bridge) ext.bridge.detach()
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
