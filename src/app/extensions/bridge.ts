import {publishThunk} from "@welshman/app"
import {pushToast} from "@app/util/toast"
import type {LoadedExtension} from "./types"

export type ExtensionMessage = {
  id?: string
  type: "request" | "response" | "event"
  action: string
  payload?: any
}

type BridgeHandler = (payload: any, ext: LoadedExtension) => Promise<any> | any

const bridgeHandlers = new Map<string, BridgeHandler>()

export const registerBridgeHandler = (action: string, handler: BridgeHandler) => {
  bridgeHandlers.set(action, handler)
}

export const removeBridgeHandler = (action: string) => {
  bridgeHandlers.delete(action)
}

let messageCounter = 0

export class ExtensionBridge {
  private pending = new Map<string, (res: any) => void>()
  private listener?: (e: MessageEvent) => void
  private allowedActions: Set<string> = new Set()

  constructor(private extension: LoadedExtension) {
    // Precompute allowed permissions from manifest + granted policy
    if (extension.manifest.permissions) {
      extension.manifest.permissions.forEach(p => this.allowedActions.add(p))
    }
  }

  attachHandlers(target: Window | null): void {
    if (!target) return
    this.listener = (e: MessageEvent) => this.handleMessage(e)
    window.addEventListener("message", this.listener)
  }

  detach(): void {
    if (this.listener) window.removeEventListener("message", this.listener)
    this.pending.clear()
  }

  private isPrivileged(action: string): boolean {
    const privileged = action.startsWith("nostr:") || action.startsWith("storage:")
    return privileged
  }

  private enforcePolicy(action: string): void {
    if (this.isPrivileged(action) && !this.allowedActions.has(action)) {
      throw new Error(`Extension not permitted to perform "${action}"`)
    }
  }

  async handleMessage(event: MessageEvent): Promise<void> {
    const {data, source, origin} = event
    if (!data || typeof data !== "object" || !("action" in data)) return

    const msg = data as ExtensionMessage
    // Ensure message from our iframe only
    if (this.extension.origin !== origin) return

    if (msg.type === "response" && msg.id && this.pending.has(msg.id)) {
      const resolve = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      resolve(msg.payload)
      return
    }

    if (msg.type === "request") {
      try {
        this.enforcePolicy(msg.action)
        const handler = bridgeHandlers.get(msg.action)
        let result
        if (handler) result = await handler(msg.payload, this.extension)
        ;(source as Window)?.postMessage(
          {id: msg.id, type: "response", action: msg.action, payload: result},
          origin,
        )
      } catch (e: any) {
        console.error("Bridge handler error:", e)
        ;(source as Window)?.postMessage(
          {id: msg.id, type: "response", action: msg.action, payload: {error: e.message}},
          origin,
        )
      }
    }
  }

  post(action: string, payload: any): void {
    this.enforcePolicy(action)
    this.extension.iframe?.contentWindow?.postMessage(
      {type: "event", action, payload},
      this.extension.origin,
    )
  }

  request(action: string, payload: any): Promise<any> {
    this.enforcePolicy(action)
    const id = `${Date.now()}-${messageCounter++}`
    const msg: ExtensionMessage = {id, type: "request", action, payload}
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve)
      try {
        this.extension.iframe?.contentWindow?.postMessage(msg, this.extension.origin)
      } catch (e) {
        reject(e)
      }
    })
  }
}

// Example host-side actions registration (used by extensions)
registerBridgeHandler("nostr:publish", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:publish from ${ext.manifest.id}`, payload)
  try {
    const result = await publishThunk(payload)
    return {status: "ok", result}
  } catch (err: any) {
    console.error("Error in nostr:publish bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("ui:toast", (payload, ext) => {
  if (ext) console.log(`[bridge] ui:toast from ${ext.manifest.id}`, payload)
  try {
    const {message, type = "info"} = payload || {}
    if (message) pushToast({theme: type, message})
    return {status: "ok"}
  } catch (err: any) {
    console.error("Error in ui:toast bridge handler:", err)
    return {error: err.message}
  }
})
