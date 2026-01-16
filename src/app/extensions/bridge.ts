import {publishThunk} from "@welshman/app"
import {pushToast} from "@app/util/toast"
import {SimplePool} from "nostr-tools/pool"
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

const pool = new SimplePool()

const NIP100_ALLOWED_KINDS = new Set<number>([30301, 30302])
const MAX_NOSTR_QUERY_LIMIT = 500

const normalizeRelayUrls = (relays: unknown): string[] => {
  if (!Array.isArray(relays)) {
    throw new Error("Invalid relays: expected string[]")
  }

  const normalized: string[] = []
  for (const raw of relays) {
    if (typeof raw !== "string") continue
    try {
      const url = new URL(raw)
      if (url.protocol !== "wss:" && url.protocol !== "ws:") continue
      url.hash = ""
      normalized.push(url.toString())
    } catch {
      // ignore invalid URL
    }
  }

  return Array.from(new Set(normalized))
}

const requireNonEmptyStringArray = (val: unknown, name: string): string[] => {
  if (!Array.isArray(val) || val.length === 0) {
    throw new Error(`Invalid filter.${name}: expected non-empty string[]`)
  }
  const out = val.filter(v => typeof v === "string" && v.length > 0) as string[]
  if (out.length === 0) {
    throw new Error(`Invalid filter.${name}: expected non-empty string[]`)
  }
  return out
}

const normalizeNostrFilter = (filterRaw: unknown): Record<string, unknown> => {
  if (!filterRaw || typeof filterRaw !== "object") {
    throw new Error("Invalid filter: expected object")
  }

  const filter: any = {...(filterRaw as any)}

  const kinds = filter.kinds
  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new Error("Invalid filter.kinds: expected non-empty number[]")
  }

  for (const k of kinds) {
    if (typeof k !== "number" || !Number.isFinite(k)) {
      throw new Error("Invalid filter.kinds: expected non-empty number[]")
    }
    if (!NIP100_ALLOWED_KINDS.has(k)) {
      throw new Error(`Unsupported kind: ${k}`)
    }
  }

  if (kinds.includes(30301)) {
    requireNonEmptyStringArray(filter["#d"], "[\"#d\"]")
  }
  if (kinds.includes(30302)) {
    requireNonEmptyStringArray(filter["#a"], "[\"#a\"]")
  }

  const limitRaw = filter.limit
  if (limitRaw === undefined) {
    filter.limit = MAX_NOSTR_QUERY_LIMIT
  } else {
    if (typeof limitRaw !== "number" || !Number.isFinite(limitRaw) || limitRaw <= 0) {
      throw new Error("Invalid filter.limit: expected positive number")
    }
    if (limitRaw > MAX_NOSTR_QUERY_LIMIT) {
      throw new Error(`filter.limit exceeds maximum of ${MAX_NOSTR_QUERY_LIMIT}`)
    }
  }

  return filter as Record<string, unknown>
}

const parseNostrQueryPayload = (payload: unknown): {relays: string[]; filter: Record<string, unknown>} => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload: expected { relays, filter }")
  }

  const relays = normalizeRelayUrls((payload as any).relays)
  if (relays.length === 0) {
    throw new Error("No valid relays provided")
  }

  const filter = normalizeNostrFilter((payload as any).filter)

  return {relays, filter}
}

const parseNostrPublishPayload = (payload: any): {event: any; relays?: string[]} => {
  if (!payload) throw new Error("Missing payload")

  if (typeof payload === "object" && payload.event && typeof payload.event === "object") {
    const relaysRaw = payload.relays
    const relays = relaysRaw === undefined ? undefined : normalizeRelayUrls(relaysRaw)
    return {event: payload.event, relays}
  }

  return {event: payload}
}

export class ExtensionBridge {
  private pending = new Map<string, (res: any) => void>()
  private listener?: (e: MessageEvent) => void
  private allowedActions: Set<string> = new Set()
  private targetWindow: Window | null = null

  constructor(private extension: LoadedExtension) {
    // Precompute allowed permissions from manifest or widget; widgets default to empty (deny privileged)
    const permissions =
      extension.type === "nip89" ? extension.manifest.permissions : extension.widget.permissions
    if (permissions) {
      permissions.forEach(p => this.allowedActions.add(p))
    }
  }

  attachHandlers(target: Window | null): void {
    if (!target) return
    this.targetWindow = target
    this.listener = (e: MessageEvent) => this.handleMessage(e)
    window.addEventListener("message", this.listener)
  }

