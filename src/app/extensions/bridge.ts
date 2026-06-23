import {publishThunk, signer} from "@welshman/app"
import {PublishStatus, load} from "@welshman/net"
import {pushToast} from "@app/util/toast"
import {activeRepoClass} from "@app/core/git-state"
import {get} from "svelte/store"
import type {LoadedExtension} from "./types"
import {getRepoAddress} from "./types"

export type ExtensionMessage = {
  id?: string
  type: "request" | "response" | "event"
  action: string
  payload?: any
}

type BridgeHandler = (payload: any, ext: LoadedExtension) => Promise<any> | any

const bridgeHandlers = new Map<string, BridgeHandler>()

/**
 * Deep copy that unwraps Proxy values (e.g. Svelte 5 `$state`) while preserving
 * Date, ArrayBuffer, typed arrays, Map, Set. Used as a fallback when
 * `postMessage` rejects the original payload with DataCloneError.
 */
const deepSnapshot = (value: unknown, seen: WeakMap<object, unknown> = new WeakMap()): unknown => {
  if (value === null || typeof value !== "object") return value
  const obj = value as object
  const cached = seen.get(obj)
  if (cached !== undefined) return cached
  if (value instanceof Date) return new Date(value)
  if (value instanceof ArrayBuffer) return value.slice(0)
  if (ArrayBuffer.isView(value)) {
    const view = value as any
    return new view.constructor(view.buffer.slice(0), view.byteOffset, view.length)
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(obj, out)
    for (const v of value) out.push(deepSnapshot(v, seen))
    return out
  }
  if (value instanceof Map) {
    const out = new Map()
    seen.set(obj, out)
    for (const [k, v] of value) out.set(deepSnapshot(k, seen), deepSnapshot(v, seen))
    return out
  }
  if (value instanceof Set) {
    const out = new Set()
    seen.set(obj, out)
    for (const v of value) out.add(deepSnapshot(v, seen))
    return out
  }
  const out: Record<string, unknown> = {}
  seen.set(obj, out)
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = deepSnapshot((value as Record<string, unknown>)[k], seen)
  }
  return out
}

/**
 * Wraps `postMessage` with a fallback for DataCloneError — typically caused by
 * Svelte 5 `$state` proxies leaking into a handler's return value. Retries with
 * a deep-snapshotted copy and warns so the offending site can be tracked down.
 */
const safePostMessage = (target: Window, message: unknown, origin: string): void => {
  try {
    target.postMessage(message, origin)
  } catch (err) {
    if (err instanceof DOMException && err.name === "DataCloneError") {
      console.warn(
        "[bridge] postMessage payload not cloneable, retrying with snapshot:",
        err.message,
        message,
      )
      target.postMessage(deepSnapshot(message), origin)
    } else {
      throw err
    }
  }
}

export const registerBridgeHandler = (action: string, handler: BridgeHandler) => {
  bridgeHandlers.set(action, handler)
}

export const removeBridgeHandler = (action: string) => {
  bridgeHandlers.delete(action)
}

let messageCounter = 0

// Using @welshman/net load() for queries - better relay connection management

const NIP100_ALLOWED_KINDS = new Set<number>([
  30301,
  30302, // NIP-100 Kanban
  5100,
  5101, // Loom job / result
  5401,
  5402, // Hive CI workflow run / result
  30100, // Loom status
  10100, // Loom worker advertisement
])
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

  // NIP-100 Kanban: boards require #d, cards require #a
  if (kinds.includes(30301)) {
    requireNonEmptyStringArray(filter["#d"], '["#d"]')
  }
  if (kinds.includes(30302)) {
    requireNonEmptyStringArray(filter["#a"], '["#a"]')
  }
  // Hive CI / Loom: no additional required tag constraints beyond kinds

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

const getActiveRepo = () => {
  const repo = get(activeRepoClass)
  if (!repo) {
    throw new Error("Active repository is not available")
  }
  return repo
}

const getRepoBranchesPayload = () => {
  const repo = getActiveRepo()
  const branches = Array.isArray(repo.branches)
    ? repo.branches
        .map((branch: any) => ({
          name: typeof branch?.name === "string" ? branch.name : "",
          commitId:
            (typeof branch?.commitId === "string" && branch.commitId) ||
            (typeof branch?.oid === "string" && branch.oid) ||
            "",
        }))
        .filter((branch: {name: string}) => branch.name.length > 0)
    : []

  return {
    defaultBranch: repo.mainBranch || "main",
    selectedBranch: repo.selectedBranch || "",
    branches,
  }
}

