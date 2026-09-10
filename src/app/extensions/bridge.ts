import {pubkey as activeUserPubkey, publishThunk, repository, signer} from "@welshman/app"
import {goto} from "$app/navigation"
import {PublishStatus, load} from "@welshman/net"
import {
  EVENT_DATE,
  EVENT_TIME,
  getTagValue,
  matchFilters,
  sanitizeRelayUrls,
  type TrustedEvent,
} from "@welshman/util"
import {verifyEvent} from "nostr-tools/pure"
import {pushToast} from "@app/util/toast"
import {activeRepoClass} from "@app/core/git-state"
import {
  activeExactCommunityDefinition,
  activeExactCommunityPointer,
  activeCommunityPermissionStatus,
  activeCommunityProfileListEvents,
  activeExactCommunityRelays,
  activeCommunityReportState,
  authenticateCommunityRelays,
  getCommunityPermissionReadiness,
  getCommunityPermissionStatusKeyPrefix,
  getCommunityBootstrapRelays,
  getPubkeyOutboxRelays,
  loadCommunityEvents,
  loadCommunityEventsWithStatus,
  type CommunityRelayLoadResult,
} from "@app/core/community-state"
import {
  TARGETED_PUBLICATION_KIND,
  PROFILE_LIST_KIND,
  normalizePubkey,
  normalizeRelays,
  parseAddressRef,
  type CommunityDefinition,
} from "@app/core/community"
import {
  filterAuthorizedCommunityDescriptorEvents,
  filterCommunityDescriptorEvents,
  getCommunityContextRuntimeSnapshot,
  makeCommunityDescriptorQueryPlan,
  normalizeCommunityEventDescriptors,
  resolveCommunityEventDescriptors,
  type ResolvedCommunityEventDescriptor,
} from "@app/extensions/community-context"
import {get} from "svelte/store"
import type {
  CommunityEventDescriptor,
  CommunityPublishSharedConfigRequest,
  CommunityQueryLiveStreamsRequest,
  CommunityQuerySharedConfigRequest,
  CommunityQueryEventsRequest,
  CommunityWidgetContext,
  CommunityWidgetRuntimeContext,
  LoadedExtension,
  WidgetResizeRequest,
} from "./types"
import {getRepoAddress} from "./types"
import {
  extensionSubscriptionRegistry,
  MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION,
} from "./extension-subscriptions"
import {queryExtensionRelays} from "./nostr-query"
import {isAllowedExtensionOrigin} from "./url-policy"
import {BoundedRefreshCache} from "./bounded-refresh-cache"
import {
  getCommunitySharedConfigDescriptorKey,
  isAuthorizedCommunitySharedConfigEvent,
} from "./community-shared-config"
import {
  MAX_NOSTR_QUERY_LIMIT,
  MAX_STORAGE_KEY_LENGTH,
  MAX_STORAGE_VALUE_SIZE,
  getBridgeHandler,
  getRegisteredBridgeActions,
  registerBridgeHandler,
  removeBridgeHandler,
} from "./host-capabilities"

export {getRegisteredBridgeActions, registerBridgeHandler, removeBridgeHandler}

export type ExtensionMessage = {
  id?: string
  type: "request" | "response" | "event"
  action: string
  payload?: any
}

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
const COMMUNITY_SHARED_CONFIG_KIND = 30078
const COMMUNITY_SHARED_CONFIG_PREFIX = "budabit-community-config"
const COMMUNITY_BRIDGE_LOAD_TIMEOUT = 5000
const COMMUNITY_BRIDGE_QUERY_PAGE_SIZE = 100
const COMMUNITY_BRIDGE_QUERY_MAX_PAGES = 3
const COMMUNITY_CONTEXT_NOT_READY_CODE = "COMMUNITY_CONTEXT_NOT_READY"
const COMMUNITY_QUERY_TIMEOUT_CODE = "COMMUNITY_QUERY_TIMEOUT"
const LIVE_STREAM_KIND = 30311
const COMMUNITY_STREAM_TAG_PREFIX = "budabit-community:"
const DEFAULT_TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS = [
  "cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5",
  "81ee947168db2f909895dbd4f71534f4040035575f58156e9a3802d1dd467e1d",
  "f6a25b87f7e7bec9a691e37851b1b57a7b49fa00bb431280303002a3ebca4891",
  "85df822a86599ffbe8143db1e1e1bf2d162fa60fc685c65515963e67cfd7499f",
]
const configuredTrustedLiveStreamProviderPubkeys = String(
  import.meta.env.VITE_TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS || "",
)
  .split(",")
  .map(normalizePubkey)
  .filter(Boolean)
const TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS = new Set(
  configuredTrustedLiveStreamProviderPubkeys.length > 0
    ? configuredTrustedLiveStreamProviderPubkeys
    : DEFAULT_TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS,
)

const normalizeRelayUrls = (relays: unknown): string[] => {
  if (!Array.isArray(relays)) {
    throw new Error("Invalid relays: expected string[]")
  }

  return sanitizeRelayUrls(relays)
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

/**
 * Kinds a widget declared in its signed manifest event (via `nostrKinds` tags).
 * These are allowed for nostr:query / nostr:subscribe in addition to the
 * hardcoded NIP100_ALLOWED_KINDS baseline.
 */
const getDeclaredNostrKinds = (ext?: {widget?: {tags?: string[][]}}): Set<number> => {
  const kinds = new Set<number>()
  const tags = ext?.widget?.tags
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (Array.isArray(tag) && tag[0] === "nostrKinds") {
        const k = Number(tag[1])
        if (Number.isFinite(k)) kinds.add(k)
      }
    }
  }
  return kinds
}

const assertDeclaredWriteKind = (kind: unknown, ext: LoadedExtension) => {
  if (!Number.isSafeInteger(kind) || (kind as number) < 0) throw new Error("Invalid event kind")
  if (
    ext.widget.tags?.some(tag => tag[0] === "nostrKinds") &&
    !getDeclaredNostrKinds(ext).has(kind as number)
  ) {
    throw new Error(`Event kind ${kind} is not declared by this extension`)
  }
}

const assertExpectedScope = (payload: any, ext: LoadedExtension, publishing = false) => {
  if (
    payload?.expectedRepoAddress !== undefined &&
    (!ext.repoContext || getRepoAddress(ext.repoContext) !== payload.expectedRepoAddress)
  ) {
    throw new Error("Repository context changed")
  }
  if (payload?.expectedPubkey !== undefined) {
    if (
      typeof payload.expectedPubkey !== "string" ||
      !/^[0-9a-f]{64}$/.test(payload.expectedPubkey) ||
      get(activeUserPubkey) !== payload.expectedPubkey
    )
      throw new Error("Signing account changed")
    if (
      publishing &&
      payload.expectedRepoAddress !== undefined &&
      ext.repoContext &&
      ![ext.repoContext.pubkey, ...(ext.repoContext.maintainers || [])].includes(
        payload.expectedPubkey,
      )
    ) {
      throw new Error("Signing account is not a repository maintainer")
    }
  }
}

const normalizeNostrFilter = (
  filterRaw: unknown,
  extraAllowedKinds?: Set<number>,
): Record<string, unknown> => {
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
    if (!NIP100_ALLOWED_KINDS.has(k) && !extraAllowedKinds?.has(k)) {
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
  extraAllowedKinds?: Set<number>,
): {relays: string[]; filter: Record<string, unknown>} => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload: expected { relays, filter }")
  }

  const relays = normalizeRelayUrls((payload as any).relays)
  if (relays.length === 0) {
    throw new Error("No valid relays provided")
  }
  if (relays.length > MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION)
    throw new Error("Too many query relays (maximum 8)")

  const filter = normalizeNostrFilter((payload as any).filter, extraAllowedKinds)

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

const verifyExternallySignedEvent = (event: any) =>
  verifyEvent({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  })

const authenticatePublishCommunityRelays = async (relays: string[] = []) => {
  const activeRelaySet = new Set(normalizeRelayUrls(get(activeExactCommunityRelays)))
  const communityRelays = relays.filter(relay => activeRelaySet.has(relay))

  if (communityRelays.length === 0) return

  await authenticateCommunityRelays(communityRelays, {
    priorityRelays: get(activeExactCommunityPointer)?.relayHints || [],
  })
}

const normalizeUiResizePayload = (payload: unknown): WidgetResizeRequest => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid resize payload: expected object")
  }

  const resize: WidgetResizeRequest = {}
  const height = (payload as any).height
  const width = (payload as any).width

  if (height !== undefined) {
    if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
      throw new Error("Invalid resize height: expected positive finite number")
    }
    resize.height = height
  }

  if (width !== undefined) {
    if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
      throw new Error("Invalid resize width: expected positive finite number")
    }
    resize.width = width
  }

  if (resize.height === undefined && resize.width === undefined) {
    throw new Error("Invalid resize payload: expected positive finite height or width")
  }

  return resize
}

const getActiveRepo = () => {
  const repo = get(activeRepoClass)
  if (!repo) {
    throw new Error("Active repository is not available")
  }
  return repo
}

const getRepoBranchesPayload = (
  repo = getActiveRepo(),
  resolvedBranch = repo.selectedBranch || repo.mainBranch || "main",
) => {
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
    resolvedBranch,
    defaultBranch: repo.mainBranch || "main",
    selectedBranch: repo.selectedBranch || "",
    branches,
  }
}

