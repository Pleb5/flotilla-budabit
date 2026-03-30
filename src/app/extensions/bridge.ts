import {publishThunk} from "@welshman/app"
import {PublishStatus, load} from "@welshman/net"
import {pushToast} from "@app/util/toast"
import type {LoadedExtension, RepoContext} from "./types"
import {getRepoAddress} from "./types"

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

// Using @welshman/net load() for queries - better relay connection management

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
    requireNonEmptyStringArray(filter["#d"], '["#d"]')
  }
  if (kinds.includes(30302)) {
    requireNonEmptyStringArray(filter["#a"], '["#a"]')
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

const parseNostrQueryPayload = (
  payload: unknown,
): {relays: string[]; filter: Record<string, unknown>} => {
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
    // Check origin - allow Blossom CDN redirects (r2a.primal.net serves blossom.primal.net content)
    const isOriginMatch =
      this.extension.origin === origin ||
      (this.extension.origin.includes("blossom.primal.net") && origin.includes("primal.net"))
    if (!isOriginMatch) {
      console.log(`[bridge] origin mismatch: expected ${this.extension.origin}, got ${origin}`)
      return
    }

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
    // Use the extension's known origin to prevent message leaks if the iframe navigates.
    // For sandboxed iframes (origin 'null'), we must use '*' but only for the expected window.
    const isSandboxed = this.extension.origin === "null"
    const targetOrigin = isSandboxed ? "*" : this.extension.origin
    targetWindow?.postMessage({type: "event", action, payload}, targetOrigin)
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
    const hasIdAndSig =
      event &&
      typeof event === "object" &&
      typeof (event as any).id === "string" &&
      typeof (event as any).sig === "string"

    console.log(`[bridge] nostr:publish event hasIdAndSig=${hasIdAndSig}, relays=${relays?.length}`)

    if (relays && relays.length > 0 && hasIdAndSig) {
      console.log(`[bridge] nostr:publish using publishThunk for signed event`)
      // For already-signed events, still use publishThunk which handles relay connections
      const thunk = (publishThunk as any)({event, relays})
      await thunk.complete
      const results = thunk.results || {}
      const successCount = Object.values(results).filter(
        (r: any) => r?.status === PublishStatus.Success,
      ).length
      console.log(
        `[bridge] nostr:publish signed event completed: ${successCount}/${relays.length} relays accepted`,
      )
      const sanitizedResult = Object.entries(results).map(([relay, r]: [string, any]) => ({
        relay,
        status: r?.status === PublishStatus.Success ? "fulfilled" : "rejected",
        reason: r?.detail || r?.message,
      }))
      console.log(`[bridge] nostr:publish completed:`, sanitizedResult)
      return {
        status: "ok",
        result: {
          published: true,
          relays: [...relays],
          publishResult: sanitizedResult,
          successCount,
        },
      }
    }

    // Event needs signing - use publishThunk
    console.log(
      `[bridge] nostr:publish using publishThunk to sign and publish, event:`,
      JSON.stringify(event),
    )
    if (relays && relays.length > 0) {
      try {
        const thunk = (publishThunk as any)({event, relays})
        await thunk.complete
        // Log publish results to debug - use PublishStatus enum
        const results = thunk.results || {}
        const successCount = Object.values(results).filter(
          (r: any) => r?.status === PublishStatus.Success,
        ).length
        // Log detailed results for each relay
        for (const [relay, result] of Object.entries(results)) {
          const r = result as any
          console.log(
            `[bridge] nostr:publish relay ${relay}: status=${r?.status}, message=${r?.message || r?.detail || "none"}`,
          )
        }
        console.log(
          `[bridge] nostr:publish publishThunk completed: ${successCount}/${relays.length} relays accepted`,
        )
        // Return immediately - client should handle retry logic
        return {status: "ok", result: {published: true, relays: [...relays], successCount}}
      } catch (e: any) {
        console.error(`[bridge] nostr:publish publishThunk with relays failed:`, e)
        // Fallback to legacy behavior below.
      }
    }

    const thunk = publishThunk(event)
    await thunk.complete
    console.log(
      `[bridge] nostr:publish publishThunk completed (no relays), waiting for relay indexing`,
    )
    // Give relays time to index the event before returning
    await new Promise(r => setTimeout(r, 500))
    return {status: "ok", result: {published: true}}
  } catch (err: any) {
    console.error("Error in nostr:publish bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("nostr:query", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:query from ${ext.id}`, payload)
  try {
    const {relays, filter} = parseNostrQueryPayload(payload)
    console.log(
      `[bridge] nostr:query querying ${relays.length} relays:`,
      relays,
      JSON.stringify(filter),
    )

    // Use @welshman/net load() for better relay connection management
    const events: any[] = []
    const seenIds = new Set<string>()
    let resolved = false
    let resolveEarly: (() => void) | null = null

    // Promise that resolves when we get events (after a short delay to collect more)
    const earlyResolvePromise = new Promise<void>(resolve => {
      resolveEarly = resolve
    })

    // Timeout after 5s (reduced from 10s)
    const timeoutPromise = new Promise<void>(resolve => {
      setTimeout(() => {
        if (!resolved) {
          console.log(`[bridge] nostr:query timeout after 5s, got ${events.length} events`)
          resolved = true
          resolve()
        }
      }, 5000)
    })

    const loadPromise = load({
      relays,
      filters: [filter as any],
      onEvent: (event: any) => {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id)
          events.push(event)
          console.log(`[bridge] nostr:query received event ${event.id}, total: ${events.length}`)
          // Once we have events, wait 500ms for more then resolve early
          if (!resolved && resolveEarly) {
            setTimeout(() => {
              if (!resolved) {
                console.log(`[bridge] nostr:query early resolve with ${events.length} events`)
                resolved = true
                resolveEarly!()
              }
            }, 500)
          }
        }
      },
    }).catch((e: any) => {
      console.log(`[bridge] nostr:query load error:`, e?.message || e)
    })

    // Wait for load to complete, early resolve (events found), or timeout
    await Promise.race([loadPromise, earlyResolvePromise, timeoutPromise])

    console.log(`[bridge] nostr:query got ${events.length} events`)
    return {status: "ok", events}
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

// Storage handlers - scoped by extension ID and optionally by repository
const STORAGE_PREFIX = "flotilla:ext:"
const MAX_STORAGE_KEY_LENGTH = 256
const MAX_STORAGE_VALUE_SIZE = 1024 * 1024 // 1MB per value

/**
 * Compute the storage key prefix for an extension.
 * If repoContext is present, keys are scoped to that repository.
 * Format: "flotilla:ext:{extId}:{key}" or "flotilla:ext:{extId}:repo:{pubkey}:{name}:{key}"
 */
const getStorageKeyPrefix = (ext: LoadedExtension, repoScoped: boolean): string => {
  const base = `${STORAGE_PREFIX}${ext.id}:`
  if (repoScoped && ext.repoContext) {
    return `${base}repo:${ext.repoContext.pubkey}:${ext.repoContext.name}:`
  }
  return base
}

registerBridgeHandler("storage:get", (payload, ext) => {
  if (ext) console.log(`[bridge] storage:get from ${ext.id}`, payload)
  try {
    const {key, repoScoped = false} = payload || {}
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Invalid key: expected non-empty string")
    }
    if (key.length > MAX_STORAGE_KEY_LENGTH) {
      throw new Error(`Key exceeds maximum length of ${MAX_STORAGE_KEY_LENGTH}`)
    }
    if (repoScoped && !ext.repoContext) {
      throw new Error("repoScoped requested but no repository context available")
    }
    const scopedKey = `${getStorageKeyPrefix(ext, repoScoped)}${key}`
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
    const {key, data, repoScoped = false} = payload || {}
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Invalid key: expected non-empty string")
    }
    if (key.length > MAX_STORAGE_KEY_LENGTH) {
      throw new Error(`Key exceeds maximum length of ${MAX_STORAGE_KEY_LENGTH}`)
    }
    if (repoScoped && !ext.repoContext) {
      throw new Error("repoScoped requested but no repository context available")
    }
    const scopedKey = `${getStorageKeyPrefix(ext, repoScoped)}${key}`
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
    const {key, repoScoped = false} = payload || {}
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("Invalid key: expected non-empty string")
    }
    if (repoScoped && !ext.repoContext) {
      throw new Error("repoScoped requested but no repository context available")
    }
    const scopedKey = `${getStorageKeyPrefix(ext, repoScoped)}${key}`
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
    const {repoScoped = false} = payload || {}
    if (repoScoped && !ext.repoContext) {
      throw new Error("repoScoped requested but no repository context available")
    }
    const prefix = getStorageKeyPrefix(ext, repoScoped)
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

// Handler to get current repo context (if available)
registerBridgeHandler("context:getRepo", (payload, ext) => {
  if (ext) console.log(`[bridge] context:getRepo from ${ext.id}`)
  try {
    if (!ext.repoContext) {
      return {status: "ok", repoContext: null}
    }
    return {
      status: "ok",
      repoContext: {
        pubkey: ext.repoContext.pubkey,
        name: ext.repoContext.name,
        naddr: ext.repoContext.naddr,
        relays: ext.repoContext.relays,
        address: getRepoAddress(ext.repoContext), // Canonical "30617:pubkey:name" format
      },
    }
  } catch (err: any) {
    console.error("Error in context:getRepo bridge handler:", err)
    return {error: err.message}
  }
})