  detach(): void {
    if (this.listener) window.removeEventListener("message", this.listener)
    this.pending.clear()
    this.targetWindow = null
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
    if (this.targetWindow && source !== this.targetWindow) return
    if (!data || typeof data !== "object" || !("action" in data)) return

    const msg = data as ExtensionMessage
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
    // Use targetWindow if available (for sandboxed iframes), otherwise fall back to iframe.contentWindow
    const targetWindow = this.targetWindow ?? this.extension.iframe?.contentWindow
    // Use '*' for sandboxed iframes since their origin is 'null'
    const targetOrigin = this.targetWindow ? '*' : this.extension.origin
    targetWindow?.postMessage(
      {type: "event", action, payload},
      targetOrigin,
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

registerBridgeHandler("nostr:publish", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:publish from ${ext.id}`, payload)
  try {
    const {event, relays} = parseNostrPublishPayload(payload)

    if (
      relays &&
      relays.length > 0 &&
      event &&
      typeof event === "object" &&
      typeof (event as any).id === "string" &&
      typeof (event as any).sig === "string"
    ) {
      const publishResult = await Promise.allSettled((pool as any).publish(relays, event))
      return {status: "ok", result: {published: true, relays, publishResult}}
    }

    if (relays && relays.length > 0) {
      try {
        const result = await (publishThunk as any)({event, relays})
        return {status: "ok", result}
      } catch {
        // Fallback to legacy behavior below.
      }
    }

    const result = await publishThunk(event)
    return {status: "ok", result}
  } catch (err: any) {
    console.error("Error in nostr:publish bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("nostr:query", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:query from ${ext.id}`, payload)
  try {
    const {relays, filter} = parseNostrQueryPayload(payload)
    console.log(`[bridge] nostr:query querying ${relays.length} relays:`, relays, filter)

    // Use querySync but with a race against a timeout
    // This ensures we don't wait forever for slow relays
    const queryPromise = pool.querySync(relays, filter as any)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), 8000)
    })

    try {
      const events = await Promise.race([queryPromise, timeoutPromise])
      console.log(`[bridge] nostr:query got ${events.length} events`)
      return {status: "ok", events}
    } catch (err: any) {
      if (err.message === "timeout") {
        console.log(`[bridge] nostr:query timeout, returning empty`)
        return {status: "ok", events: []}
      }
      throw err
    }
  } catch (err: any) {
    console.error("Error in nostr:query bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("ui:toast", (payload, ext) => {
  if (ext) console.log(`[bridge] ui:toast from ${ext.id}`, payload)
  try {
    const {message, type = "info"} = payload || {}
    if (message) pushToast({theme: type, message})
    return {status: "ok"}
  } catch (err: any) {
    console.error("Error in ui:toast bridge handler:", err)
    return {error: err.message}
  }
})

// Storage handlers - scoped by extension ID to prevent cross-extension data access
const STORAGE_PREFIX = "flotilla:ext:"
const MAX_STORAGE_KEY_LENGTH = 256
const MAX_STORAGE_VALUE_SIZE = 1024 * 1024 // 1MB per value

registerBridgeHandler("storage:get", (payload, ext) => {
  if (ext) console.log(`[bridge] storage:get from ${ext.id}`, payload)
  try {
    const {key} = payload || {}
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Invalid key: expected non-empty string")
    }
    if (key.length > MAX_STORAGE_KEY_LENGTH) {
      throw new Error(`Key exceeds maximum length of ${MAX_STORAGE_KEY_LENGTH}`)
    }
    const scopedKey = `${STORAGE_PREFIX}${ext.id}:${key}`
    const raw = localStorage.getItem(scopedKey)
    const data = raw ? JSON.parse(raw) : null
    return {status: "ok", data}
  } catch (err: any) {
    console.error("Error in storage:get bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("storage:set", (payload, ext) => {
  if (ext) console.log(`[bridge] storage:set from ${ext.id}`, payload)
  try {
    const {key, data} = payload || {}
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Invalid key: expected non-empty string")
    }
    if (key.length > MAX_STORAGE_KEY_LENGTH) {
      throw new Error(`Key exceeds maximum length of ${MAX_STORAGE_KEY_LENGTH}`)
    }
    const scopedKey = `${STORAGE_PREFIX}${ext.id}:${key}`
    if (data === null || data === undefined) {
      localStorage.removeItem(scopedKey)
      return {status: "ok"}
    }
    const serialized = JSON.stringify(data)
    if (serialized.length > MAX_STORAGE_VALUE_SIZE) {
      throw new Error(`Value exceeds maximum size of ${MAX_STORAGE_VALUE_SIZE} bytes`)
    }
    localStorage.setItem(scopedKey, serialized)
    return {status: "ok"}
  } catch (err: any) {
    console.error("Error in storage:set bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("storage:remove", (payload, ext) => {
  if (ext) console.log(`[bridge] storage:remove from ${ext.id}`, payload)
  try {
    const {key} = payload || {}
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Invalid key: expected non-empty string")
    }
    const scopedKey = `${STORAGE_PREFIX}${ext.id}:${key}`
    localStorage.removeItem(scopedKey)
    return {status: "ok"}
  } catch (err: any) {
    console.error("Error in storage:remove bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("storage:keys", (payload, ext) => {
  if (ext) console.log(`[bridge] storage:keys from ${ext.id}`)
  try {
    const prefix = `${STORAGE_PREFIX}${ext.id}:`
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) {
        keys.push(key.slice(prefix.length))
      }
    }
    return {status: "ok", keys}
  } catch (err: any) {
    console.error("Error in storage:keys bridge handler:", err)
    return {error: err.message}
  }
})