const normalizeRepoPath = (path: unknown) => {
  if (path === undefined || path === null) return ""
  if (typeof path !== "string") throw new Error("Invalid repository path")

  const normalized = path.replace(/^\/+|\/+$/g, "")
  if (!normalized) return ""

  for (const segment of normalized.split("/")) {
    let decoded = segment
    for (let pass = 0; pass < 2; pass++) {
      try {
        const next = decodeURIComponent(decoded)
        if (next === decoded) break
        decoded = next
      } catch {
        break
      }
    }

    const hasInvalidCharacter = Array.from(decoded).some(character => {
      const code = character.charCodeAt(0)
      return "\\/?#".includes(character) || code <= 0x1f || code === 0x7f
    })
    if (!segment || decoded === "." || decoded === ".." || hasInvalidCharacter) {
      throw new Error("Invalid repository path")
    }
  }

  return normalized
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
  private readonly entrypointOrigin: string
  private detached = false

  constructor(private extension: LoadedExtension) {
    this.entrypointOrigin = extension.origin
    // Widgets default to empty permissions, denying privileged bridge actions.
    const permissions = extension.widget.permissions
    if (permissions) {
      permissions.forEach(p => this.allowedActions.add(p))
    }
  }

  attachHandlers(target: Window | null): void {
    if (!target) return
    if (this.listener) window.removeEventListener("message", this.listener)
    this.detached = false
    this.targetWindow = target
    this.listener = (e: MessageEvent) => this.handleMessage(e)
    window.addEventListener("message", this.listener)
  }

  updateCommunityContext(
    communityContext?: CommunityWidgetContext | null,
    communityRuntimeContext?: CommunityWidgetRuntimeContext | null,
  ): void {
    if (this.extension.type === "widget") {
      this.extension.communityContext = communityContext || undefined
      this.extension.communityRuntimeContext = communityRuntimeContext || undefined
    }
  }

  detach(): void {
    this.detached = true
    if (this.listener) window.removeEventListener("message", this.listener)
    cleanupExtensionSubscriptions(this.extension.id)
    this.pending.clear()
    this.targetWindow = null
  }

  private isPrivileged(action: string): boolean {
    const privileged =
      action.startsWith("nostr:") ||
      action.startsWith("storage:") ||
      action.startsWith("community:") ||
      action === "repo:listFiles" ||
      action === "repo:getFile" ||
      action === "ui:notify"
    return privileged
  }

  private enforcePolicy(action: string): void {
    if (this.isPrivileged(action) && !this.allowedActions.has(action)) {
      throw Object.assign(new Error(`Extension not permitted to perform "${action}"`), {
        code: "CAPABILITY_NOT_AUTHORIZED",
      })
    }
  }

  async handleMessage(event: MessageEvent): Promise<void> {
    const {data, source, origin} = event
    if (!this.acceptOrigin(event)) return
    if (!data || typeof data !== "object" || !("action" in data)) return

    const msg = data as ExtensionMessage

    if (msg.type === "response" && msg.id && this.pending.has(msg.id)) {
      const resolve = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      resolve(msg.payload)
      return
    }

    if (msg.type === "request") {
      try {
        this.enforcePolicy(msg.action)
        const handler = getBridgeHandler(msg.action)
        if (!handler) {
          throw Object.assign(new Error(`Host does not support "${msg.action}"`), {
            code: "UNSUPPORTED_CAPABILITY",
          })
        }
        const result = await handler(msg.payload, this.extension)
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
            {
              id: msg.id,
              type: "response",
              action: msg.action,
              payload: {error: e.message, ...(e.code ? {code: e.code} : {})},
            },
            origin,
          )
        }
      }
    }
  }

  /** Synchronize redirect origin only from this iframe's window and a known deployment origin. */
  acceptOrigin(event: MessageEvent): boolean {
    const expectedWindow = this.targetWindow ?? this.extension.iframe?.contentWindow
    if (
      this.detached ||
      !expectedWindow ||
      event.source !== expectedWindow ||
      !isAllowedExtensionOrigin(this.entrypointOrigin, event.origin)
    )
      return false
    this.extension.origin = event.origin
    return true
  }

  post(action: string, payload: any): void {
    if (this.detached) return
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

const safeRelayEndpoint = (relay: string) => relay.split("?", 1)[0].split("#", 1)[0]

registerBridgeHandler("nostr:publish", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:publish from ${ext.id}`)
  try {
    const {event, relays} = parseNostrPublishPayload(payload)
    assertDeclaredWriteKind(event?.kind, ext)
    assertExpectedScope(payload, ext, true)
    if (
      payload?.expectedPubkey !== undefined &&
      (event.pubkey !== payload.expectedPubkey || !event.id || !event.sig)
    ) {
      throw new Error("Pinned publication requires an event already signed by the intended account")
    }
    if (!relays?.length) throw new Error("No valid publish relays provided")
    if (
      event?.kind === TARGETED_PUBLICATION_KIND ||
      (Array.isArray(event?.tags) &&
        event.tags.some((tag: unknown) => Array.isArray(tag) && tag[0] === "h"))
    ) {
      throw new Error("Community-scoped events must use a dedicated community publish capability")
    }
    await authenticatePublishCommunityRelays(relays)
    assertExpectedScope(payload, ext, true)
    const hasIdAndSig =
      event &&
      typeof event === "object" &&
      typeof (event as any).id === "string" &&
      typeof (event as any).sig === "string"

    console.log(`[bridge] nostr:publish event hasIdAndSig=${hasIdAndSig}, relays=${relays?.length}`)

    if (hasIdAndSig && !verifyExternallySignedEvent(event)) {
      throw new Error("Externally signed event failed cryptographic verification")
    }

    if (hasIdAndSig) {
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
        relay: safeRelayEndpoint(relay),
        status: r?.status === PublishStatus.Success ? "fulfilled" : "rejected",
        reason: r?.detail || r?.message,
      }))
      console.log(`[bridge] nostr:publish completed:`, sanitizedResult)
      if (successCount === 0) throw new Error("Event was not accepted by any relay")

      return {
        status: "ok",
        result: {
          published: true,
          relays: relays.map(safeRelayEndpoint),
          publishResult: sanitizedResult,
          successCount,
          eventId: event.id,
        },
      }
    }

    console.log(`[bridge] nostr:publish using publishThunk to sign and publish`)
    const thunk = (publishThunk as any)({event, relays})
    await thunk.complete
    const successCount = Object.values(thunk.results || {}).filter(
      (result: any) => result?.status === PublishStatus.Success,
    ).length
    if (successCount === 0) throw new Error("Event was not accepted by any relay")

    const signedEventId = thunk.event?.id || null
    return {
      status: "ok",
      result: {
        published: true,
        relays: relays.map(safeRelayEndpoint),
        successCount,
        eventId: signedEventId,
      },
    }
  } catch (err: any) {
    console.error("Error in nostr:publish bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("nostr:query", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:query from ${ext.id}`)
  try {
    const {relays, filter} = parseNostrQueryPayload(payload, getDeclaredNostrKinds(ext))
    console.log(
      `[bridge] nostr:query querying ${relays.length} relays:`,
      relays.map(safeRelayEndpoint),
    )

    return await queryExtensionRelays(relays, filter as any)
  } catch (err: any) {
    console.error("Error in nostr:query bridge handler:", err)
    return {error: err.message}
  }
})

const normalizeCommunityDescriptorsPayload = (
  payload: unknown,
): {descriptors: CommunityEventDescriptor[]} => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload: expected { descriptors }")
  }

  const descriptors = (payload as any).descriptors
  if (!Array.isArray(descriptors)) {
    throw new Error("Invalid descriptors: expected CommunityEventDescriptor[]")
  }

  const normalizedDescriptors = normalizeCommunityEventDescriptors(descriptors)
  if (normalizedDescriptors.length === 0) {
    throw new Error("Invalid descriptors: expected non-empty CommunityEventDescriptor[]")
  }

  return {descriptors: normalizedDescriptors}
}

const HEX_EVENT_ID = /^[0-9a-f]{64}$/i

const normalizeCommunityQueryRefs = (value: unknown) => {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error("Invalid refs: expected string[]")

  return Array.from(
    new Set(value.map(ref => (typeof ref === "string" ? ref.trim() : "")).filter(Boolean)),
  ).slice(0, MAX_NOSTR_QUERY_LIMIT)
}

const getBridgeEventTagValue = (event: any, name: string) =>
  Array.isArray(event?.tags) ? event.tags.find((tag: any) => tag?.[0] === name)?.[1] || "" : ""

const getBridgeEventAddress = (event: any) => {
  const identifier = getBridgeEventTagValue(event, "d")
  const pubkey = normalizePubkey(event?.pubkey || "")

  return identifier && pubkey ? `${event.kind}:${pubkey}:${identifier}` : ""
}

const normalizeCommunityQueryEventsPayload = (
  payload: unknown,
): Required<Pick<CommunityQueryEventsRequest, "descriptors" | "refs" | "limit">> &
  Pick<CommunityQueryEventsRequest, "since" | "until" | "calendarStart" | "calendarDate"> => {
  const {descriptors} = normalizeCommunityDescriptorsPayload(payload)

  const limitRaw = (payload as any).limit
  const sinceRaw = (payload as any).since
  const untilRaw = (payload as any).until
  const calendarStartRaw = (payload as any).calendarStart
  const calendarDateRaw = (payload as any).calendarDate
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_NOSTR_QUERY_LIMIT)
      : 100
  const since =
    typeof sinceRaw === "number" && Number.isFinite(sinceRaw) && sinceRaw > 0
      ? Math.floor(sinceRaw)
      : undefined
  const until =
    typeof untilRaw === "number" && Number.isFinite(untilRaw) && untilRaw > 0
      ? Math.floor(untilRaw)
      : undefined

  return {
    descriptors,
    refs: normalizeCommunityQueryRefs((payload as any).refs),
    limit,
    since,
    until,
    calendarStart:
      typeof calendarStartRaw === "number" &&
      Number.isFinite(calendarStartRaw) &&
      calendarStartRaw > 0
        ? Math.floor(calendarStartRaw)
        : undefined,
    calendarDate:
      typeof calendarDateRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(calendarDateRaw)
        ? calendarDateRaw
        : undefined,
  }
}

