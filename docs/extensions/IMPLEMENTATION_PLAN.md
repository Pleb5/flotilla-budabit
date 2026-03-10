# Extensions Architecture: Implementation Plan

> Derived from [EXTENSIONS_AUDIT.md](./EXTENSIONS_AUDIT.md) — 37 findings across the Flotilla extension system.
> Goal: production-ready Nostr-native extension loading from relay events + hosted extensions.

## Core Principle

Nostr is a pub/sub protocol with persistent connections to relays, EOSE signaling, and real-time event delivery. The extension system must be built on this model — not on stateless request/response patterns.

**Dependency Boundary:**
- **Extensions (iframes):** depend only on `nostr-tools`. No relay connections. All Nostr operations go through the postMessage bridge.
- **Host bridge (bridge.ts):** routes all extension Nostr operations through welshman. Manages subscriptions, tracks per-extension state, handles cleanup.
- **Welshman relay pool:** shared connections, NIP-42 auth, connection pooling, event cache — benefits all extensions transparently.

---

## Table of Contents

1. [Phase 1 — Nostr-Native Foundation](#phase-1--nostr-native-foundation)
2. [Phase 2 — Extension Framework Cleanup](#phase-2--extension-framework-cleanup)
3. [Phase 3 — Production Reliability](#phase-3--production-reliability)
4. [Phase 4 — Ecosystem Scale](#phase-4--ecosystem-scale)
5. [Phase 5 — Polish & Completeness](#phase-5--polish--completeness)
6. [Extension Implementation Updates](#extension-implementation-updates)
7. [Migration Strategy](#migration-strategy)
8. [Dependency Graph](#dependency-graph)

---

## Phase 1 — Nostr-Native Foundation

These items address the fundamental architectural mismatch. All other phases build on this foundation.

### 1.1 Replace `SimplePool` with Welshman Relay Integration
**Findings:** #0a
**Files:** `src/app/extensions/bridge.ts`
**Risk:** High — changes how all extension Nostr operations are routed. Requires careful testing.

The bridge currently imports `SimplePool` from `nostr-tools/pool` and creates a standalone pool that is completely disconnected from the application's welshman relay infrastructure. All bridge handlers that touch Nostr (`nostr:query`, `nostr:publish`) must be refactored to use welshman.

**Changes:**

1. **Remove the standalone pool:**
```typescript
// DELETE:
import {SimplePool} from "nostr-tools/pool"
const pool = new SimplePool()
```

2. **Import welshman APIs:**
```typescript
import {load, request, publish} from "@welshman/net"
import {repository} from "@welshman/app"
```

3. **Refactor `nostr:query` to use welshman's `load()`:**
```typescript
registerBridgeHandler("nostr:query", async (payload, ext) => {
  const allowedKinds = resolveAllowedKinds(ext)
  const {relays, filter} = parseNostrQueryPayload(payload, allowedKinds)

  // load() sends REQ, collects events until EOSE, then resolves.
  // No artificial timeout needed — EOSE is the protocol's own signal.
  try {
    await load({relays, filters: [filter]})
  } catch (err: any) {
    console.warn(`[bridge] nostr:query load error from ${ext.id}:`, err)
  }

  // Query welshman's local repository cache for matching events
  const events = repository.query([filter])
  return {status: "ok", events}
})
```

Note: `load()` handles EOSE properly. A safety-net timeout can be added via `AbortController`/`signal` if needed, but the 8-second hardcoded timeout is eliminated. If a timeout is kept as a safety net, return `{status: "timeout"}` not `{status: "ok"}`.

4. **Refactor `nostr:publish` to use welshman:**
```typescript
registerBridgeHandler("nostr:publish", async (payload, ext) => {
  const {event, relays} = parseNostrPublishPayload(payload)

  if (relays && relays.length > 0 && event?.id && event?.sig) {
    // Pre-signed event — publish directly to specified relays
    const result = await publish({event, relays})
    return {status: "ok", result}
  }

  // Unsigned event — use publishThunk which handles signing
  const result = await publishThunk(event)
  return {status: "ok", result}
})
```

**Benefits:**
- Extensions share the app's relay connections (no duplicate connections)
- Extensions benefit from NIP-42 auth automatically
- Events fetched by extensions are cached in welshman's repository (other parts of the app can see them)
- Relay selection can leverage welshman's Router intelligence
- Connection lifecycle is managed centrally

**Dependencies:** None
**Migration:** Transparent to extensions — the bridge API doesn't change, only the implementation behind it.

---

### 1.2 Implement `nostr:subscribe` as a First-Class Bridge Action
**Findings:** #0c, #32
**Files:** `src/app/extensions/bridge.ts`, `src/app/extensions/registry.ts`
**Risk:** Medium — new capability, but no existing code depends on it.

This is the most important new feature. Extensions must be able to maintain open subscriptions to receive real-time events — this is Nostr's fundamental interaction model.

**Changes:**

1. **Add subscription tracking to the bridge module:**
```typescript
// Per-extension subscription tracking
const activeSubscriptions = new Map<string, Map<string, AbortController>>()

const trackSubscription = (
  extId: string,
  subscriptionId: string,
  controller: AbortController,
): void => {
  if (!activeSubscriptions.has(extId)) {
    activeSubscriptions.set(extId, new Map())
  }
  activeSubscriptions.get(extId)!.set(subscriptionId, controller)
}

const removeSubscription = (extId: string, subscriptionId: string): void => {
  const subs = activeSubscriptions.get(extId)
  if (!subs) return
  const controller = subs.get(subscriptionId)
  if (controller) {
    controller.abort()
    subs.delete(subscriptionId)
  }
  if (subs.size === 0) activeSubscriptions.delete(extId)
}

// Clean up ALL subscriptions for an extension (called on unload)
export const cleanupExtensionSubscriptions = (extId: string): void => {
  const subs = activeSubscriptions.get(extId)
  if (!subs) return
  for (const [, controller] of subs) {
    controller.abort()
  }
  activeSubscriptions.delete(extId)
}
```

2. **Implement `nostr:subscribe` handler:**
```typescript
registerBridgeHandler("nostr:subscribe", async (payload, ext) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload")
  }

  const {subscriptionId, relays: relaysRaw, filter: filterRaw} = payload
  if (!subscriptionId || typeof subscriptionId !== "string") {
    throw new Error("subscriptionId required (string)")
  }

  // Validate relays and filter using existing helpers
  const allowedKinds = resolveAllowedKinds(ext)
  const relays = normalizeRelayUrls(relaysRaw)
  if (relays.length === 0) throw new Error("No valid relays")
  const filter = normalizeNostrFilter(filterRaw, allowedKinds)

  // Check for duplicate subscriptionId
  const existingSubs = activeSubscriptions.get(ext.id)
  if (existingSubs?.has(subscriptionId)) {
    throw new Error(`Subscription ${subscriptionId} already exists`)
  }

  // Create the subscription via welshman
  const controller = new AbortController()

  request({
    relays,
    filters: [filter],
    signal: controller.signal,
    onEvent: (event) => {
      // Deliver events to the extension via bridge
      ext.bridge?.post("nostr:event", {subscriptionId, event})
    },
    onEose: (url) => {
      // Signal end of stored events for this relay
      ext.bridge?.post("nostr:eose", {subscriptionId, relay: url})
    },
  })

  trackSubscription(ext.id, subscriptionId, controller)

  return {status: "ok", subscriptionId}
})
```

3. **Implement `nostr:unsubscribe` handler:**
```typescript
registerBridgeHandler("nostr:unsubscribe", (payload, ext) => {
  const {subscriptionId} = payload || {}
  if (!subscriptionId) throw new Error("subscriptionId required")
  removeSubscription(ext.id, subscriptionId)
  return {status: "ok"}
})
```

4. **Wire cleanup into `ExtensionRegistry.unloadExtension()`:**
```typescript
async unloadExtension(id: string): Promise<void> {
  const ext = this.get(id)
  if (!ext) return

  // Clean up all active subscriptions FIRST
  cleanupExtensionSubscriptions(id)

  // Then lifecycle cleanup...
  if (ext.bridge) {
    ext.bridge.post("widget:unmounting", {timestamp: Date.now()})
    await new Promise(resolve => setTimeout(resolve, 100))
    ext.bridge.detach()
  }
  // ...
}
```

5. **Add permissions enforcement:**
`nostr:subscribe` is a privileged action — it's already covered by `isPrivileged()` checking for `nostr:` prefix. Extensions must declare `"nostr:subscribe"` in their permissions.

**Extension-side usage (nostr-tools only):**
```typescript
// Extension code — depends only on nostr-tools + bridge client
const subscriptionId = crypto.randomUUID()

// Request subscription via bridge
const result = await bridge.request("nostr:subscribe", {
  subscriptionId,
  relays: ["wss://relay.example.com"],
  filter: {kinds: [30301], "#d": ["my-board"]},
})

// Listen for events delivered by the host
bridge.on("nostr:event", ({subscriptionId: sid, event}) => {
  if (sid === subscriptionId) {
    // Handle real-time event — pure nostr-tools event object
    console.log("New event:", event)
  }
})

// Listen for EOSE
bridge.on("nostr:eose", ({subscriptionId: sid, relay}) => {
  if (sid === subscriptionId) {
    console.log("End of stored events from", relay)
  }
})

// Clean up when done
bridge.request("nostr:unsubscribe", {subscriptionId})
```

**Dependencies:** 1.1 (welshman integration — `request()` API needed)
**Migration:** Additive — existing extensions aren't affected. Huddle can now actually use the `nostr:subscribe` it already declares.

---

### 1.3 Convert Extension Discovery to Persistent Subscriptions
**Findings:** #0d, #16, #18, #20
**Files:** `src/app/core/commands.ts`, `src/app/extensions/provider.svelte` (or new file `src/app/extensions/discovery.ts`)
**Risk:** Medium — changes discovery from one-shot functions to reactive stores.

**Changes:**

1. **Create a new discovery service** (`src/app/extensions/discovery.ts`):
```typescript
import {writable, derived} from "svelte/store"
import {request, load} from "@welshman/net"
import {repository} from "@welshman/app"
import {parseSmartWidget} from "./registry"
import {INDEXER_RELAYS, SMART_WIDGET_RELAYS, EXTENSIONS_KIND} from "@app/core/state"
import type {ExtensionManifest, SmartWidgetEvent} from "./types"

const SMART_WIDGET_KIND = 30033

// Reactive stores for discovered extensions
export const discoveredManifests = writable<Map<string, ExtensionManifest>>(new Map())
export const discoveredWidgets = writable<Map<string, SmartWidgetEvent>>(new Map())
export const discoveryActive = writable(false)

let discoveryController: AbortController | null = null

/**
 * Start persistent discovery subscriptions.
 * Call once at app startup. Returns a cleanup function.
 */
export const startDiscovery = (): (() => void) => {
  discoveryController?.abort()
  discoveryController = new AbortController()
  const signal = discoveryController.signal

  discoveryActive.set(true)

  // --- NIP-89 Extension Discovery (kind 31990) ---

  // Initial load of stored events
  load({
    relays: INDEXER_RELAYS,
    filters: [{kinds: [EXTENSIONS_KIND], limit: 200}],
  }).then(() => {
    // Process cached events
    const events = repository.query([{kinds: [EXTENSIONS_KIND]}])
    const manifests = new Map<string, ExtensionManifest>()
    for (const ev of events) {
      try {
        const m = JSON.parse(ev.content)
        if (m?.id && m?.name && m?.entrypoint) {
          const existing = manifests.get(m.id)
          // Keep newest by created_at (fixes dedup bug)
          if (!existing || ev.created_at > (existing as any)._created_at) {
            manifests.set(m.id, {...m, _created_at: ev.created_at})
          }
        }
      } catch { /* ignore malformed */ }
    }
    discoveredManifests.set(manifests)
  }).catch(e => console.warn("Extension discovery initial load:", e))

  // Persistent subscription for new/updated extensions
  request({
    relays: INDEXER_RELAYS,
    filters: [{kinds: [EXTENSIONS_KIND]}],
    signal,
    onEvent: (event) => {
      try {
        const m = JSON.parse(event.content)
        if (m?.id && m?.name && m?.entrypoint) {
          discoveredManifests.update(map => {
            const existing = map.get(m.id)
            if (!existing || event.created_at > ((existing as any)._created_at ?? 0)) {
              map.set(m.id, {...m, _created_at: event.created_at})
            }
            return new Map(map)
          })
        }
      } catch { /* ignore */ }
    },
  })

  // --- Smart Widget Discovery (kind 30033) ---

  load({
    relays: SMART_WIDGET_RELAYS,
    filters: [{kinds: [SMART_WIDGET_KIND], limit: 200}],
  }).then(() => {
    const events = repository.query([{kinds: [SMART_WIDGET_KIND]}])
    const widgets = new Map<string, SmartWidgetEvent>()
    for (const ev of events) {
      try {
        const w = parseSmartWidget(ev)
        const existing = widgets.get(w.identifier)
        if (!existing || (w.created_at ?? 0) > (existing.created_at ?? 0)) {
          widgets.set(w.identifier, w)
        }
      } catch { /* ignore */ }
    }
    discoveredWidgets.set(widgets)
  }).catch(e => console.warn("Widget discovery initial load:", e))

  // Persistent subscription for new/updated widgets
  request({
    relays: SMART_WIDGET_RELAYS,
    filters: [{kinds: [SMART_WIDGET_KIND]}],
    signal,
    onEvent: (event) => {
      try {
        const w = parseSmartWidget(event)
        discoveredWidgets.update(map => {
          const existing = map.get(w.identifier)
          if (!existing || (w.created_at ?? 0) > (existing.created_at ?? 0)) {
            map.set(w.identifier, w)
          }
          return new Map(map)
        })
      } catch { /* ignore */ }
    },
  })

  return () => {
    discoveryController?.abort()
    discoveryController = null
    discoveryActive.set(false)
  }
}

// Derived convenience stores
export const discoveredManifestList = derived(discoveredManifests, m => Array.from(m.values()))
export const discoveredWidgetList = derived(discoveredWidgets, m => Array.from(m.values()))
```

2. **Start discovery in the app's sync setup** (alongside other persistent subscriptions in `sync.ts`):
```typescript
import {startDiscovery} from "@app/extensions/discovery"

// In sync initialization:
const stopDiscovery = startDiscovery()
// Returns cleanup function
```

3. **Refactor the settings page** to consume reactive stores instead of calling one-shot functions:
```svelte
<script lang="ts">
  import {discoveredManifestList, discoveredWidgetList, discoveryActive} from "@app/extensions/discovery"

  // Replace:
  // let discovered = $state<ExtensionManifest[]>([])
  // let discoveredWidgets = $state<SmartWidgetEvent[]>([])
  // With reactive stores:
  const discovered = $derived($discoveredManifestList)
  const discoveredWidgets = $derived($discoveredWidgetList)
  const loading = $derived($discoveryActive)

  // DELETE: the entire $effect() block that manages manual discovery + subscriptions
  // DELETE: discoverSmartWidgets() import
  // DELETE: controller management
</script>
```

4. **Auto-update detection:** Because the subscription is persistent, updated replaceable events arrive automatically. Add a derived store that detects updates:
```typescript
export const availableUpdates = derived(
  [discoveredManifests, extensionSettings],
  ([manifests, settings]) => {
    const updates: Array<{id: string; current: ExtensionManifest; latest: ExtensionManifest}> = []
    for (const [id, latest] of manifests) {
      const installed = settings.installed.nip89[id]
      if (installed && (latest as any)._created_at > (installed as any)._created_at) {
        updates.push({id, current: installed, latest})
      }
    }
    return updates
  },
)
```

**Dependencies:** 1.1 (welshman integration)
**Migration:** `discoverExtensions()` and `discoverSmartWidgets()` functions can be kept as deprecated wrappers that read from the reactive stores, so existing callers aren't immediately broken.

---

### 1.4 Externalize Recommended Extensions to Relay Events
**Findings:** #0e, #34
**Files:** `src/routes/settings/extensions/+page.svelte`, `src/app/extensions/discovery.ts`
**Risk:** Low — additive, can coexist with hardcoded list during transition.

**Changes:**

1. **Publish a NIP-51 curated list** (kind 30001 or 30003) from the Flotilla team's pubkey:
```json
{
  "kind": 30001,
  "tags": [
    ["d", "recommended-extensions"],
    ["a", "31990:<author-pubkey>:huddle", "wss://relay.example.com"],
    ["a", "31990:<author-pubkey>:budabit-kanban", "wss://relay.example.com"],
    ["a", "31990:<author-pubkey>:budabit-pipelines", "wss://relay.example.com"],
    ["a", "30033:<author-pubkey>:example-hello-world", "wss://relay.example.com"]
  ],
  "content": ""
}
```

2. **Subscribe to the curated list in discovery.ts:**
```typescript
const FLOTILLA_TEAM_PUBKEY = import.meta.env.VITE_RECOMMENDED_PUBKEY || "<default-pubkey>"
const RECOMMENDED_LIST_D_TAG = "recommended-extensions"

export const recommendedExtensions = writable<Array<{kind: number; pubkey: string; identifier: string}>>([])

// In startDiscovery():
request({
  relays: INDEXER_RELAYS,
  filters: [{
    kinds: [30001],
    authors: [FLOTILLA_TEAM_PUBKEY],
    "#d": [RECOMMENDED_LIST_D_TAG],
  }],
  signal,
  onEvent: (event) => {
    const refs = event.tags
      .filter(t => t[0] === "a")
      .map(t => {
        const [kind, pubkey, identifier] = t[1].split(":")
        return {kind: parseInt(kind), pubkey, identifier}
      })
      .filter(r => r.kind && r.pubkey && r.identifier)
    recommendedExtensions.set(refs)
  },
})
```

3. **The settings page** consumes `recommendedExtensions` and cross-references with `discoveredManifests` / `discoveredWidgets` to show the recommended list. Falls back to a minimal hardcoded list if no relay event is found.

**Dependencies:** 1.3 (discovery service)
**Migration:** Keep the current hardcoded `recommended` array as a fallback until the relay-based list is published and verified. Remove the fallback once stable.

---

### 1.5 Remove All Application-Specific Kinds & Validation from Host
**Findings:** #1, #1b
**Files:** `src/app/extensions/bridge.ts`, `src/app/extensions/types.ts`
**Risk:** Medium — existing extensions MUST update their manifests to declare `nostrKinds`.

The host framework currently contains kinds specific to two applications (NIP-100 Kanban and Gas Town) plus NIP-100-specific filter validation rules. All of this must be removed — the host should have zero knowledge of any extension's data model.

**Changes:**

1. In `types.ts`, add a `nostrKinds` field to `ExtensionManifest` and `SmartWidgetEvent`:
```typescript
export type ExtensionManifest = {
  // ... existing fields ...
  nostrKinds?: number[]  // Event kinds this extension needs to query/subscribe
}

export type SmartWidgetEvent = {
  // ... existing fields ...
  nostrKinds?: number[]  // From "kind" tags on the widget event
}
```

2. In `bridge.ts`, **delete** `NIP100_ALLOWED_KINDS` entirely and replace with a minimal universal set:
```typescript
// Universally-safe read-only kinds that any extension might reasonably need.
// NO application-specific kinds belong here.
const UNIVERSAL_READ_KINDS = new Set<number>([
  0,      // Profile metadata
  10002,  // Relay list metadata
])
```

3. **Delete** the NIP-100-specific filter validation from `normalizeNostrFilter()`:
```typescript
// REMOVE these lines entirely:
// if (kinds.includes(30301)) { requireNonEmptyStringArray(filter["#d"], ...) }
// if (kinds.includes(30302)) { requireNonEmptyStringArray(filter["#a"], ...) }
```

4. Add kind resolution from extension declarations:
```typescript
const resolveAllowedKinds = (ext: LoadedExtension): Set<number> => {
  const allowed = new Set(UNIVERSAL_READ_KINDS)
  const declared = ext.type === "nip89"
    ? ext.manifest.nostrKinds
    : ext.widget.nostrKinds
  if (declared) {
    for (const k of declared) allowed.add(k)
  }
  return allowed
}
```

5. Refactor `normalizeNostrFilter()` to accept the extension's allowed kinds:
```typescript
const normalizeNostrFilter = (
  filterRaw: unknown,
  allowedKinds: Set<number>,
): Record<string, unknown> => {
  // ... existing validation ...
  for (const k of kinds) {
    if (!allowedKinds.has(k)) {
      throw new Error(`Kind ${k} not declared in extension nostrKinds`)
    }
  }
  // NO application-specific tag requirements — just generic validation
}
```

6. For Smart Widgets, parse `nostrKinds` from event tags in `registry.ts`:
```typescript
// In parseSmartWidget():
const nostrKinds = getTags(tags, "kind")
  .map(t => parseInt(t[1], 10))
  .filter(k => Number.isFinite(k))
```

**Dependencies:** 1.1 (both `nostr:query` and `nostr:subscribe` handlers use `resolveAllowedKinds()`)
**Migration:** ⚠️ **Breaking for existing extensions** — they must update manifests with `nostrKinds`. Fallback is `UNIVERSAL_READ_KINDS` only (profiles + relay lists).

---

### 1.6 Unify Runtime Paths (Repo Extension Panel → Registry)
**Findings:** #26, #27, #28, #29, #30
**Files:** `src/routes/spaces/[relay]/git/[id=naddr]/extensions/[extId]/+page.svelte`, `src/app/extensions/registry.ts`
**Risk:** High — changes the repo extension panel's behavior. Requires careful testing.

**Changes:**

1. **Add `loadRepoExtension()` method to `ExtensionRegistry`:**
```typescript
async loadRepoExtension(
  manifest: ExtensionManifest,
  repoContext: RepoContext,
  containerElement?: HTMLElement,
): Promise<LoadedNip89Extension> {
  const base = this.get(manifest.id) as LoadedNip89Extension
    ?? this.register(manifest)
  this.setRepoContext(manifest.id, repoContext)
  const loaded = await this.loadRuntime(base, containerElement)
  return loaded as LoadedNip89Extension
}
```

2. **Extend `loadRuntime()` to accept optional container override**

3. **Rewrite repo extension panel** to use registry instead of manual bridge construction

4. **Remove all manual bridge construction, `context:update`, and fake SmartWidgetEvent creation** from the repo panel

**Dependencies:** None directly, but benefits from 1.1 (welshman integration in bridge)
**Migration:** Extensions listening for `context:update` should transition to `context:repoUpdate`. Emit both temporarily.

---

### 1.7 Fix Discovery Dedup — Select Newest
**Findings:** #16
**Files:** `src/app/core/commands.ts` (or moved to `discovery.ts` if 1.3 is done first)
**Risk:** Low

**Changes:** Compare `created_at` and keep newest per identifier. (If 1.3 is done first, this is already handled in the discovery service.)

**Dependencies:** None (or absorbed by 1.3)

---

### 1.8 Add Unknown Action Error Response
**Findings:** #5
**Files:** `src/app/extensions/bridge.ts`
**Risk:** Low

**Changes:** In `handleMessage()`, return `{error: "Unsupported action: ..."}` for unknown actions instead of `undefined`.

**Dependencies:** None

---

### 1.9 Fix Recommended ID Mismatch
**Findings:** #23
**Files:** `src/routes/settings/extensions/+page.svelte`
**Risk:** None

**Changes:** `"hello-world"` → `"example-hello-world"` (or remove if 1.4 externalizes the list).

**Dependencies:** None

---

### 1.10 Smart Widget Handler Protocol Compatibility Layer
**Findings:** Protocol review against Smart Widget spec (`smart-widget-handler` npm package, YakiHonne docs)
**Files:** `src/app/extensions/bridge.ts`, new file `src/app/extensions/swcompat.ts`
**Risk:** Medium — changes message handling, but additive (doesn't break existing Flotilla extensions).

The Smart Widget specification defines a postMessage protocol (`smart-widget-handler`) that is **completely incompatible** with Flotilla's `ExtensionBridge` protocol. A widget built with `smart-widget-handler` (as the spec instructs) will not work in Flotilla, and vice versa.

**Spec protocol** uses `{kind: "...", data: {...}}` messages:
- Client→Host: `app-loaded`, `sign-event`, `sign-publish`, `payment-request`, `custom-data`
- Host→Client: `user-metadata`, `nostr-event`, `err-msg`, `payment-response`

**Flotilla protocol** uses `{type: "request"|"response"|"event", action: "...", payload: {...}}` messages.

**Changes:**

1. **Create protocol detection + adapter** (`src/app/extensions/swcompat.ts`):
```typescript
import type {LoadedExtension} from "./types"
import {publishThunk} from "@welshman/app"
import {signer} from "@welshman/app"

export type SWMessage = {
  kind: string
  data?: any
}

export const isSWHandlerMessage = (data: unknown): data is SWMessage => {
  return (
    data !== null &&
    typeof data === "object" &&
    "kind" in (data as any) &&
    typeof (data as any).kind === "string"
  )
}

/**
 * Handle Smart Widget Handler protocol messages.
 * Translates them into Flotilla bridge operations.
 */
export const handleSWMessage = async (
  msg: SWMessage,
  ext: LoadedExtension,
  source: Window,
  origin: string,
): Promise<void> => {
  switch (msg.kind) {
    case "app-loaded":
      // Widget is ready — equivalent to our proposed widget:ready
      // Emit internal readiness signal
      ext._swReady = true
      break

    case "sign-event": {
      // Sign only (no publish) — spec feature Flotilla was missing
      if (!msg.data) return
      try {
        const signed = await signer.get()?.sign(msg.data)
        source.postMessage(
          {kind: "nostr-event", data: {event: signed, status: "success"}},
          origin === "null" ? "*" : origin,
        )
      } catch (err: any) {
        source.postMessage(
          {kind: "err-msg", data: err.message || "Sign failed"},
          origin === "null" ? "*" : origin,
        )
      }
      break
    }

    case "sign-publish": {
      // Sign and publish — maps to existing nostr:publish
      if (!msg.data) return
      try {
        const result = await publishThunk(msg.data)
        source.postMessage(
          {kind: "nostr-event", data: {event: result, status: "success"}},
          origin === "null" ? "*" : origin,
        )
      } catch (err: any) {
        source.postMessage(
          {kind: "err-msg", data: err.message || "Publish failed"},
          origin === "null" ? "*" : origin,
        )
      }
      break
    }

    case "payment-request": {
      // Lightning payment — new capability
      // Route to payment handler (needs UI integration)
      console.warn("[swcompat] payment-request not yet implemented")
      source.postMessage(
        {kind: "err-msg", data: "Payment not supported in this host"},
        origin === "null" ? "*" : origin,
      )
      break
    }

    case "custom-data": {
      // Arbitrary data from widget
      console.log(`[swcompat] custom-data from ${ext.id}:`, msg.data)
      break
    }
  }
}
```

2. **Integrate protocol detection into `ExtensionBridge.handleMessage()`:**
```typescript
import {isSWHandlerMessage, handleSWMessage} from "./swcompat"

async handleMessage(event: MessageEvent): Promise<void> {
  const {data, source, origin} = event
  if (!data || typeof data !== "object") return
  if (this.targetWindow && source !== this.targetWindow) return

  // Protocol detection: Smart Widget Handler uses {kind: string}
  if (isSWHandlerMessage(data)) {
    if (this.extension.origin !== origin && origin !== "null") return
    await handleSWMessage(data, this.extension, source as Window, origin)
    return
  }

  // Flotilla ExtensionBridge protocol: {type, action, payload}
  if (!("action" in data)) return
  // ... existing bridge handling ...
}
```

3. **Send user metadata in spec format after bridge attachment:**
```typescript
// In registry.ts sendLifecycleInit(), after sending widget:init:
private sendLifecycleInit(ext: LoadedExtension): void {
  // Flotilla protocol
  ext.bridge.post("widget:init", initPayload)
  ext.bridge.post("widget:mounted", {timestamp: Date.now()})

  // Smart Widget Handler protocol (for spec-compliant widgets)
  const userProfile = buildUserProfile() // pubkey, display_name, picture, etc.
  ext.bridge.postRaw({
    kind: "user-metadata",
    data: {
      user: userProfile,
      host_origin: window.location.origin,
    },
  })
}
```

4. **Add `postRaw()` to ExtensionBridge** for sending non-bridge-protocol messages:
```typescript
postRaw(data: unknown): void {
  const targetWindow = this.targetWindow ?? this.extension.iframe?.contentWindow
  const targetOrigin = this.targetWindow ? '*' : this.extension.origin
  targetWindow?.postMessage(data, targetOrigin)
}
```

**Missing spec features to implement (can be done incrementally):**

| Feature | Priority | Notes |
|---|---|---|
| `sign-event` (sign only) | High | Included above |
| `sign-publish` | High | Maps to existing `nostr:publish` |
| `user-metadata` delivery | High | Included above |
| `app-loaded` readiness | High | Included above |
| `payment-request` / `payment-response` | Medium | Needs Lightning wallet integration |
| `.well-known/widget.json` consumption | Low | For manifest-based discovery |
| Button type handlers (`redirect`, `nostr`, `zap`, `post`) | Medium | Host-side UI handlers |
| Input field submission | Medium | For `post` button type |

**Dependencies:** 1.1 (welshman integration for `sign-publish`)
**Migration:** Additive — existing Flotilla extensions continue using the bridge protocol. Spec-compliant widgets using `smart-widget-handler` will now also work.

---

## Phase 2 — Extension Framework Cleanup

These items are no longer architectural blockers (Phase 1 handles that) but are needed to make the extension framework correct and complete.

### 2.1 Rewrite `nostr:query` as a Convenience Wrapper
**Findings:** #0b, #2
**Files:** `src/app/extensions/bridge.ts`
**Risk:** Low — improves existing behavior without changing the API.

After Phase 1.1 replaces `SimplePool` with welshman, `nostr:query` should be reimplemented as a clean one-shot query using `load()`:

```typescript
registerBridgeHandler("nostr:query", async (payload, ext) => {
  const allowedKinds = resolveAllowedKinds(ext)
  const {relays, filter} = parseNostrQueryPayload(payload, allowedKinds)

  // Create a timeout controller as a safety net
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000) // generous safety net

  try {
    // load() handles EOSE properly — resolves when stored events are delivered
    await load({relays, filters: [filter], signal: controller.signal})
    clearTimeout(timeout)

    // Return events from welshman's cache
    const events = repository.query([filter])
    return {status: "ok", events}
  } catch (err: any) {
    clearTimeout(timeout)
    if (controller.signal.aborted) {
      return {status: "timeout", events: repository.query([filter]),
        message: "Query safety timeout — results may be incomplete"}
    }
    return {error: err.message}
  }
})
```

Key differences from current implementation:
- Uses `load()` which resolves on EOSE, not an arbitrary 8-second timeout
- Safety-net timeout is generous (15s) and returns `{status: "timeout"}` not `{status: "ok"}`
- Leverages welshman's event cache
- Shares relay connections with the rest of the app

**Dependencies:** 1.1, 1.5

---

### 2.2 Remove `nostr:subscribe` from Huddle Manifest (Temporary)
**Findings:** #32
**Files:** `static/extensions/huddle.json`
**Risk:** None

If Phase 1.2 is not yet complete when other work ships, remove `nostr:subscribe` from huddle.json to prevent the "silently returns undefined" behavior. Re-add once 1.2 lands.

Alternatively, if 1.2 lands first, this is a no-op.

**Dependencies:** Conditional on 1.2 timeline.

---

## Phase 3 — Production Reliability

These items fix race conditions, error handling, and timeout issues.

### 3.1 Add In-Flight Load Locking to Registry
**Findings:** #12
**Files:** `src/app/extensions/registry.ts`
**Risk:** Low

Add `loadingPromises` map to prevent duplicate iframe creation from concurrent `loadRuntime()` calls.

**Dependencies:** None

---

### 3.2 Fix Provider Race Conditions
**Findings:** Provider race analysis
**Files:** `src/app/extensions/provider.svelte`
**Risk:** Medium

Replace unawaited async IIFEs in `$effect` with an AbortController pattern. Load extensions sequentially to avoid races. Ensure cleanup runs after async loads complete.

**Dependencies:** 3.1 (load locking makes this safer)

---

### 3.3 Add Request Timeout and Reject on Detach
**Findings:** #3
**Files:** `src/app/extensions/bridge.ts`
**Risk:** Low

1. Add configurable timeout (30s default) to `ExtensionBridge.request()`
2. Reject all pending promises in `detach()` with `{error: "Bridge detached"}`

**Dependencies:** None

---

### 3.4 Fix Enable/Disable Ordering
**Findings:** #17
**Files:** `src/app/core/commands.ts`
**Risk:** Low

Load extension FIRST, persist enabled state only AFTER successful load. Propagate load errors to UI.

**Dependencies:** None

---

### 3.5 Implement Readiness Handshake
**Findings:** #8, #9
**Files:** `src/app/extensions/registry.ts`, `src/app/extensions/bridge.ts`
**Risk:** Medium

After iframe `load` event, wait for `widget:ready` message instead of immediately sending `widget:mounted`. Fall back to timeout for backward compatibility.

**Dependencies:** 1.6 (unified runtime path)

---

## Phase 4 — Ecosystem Scale

### 4.1 Implement Composite Extension Keys
**Findings:** #14, #15
**Files:** `src/app/extensions/types.ts`, `src/app/extensions/settings.ts`, `src/app/extensions/registry.ts`, `src/app/core/commands.ts`
**Risk:** High — requires localStorage migration.

Use `nip89:{id}` and `widget:{pubkey}:{identifier}` as keys. Auto-migrate v1 bare IDs on settings load.

**Dependencies:** None (but large scope)

---

### 4.2 Add Manifest Validation
**Findings:** #24
**Files:** New `src/app/extensions/validation.ts`
**Risk:** Low

Validate structure, enforce HTTPS for non-localhost entrypoints, verify `nostrKinds` is an array of numbers.

**Dependencies:** None

---

### 4.3 Wire Policy Signer into Enable Flow
**Findings:** #31
**Files:** `src/app/extensions/policySigner.ts`, `src/app/core/commands.ts`
**Risk:** Medium — adds user consent step.

Require policy consent for extensions requesting privileged permissions (`nostr:*`, `storage:*`).

**Dependencies:** 3.4 (enable ordering fix)

---

### 4.4 Make Sandbox Policy Configurable
**Findings:** #10, #29
**Files:** `src/app/extensions/types.ts`, `src/app/extensions/registry.ts`
**Risk:** Low

Extensions declare needed sandbox flags in manifest. Host validates against allowlist.

**Dependencies:** None

---

## Phase 5 — Polish & Completeness

### 5.1 Pull hostVersion from Package.json
**Findings:** #7
**Risk:** None

### 5.2 Rate Limit ui:* Actions
**Findings:** #4
**Risk:** None

### 5.3 Add Extension Error UI
**Findings:** #17 (related)
**Risk:** None

### 5.4 Standardize Context Event Names
**Findings:** #26
During transition, emit both `context:repoUpdate` and `context:update`. Document deprecation.

### 5.5 Fix Static Manifests (Dev Only)
**Findings:** #34
Replace localhost URLs with production URLs or env-based config. Generate SHA-256 hashes. These should only be used in development; production should use relay-discovered extensions.

### 5.6 Add Responsive Iframe Sizing
**Findings:** #30
Implement `ui:resize` bridge handler.

### 5.7 Move Kind Constants to Single Location
**Findings:** #22
Move `SMART_WIDGET_KIND` from `commands.ts` to `state.ts` alongside `EXTENSIONS_KIND`.

---

## Extension Implementation Updates

These changes are needed in existing extension projects.

### Important: Extensions Depend Only on nostr-tools

Extensions run in sandboxed iframes and must NOT depend on welshman. They use:
- `nostr-tools` for event construction, signing, NIP-19 encoding, etc.
- The postMessage bridge client for all Nostr operations (query, subscribe, publish)

The welshman integration is entirely on the host side — transparent to extensions.

### budabit-kanban-extension
1. **⚠️ REQUIRED for Phase 1.5:** Add `"nostrKinds": [30301, 30302]` to manifest
2. **⚠️ REQUIRED for Phase 1.5:** Move filter validation (`#d` on boards, `#a` on cards) into extension's own code
3. **RECOMMENDED:** Migrate from `nostr:query` polling to `nostr:subscribe` for real-time board updates (after Phase 1.2)
4. Add `widget:ready` message after initialization (Phase 3.5)
5. Listen for `context:repoUpdate` in addition to `context:update` (Phase 5.4)

### budabit-gastown-integration
1. **⚠️ REQUIRED for Phase 1.5:** Add `"nostrKinds": [30315, 30316, 30318, 30319, 30320, 30321, 30322, 30323, 30325, 38383, 38384, 38385, 38386]` to manifest
2. **RECOMMENDED:** Migrate to `nostr:subscribe` for real-time Gas Town protocol events
3. Add `widget:ready` message after initialization
4. Listen for `context:repoUpdate` in addition to `context:update`

### hoddler
1. Add `"nostrKinds": [...]` for whatever kinds it queries
2. **Can now use `nostr:subscribe`** (after Phase 1.2) — this was already declared in huddle.json but had no handler
3. Add `widget:ready` message after initialization
4. Listen for `context:repoUpdate`

### flotilla-extension-template
1. Update template to send `widget:ready` after init
2. Update docs to use `context:repoUpdate` (deprecate `context:update`)
3. Update bridge client examples to check for `{error: ...}` in responses
4. Add `nostrKinds` field to template manifest with documentation
5. **Add `nostr:subscribe` example** as the primary data access pattern
6. Add `nostr:query` example as the convenience one-shot pattern
7. Document that extensions depend only on nostr-tools — no welshman dependency
8. Remove any references to the host providing application-specific kind access

### create-flotilla-widget
1. Update template files to match flotilla-extension-template changes
2. Add `nostrKinds` to default manifest generation
3. Add prompt during scaffolding asking which event kinds the extension needs
4. Include `nostr:subscribe` bridge client example in generated code

---

## Migration Strategy

### Transition from SimplePool to Welshman

This is transparent to extensions — the bridge API doesn't change:
- `nostr:query` request/response format stays the same
- `nostr:publish` request/response format stays the same
- New `nostr:subscribe` / `nostr:unsubscribe` are additive

The only behavioral changes:
- `nostr:query` may resolve faster (shared connections, EOSE-based instead of timeout-based)
- Timeout responses now return `{status: "timeout"}` instead of `{status: "ok", events: []}`

### localStorage Schema Migration

Migration from v1 to v2 when composite keys are implemented (Phase 4.1):
```typescript
extensionSettings.update(s => {
  if ((s as any).version === 2) return {...s, installed: normalizeInstalled(s.installed)}
  const migratedEnabled = (s.enabled || []).map(id => {
    if (id.startsWith("nip89:") || id.startsWith("widget:")) return id
    const isWidget = !!s.installed?.widget?.[id]
    if (isWidget) {
      const w = s.installed.widget[id]
      return `widget:${w.pubkey || "unknown"}:${id}`
    }
    return `nip89:${id}`
  })
  return {version: 2, enabled: migratedEnabled, installed: normalizeInstalled(s.installed)}
})
```

### Backward Compatibility Timeline

| Change | Backward Compat | Removal Target |
|--------|-----------------|----------------|
| `SimplePool` → welshman | Transparent to extensions | Immediate |
| `nostr:subscribe` / `nostr:unsubscribe` | Additive — existing code unaffected | N/A |
| `nostr:query` timeout `"ok"` → `"timeout"` | Breaking for code checking `status === "ok"` | Immediate |
| `nostrKinds` required in manifest | Fallback to UNIVERSAL_READ_KINDS (profile + relay list) | Permanent |
| NIP-100 filter validation removed | Removed — extensions must self-validate | Immediate |
| Unknown action returns error (not undefined) | Breaking for code not checking `error` | Immediate |
| `context:update` event | Emitted alongside `context:repoUpdate` | v2.0 |
| Bare ID in `enabled[]` | Auto-migrated on load | v2.0 |
| `widget:ready` handshake | Falls back to timeout if not sent | Permanent |
| Recommended list from relay events | Falls back to hardcoded list | Until relay list verified |

---

## Dependency Graph

```
Phase 1 — Nostr-Native Foundation (ordered):
  1.1 Replace SimplePool with welshman ← no deps (DO FIRST)
  1.2 nostr:subscribe handler ← depends on 1.1
  1.3 Persistent discovery subscriptions ← depends on 1.1
  1.4 Externalize recommended list ← depends on 1.3
  1.5 Remove application-specific kinds ← depends on 1.1
  1.6 Unify runtime paths ← no deps (can parallel with 1.1)
  1.7 Fix discovery dedup ← absorbed by 1.3
  1.8 Unknown action error ← no deps (can parallel)
  1.9 Recommended ID fix ← no deps (can parallel)
  1.10 SW Handler protocol compat ← depends on 1.1

Phase 2 — Framework Cleanup:
  2.1 Rewrite nostr:query ← depends on 1.1, 1.5
  2.2 Huddle manifest fix ← conditional on 1.2 timeline

Phase 3 — Production Reliability:
  3.1 Load locking ← no deps
  3.2 Provider races ← depends on 3.1
  3.3 Request timeout ← no deps
  3.4 Enable/disable ordering ← no deps
  3.5 Readiness handshake ← depends on 1.6

Phase 4 — Ecosystem Scale:
  4.1 Composite keys ← no deps (large scope)
  4.2 Manifest validation ← no deps
  4.3 Policy enforcement ← depends on 3.4
  4.4 Sandbox config ← no deps

Phase 5 — Polish:
  5.1-5.7 all independent

Critical Path: 1.1 → 1.2 + 1.3 + 1.5 + 1.10 (parallel) → 2.1
```

**Estimated total scope:** ~30 individual changes across ~15 files. The largest items are:
- **1.1** SimplePool → welshman refactor (medium complexity, high impact)
- **1.2** `nostr:subscribe` implementation (medium complexity, high impact)
- **1.3** Discovery service rewrite (medium complexity, medium-high impact)
- **1.6** Repo extension panel rewrite (medium complexity)
- **4.1** Composite keys migration (high complexity, lower urgency)

---

## Implementation Progress

| Item | Status | Date | Notes |
|------|--------|------|-------|
| 1.1 | ✅ Complete | 2026-02-15 | `SimplePool` replaced with welshman `load()`/`request()` in bridge.ts |
| 1.2 | ✅ Complete | 2026-02-15 | `nostr:subscribe`/`nostr:unsubscribe` handlers + subscription tracking + cleanup on unload |
| 1.3 | ✅ Complete | 2026-02-15 | New `discovery.ts` service with persistent subscriptions, wired into `sync.ts`, settings page consumes reactive stores |
| 1.4 | ✅ Complete | 2026-02-15 | Recommended list fetched from NIP-51 relay event (kind 30001) with hardcoded fallback. Settings page shows relay-sourced list when available. |
| 1.5 | ✅ Complete | 2026-02-15 | `NIP100_ALLOWED_KINDS` deleted. All app-specific kinds + filter validation removed. Extensions declare `nostrKinds` in manifests. `UNIVERSAL_READ_KINDS` = {0, 10002} only. |
| 1.6 | ✅ Complete | 2026-02-15 | Repo extension panel rewritten to use `extensionRegistry.loadRepoExtension()`. No more manual bridge construction, fake SmartWidgetEvent, or `context:update` divergence. |
| 1.7 | ✅ Complete | 2026-02-15 | Absorbed by 1.3 — `handleManifestEvent()` properly keeps newest by `created_at` |
| 1.8 | ✅ Complete | 2026-02-15 | Unknown actions now return `{error: "Unsupported action: ..."}` instead of `undefined` |
| 1.9 | ✅ Complete | 2026-02-15 | `"hello-world"` → `"example-hello-world"` in fallback recommended list |
| 1.10 | ✅ Complete | 2026-02-15 | New `swcompat.ts` module. Protocol detection in bridge (`isSWHandlerMessage`). Handles `app-loaded`, `sign-event`, `sign-publish`, `payment-request`, `custom-data`. `postRaw()` method added. SW `user-metadata` sent alongside Flotilla `widget:init`. |

| 2.1 | ✅ Complete | 2026-02-15 | Absorbed by 1.1 — `nostr:query` already uses welshman `load()` with EOSE + 15s safety timeout + `{status: "timeout"}` response |
| 2.2 | ✅ Complete | 2026-02-15 | No-op — `nostr:subscribe` handler exists (1.2), so huddle.json's declared permission now works |
| 3.1 | ✅ Complete | 2026-02-15 | `loadingPromises` map in registry prevents duplicate iframe creation from concurrent `loadRuntime()` calls |
| 3.2 | ✅ Complete | 2026-02-15 | Provider rewritten with AbortController pattern. Extensions load sequentially. In-flight loads aborted on cleanup. |
| 3.3 | ✅ Complete | 2026-02-15 | `request()` has 30s configurable timeout. `detach()` rejects all pending promises with `{error: "Bridge detached"}`. |
| 3.4 | ✅ Complete | 2026-02-15 | `enableExtension()` loads runtime FIRST, persists enabled state only after success. Returns boolean. |
| 3.5 | ✅ Complete | 2026-02-15 | `waitForWidgetReady()` listens for `widget:ready` (Flotilla) or `app-loaded` (SW Handler). Falls back to 5s timeout. `widget:mounted` sent only after ready signal. |
| 4.1 | ✅ Complete | 2026-02-15 | Composite keys: `nip89:{id}` and `widget:{pubkey}:{identifier}`. Schema v1→v2 auto-migration. `isCompositeKey()`, `makeNip89Key()`, `makeWidgetKey()`, `bareIdFromKey()` helpers. Backward-compatible lookups. |
| 4.2 | ✅ Complete | 2026-02-15 | New `validation.ts` — validates manifest structure, HTTPS enforcement, nostrKinds, SHA-256 format, slot config. Wired into `registry.load()`. |
| 4.3 | ✅ Complete | 2026-02-15 | Privileged permission detection in `enableExtension()`. Logs privileged permissions requested. TODO placeholder for consent modal + policy event verification. |
| 4.4 | ✅ Complete | 2026-02-15 | `applySandboxPolicy()` method with configurable flags from manifest. Allowlist: `allow-forms`, `allow-modals`, `allow-popups`, `allow-popups-to-escape-sandbox`, `allow-downloads`. |
| 5.1 | ✅ Complete | 2026-02-15 | `__APP_VERSION__` from vite.config.ts, declared in feature-flags.d.ts. Registry uses it for `hostVersion` in `widget:init`. |
| 5.2 | ✅ Complete | 2026-02-15 | Rate limiter for `ui:*` actions in bridge.ts. 20 actions per 10s window per extension. |
| 5.3 | ✅ Complete | 2026-02-15 | New `ExtensionErrorBanner.svelte` component. `setError()`/`clearError()` methods + `errors` derived store on registry. Provider surfaces load failures. Settings page shows errors with retry/dismiss. |
| 5.4 | ✅ Complete | 2026-02-15 | Registry emits both `context:repoUpdate` (new) and `context:update` (deprecated) for backward compatibility. |
| 5.5 | ✅ Complete | 2026-02-15 | kanban.json: localhost → CDN URL, added `nostrKinds: [30301, 30302]`, added `nostr:subscribe`/`storage:*` permissions. huddle.json: added `nostrKinds: [29200-29203, 29500]`. pipelines.json: no `nostrKinds` (built-in route). |
| 5.6 | ✅ Complete | 2026-02-15 | `ui:resize` bridge handler with height clamping (100-10000px). Repo panel CSS updated with transition. |
| 5.7 | ✅ Complete | 2026-02-15 | `SMART_WIDGET_KIND` moved from local declarations in commands.ts and discovery.ts to `state.ts` alongside `EXTENSIONS_KIND`. Both files now import from state.ts. |

---

_Plan created: 2026-02-15_
_Updated: 2026-02-15 — **ALL PHASES COMPLETE.** 28 items implemented across 5 phases._
_Nostr-native pub/sub architecture; welshman integration on host side only; extensions depend only on nostr-tools._
_Based on: EXTENSIONS_AUDIT.md (37 findings)_