const listRepoWorkflowFiles = async () => {
  const repo = getActiveRepo()
  const branch = repo.selectedBranch || repo.mainBranch || undefined
  console.log(
    `[bridge] listRepoWorkflowFiles: listing .github/workflows on branch=${branch || "(default)"}`,
  )
  const filesResult = await repo.listRepoFiles({path: ".github/workflows", branch})
  const files = Array.isArray(filesResult?.files) ? filesResult.files : []
  console.log(
    `[bridge] listRepoWorkflowFiles: got ${files.length} entries:`,
    files.map((f: any) => ({path: f?.path, type: f?.type})),
  )

  const workflowFiles = files.filter(
    (file: any) =>
      file?.type === "file" &&
      typeof file?.path === "string" &&
      (file.path.endsWith(".yml") || file.path.endsWith(".yaml")),
  )
  console.log(`[bridge] listRepoWorkflowFiles: ${workflowFiles.length} workflow files after filter`)

  const workflows = await Promise.all(
    workflowFiles.map(async (file: any) => {
      const contentResult = await repo.getFileContent({path: file.path, branch})
      const content = typeof contentResult?.content === "string" ? contentResult.content : ""
      const fileName = file.path.split("/").pop() || file.path
      const nameMatch = content.match(/^name:\s*['\"]?(.+?)['\"]?$/m)
      const name = nameMatch
        ? nameMatch[1].trim()
        : fileName.replace(/\.(yml|yaml)$/i, "").replace(/[-_]/g, " ")

      return {
        name,
        path: file.path,
        content,
      }
    }),
  )

  console.log(
    `[bridge] listRepoWorkflowFiles: returning ${workflows.length} workflows:`,
    workflows.map(w => ({name: w.name, path: w.path})),
  )
  return workflows.sort((a, b) => a.name.localeCompare(b.name))
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
        const win = source as Window | null
        if (win) {
          safePostMessage(
            win,
            {id: msg.id, type: "response", action: msg.action, payload: result},
            origin,
          )
        }
      } catch (e: any) {
        console.error("Bridge handler error:", e)
        const win = source as Window | null
        if (win) {
          safePostMessage(
            win,
            {id: msg.id, type: "response", action: msg.action, payload: {error: e.message}},
            origin,
          )
        }
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
    if (targetWindow) {
      safePostMessage(targetWindow, {type: "event", action, payload}, targetOrigin)
    }
  }

  request(action: string, payload: any): Promise<any> {
    this.enforcePolicy(action)
    const id = `${Date.now()}-${messageCounter++}`
    const msg: ExtensionMessage = {id, type: "request", action, payload}
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve)
      try {
        const target = this.extension.iframe?.contentWindow
        if (target) safePostMessage(target, msg, this.extension.origin)
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
          eventId: event.id,
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
        const signedEventId = thunk.event?.id || null
        return {
          status: "ok",
          result: {published: true, relays: [...relays], successCount, eventId: signedEventId},
        }
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
    const signedEventId = thunk.event?.id || null
    return {status: "ok", result: {published: true, eventId: signedEventId}}
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

// Storage handlers are scoped by encoded extension/widget line ID and optional repo address.
// v2 keys receive all new writes; legacy flotilla keys remain readable during migration.
const STORAGE_PREFIX = "budabit:ext:v2:"
const LEGACY_STORAGE_PREFIX = "flotilla:ext:"
const MAX_STORAGE_KEY_LENGTH = 256
const MAX_STORAGE_VALUE_SIZE = 1024 * 1024 // 1MB per value

const encodeStorageComponent = (value: string): string => encodeURIComponent(value)

const decodeStorageComponent = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const getV2StorageKeyPrefix = (ext: LoadedExtension, repoScoped: boolean): string => {
  const base = `${STORAGE_PREFIX}${encodeStorageComponent(ext.id)}:`

  if (repoScoped && ext.repoContext) {
    return `${base}repo:${encodeStorageComponent(getRepoAddress(ext.repoContext))}:`
  }

  return `${base}global:`
}

const getLegacyStorageKeyPrefix = (
  extId: string,
  repoContext: LoadedExtension["repoContext"],
  repoScoped: boolean,
): string => {
  const base = `${LEGACY_STORAGE_PREFIX}${extId}:`

  if (repoScoped && repoContext) {
    return `${base}repo:${repoContext.pubkey}:${repoContext.name}:`
  }

  return base
}

const getLegacyStorageKeyPrefixes = (ext: LoadedExtension, repoScoped: boolean): string[] => {
  const ids = [ext.id]

  if (ext.type === "widget" && ext.widget.identifier && ext.widget.identifier !== ext.id) {
    ids.push(ext.widget.identifier)
  }

  return Array.from(
    new Set(ids.map(id => getLegacyStorageKeyPrefix(id, ext.repoContext, repoScoped))),
  )
}

const getV2StorageKey = (ext: LoadedExtension, repoScoped: boolean, key: string): string =>
  `${getV2StorageKeyPrefix(ext, repoScoped)}${encodeStorageComponent(key)}`

const getLegacyStorageKeys = (ext: LoadedExtension, repoScoped: boolean, key: string): string[] =>
  getLegacyStorageKeyPrefixes(ext, repoScoped).map(prefix => `${prefix}${key}`)

const removeStorageKey = (ext: LoadedExtension, repoScoped: boolean, key: string): void => {
  localStorage.removeItem(getV2StorageKey(ext, repoScoped, key))
  for (const legacyKey of getLegacyStorageKeys(ext, repoScoped, key)) {
    localStorage.removeItem(legacyKey)
  }
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
    const raw =
      localStorage.getItem(getV2StorageKey(ext, repoScoped, key)) ??
      getLegacyStorageKeys(ext, repoScoped, key)
        .map(legacyKey => localStorage.getItem(legacyKey))
        .find(value => value !== null)
    const data = raw !== null && raw !== undefined ? JSON.parse(raw) : null
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
    if (data === null || data === undefined) {
      removeStorageKey(ext, repoScoped, key)
      return {status: "ok"}
    }
    const serialized = JSON.stringify(data)
    if (serialized.length > MAX_STORAGE_VALUE_SIZE) {
      throw new Error(`Value exceeds maximum size of ${MAX_STORAGE_VALUE_SIZE} bytes`)
    }
    localStorage.setItem(getV2StorageKey(ext, repoScoped, key), serialized)
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
    removeStorageKey(ext, repoScoped, key)
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
    const v2Prefix = getV2StorageKeyPrefix(ext, repoScoped)
    const legacyPrefixes = getLegacyStorageKeyPrefixes(ext, repoScoped)
    const keys = new Set<string>()

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue

      if (key.startsWith(v2Prefix)) {
        keys.add(decodeStorageComponent(key.slice(v2Prefix.length)))
        continue
      }

      for (const legacyPrefix of legacyPrefixes) {
        if (key.startsWith(legacyPrefix)) {
          keys.add(key.slice(legacyPrefix.length))
          break
        }
      }
    }

    return {status: "ok", keys: Array.from(keys)}
  } catch (err: any) {
    console.error("Error in storage:keys bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("repo:getBranches", async (payload, ext) => {
  if (ext) console.log(`[bridge] repo:getBranches from ${ext.id}`)
  try {
    return {
      status: "ok",
      ...getRepoBranchesPayload(),
    }
  } catch (err: any) {
    console.error("Error in repo:getBranches bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("repo:listWorkflows", async (payload, ext) => {
  if (ext) console.log(`[bridge] repo:listWorkflows from ${ext.id}`)
  try {
    return {
      status: "ok",
      workflows: await listRepoWorkflowFiles(),
      ...getRepoBranchesPayload(),
    }
  } catch (err: any) {
    console.error("Error in repo:listWorkflows bridge handler:", err)
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

// ── NIP-44 Encryption ────────────────────────────────────────────────
// Allows extensions to encrypt plaintext to a recipient pubkey using the host's signer.

registerBridgeHandler("nostr:sign", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:sign from ${ext.id}`)
  try {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid payload: expected an unsigned event template")
    }
    const template = payload as {kind?: number; created_at?: number; content?: string; tags?: any[]}
    if (typeof template.kind !== "number") {
      throw new Error("Invalid event template: missing numeric `kind`")
    }
    const $signer = signer.get()
    if (!$signer) {
      throw new Error("No active signer available")
    }
    const event = {
      kind: template.kind,
      created_at: template.created_at ?? Math.floor(Date.now() / 1000),
      content: template.content ?? "",
      tags: Array.isArray(template.tags) ? template.tags : [],
    }
    const signed = await $signer.sign(event)
    return {status: "ok", event: signed}
  } catch (err: any) {
    console.error("Error in nostr:sign bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("nostr:nip44Encrypt", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:nip44Encrypt from ${ext.id}`)
  try {
    const {recipientPubkey, plaintext} = payload || {}
    if (typeof recipientPubkey !== "string" || recipientPubkey.length !== 64) {
      throw new Error("Invalid recipientPubkey: expected 64-char hex string")
    }
    if (typeof plaintext !== "string") {
      throw new Error("Invalid plaintext: expected string")
    }

    const $signer = signer.get()
    if (!$signer) {
      throw new Error("No active signer available")
    }
    if (!$signer.nip44) {
      throw new Error("Active signer does not support NIP-44 encryption")
    }

    const ciphertext = await $signer.nip44.encrypt(recipientPubkey, plaintext)
    return {status: "ok", ciphertext}
  } catch (err: any) {
    console.error("Error in nostr:nip44Encrypt bridge handler:", err)
    return {error: err.message}
  }
})

// ── Nostr Subscriptions ─────────────────────────────────────────────
// Persistent subscriptions that stream events back to extensions via bridge events.
// Uses nostr-tools SimplePool since welshman/net only exposes one-shot load().

import {SimplePool} from "nostr-tools"

const MAX_SUBSCRIPTIONS_PER_EXT = 10
let subscriptionCounter = 0

// Track active subscriptions: extId → Map<subId, cleanup>
const extensionSubscriptions = new Map<string, Map<string, () => void>>()

/**
 * Post an event to an extension's iframe.
 * Uses the same mechanism as ExtensionBridge.post() but callable from handlers.
 */
function postEventToExtension(ext: LoadedExtension, action: string, payload: any): void {
  const targetWindow = ext.iframe?.contentWindow
  if (!targetWindow) return
  const isSandboxed = ext.origin === "null"
  const targetOrigin = isSandboxed ? "*" : ext.origin
  targetWindow.postMessage({type: "event", action, payload}, targetOrigin)
}

/**
 * Clean up all subscriptions for an extension.
 * Called when the extension is unloaded.
 */
export function cleanupExtensionSubscriptions(extId: string): void {
  const subs = extensionSubscriptions.get(extId)
  if (!subs) return
  for (const [subId, cleanup] of Array.from(subs)) {
    console.log(`[bridge] cleaning up subscription ${subId} for ${extId}`)
    cleanup()
  }
  subs.clear()
  extensionSubscriptions.delete(extId)
}

registerBridgeHandler("nostr:subscribe", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:subscribe from ${ext.id}`, payload)
  try {
    const {relays, filter} = parseNostrQueryPayload(payload)

    // Enforce per-extension subscription limit
    if (!extensionSubscriptions.has(ext.id)) {
      extensionSubscriptions.set(ext.id, new Map())
    }
    const extSubs = extensionSubscriptions.get(ext.id)!
    if (extSubs.size >= MAX_SUBSCRIPTIONS_PER_EXT) {
      throw new Error(`Subscription limit reached (max ${MAX_SUBSCRIPTIONS_PER_EXT})`)
    }

    const subId = `sub-${ext.id.slice(0, 8)}-${++subscriptionCounter}`
    const pool = new SimplePool()

    console.log(
      `[bridge] opening subscription ${subId} on ${relays.length} relays, filter:`,
      JSON.stringify(filter),
    )

    const sub = pool.subscribeMany(relays, [filter] as any, {
      onevent(event: any) {
        // Stream each event to the extension
        postEventToExtension(ext, "nostr:subscription:event", {
          subscriptionId: subId,
          event,
        })
      },
      oneose() {
        console.log(`[bridge] subscription ${subId} EOSE`)
      },
    })

    const cleanup = () => {
      try {
        sub.close()
        pool.close(relays)
      } catch {
        // ignore cleanup errors
      }
    }

    extSubs.set(subId, cleanup)

    return {status: "ok", subscriptionId: subId}
  } catch (err: any) {
    console.error("Error in nostr:subscribe bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("nostr:unsubscribe", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:unsubscribe from ${ext.id}`, payload)
  try {
    const {subscriptionId} = payload || {}
    if (typeof subscriptionId !== "string") {
      throw new Error("Invalid subscriptionId")
    }

    const extSubs = extensionSubscriptions.get(ext.id)
    const cleanup = extSubs?.get(subscriptionId)
    if (cleanup) {
      cleanup()
      extSubs!.delete(subscriptionId)
      console.log(`[bridge] closed subscription ${subscriptionId}`)
    }

    return {status: "ok"}
  } catch (err: any) {
    console.error("Error in nostr:unsubscribe bridge handler:", err)
    return {error: err.message}
  }
})