const normalizeCommunityQueryLiveStreamsPayload = (
  payload: unknown,
): Required<Pick<CommunityQueryLiveStreamsRequest, "descriptors">> &
  Pick<CommunityQueryLiveStreamsRequest, "limit" | "since" | "until"> => {
  const {descriptors} = normalizeCommunityDescriptorsPayload(payload)
  const limitRaw = (payload as any).limit
  const sinceRaw = (payload as any).since
  const untilRaw = (payload as any).until

  return {
    descriptors,
    limit:
      typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), MAX_NOSTR_QUERY_LIMIT)
        : 100,
    since:
      typeof sinceRaw === "number" && Number.isFinite(sinceRaw) && sinceRaw > 0
        ? Math.floor(sinceRaw)
        : undefined,
    until:
      typeof untilRaw === "number" && Number.isFinite(untilRaw) && untilRaw > 0
        ? Math.floor(untilRaw)
        : undefined,
  }
}

const normalizeSharedConfigPart = (value: unknown, name: string) => {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${name}: expected non-empty string`)
  }

  const normalized = value.trim()
  if (!normalized || normalized.length > 120 || !/^[a-z0-9][a-z0-9:._-]*$/i.test(normalized)) {
    throw new Error(`Invalid ${name}: expected namespaced identifier`)
  }

  return normalized
}

const normalizeCommunitySharedConfigScope = (
  payload: unknown,
): Pick<CommunityQuerySharedConfigRequest, "namespace" | "key" | "descriptors" | "limit"> => {
  const {descriptors} = normalizeCommunityDescriptorsPayload(payload)

  const limitRaw = (payload as any).limit
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_NOSTR_QUERY_LIMIT)
      : 50

  return {
    namespace: normalizeSharedConfigPart((payload as any).namespace, "namespace"),
    key: normalizeSharedConfigPart((payload as any).key, "key"),
    descriptors,
    limit,
  }
}

const normalizeCommunityPublishSharedConfigPayload = (
  payload: unknown,
): CommunityPublishSharedConfigRequest => {
  const scope = normalizeCommunitySharedConfigScope(payload)

  if (!payload || typeof payload !== "object" || !("config" in payload)) {
    throw new Error("Invalid config: expected shared config payload")
  }

  const expectedRevision = (payload as any).expectedRevision
  if (
    expectedRevision !== undefined &&
    expectedRevision !== null &&
    (typeof expectedRevision !== "string" || !HEX_EVENT_ID.test(expectedRevision))
  ) {
    throw new Error("Invalid expectedRevision: expected event ID or null")
  }

  return {
    ...scope,
    config: (payload as any).config,
    ...(expectedRevision === undefined
      ? {}
      : {expectedRevision: expectedRevision?.toLowerCase() ?? null}),
  }
}

const makeCommunitySharedConfigIdentifier = ({
  definition,
  namespace,
  key,
}: {
  definition: CommunityDefinition
  namespace: string
  key: string
}) => `${COMMUNITY_SHARED_CONFIG_PREFIX}:${definition.pointer.address}:${namespace}:${key}`

const makeCommunityProfileListFilters = (definition: CommunityDefinition) =>
  definition.sections
    .flatMap(section => section.profileLists)
    .flatMap(ref => {
      const address = parseAddressRef(ref.address)
      return address
        ? [
            {
              kinds: [PROFILE_LIST_KIND],
              authors: [address.pubkey],
              "#d": [address.identifier],
              limit: 1,
            },
          ]
        : []
    })

const dedupeEvents = <T extends {id?: string}>(events: T[]) =>
  Array.from(new Map(events.filter(event => event.id).map(event => [event.id, event])).values())

const parseSharedConfigContent = (event: any) => {
  if (!event || typeof event.content !== "string") return undefined

  try {
    return JSON.parse(event.content)
  } catch {
    return event.content
  }
}

const makeCommunityContextNotReadyError = (message: string) =>
  Object.assign(new Error(message), {code: COMMUNITY_CONTEXT_NOT_READY_CODE})

const makeCommunityQueryTimeoutError = () =>
  Object.assign(new Error("Community relay query is still loading"), {
    code: COMMUNITY_QUERY_TIMEOUT_CODE,
  })

const isCommunityLoadingError = (error: any) =>
  error?.code === COMMUNITY_CONTEXT_NOT_READY_CODE || error?.code === COMMUNITY_QUERY_TIMEOUT_CODE

const isPreferredEvent = (candidate: any, current: any | undefined) => {
  if (!current) return true
  if ((candidate.created_at || 0) !== (current.created_at || 0)) {
    return (candidate.created_at || 0) > (current.created_at || 0)
  }

  return String(candidate.id || "") < String(current.id || "")
}

const sortCommunityQueryEvents = (events: any[]) =>
  events.sort(
    (a, b) =>
      (b.created_at || 0) - (a.created_at || 0) ||
      String(a.id || "").localeCompare(String(b.id || "")),
  )

const filterCommunityCalendarWindow = (
  events: any[],
  calendarStart?: number,
  calendarDate?: string,
) => {
  if (!calendarStart || !calendarDate) return events

  return events.filter(event => {
    if (event.kind === EVENT_TIME) {
      const start = Number(getTagValue("start", event.tags))
      const end = Number(getTagValue("end", event.tags))
      const boundary = Number.isFinite(end) && end > 0 ? end : start
      return !Number.isFinite(boundary) || boundary >= calendarStart
    }
    if (event.kind === EVENT_DATE) {
      const start = getTagValue("start", event.tags) || ""
      const end = getTagValue("end", event.tags) || ""
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return true
      return /^\d{4}-\d{2}-\d{2}$/.test(end) && end > start
        ? calendarDate < end
        : calendarDate <= start
    }
    return true
  })
}

const makeCommunityQueryPage = (events: any[], limit: number, complete: boolean) => {
  const limitedEvents = events.slice(0, limit)
  const hasMore = !complete || events.length > limit
  const boundaryTimestamp = Number(limitedEvents.at(-1)?.created_at)
  const firstOmittedTimestamp = Number(events[limit]?.created_at)
  const canMoveBelowBoundary =
    complete &&
    events.length > limit &&
    Number.isSafeInteger(boundaryTimestamp) &&
    boundaryTimestamp > 1 &&
    firstOmittedTimestamp < boundaryTimestamp

  return {
    events: limitedEvents,
    hasMore,
    ...(canMoveBelowBoundary ? {nextUntil: boundaryTimestamp - 1} : {}),
  }
}

const selectLiveStreamReplacements = (events: any[]) => {
  const selected = new Map<string, any>()

  for (const event of dedupeEvents(events)) {
    if (event?.kind !== LIVE_STREAM_KIND) continue
    const address = getBridgeEventAddress(event)
    if (!address) continue
    const current = selected.get(address)
    if (isPreferredEvent(event, current)) selected.set(address, event)
  }

  return Array.from(selected.values())
}

const hasCommunityStreamTag = (event: any, communityId: string) => {
  const marker = `${COMMUNITY_STREAM_TAG_PREFIX}${communityId}`

  return Array.isArray(event?.tags)
    ? event.tags.some((tag: any) => {
        const name = String(tag?.[0] || "").toLowerCase()
        const value = String(tag?.[1] || "")
          .trim()
          .toLowerCase()
        return (
          (name === "h" && value === communityId) ||
          (name === "t" && (value === marker || value === communityId))
        )
      })
    : false
}

const hasModeratorHostTag = (event: any, moderatorPubkeys: Set<string>) =>
  Array.isArray(event?.tags) &&
  event.tags.some(
    (tag: any) =>
      tag?.[0] === "p" &&
      moderatorPubkeys.has(normalizePubkey(String(tag?.[1] || ""))) &&
      String(tag?.[3] || "").toLowerCase() === "host",
  )

const selectAuthorizedLiveStreams = ({
  events,
  moderatorPubkeys,
  communityId,
  since,
  until,
  limit,
}: {
  events: any[]
  moderatorPubkeys: Set<string>
  communityId: string
  since?: number
  until?: number
  limit: number
}) =>
  selectLiveStreamReplacements(events)
    .filter(event => {
      const author = normalizePubkey(event?.pubkey || "")
      const createdAt = Number(event?.created_at || 0)
      const direct = moderatorPubkeys.has(author)
      const delegated =
        TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS.has(author) &&
        hasModeratorHostTag(event, moderatorPubkeys)

      return (
        Boolean(author) &&
        hasCommunityStreamTag(event, communityId) &&
        (!since || createdAt >= since) &&
        (!until || createdAt <= until) &&
        (direct || delegated)
      )
    })
    .sort(
      (a, b) =>
        (b.created_at || 0) - (a.created_at || 0) ||
        String(a.id || "").localeCompare(String(b.id || "")),
    )
    .slice(0, limit)

const selectCommunitySharedConfigEvent = (
  events: any[],
  resolved: ResolvedCommunityEventDescriptor[],
) => {
  return events
    .filter(event =>
      isAuthorizedCommunitySharedConfigEvent({
        event,
        descriptorAuthorities: resolved,
        allowDescriptorChanges: true,
      }),
    )
    .reduce(
      (current, event) => (isPreferredEvent(event, current) ? event : current),
      undefined as any,
    )
}

const SHARED_CONFIG_REFRESH_TTL_MS = 30_000
const MAX_SHARED_CONFIG_REFRESH_SCOPES = 100
const sharedConfigRefreshCache = new BoundedRefreshCache<CommunityRelayLoadResult>(
  SHARED_CONFIG_REFRESH_TTL_MS,
  MAX_SHARED_CONFIG_REFRESH_SCOPES,
  Date.now,
  result => result.complete && result.events.length > 0,
)

const queryCachedCommunitySharedConfigEvents = ({
  identifier,
  authors,
  limit,
}: {
  identifier: string
  authors: string[]
  limit?: number
}) => {
  try {
    return repository.query([
      {
        kinds: [COMMUNITY_SHARED_CONFIG_KIND],
        authors,
        "#d": [identifier],
        limit,
      } as any,
    ])
  } catch (error) {
    console.warn("[bridge] cached shared config query failed", error)
    return []
  }
}

const queryCachedBridgeEvents = (filters: Record<string, unknown>[]) => {
  if (filters.length === 0) return []

  try {
    return repository.query(filters as any)
  } catch (error) {
    console.warn("[bridge] cached community event query failed", error)
    return []
  }
}

const makeExactCommunityEventRefFilters = ({
  refs,
  descriptorInfos,
}: {
  refs: string[]
  descriptorInfos: ResolvedCommunityEventDescriptor[]
}) => {
  if (refs.length === 0) return []

  const ids: string[] = []
  const filters: Record<string, unknown>[] = []

  for (const ref of refs) {
    if (HEX_EVENT_ID.test(ref)) {
      ids.push(ref.toLowerCase())
      continue
    }

    const [kindRaw, pubkeyRaw, ...identifierParts] = ref.split(":")
    const kind = Number(kindRaw)
    const pubkey = normalizePubkey(pubkeyRaw || "")
    const identifier = identifierParts.join(":").trim()

    if (!Number.isInteger(kind) || !pubkey || !identifier) continue
    const canWriteMatchingDescriptor = descriptorInfos.some(
      info => info.descriptor.kind === kind && info.writerPubkeys.includes(pubkey),
    )
    if (!canWriteMatchingDescriptor) continue

    filters.push({kinds: [kind], authors: [pubkey], "#d": [identifier], limit: 1})
  }

  if (ids.length > 0) filters.push({ids: Array.from(new Set(ids)), limit: ids.length})

  return filters
}

const filterExactCommunityRefEvents = (
  events: TrustedEvent[],
  filters: Record<string, unknown>[],
  communityId: string,
  descriptorInfos: ResolvedCommunityEventDescriptor[],
) => {
  const matchingEvents = events.filter(event => matchFilters(filters as any, event))

  return filterAuthorizedCommunityDescriptorEvents(matchingEvents, communityId, descriptorInfos)
}

const exactCommunityRefsCovered = (refs: string[], events: any[]) =>
  refs.length > 0 &&
  refs.every(ref =>
    events.some(event => {
      if (HEX_EVENT_ID.test(ref)) return String(event?.id || "").toLowerCase() === ref.toLowerCase()

      return getBridgeEventAddress(event).toLowerCase() === ref.toLowerCase()
    }),
  )

const isCommunityAuthorityLoading = (snapshot: ReturnType<typeof getCommunityRequestSnapshot>) => {
  if (snapshot.source === "runtime") return false

  const status = get(activeCommunityPermissionStatus)
  if (!status.communityAddress) return false
  const expectedKeyPrefix = getCommunityPermissionStatusKeyPrefix(
    snapshot.definition,
    snapshot.relays,
    snapshot.userPubkey,
  )

  return (
    getCommunityPermissionReadiness({
      status,
      communityAddress: snapshot.definition.pointer.address,
      expectedKeyPrefix,
    }) === "loading"
  )
}

const getExtensionCommunityContext = (ext: LoadedExtension) => {
  if (ext.type !== "widget") return undefined

  return ext.communityContext
}

const getExtensionCommunityRuntimeContext = (ext: LoadedExtension) => {
  if (ext.type !== "widget") return undefined

  if (ext.communityRuntimeContextProvider) return ext.communityRuntimeContextProvider()

  return ext.communityRuntimeContext
}

const getCommunityRequestSnapshot = (ext: LoadedExtension) => {
  const extensionRuntimeContext = getExtensionCommunityRuntimeContext(ext)
  if (
    ext.type === "widget" &&
    ext.communityRuntimeContextProvider &&
    !extensionRuntimeContext?.definition
  ) {
    throw makeCommunityContextNotReadyError("Community runtime context is not available")
  }

  if (extensionRuntimeContext?.definition) {
    const definition = extensionRuntimeContext.definition
    const community = extensionRuntimeContext.community
    if (community.address !== definition.pointer.address) {
      throw makeCommunityContextNotReadyError("Community context branch does not match definition")
    }
    const profileListEvents = extensionRuntimeContext.profileListEvents || []
    const reportState = extensionRuntimeContext.reportState
    const relayHints = extensionRuntimeContext.relayHints?.length
      ? extensionRuntimeContext.relayHints
      : extensionRuntimeContext.relays || []
    const relays = extensionRuntimeContext.relays?.length
      ? extensionRuntimeContext.relays
      : relayHints
    const userPubkey =
      extensionRuntimeContext.communityContext?.viewer.pubkey || get(activeUserPubkey) || ""

    if (relays.length === 0) {
      throw makeCommunityContextNotReadyError("Community relays are not available")
    }

    const runtime = extensionRuntimeContext.communityContext
      ? {
          contextSessionId: extensionRuntimeContext.communityContext.contextSessionId,
          contextVersion: extensionRuntimeContext.communityContext.contextVersion,
        }
      : getCommunityContextRuntimeSnapshot({
          definition,
          profileListEvents,
          reportState,
          userPubkey,
          relays,
          relayHints,
        })

    const publishRelays = normalizeRelays(definition.relays)

    return {
      source: "runtime" as const,
      community,
      definition,
      profileListEvents,
      authorityEvidenceSettled: extensionRuntimeContext.authorityEvidenceSettled === true,
      reportState,
      relays,
      relayHints,
      publishRelays,
      userPubkey,
      ...runtime,
    }
  }

  const definition = get(activeExactCommunityDefinition)
  const profileListEvents = get(activeCommunityProfileListEvents)
  const reportState = get(activeCommunityReportState)
  const activeRelays = get(activeExactCommunityRelays)
  const activeRelayHints = get(activeExactCommunityPointer)?.relayHints || []
  const userPubkey = get(activeUserPubkey) || ""

  if (!definition) {
    throw makeCommunityContextNotReadyError("Active community definition is not available")
  }

  const extensionCommunityContext = getExtensionCommunityContext(ext)
  const matchingExtensionCommunityContext =
    extensionCommunityContext?.definitionAddress === definition.pointer.address
      ? extensionCommunityContext
      : undefined
  const relayHints = matchingExtensionCommunityContext?.relayHints?.length
    ? matchingExtensionCommunityContext.relayHints
    : activeRelayHints
  const relays = activeRelays.length
    ? activeRelays
    : matchingExtensionCommunityContext?.relays?.length
      ? matchingExtensionCommunityContext.relays
      : relayHints

  if (relays.length === 0) {
    throw makeCommunityContextNotReadyError("Active community relays are not available")
  }

  const runtime = getCommunityContextRuntimeSnapshot({
    definition,
    profileListEvents,
    reportState,
    userPubkey,
    relays,
    relayHints,
  })

  const publishRelays = normalizeRelays(definition.relays)
  const permissionStatus = get(activeCommunityPermissionStatus)
  const permissionKeyPrefix = getCommunityPermissionStatusKeyPrefix(definition, relays, userPubkey)
  const authorityEvidenceSettled =
    getCommunityPermissionReadiness({
      status: permissionStatus,
      communityAddress: definition.pointer.address,
      expectedKeyPrefix: permissionKeyPrefix,
    }) === "ready"

  return {
    source: "active" as const,
    community: definition.pointer,
    definition,
    profileListEvents,
    authorityEvidenceSettled,
    reportState,
    relays,
    relayHints,
    publishRelays,
    userPubkey,
    ...runtime,
  }
}

const loadBridgeEvents = async ({
  relays,
  filters,
  timeoutMs = COMMUNITY_BRIDGE_LOAD_TIMEOUT,
  authenticate = false,
  priorityAuthRelays = [],
  settle = "all",
}: {
  relays: string[]
  filters: Record<string, unknown>[]
  timeoutMs?: number
  authenticate?: boolean
  priorityAuthRelays?: string[]
  settle?: "all" | "first" | "first-non-empty"
}) => {
  if (relays.length === 0 || filters.length === 0) return []

  try {
    return await loadCommunityEvents(relays, filters as any, {
      timeout: timeoutMs,
      authenticate,
      priorityAuthRelays,
      settle,
    })
  } catch (error: any) {
    console.warn("[bridge] community query load failed", error?.message || error)
    return []
  }
}

const loadBridgeEventsWithStatus = async ({
  relays,
  filters,
  timeoutMs = COMMUNITY_BRIDGE_LOAD_TIMEOUT,
  authenticate = false,
  priorityAuthRelays = [],
  settle = "all",
}: {
  relays: string[]
  filters: Record<string, unknown>[]
  timeoutMs?: number
  authenticate?: boolean
  priorityAuthRelays?: string[]
  settle?: "all" | "first" | "first-non-empty"
}): Promise<CommunityRelayLoadResult> => {
  if (relays.length === 0 || filters.length === 0) {
    return {events: [], complete: true, timedOutRelays: [], failedRelays: []}
  }

  try {
    return await loadCommunityEventsWithStatus(relays, filters as any, {
      timeout: timeoutMs,
      authenticate,
      priorityAuthRelays,
      settle,
    })
  } catch (error: any) {
    console.warn("[bridge] community query load failed", error?.message || error)
    return {events: [], complete: false, timedOutRelays: [], failedRelays: relays}
  }
}

const refreshCommunitySharedConfig = ({
  refreshKey,
  relays,
  relayHints,
  filter,
}: {
  refreshKey: string
  relays: string[]
  relayHints: string[]
  filter: Record<string, unknown>
}) => {
  return sharedConfigRefreshCache.refresh(refreshKey, () =>
    loadBridgeEventsWithStatus({
      relays,
      filters: [filter],
      authenticate: true,
      priorityAuthRelays: relayHints,
    }),
  )
}

type BridgeCursorFilterState = {
  filter: Record<string, unknown>
  cursor?: number
  pages: number
}

const loadBridgeEventsWithCursorPagination = async ({
  relays,
  relayFilters,
  localFilters,
  admitEvent,
  pageSize = COMMUNITY_BRIDGE_QUERY_PAGE_SIZE,
  maxPages = COMMUNITY_BRIDGE_QUERY_MAX_PAGES,
  timeoutMs = COMMUNITY_BRIDGE_LOAD_TIMEOUT,
  authenticate = false,
  priorityAuthRelays = [],
}: {
  relays: string[]
  relayFilters: Record<string, unknown>[]
  localFilters: Record<string, unknown>[]
  admitEvent?: (event: TrustedEvent) => boolean
  pageSize?: number
  maxPages?: number
  timeoutMs?: number
  authenticate?: boolean
  priorityAuthRelays?: string[]
}): Promise<CommunityRelayLoadResult> => {
  if (relays.length === 0 || relayFilters.length === 0 || localFilters.length === 0) {
    return {events: [], complete: true, timedOutRelays: [], failedRelays: []}
  }

  const normalizedRelays = normalizeRelays(relays)
  const authFailedRelays = authenticate
    ? (await authenticateCommunityRelays(normalizedRelays, {
        priorityRelays: priorityAuthRelays,
      })) || []
    : []
  const readableRelays = normalizedRelays.filter(relay => !authFailedRelays.includes(relay))

  const scanRelay = async (relay: string): Promise<CommunityRelayLoadResult> => {
    let active: BridgeCursorFilterState[] = relayFilters.map(filter => ({
      filter: {...filter},
      cursor: typeof filter.until === "number" ? filter.until : undefined,
      pages: 0,
    }))
    const admittedEvents: TrustedEvent[] = []
    const timedOutRelays = new Set<string>()
    const failedRelays = new Set<string>()
    let complete = true

    while (active.length > 0) {
      const pageFilters = active.map(state => ({
        ...state.filter,
        limit: pageSize,
        ...(state.cursor === undefined ? {} : {until: state.cursor}),
      }))
      const page = await loadBridgeEventsWithStatus({
        relays: [relay],
        filters: pageFilters,
        timeoutMs,
        authenticate: false,
        priorityAuthRelays,
        settle: "all",
      })
      admittedEvents.push(
        ...page.events.filter(
          event => matchFilters(localFilters as any, event) && (!admitEvent || admitEvent(event)),
        ),
      )
      page.timedOutRelays.forEach(url => timedOutRelays.add(url))
      page.failedRelays.forEach(url => failedRelays.add(url))

      if (!page.complete) {
        complete = false
        break
      }

      const nextActive: BridgeCursorFilterState[] = []
      for (let index = 0; index < active.length; index += 1) {
        const state = active[index]
        const pageFilter = pageFilters[index]
        const rawEvents = page.events.filter(event => matchFilters([pageFilter] as any, event))
        state.pages += 1

        if (rawEvents.length < pageSize) continue

        // A full page may omit events sharing its oldest timestamp, so it cannot prove exhaustion.
        complete = false
        if (state.pages >= maxPages) continue

        const oldestTimestamp = Math.min(...rawEvents.map(event => event.created_at))
        if (!Number.isSafeInteger(oldestTimestamp) || oldestTimestamp <= 0) continue

        const nextCursor = oldestTimestamp - 1
        const since = state.filter.since
        if (typeof since === "number" && nextCursor < since) continue

        state.cursor = nextCursor
        nextActive.push(state)
      }

      active = nextActive
    }

    return {
      events: dedupeEvents(admittedEvents) as TrustedEvent[],
      complete,
      timedOutRelays: Array.from(timedOutRelays),
      failedRelays: Array.from(failedRelays),
    }
  }

  const relayResults = await Promise.all(readableRelays.map(scanRelay))

  return {
    events: dedupeEvents(relayResults.flatMap(result => result.events)) as TrustedEvent[],
    complete:
      authFailedRelays.length === 0 &&
      relayResults.length === normalizedRelays.length &&
      relayResults.every(result => result.complete),
    timedOutRelays: Array.from(new Set(relayResults.flatMap(result => result.timedOutRelays))),
    failedRelays: Array.from(
      new Set([...authFailedRelays, ...relayResults.flatMap(result => result.failedRelays)]),
    ),
  }
}

const profileListHydrationPromises = new Map<string, Promise<any[]>>()

const profileListFiltersCovered = (filters: Record<string, unknown>[], events: any[]) =>
  filters.every(filter =>
    events.some(event => {
      const authors = Array.isArray(filter.authors) ? filter.authors : []
      const identifiers = Array.isArray(filter["#d"]) ? filter["#d"] : []
      const identifier = event?.tags?.find((tag: any) => tag?.[0] === "d")?.[1]

      return (
        event?.kind === PROFILE_LIST_KIND &&
        authors.includes(event?.pubkey) &&
        identifiers.includes(identifier)
      )
    }),
  )

const hydrateCommunityRequestSnapshot = async (
  snapshot: ReturnType<typeof getCommunityRequestSnapshot>,
) => {
  const profileListFilters = makeCommunityProfileListFilters(snapshot.definition)
  if (profileListFilters.length === 0) return snapshot

  const cachedProfileListEvents = dedupeEvents([
    ...snapshot.profileListEvents,
    ...queryCachedBridgeEvents(profileListFilters),
  ]).filter(event => event.kind === PROFILE_LIST_KIND)
  if (profileListFiltersCovered(profileListFilters, cachedProfileListEvents)) {
    return {...snapshot, profileListEvents: cachedProfileListEvents}
  }
  if (isCommunityAuthorityLoading(snapshot)) {
    throw makeCommunityContextNotReadyError("Community context is still loading")
  }

  const hydrationKey = JSON.stringify({
    definition: snapshot.definition.event.id,
    relays: normalizeRelays(snapshot.relays),
    filters: profileListFilters,
  })
  let hydration = profileListHydrationPromises.get(hydrationKey)
  if (!hydration) {
    hydration = loadBridgeEvents({
      relays: snapshot.relays,
      filters: profileListFilters,
      timeoutMs: 3500,
      authenticate: true,
      priorityAuthRelays: snapshot.relayHints,
    }).finally(() => profileListHydrationPromises.delete(hydrationKey))
    profileListHydrationPromises.set(hydrationKey, hydration)
  }
  const loadedProfileListEvents = await hydration

  const profileListEvents = dedupeEvents([
    ...cachedProfileListEvents,
    ...loadedProfileListEvents.filter(event => event.kind === PROFILE_LIST_KIND),
  ])
  if (
    !profileListFiltersCovered(profileListFilters, profileListEvents) &&
    !snapshot.authorityEvidenceSettled
  ) {
    throw makeCommunityContextNotReadyError("Community context is unavailable")
  }

  return {
    ...snapshot,
    profileListEvents,
  }
}

const getHydratedCommunityRequestSnapshot = async (ext: LoadedExtension) =>
  hydrateCommunityRequestSnapshot(getCommunityRequestSnapshot(ext))

registerBridgeHandler("community:checkWriteCapabilities", async (payload, ext) => {
  if (ext) console.log(`[bridge] community:checkWriteCapabilities from ${ext.id}`, payload)
  try {
    const request = normalizeCommunityDescriptorsPayload(payload)
    const snapshot = await getHydratedCommunityRequestSnapshot(ext)
    const capabilities = resolveCommunityEventDescriptors({
      definition: snapshot.definition,
      profileListEvents: snapshot.profileListEvents,
      reportState: snapshot.reportState,
      userPubkey: snapshot.userPubkey,
      descriptors: request.descriptors,
    }).map(info => info.capability)

    return {
      status: "ok",
      capabilities,
      contextSessionId: snapshot.contextSessionId,
      contextVersion: snapshot.contextVersion,
    }
  } catch (err: any) {
    console.error("Error in community:checkWriteCapabilities bridge handler:", err)
    return {error: err.message, ...(err.code ? {code: err.code} : {})}
  }
})

registerBridgeHandler("community:queryEvents", async (payload, ext) => {
  if (ext) console.log(`[bridge] community:queryEvents from ${ext.id}`, payload)
  try {
    const request = normalizeCommunityQueryEventsPayload(payload)
    const snapshot = await getHydratedCommunityRequestSnapshot(ext)
    const descriptorInfos = resolveCommunityEventDescriptors({
      definition: snapshot.definition,
      profileListEvents: snapshot.profileListEvents,
      reportState: snapshot.reportState,
      descriptors: request.descriptors,
    })
    const exactRefWriterPubkeys = Array.from(
      new Set(
        descriptorInfos
          .flatMap(info => info.writerPubkeys)
          .map(normalizePubkey)
          .filter(Boolean),
      ),
    )
    const exactRefFilters = makeExactCommunityEventRefFilters({
      refs: request.refs || [],
      descriptorInfos,
    })
    const cachedExactRefEvents = queryCachedBridgeEvents(exactRefFilters)
    const exactRefAuthorPubkeys = Array.from(
      new Set(
        exactRefFilters
          .flatMap(filter => (Array.isArray(filter.authors) ? filter.authors : []))
          .map(author => normalizePubkey(String(author || "")))
          .filter(Boolean),
      ),
    )
    const exactRefOutboxPubkeys = exactRefAuthorPubkeys.length
      ? exactRefAuthorPubkeys
      : exactRefWriterPubkeys
    const exactRefWriterOutboxRelays = exactRefOutboxPubkeys.flatMap(pubkey =>
      getPubkeyOutboxRelays([pubkey]),
    )
    const exactRefRelays = normalizeRelays([
      ...snapshot.relays,
      ...getCommunityBootstrapRelays(exactRefWriterOutboxRelays),
    ])
    const authorizedCachedExactRefEvents = filterExactCommunityRefEvents(
      cachedExactRefEvents as TrustedEvent[],
      exactRefFilters,
      snapshot.community.communityId,
      descriptorInfos,
    )

    if (
      request.refs?.length &&
      exactCommunityRefsCovered(request.refs, authorizedCachedExactRefEvents)
    ) {
      void loadBridgeEventsWithStatus({
        relays: exactRefRelays,
        filters: exactRefFilters,
        authenticate: true,
        priorityAuthRelays: snapshot.relayHints,
        settle: "all",
      })
      const allEvents = sortCommunityQueryEvents(
        filterCommunityDescriptorEvents(
          authorizedCachedExactRefEvents as any,
          snapshot.community.communityId,
          descriptorInfos.map(info => info.descriptor),
        ),
      )
      const page = makeCommunityQueryPage(allEvents, request.limit, true)

      return {
        status: "ok",
        ...page,
        relays: snapshot.relays,
        descriptors: descriptorInfos.map(info => info.descriptor),
        contextSessionId: snapshot.contextSessionId,
        contextVersion: snapshot.contextVersion,
      }
    }

    const loadedExactRefResult = await loadBridgeEventsWithStatus({
      relays: exactRefRelays,
      filters: exactRefFilters,
      authenticate: true,
      priorityAuthRelays: snapshot.relayHints,
      settle: "all",
    })
    const exactRefEvents = filterExactCommunityRefEvents(
      dedupeEvents([...cachedExactRefEvents, ...loadedExactRefResult.events]) as TrustedEvent[],
      exactRefFilters,
      snapshot.community.communityId,
      descriptorInfos,
    )

    if (request.refs?.length) {
      const allEvents = sortCommunityQueryEvents(
        filterCommunityDescriptorEvents(
          exactRefEvents as any,
          snapshot.community.communityId,
          descriptorInfos.map(info => info.descriptor),
        ),
      )
      const page = makeCommunityQueryPage(allEvents, request.limit, loadedExactRefResult.complete)
      const events = page.events

      if (!exactCommunityRefsCovered(request.refs, events) && !loadedExactRefResult.complete) {
        throw makeCommunityQueryTimeoutError()
      }

      if (ext) {
        console.log(`[bridge] community:queryEvents exact result from ${ext.id}`, {
          refs: request.refs,
          returnedEventCount: events.length,
          returnedRefs: events.map((event: any) => getBridgeEventAddress(event)),
        })
      }

      return {
        status: "ok",
        ...page,
        relays: snapshot.relays,
        descriptors: descriptorInfos.map(info => info.descriptor),
        contextSessionId: snapshot.contextSessionId,
        contextVersion: snapshot.contextVersion,
      }
    }

    const initialPlan = makeCommunityDescriptorQueryPlan({
      community: snapshot.community,
      definition: snapshot.definition,
      profileListEvents: snapshot.profileListEvents,
      reportState: snapshot.reportState,
      descriptors: request.descriptors,
      limit: request.limit,
      since: request.since,
      until: request.until,
    })

    const descriptorPageSize = Math.max(request.limit || 100, COMMUNITY_BRIDGE_QUERY_PAGE_SIZE)
    const localTargetingFilters = initialPlan.localTargetingFilters.map(filter => ({
      ...filter,
      limit: descriptorPageSize,
    }))
    const cachedTargetingEvents = queryCachedBridgeEvents(localTargetingFilters)
    const loadedTargetingResult = initialPlan.relayTargetingFilters.length
      ? await loadBridgeEventsWithCursorPagination({
          relays: snapshot.relays,
          relayFilters: initialPlan.relayTargetingFilters,
          localFilters: initialPlan.localTargetingFilters,
          pageSize: descriptorPageSize,
          authenticate: true,
          priorityAuthRelays: snapshot.relayHints,
        })
      : {events: [], complete: true, timedOutRelays: [], failedRelays: []}
    const targetingEvents = dedupeEvents([
      ...cachedTargetingEvents,
      ...loadedTargetingResult.events,
    ]).filter(event => matchFilters(initialPlan.localTargetingFilters, event))
    const plan = makeCommunityDescriptorQueryPlan({
      community: snapshot.community,
      definition: snapshot.definition,
      profileListEvents: snapshot.profileListEvents,
      reportState: snapshot.reportState,
      descriptors: request.descriptors,
      targetingEvents,
      limit: request.limit,
      since: request.since,
      until: request.until,
    })
    const targetKindSet = new Set(plan.targetKinds)
    const admitsOriginalEvent = (event: TrustedEvent) => {
      if (targetKindSet.has(event.kind)) {
        return (
          filterCommunityDescriptorEvents(
            [event],
            snapshot.community.communityId,
            plan.descriptors.filter(descriptor => targetKindSet.has(descriptor.kind)),
          ).length > 0
        )
      }

      return (
        filterAuthorizedCommunityDescriptorEvents(
          [event],
          snapshot.community.communityId,
          descriptorInfos,
        ).length > 0
      )
    }
    const originalRelays = normalizeRelays([...snapshot.relays, ...plan.originalRelayHints])
    const cachedEvents = queryCachedBridgeEvents(plan.localOriginalFilters)
    const loadedResult = await loadBridgeEventsWithCursorPagination({
      relays: originalRelays,
      relayFilters: plan.relayOriginalFilters,
      localFilters: plan.localOriginalFilters,
      admitEvent: admitsOriginalEvent,
      pageSize: descriptorPageSize,
      authenticate: true,
      priorityAuthRelays: snapshot.relayHints,
    })
    const admittedOriginalEvents = dedupeEvents([...cachedEvents, ...loadedResult.events]).filter(
      event => matchFilters(plan.localOriginalFilters, event) && admitsOriginalEvent(event),
    )
    const events = sortCommunityQueryEvents(
      filterCommunityCalendarWindow(
        filterCommunityDescriptorEvents(
          dedupeEvents([...exactRefEvents, ...admittedOriginalEvents]) as any,
          snapshot.community.communityId,
          plan.descriptors,
        ),
        request.calendarStart,
        request.calendarDate,
      ),
    )
    const complete = loadedTargetingResult.complete && loadedResult.complete
    const page = makeCommunityQueryPage(events, request.limit, complete)
    const limitedEvents = page.events

    if (
      !request.calendarStart &&
      limitedEvents.length < request.limit &&
      (!loadedTargetingResult.complete || !loadedResult.complete)
    ) {
      throw makeCommunityQueryTimeoutError()
    }

    if (ext) {
      console.log(`[bridge] community:queryEvents result from ${ext.id}`, {
        refs: request.refs || [],
        exactRefEventCount: exactRefEvents.length,
        cachedEventCount: cachedEvents.length,
        loadedEventCount: loadedResult.events.length,
        returnedEventCount: limitedEvents.length,
        localFilterCount: plan.localOriginalFilters.length,
        relayFilterCount: plan.relayOriginalFilters.length,
        originalRelays,
        returnedRefs: limitedEvents.slice(0, 10).map((event: any) => ({
          id: event.id,
          address: getBridgeEventAddress(event),
          kind: event.kind,
          pubkey: normalizePubkey(event.pubkey || ""),
          title: getBridgeEventTagValue(event, "title") || getBridgeEventTagValue(event, "name"),
        })),
      })
    }

    return {
      status: "ok",
      ...page,
      relays: snapshot.relays,
      descriptors: plan.descriptors,
      contextSessionId: snapshot.contextSessionId,
      contextVersion: snapshot.contextVersion,
    }
  } catch (err: any) {
    if (!isCommunityLoadingError(err)) {
      console.error("Error in community:queryEvents bridge handler:", err)
    }
    return {error: err.message, ...(err.code ? {code: err.code} : {})}
  }
})

registerBridgeHandler("community:queryLiveStreams", async (payload, ext) => {
  if (ext) console.log(`[bridge] community:queryLiveStreams from ${ext.id}`, payload)
  try {
    const request = normalizeCommunityQueryLiveStreamsPayload(payload)
    const snapshot = await getHydratedCommunityRequestSnapshot(ext)
    const descriptorInfos = resolveCommunityEventDescriptors({
      definition: snapshot.definition,
      profileListEvents: snapshot.profileListEvents,
      reportState: snapshot.reportState,
      descriptors: request.descriptors,
    })
    const moderatorPubkeys = new Set(
      descriptorInfos
        .flatMap(info => info.moderatorPubkeys)
        .map(normalizePubkey)
        .filter(Boolean),
    )
    const trustedProviderPubkeys = Array.from(TRUSTED_LIVE_STREAM_PROVIDER_PUBKEYS)
    const queryWindow = {
      ...(request.since ? {since: request.since} : {}),
      ...(request.until ? {until: request.until} : {}),
      limit: MAX_NOSTR_QUERY_LIMIT,
    }
    const filters: Record<string, unknown>[] = []

    if (moderatorPubkeys.size > 0) {
      filters.push({
        kinds: [LIVE_STREAM_KIND],
        authors: Array.from(moderatorPubkeys),
        ...queryWindow,
      })
    }
    if (trustedProviderPubkeys.length > 0 && moderatorPubkeys.size > 0) {
      filters.push({
        kinds: [LIVE_STREAM_KIND],
        authors: trustedProviderPubkeys,
        ...queryWindow,
      })
    }

    const communityId = snapshot.community.communityId
    const selectEvents = (events: any[]) =>
      selectAuthorizedLiveStreams({
        events,
        moderatorPubkeys,
        communityId,
        since: request.since,
        until: request.until,
        limit: request.limit || 100,
      })
    const cachedEvents = queryCachedBridgeEvents(filters)
    const cachedStreams = selectEvents(cachedEvents)

    if (cachedStreams.length > 0) {
      void loadBridgeEventsWithStatus({
        relays: snapshot.relays,
        filters,
        authenticate: true,
        priorityAuthRelays: snapshot.relayHints,
      })

      return {
        status: "ok",
        events: cachedStreams,
        relays: snapshot.relays,
        descriptors: descriptorInfos.map(info => info.descriptor),
        contextSessionId: snapshot.contextSessionId,
        contextVersion: snapshot.contextVersion,
      }
    }

    const loadedResult = await loadBridgeEventsWithStatus({
      relays: snapshot.relays,
      filters,
      authenticate: true,
      priorityAuthRelays: snapshot.relayHints,
    })
    const events = selectEvents([...cachedEvents, ...loadedResult.events])

    if (events.length === 0 && !loadedResult.complete) throw makeCommunityQueryTimeoutError()

    return {
      status: "ok",
      events,
      relays: snapshot.relays,
      descriptors: descriptorInfos.map(info => info.descriptor),
      contextSessionId: snapshot.contextSessionId,
      contextVersion: snapshot.contextVersion,
    }
  } catch (err: any) {
    if (!isCommunityLoadingError(err)) {
      console.error("Error in community:queryLiveStreams bridge handler:", err)
    }
    return {error: err.message, ...(err.code ? {code: err.code} : {})}
  }
})

registerBridgeHandler("community:querySharedConfig", async (payload, ext) => {
  if (ext) console.log(`[bridge] community:querySharedConfig from ${ext.id}`, payload)
  try {
    const request = normalizeCommunitySharedConfigScope(payload)
    const snapshot = await getHydratedCommunityRequestSnapshot(ext)
    const resolved = resolveCommunityEventDescriptors({
      definition: snapshot.definition,
      profileListEvents: snapshot.profileListEvents,
      reportState: snapshot.reportState,
      userPubkey: snapshot.userPubkey,
      descriptors: request.descriptors,
    })
    const moderatorAuthors = Array.from(
      new Set(
        resolved
          .flatMap(info => info.moderatorPubkeys)
          .map(normalizePubkey)
          .filter(Boolean),
      ),
    ).sort()
    const identifier = makeCommunitySharedConfigIdentifier({
      definition: snapshot.definition,
      namespace: request.namespace,
      key: request.key,
    })
    const sharedConfigRelays =
      snapshot.publishRelays.length > 0 ? snapshot.publishRelays : snapshot.relays
    const sharedConfigFilter = {
      kinds: [COMMUNITY_SHARED_CONFIG_KIND],
      authors: moderatorAuthors,
      "#d": [identifier],
      limit: request.limit,
    }
    const refreshKey = JSON.stringify([
      identifier,
      resolved.map(info => getCommunitySharedConfigDescriptorKey(info.descriptor)).sort(),
      moderatorAuthors,
      sharedConfigRelays.slice().sort(),
    ])
    const refreshedResult = sharedConfigRefreshCache.getLatest(refreshKey)
    const cachedEvents = dedupeEvents([
      ...queryCachedCommunitySharedConfigEvents({
        identifier,
        authors: moderatorAuthors,
        limit: request.limit,
      }),
      ...(refreshedResult?.events || []),
    ])
    const cachedSelected = selectCommunitySharedConfigEvent(cachedEvents, resolved)

    if (cachedSelected) {
      void refreshCommunitySharedConfig({
        refreshKey,
        relays: sharedConfigRelays,
        relayHints: snapshot.relayHints,
        filter: sharedConfigFilter,
      })
      if (ext) {
        console.log(`[bridge] community:querySharedConfig result from ${ext.id}`, {
          source: "cache",
          hasConfig: true,
          eventId: cachedSelected.id,
          author: cachedSelected.pubkey,
          moderatorPubkeyCount: moderatorAuthors.length,
        })
      }

      return {
        status: "ok",
        event: cachedSelected,
        config: parseSharedConfigContent(cachedSelected),
        relays: sharedConfigRelays,
        contextSessionId: snapshot.contextSessionId,
        contextVersion: snapshot.contextVersion,
      }
    }

    const loadedResult = await refreshCommunitySharedConfig({
      refreshKey,
      relays: sharedConfigRelays,
      relayHints: snapshot.relayHints,
      filter: sharedConfigFilter,
    })
    const selected = selectCommunitySharedConfigEvent(
      dedupeEvents([...cachedEvents, ...loadedResult.events]),
      resolved,
    )

    if (!selected && !loadedResult.complete) throw makeCommunityQueryTimeoutError()

    if (ext) {
      console.log(`[bridge] community:querySharedConfig result from ${ext.id}`, {
        source: "relay",
        hasConfig: Boolean(selected),
        eventId: selected?.id,
        author: selected?.pubkey,
        cachedEventCount: cachedEvents.length,
        loadedEventCount: loadedResult.events.length,
        moderatorPubkeyCount: moderatorAuthors.length,
      })
    }

    return {
      status: "ok",
      ...(selected ? {event: selected, config: parseSharedConfigContent(selected)} : {}),
      relays: sharedConfigRelays,
      contextSessionId: snapshot.contextSessionId,
      contextVersion: snapshot.contextVersion,
    }
  } catch (err: any) {
    if (!isCommunityLoadingError(err)) {
      console.error("Error in community:querySharedConfig bridge handler:", err)
    }
    return {error: err.message, ...(err.code ? {code: err.code} : {})}
  }
})

registerBridgeHandler("community:publishSharedConfig", async (payload, ext) => {
  if (ext) console.log(`[bridge] community:publishSharedConfig from ${ext.id}`, payload)
  try {
    const request = normalizeCommunityPublishSharedConfigPayload(payload)
    const snapshot = await getHydratedCommunityRequestSnapshot(ext)
    const normalizedUser = normalizePubkey(snapshot.userPubkey)

    if (snapshot.publishRelays.length === 0) {
      throw makeCommunityContextNotReadyError(
        "Community definition must declare relays before publishing",
      )
    }

    if (!normalizedUser) {
      throw Object.assign(new Error("Login required to publish shared community config"), {
        code: "LOGIN_REQUIRED",
      })
    }

    const resolved = resolveCommunityEventDescriptors({
      definition: snapshot.definition,
      profileListEvents: snapshot.profileListEvents,
      reportState: snapshot.reportState,
      userPubkey: normalizedUser,
      descriptors: request.descriptors,
    })
    const canModerate = resolved.some(info => info.capability.canModerate)

    if (!canModerate) {
      throw Object.assign(
        new Error("Current user is not a moderator for the requested community descriptors"),
        {code: "FORBIDDEN"},
      )
    }

    const identifier = makeCommunitySharedConfigIdentifier({
      definition: snapshot.definition,
      namespace: request.namespace,
      key: request.key,
    })
    const event = {
      kind: COMMUNITY_SHARED_CONFIG_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify(request.config),
      tags: [
        ["d", identifier],
        ["a", snapshot.definition.pointer.address],
        ["namespace", request.namespace],
        ["key", request.key],
        ...request.descriptors.map(descriptor =>
          descriptor.subtype
            ? ["descriptor", String(descriptor.kind), descriptor.subtype]
            : ["descriptor", String(descriptor.kind)],
        ),
      ],
    }
    await authenticateCommunityRelays(snapshot.publishRelays, {
      priorityRelays: snapshot.relayHints,
    })

    if (request.expectedRevision !== undefined) {
      const moderatorAuthors = Array.from(
        new Set(
          resolved
            .flatMap(info => info.moderatorPubkeys)
            .map(normalizePubkey)
            .filter(Boolean),
        ),
      ).sort()
      const filter = {
        kinds: [COMMUNITY_SHARED_CONFIG_KIND],
        authors: moderatorAuthors,
        "#d": [identifier],
        limit: MAX_NOSTR_QUERY_LIMIT,
      }
      const cachedEvents = queryCachedCommunitySharedConfigEvents({
        identifier,
        authors: moderatorAuthors,
        limit: MAX_NOSTR_QUERY_LIMIT,
      })
      const loadedResult = await loadBridgeEventsWithStatus({
        relays: snapshot.publishRelays,
        filters: [filter],
        authenticate: true,
        priorityAuthRelays: snapshot.relayHints,
        settle: "all",
      })
      if (!loadedResult.complete) throw makeCommunityQueryTimeoutError()

      const selected = selectCommunitySharedConfigEvent(
        dedupeEvents([...cachedEvents, ...loadedResult.events]),
        resolved,
      )
      const currentRevision = selected?.id || null
      if (currentRevision !== request.expectedRevision) {
        throw Object.assign(new Error("Shared community config changed before publishing"), {
          code: "CONFIG_REVISION_CONFLICT",
        })
      }
    }

    const thunk = (publishThunk as any)({event, relays: snapshot.publishRelays})
    await thunk.complete
    const successCount = Object.values(thunk.results || {}).filter(
      (result: any) => result?.status === PublishStatus.Success,
    ).length
    if (successCount === 0) {
      throw new Error("Shared community config was not accepted by any relay")
    }

    return {
      status: "ok",
      eventId: thunk.event?.id,
      relays: snapshot.publishRelays,
      successCount,
      contextSessionId: snapshot.contextSessionId,
      contextVersion: snapshot.contextVersion,
    }
  } catch (err: any) {
    console.error("Error in community:publishSharedConfig bridge handler:", err)
    return {error: err.message, ...(err.code ? {code: err.code} : {})}
  }
})

registerBridgeHandler("ui:toast", (payload, ext) => {
  // if (ext) console.log(`[bridge] ui:toast from ${ext.id}`, payload)
  try {
    const {message, type = "info"} = payload || {}
    if (message) pushToast({theme: type, message})
    return {status: "ok"}
  } catch (err: any) {
    console.error("Error in ui:toast bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("ui:notify", async (payload, ext) => {
  if (ext) console.log(`[bridge] ui:notify from ${ext.id}`)
  try {
    const {title, body, tag} = payload || {}
    if (!title || typeof title !== "string") return {error: "title is required"}
    const bodyText = typeof body === "string" ? body : undefined
    const tagText = typeof tag === "string" ? tag : undefined
    if (typeof Notification !== "undefined") {
      let permission = Notification.permission
      if (permission === "default") {
        permission = await Notification.requestPermission().catch(() => "denied" as const)
      }
      if (permission === "granted") {
        new Notification(title, {body: bodyText, tag: tagText})
        return {status: "ok", delivery: "notification"}
      }
    }
    pushToast({theme: "info", message: bodyText ? `${title} — ${bodyText}` : title})
    return {status: "ok", delivery: "toast"}
  } catch (err: any) {
    console.error("Error in ui:notify bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("ui:navigate", async (payload, ext) => {
  // if (ext) console.log(`[bridge] ui:navigate from ${ext.id}`, payload)
  try {
    const path = typeof payload?.path === "string" ? payload.path.trim() : ""
    if (!path || !path.startsWith("/") || path.startsWith("//")) {
      throw new Error("Invalid navigation path")
    }

    // Let the bridge acknowledge the request before navigation destroys the
    // widget iframe that initiated it.
    setTimeout(() => {
      void goto(path).catch(err => console.error("Error in deferred widget navigation:", err))
    }, 0)
    return {status: "ok"}
  } catch (err: any) {
    console.error("Error in ui:navigate bridge handler:", err)
    return {error: err.message || "Navigation failed"}
  }
})

registerBridgeHandler("ui:resize", (payload, ext) => {
  // if (ext) console.log(`[bridge] ui:resize from ${ext.id}`, payload)
  try {
    const resize = normalizeUiResizePayload(payload)
    if (ext.type === "widget") ext.onResizeRequest?.(resize)
    return {status: "ok"}
  } catch (err: any) {
    console.error("Error in ui:resize bridge handler:", err)
    return {error: err.message}
  }
})

// Storage handlers are scoped by encoded extension/widget line ID and optional repo address.
const STORAGE_PREFIX = "budabit:extension:"
const V2_STORAGE_PREFIX = "budabit:ext:v2:"
const FLOTILLA_STORAGE_PREFIX = "flotilla:ext:"
const encodeStorageComponent = (value: string): string => encodeURIComponent(value)

const decodeStorageComponent = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const getExtensionStorageKeyPrefix = (
  ext: LoadedExtension,
  repoScoped: boolean,
  prefix = STORAGE_PREFIX,
): string => {
  if (prefix === FLOTILLA_STORAGE_PREFIX) {
    const base = `${prefix}${ext.id}:`
    return repoScoped && ext.repoContext
      ? `${base}repo:${ext.repoContext.pubkey}:${ext.repoContext.name}:`
      : base
  }
  const base = `${prefix}${encodeStorageComponent(ext.id)}:`

  if (repoScoped && ext.repoContext) {
    return `${base}repo:${encodeStorageComponent(getRepoAddress(ext.repoContext))}:`
  }

  return `${base}global:`
}

const getExtensionStorageKey = (ext: LoadedExtension, repoScoped: boolean, key: string): string =>
  `${getExtensionStorageKeyPrefix(ext, repoScoped)}${encodeStorageComponent(key)}`

const getExtensionStorageLocations = (ext: LoadedExtension, repoScoped: boolean, key: string) => [
  getExtensionStorageKey(ext, repoScoped, key),
  `${getExtensionStorageKeyPrefix(ext, repoScoped, V2_STORAGE_PREFIX)}${encodeStorageComponent(key)}`,
  `${getExtensionStorageKeyPrefix(ext, repoScoped, FLOTILLA_STORAGE_PREFIX)}${key}`,
]

const removeStorageKey = (ext: LoadedExtension, repoScoped: boolean, key: string): void => {
  for (const storageKey of getExtensionStorageLocations(ext, repoScoped, key)) {
    localStorage.removeItem(storageKey)
  }
}

registerBridgeHandler("storage:get", (payload, ext) => {
  if (ext) console.log(`[bridge] storage:get from ${ext.id}`, payload)
  try {
    assertExpectedScope(payload, ext)
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
    const locations = getExtensionStorageLocations(ext, repoScoped, key)
    const sourceIndex = locations.findIndex(location => localStorage.getItem(location) !== null)
    const raw = sourceIndex >= 0 ? localStorage.getItem(locations[sourceIndex]) : null
    const data = raw !== null ? JSON.parse(raw) : null
    if (raw !== null && sourceIndex > 0) {
      localStorage.setItem(locations[0], raw)
      for (const location of locations.slice(1)) localStorage.removeItem(location)
    }
    return {status: "ok", data}
  } catch (err: any) {
    console.error("Error in storage:get bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("storage:set", (payload, ext) => {
  if (ext) console.log(`[bridge] storage:set from ${ext.id}`, payload)
  try {
    assertExpectedScope(payload, ext)
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
    if (new TextEncoder().encode(serialized).byteLength > MAX_STORAGE_VALUE_SIZE) {
      throw new Error(`Value exceeds maximum size of ${MAX_STORAGE_VALUE_SIZE} bytes`)
    }
    localStorage.setItem(getExtensionStorageKey(ext, repoScoped, key), serialized)
    for (const legacyKey of getExtensionStorageLocations(ext, repoScoped, key).slice(1)) {
      localStorage.removeItem(legacyKey)
    }
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
    const storagePrefixes = [
      {value: getExtensionStorageKeyPrefix(ext, repoScoped), encoded: true},
      {value: getExtensionStorageKeyPrefix(ext, repoScoped, V2_STORAGE_PREFIX), encoded: true},
      {
        value: getExtensionStorageKeyPrefix(ext, repoScoped, FLOTILLA_STORAGE_PREFIX),
        encoded: false,
      },
    ]
    const keys = new Set<string>()

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue

      for (const prefix of storagePrefixes) {
        if (!key.startsWith(prefix.value)) continue
        const logicalKey = key.slice(prefix.value.length)
        if (!repoScoped && !prefix.encoded && logicalKey.startsWith("repo:")) continue
        keys.add(prefix.encoded ? decodeStorageComponent(logicalKey) : logicalKey)
        break
      }
    }

    return {status: "ok", keys: Array.from(keys).sort()}
  } catch (err: any) {
    console.error("Error in storage:keys bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("repo:listFiles", async (payload, ext) => {
  if (ext) console.log(`[bridge] repo:listFiles from ${ext.id}`)
  try {
    const repo = getActiveRepo()
    const path = normalizeRepoPath(payload?.path)
    const resolvedBranch = payload?.branch || repo.selectedBranch || repo.mainBranch || "main"
    const filesResult = await repo.listRepoFiles({path, branch: resolvedBranch})
    const files = Array.isArray(filesResult?.files)
      ? filesResult.files
          .filter(
            (file: any) =>
              typeof file?.path === "string" &&
              (file?.type === "file" || file?.type === "directory"),
          )
          .map((file: any) => ({path: file.path, type: file.type}))
      : []

    return {
      status: "ok",
      files,
      ...getRepoBranchesPayload(repo, resolvedBranch),
    }
  } catch (err: any) {
    console.error("Error in repo:listFiles bridge handler:", err)
    return {error: err.message}
  }
})

registerBridgeHandler("repo:getFile", async (payload, ext) => {
  if (ext) console.log(`[bridge] repo:getFile from ${ext.id}`)
  try {
    const repo = getActiveRepo()
    const path = normalizeRepoPath(payload?.path)
    if (!path) {
      throw new Error("Invalid repository file path")
    }

    const resolvedBranch = payload?.branch || repo.selectedBranch || repo.mainBranch || "main"
    const fileResult = await repo.getFileContent({path, branch: resolvedBranch})

    return {
      status: "ok",
      path,
      content: typeof fileResult?.content === "string" ? fileResult.content : "",
      resolvedBranch,
    }
  } catch (err: any) {
    console.error("Error in repo:getFile bridge handler:", err)
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
        displayName: ext.repoContext.displayName,
        naddr: ext.repoContext.naddr,
        relays: ext.repoContext.relays,
        maintainers: ext.repoContext.maintainers,
        address: getRepoAddress(ext.repoContext), // Canonical "30617:pubkey:name" format
        // The push-based context:update event is the primary carrier of the
        // signed-in user's pubkey, but it can be lost if the host sends it
        // before the widget's listeners are registered. Widgets recover via
        // this polled response, so it must carry userPubkey too — otherwise
        // they render fine but stay permanently "not signed in".
        userPubkey: get(activeUserPubkey) || undefined,
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
    assertDeclaredWriteKind(template.kind, ext)
    assertExpectedScope(payload, ext, true)
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
    assertExpectedScope(payload, ext, true)
    if (payload.expectedPubkey !== undefined && signed.pubkey !== payload.expectedPubkey)
      throw new Error("Signer returned a different account")
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

/**
 * Post an event to an extension's iframe.
 * Uses the same mechanism as ExtensionBridge.post() but callable from handlers.
 */
function postEventToExtension(ext: LoadedExtension, action: string, payload: any): void {
  const targetWindow = ext.iframe?.contentWindow
  if (!targetWindow) return
  const isSandboxed = ext.origin === "null"
  const targetOrigin = isSandboxed ? "*" : ext.origin
  safePostMessage(targetWindow, {type: "event", action, payload}, targetOrigin)
}

/**
 * Clean up all subscriptions for an extension.
 * Called when the extension is unloaded.
 */
export function cleanupExtensionSubscriptions(extId: string): void {
  extensionSubscriptionRegistry.cleanupExtension(extId)
}

registerBridgeHandler("nostr:subscribe", async (payload, ext) => {
  if (ext) console.log(`[bridge] nostr:subscribe from ${ext.id}`, payload)
  try {
    const {relays, filter} = parseNostrQueryPayload(payload, getDeclaredNostrKinds(ext))

    const subId = extensionSubscriptionRegistry.subscribe({
      extensionId: ext.id,
      relays,
      filters: [filter as any],
      onEvent(subscriptionId, event) {
        postEventToExtension(ext, "nostr:subscription:event", {
          subscriptionId,
          event,
        })
      },
      onEose(subscriptionId, relay) {
        postEventToExtension(ext, "nostr:eose", {subscriptionId, relay})
      },
    })

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

    if (extensionSubscriptionRegistry.unsubscribe(ext.id, subscriptionId)) {
      console.log(`[bridge] closed subscription ${subscriptionId}`)
    }

    return {status: "ok"}
  } catch (err: any) {
    console.error("Error in nostr:unsubscribe bridge handler:", err)
    return {error: err.message}
  }
})
