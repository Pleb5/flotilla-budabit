# Investigation: Flotilla Extensions Architecture Audit

## Summary

The Flotilla extension system has a solid foundational design with a bridge-based communication protocol, NIP-89 manifest and Smart Widget support, and a settings/persistence layer. However, it suffers from a **fundamental architectural mismatch**: the system treats Nostr as a stateless request/response protocol (like HTTP) rather than the pub/sub protocol it actually is. This manifests as one-shot discovery fetches, timeout-based query handlers with a standalone `SimplePool`, no subscription support for extensions, and static bundled manifests instead of relay-event-driven loading.

Beyond this core issue, the system contains **37 distinct findings** across hardcoded values, timeout-based workarounds, race conditions, dead code, contract drift, and missing functionality that collectively prevent reliable loading and operation of third-party extensions from relay events.

## Symptoms / Scope

- **Architecture treats Nostr as REST** — one-shot queries with timeouts instead of persistent subscriptions
- **Standalone SimplePool** bypasses the app's welshman relay infrastructure (auth, connection pooling, relay selection)
- **No `nostr:subscribe` handler** — extensions cannot maintain open subscriptions for real-time data
- **Discovery is one-shot** — no persistent subscription for new/updated extensions
- **Static bundled manifests** instead of relay-event-driven loading
- Hardcoded kind allowlists prevent third-party extensions from querying arbitrary event kinds
- Two separate runtime paths produce inconsistent extension behavior
- Discovery doesn't properly select newest replaceable events
- Extension identity model allows collisions at ecosystem scale
- Policy signing system is defined but never enforced
- Template/docs describe a different contract than the actual host runtime
- Provider component has race conditions that can leak iframes

---

## Investigation Log

### Phase 0 — Fundamental Architecture

#### Finding 0a: Bridge Uses Standalone `SimplePool` Instead of Welshman (CRITICAL — ARCHITECTURAL)
**File:** `flotilla/src/app/extensions/bridge.ts:29`
```typescript
import {SimplePool} from "nostr-tools/pool"
const pool = new SimplePool()
```
**Impact:** The entire Nostr communication layer for extensions is a standalone `SimplePool` from nostr-tools, completely separate from the application's welshman relay infrastructure. This means:
- Extensions don't benefit from welshman's connection pooling — duplicate connections to the same relays
- No relay authentication (NIP-42) for extension queries
- No relay selection intelligence from welshman's Router
- No shared event cache via welshman's `repository`
- Extension queries and subscriptions are invisible to the app's relay management
- The app and extensions can have conflicting relay states

The rest of the Flotilla app uses `request()`, `load()`, and `repository.query()` from `@welshman/net` and `@welshman/app` for all Nostr operations (see `sync.ts`, `commands.ts`). The extension bridge is the only place that creates a separate relay pool.

**Recommendation:** Replace `SimplePool` with welshman's `request()` / `load()` / `subscribe()` APIs. All extension Nostr operations should route through the same relay infrastructure the app uses. This is the single most impactful architectural change.

#### Finding 0b: `nostr:query` Treats Nostr as REST — One-Shot with Artificial Timeout (CRITICAL — ARCHITECTURAL)
**File:** `flotilla/src/app/extensions/bridge.ts:270-293`
```typescript
registerBridgeHandler("nostr:query", async (payload, ext) => {
  const queryPromise = pool.querySync(relays, filter)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("timeout")), 8000)
  })
  const events = await Promise.race([queryPromise, timeoutPromise])
})
```
**Impact:** This implements a REST-like request/response pattern over Nostr. It opens a connection, sends a REQ, waits up to 8 seconds, returns whatever it has, and closes. This fundamentally misunderstands the Nostr protocol:
- Nostr relays signal end-of-stored-data via EOSE (End of Stored Events) — there's no need for an arbitrary timeout
- After EOSE, new events matching the filter continue to arrive in real-time — this is the core value of Nostr's pub/sub model
- The 8-second timeout is both too long (for fast relays) and too short (for slow relays with lots of data)
- Using `querySync` means every query opens and closes connections rather than reusing them

**Recommendation:** `nostr:query` should use welshman's `load()` for one-shot queries (which properly handles EOSE). For real-time data, `nostr:subscribe` (Finding 0c) should be the primary interface. The artificial timeout becomes unnecessary when EOSE is handled properly.

#### Finding 0c: No `nostr:subscribe` Handler — Extensions Cannot Receive Real-Time Events (CRITICAL — ARCHITECTURAL)
**File:** `flotilla/static/extensions/huddle.json:9`, `flotilla/src/app/extensions/bridge.ts` (entire file)
```json
"permissions": ["nostr:publish", "nostr:subscribe", "ui:toast"]
```
The huddle extension declares `nostr:subscribe` as a needed permission, but **no handler exists** in bridge.ts. This is the most significant missing feature in the entire extension system.

**Impact:** Extensions have no way to maintain open subscriptions to relays. They can only do one-shot queries via `nostr:query`, making it impossible to build any real-time feature:
- A kanban extension can't receive live board updates from collaborators
- A huddle extension can't receive live room state changes
- A chat extension can't receive new messages in real-time
- Any extension that needs to react to new events must poll via repeated `nostr:query` calls

This is not a missing convenience feature — it's the absence of Nostr's fundamental interaction model.

**Recommendation:** `nostr:subscribe` must be a first-class bridge action, implemented using welshman's `request()` with event callbacks. The bridge must track active subscriptions per extension and clean them up on extension unload. This is a Phase 1 critical item, not a Phase 3 nice-to-have.

#### Finding 0d: Discovery is One-Shot Fetch, Not Persistent Subscription (CRITICAL — ARCHITECTURAL)
**File:** `flotilla/src/app/core/commands.ts:214-242`
```typescript
export const discoverExtensions = async (): Promise<ExtensionManifest[]> => {
  await request({relays: INDEXER_RELAYS, filters: [{kinds: [KIND], limit: 100}]})
  const events = repository.query([{kinds: [KIND]}])
  // parse, dedup, return — done
}
```
And `discoverSmartWidgets()` (line 246-270) follows the same pattern.

**Impact:** Extension discovery is a one-shot async function: fetch events, parse, return, done. This means:
- New extensions published after the initial discovery are invisible until the user manually refreshes
- Updated versions of installed extensions are never detected
- The app doesn't maintain awareness of the extension ecosystem
- The settings page (line 82) does start a subscription with `onEvent`, but Smart Widget discovery remains entirely one-shot

The rest of the Flotilla app uses persistent subscriptions for data it cares about (spaces, DMs, alerts — see `sync.ts`). Extension discovery should follow the same pattern.

**Recommendation:** Extension discovery should be a persistent subscription service that maintains open subscriptions to relevant relays for kind 31990 and kind 30033 events. New/updated extensions should automatically appear in the discovery store. The settings page should consume this reactive store rather than triggering one-shot fetches.

#### Finding 0f: Smart Widget Handler Protocol Incompatibility (CRITICAL — INTEROP)
**Files:** `flotilla/src/app/extensions/bridge.ts` (entire message handling), Smart Widget spec (`smart-widget-handler` npm package)

**Impact:** The Smart Widget specification defines a postMessage protocol (implemented in `smart-widget-handler`) that uses `{kind: "...", data: {...}}` message format. Flotilla's ExtensionBridge uses a completely different `{type: "request"|"response"|"event", action: "...", payload: {...}}` format. These protocols are incompatible — a widget built according to the spec will not work in Flotilla, and a Flotilla extension will not work in other spec-compliant hosts.

Key spec features with no Flotilla equivalent:
- `sign-event` (sign without publishing) — Flotilla only has `nostr:publish`
- `payment-request` / `payment-response` — Lightning payment flow
- `user-metadata` delivery format — spec sends user profile with specific fields
- `app-loaded` readiness signal — different from proposed `widget:ready`

Additionally, the spec's button type handlers (`redirect`, `nostr`, `zap`, `post`, input submission) are parsed but not implemented in Flotilla.

**Recommendation:** Implement a dual-protocol detection layer in the bridge. When a message arrives with a `kind` string property, handle it via the Smart Widget Handler protocol. When it has `action`/`type` properties, use the Flotilla bridge protocol. Send user metadata in both formats so widgets using either protocol work.

---

#### Finding 0e: Static Bundled Manifests Instead of Relay-Event-Driven Loading (ARCHITECTURAL)
**File:** `flotilla/static/extensions/*.json`, `flotilla/src/routes/settings/extensions/+page.svelte:60-68`
```typescript
const recommended = [
  {name: "Huddle", url: "/extensions/huddle.json", description: "Audio/room collaboration", id: "huddle"},
  {name: "Repo Kanban", url: "/extensions/kanban.json", description: "NIP-100 Kanban board", id: "budabit-kanban"},
  {name: "CI/CD Pipelines", url: "/extensions/pipelines.json", description: "View pipeline runs", id: "budabit-pipelines"},
  {name: "Hello World", url: "/extensions/example.json", description: "Minimal sample", id: "hello-world"},
]
```
**Impact:** The "recommended" extensions are JSON files bundled with the application and referenced by hardcoded URL. This is the opposite of relay-first discovery:
- Adding or removing a recommended extension requires an app release
- The manifests are local files, not relay events — they bypass the entire NIP-89 discovery model
- `kanban.json` contains `"entrypoint": "http://localhost:5178"` which doesn't work in production
- All manifests have empty SHA-256 hashes

**Recommendation:** The recommended list should come from relay events — e.g., a NIP-51 list (kind 30001/30003) published by the Flotilla team's pubkey, referencing kind 31990 events by `a`-tag. The app subscribes to this list and discovers the referenced extensions via relay events. Static manifests should only exist for development/testing.

---

### Phase 1 — Core Bridge (`bridge.ts`)

#### Finding 1: Application-Specific Kind Allowlist Hardcoded in Host (CRITICAL)
**File:** `flotilla/src/app/extensions/bridge.ts:31-36`
```typescript
const NIP100_ALLOWED_KINDS = new Set<number>([
  30301, 30302,
  30315, 30316, 30318, 30319, 30320, 30321, 30322, 30323, 30325,
  38383, 38384, 38385, 38386,
])
```
**Impact:** The host extension framework contains kinds specific to two applications (NIP-100 Kanban and Gas Town protocol) baked directly into its query gating logic. This violates the extension model — the host should have no knowledge of what kinds any specific extension needs. Third-party extensions cannot query ANY event kinds other than these application-specific ones. Even the variable name (`NIP100_ALLOWED_KINDS`) reveals that this was built for a specific extension rather than as a generic framework.
**Recommendation:** Remove ALL application-specific kinds from the host. Extensions must declare the kinds they need via a `nostrKinds` field in their manifest/widget. The host should provide at most a minimal set of universally-safe read-only kinds (e.g., kind 0 profiles, kind 10002 relay lists) or no defaults at all.

#### Finding 1b: Application-Specific Filter Validation in Host (CRITICAL)
**File:** `flotilla/src/app/extensions/bridge.ts:91-95`
```typescript
if (kinds.includes(30301)) {
  requireNonEmptyStringArray(filter["#d"], '["#d"]')
}
if (kinds.includes(30302)) {
  requireNonEmptyStringArray(filter["#a"], '["#a"]')
}
```
**Impact:** The host bridge contains NIP-100 Kanban business logic — enforcing that board queries must include a `#d` filter and card queries must include an `#a` filter. This is schema validation specific to the Kanban extension's data model and has no place in a generic extension framework. It would break any future extension that uses kinds 30301/30302 for a different purpose, or that has valid reasons to query them without those specific tag filters.
**Recommendation:** Remove entirely. If the Kanban extension needs to validate its own query patterns, it should do so on its own side before sending bridge requests.

#### Finding 2: 8-Second Query Timeout Returns Empty (Not Error)
**File:** `flotilla/src/app/extensions/bridge.ts:282-293`
```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error("timeout")), 8000)
})
try {
  const events = await Promise.race([queryPromise, timeoutPromise])
  return {status: "ok", events}
} catch (err: any) {
  if (err.message === "timeout") {
    return {status: "ok", events: []}  // ← silent failure!
  }
}
```
**Impact:** When relays are slow, extensions receive `{status: "ok", events: []}` — indistinguishable from "no matching events exist". Extensions cannot differentiate timeout from empty results, leading to silent data loss. (See also Finding 0b — this entire approach is superseded by proper EOSE handling.)
**Recommendation:** Replace with welshman's `load()` which handles EOSE properly. If a timeout is still needed as a safety net, return `{status: "timeout", events: []}`.

#### Finding 3: No Timeout on `request()` — Promises Can Hang Forever
**File:** `flotilla/src/app/extensions/bridge.ts:186-196`
```typescript
request(action: string, payload: any): Promise<any> {
  const id = `${Date.now()}-${messageCounter++}`
  return new Promise((resolve, reject) => {
    this.pending.set(id, resolve)
    try {
      this.extension.iframe?.contentWindow?.postMessage(msg, this.extension.origin)
    } catch (e) { reject(e) }
  })
}
```
**Impact:** If an iframe never responds (crash, bug, malicious), the promise hangs indefinitely. In-flight requests aren't rejected on `detach()` either — `pending.clear()` just drops the resolvers without calling them.
**Recommendation:** Add configurable timeout to `request()` and reject all pending promises in `detach()`.

#### Finding 4: `ui:*` Actions Are Unprivileged by Default
**File:** `flotilla/src/app/extensions/bridge.ts:161-164`
```typescript
private isPrivileged(action: string): boolean {
  return action.startsWith("nostr:") || action.startsWith("storage:")
}
```
**Impact:** Any extension can spam `ui:toast` notifications without declaring the permission. No rate limiting exists.
**Recommendation:** Either add `ui:` to privileged prefixes or implement rate limiting for `ui:*` actions.

#### Finding 5: Unknown Action Returns `undefined` (Not Error)
**File:** `flotilla/src/app/extensions/bridge.ts:176-181`
```typescript
const handler = bridgeHandlers.get(msg.action)
let result
if (handler) result = await handler(msg.payload, this.extension)
// ← no else branch for unknown action
postMessage({payload: result}) // result is undefined
```
**Impact:** Extensions requesting unimplemented actions (e.g., `nostr:subscribe`) receive a response with `payload: undefined` rather than an error. This makes it impossible for extensions to detect unsupported features.
**Recommendation:** Add an explicit "unknown action" error response.

#### Finding 6: Hardcoded Storage Constants
**File:** `flotilla/src/app/extensions/bridge.ts:301-303`
```typescript
const STORAGE_PREFIX = "flotilla:ext:"
const MAX_STORAGE_KEY_LENGTH = 256
const MAX_STORAGE_VALUE_SIZE = 1024 * 1024 // 1MB
```
**Impact:** Not configurable per deployment. No migration strategy if prefix or format changes. Repo rename changes storage bucket with no data migration path.

---

### Phase 2 — Registry (`registry.ts`)

#### Finding 7: Hardcoded Host Version
**File:** `flotilla/src/app/extensions/registry.ts:255`
```typescript
hostVersion: "1.0.0", // Could be pulled from package.json
```
**Impact:** Extensions cannot reliably detect host capabilities for feature negotiation.
**Recommendation:** Import from `package.json` or a centralized version constant.

#### Finding 8: 10-Second Iframe Load Timeout
**File:** `flotilla/src/app/extensions/registry.ts:205-221`
```typescript
private waitForIframeLoad(iframe: HTMLIFrameElement, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Iframe load timeout")), timeoutMs)
    ...
  })
}
```
**Impact:** No readiness handshake — the iframe's `load` event fires when HTML is parsed, not when the extension's JavaScript is ready to receive messages. Lifecycle events (`widget:init`) sent immediately after may be lost. The 10s timeout is a rough heuristic that can fail for slow CDNs.
**Recommendation:** Implement a readiness handshake: extension sends `widget:ready` after initialization; host waits for that instead of `load` event.

#### Finding 9: 100ms Unload Delay
**File:** `flotilla/src/app/extensions/registry.ts:393-396`
```typescript
ext.bridge.post("widget:unmounting", {timestamp: Date.now()})
await new Promise(resolve => setTimeout(resolve, 100))
```
**Impact:** Arbitrary 100ms doesn't give extensions time for meaningful cleanup. No acknowledgment protocol — just fire-and-wait.
**Recommendation:** Implement `widget:unmounting` → extension sends `widget:unmounted` ack with a reasonable timeout fallback.

#### Finding 10: Hardcoded Iframe Sandbox Policy
**File:** `flotilla/src/app/extensions/registry.ts:340, 376`
```typescript
iframe.sandbox.add("allow-scripts", "allow-same-origin")
```
**Impact:** Extensions cannot declaratively request additional sandbox permissions (e.g., `allow-forms`, `allow-popups`). The repo extension panel route uses `allow-forms` but the registry path doesn't. Third-party extensions behave differently depending on which path loads them.
**Recommendation:** Allow manifests to declare needed sandbox permissions with a validated allowlist.

#### Finding 11: Hidden Container ID Hardcoded
**File:** `flotilla/src/app/extensions/registry.ts:339`
```typescript
const container = document.getElementById("flotilla-extension-container") ?? document.body
```
**Impact:** Coupled to specific DOM structure. Falls back to `document.body` silently if container missing.

#### Finding 12: No In-Flight Load Lock
**Evidence:** `loadRuntime()` checks `existing?.iframe` but has no "loading in progress" guard. Two concurrent calls for the same extension can both pass the check and create duplicate iframes.
**Recommendation:** Add a `loadingPromises` map to deduplicate concurrent loads.

#### Finding 13: Origin Derivation Falls Back to `window.location.origin`
**File:** `flotilla/src/app/extensions/registry.ts:82-91`
```typescript
const deriveWidgetOrigin = (widget: SmartWidgetEvent): string => {
  const candidates = [widget.appUrl, widget.originHint, widget.iconUrl, widget.imageUrl]
  ...
  return window.location.origin  // ← fallback
}
```
**Impact:** For `basic` widgets (no iframe), origin becomes the host's own origin. If a bridge is ever attached to such a widget, it would authorize messages from the host itself, creating a potential security issue.

---

### Phase 3 — Settings & Persistence (`settings.ts`)

#### Finding 14: Identity Collision Risk
**File:** `flotilla/src/app/extensions/settings.ts:60-63`
```typescript
export const getInstalledExtension = (id: string) => {
  const installed = get(extensionSettings).installed
  return installed.nip89[id] ?? installed.widget[id]
}
```
**Impact:** NIP-89 manifests use `manifest.id` as key. Widgets use `identifier` (from `d` tag). Two different authors can publish with the same `id`/`identifier`, causing collisions. At ecosystem scale with relay-loaded extensions, this is a significant security and reliability concern.
**Recommendation:** Use composite keys: `{type}:{pubkey}:{identifier}` for widgets, preserving backward compatibility via migration.

#### Finding 15: Shared `enabled[]` Array
**File:** `flotilla/src/app/extensions/settings.ts:43-47`
```typescript
export type ExtensionSettings = {
  enabled: string[]
  installed: InstalledExtensions
}
```
**Impact:** Both NIP-89 and Widget extensions share the same `enabled` array keyed by bare `id`. Cannot safely install/enable both a NIP-89 extension and its Smart Widget migration with the same id — exactly the migration path the docs recommend.

---

### Phase 4 — Commands & Discovery (`commands.ts`)

#### Finding 16: Discovery Dedup Bug — Keeps First, Not Newest
**File:** `flotilla/src/app/core/commands.ts:250-254`
```typescript
// Comment says "prefer latest by created_at"
const byId = new Map<string, ExtensionManifest>()
for (const m of manifests) {
  if (!byId.has(m.id)) byId.set(m.id, m)  // ← keeps FIRST, not latest
}
```
**Impact:** Relay-first distribution unpredictably selects which version of an extension users see. The comment explicitly states the intended behavior but the code does the opposite. Same bug exists in `discoverSmartWidgets()`.
**Recommendation:** Compare `created_at` and keep newest, or sort by `created_at` descending before dedup.

#### Finding 17: Enable Before Load — Inconsistent State
**File:** `flotilla/src/app/core/commands.ts:271-290`
```typescript
export const enableExtension = async (id: string) => {
  extensionSettings.update(s => ({...s, enabled: [...s.enabled, id]}))  // ← persists first
  // THEN tries to load...
  try { await extensionRegistry.loadIframeExtension(manifest) }
  catch (e) { console.warn("Failed to load extension", id, e) }  // ← no rollback
}
```
**Impact:** If runtime load fails, extension remains marked as "enabled" in settings. Users see "enabled but not working" state with no indication of failure. On next page load, provider will attempt to load again (possibly failing again repeatedly).
**Recommendation:** Only persist enabled state after successful load, or add an "error" state.

#### Finding 18: Hardcoded Discovery Limits
**File:** `flotilla/src/app/core/commands.ts:233, 249`
```typescript
await request({relays: INDEXER_RELAYS, filters: [{kinds: [KIND], limit: 100}]})
// ...
await request({relays: SMART_WIDGET_RELAYS, filters: [{kinds: [SMART_WIDGET_KIND], limit: 200}]})
```
**Impact:** Fixed limits may miss extensions if ecosystem grows. No pagination or continuation. (Superseded by Finding 0d — persistent subscriptions don't need initial limits in the same way.)

#### Finding 19: Hardcoded Pubkey in Job Request
**File:** `flotilla/src/app/core/commands.ts:368`
```typescript
["p", "b4b030aea662b2b47c57fca22cd9dc259079a8b5da89ac5aa2b6661af54ef710"],
```
**Impact:** Job requests always tag this specific pubkey regardless of context.

#### Finding 20: No Replaceable-Event Version Tracking
**Evidence:** Neither `discoverExtensions` nor `discoverSmartWidgets` persist relay hints or `created_at` for installed extensions. No background refresh mechanism exists.
**Impact:** Installed extensions never auto-update. Users must manually reinstall to get updates. (Superseded by Finding 0d — persistent subscriptions naturally deliver updated replaceable events.)

---

### Phase 5 — Environment & Defaults (`state.ts`)

#### Finding 21: Hardcoded Default Relay
**File:** `flotilla/src/app/core/state.ts:173-175`
```typescript
export const SMART_WIDGET_RELAYS =
  envSmartWidgetRelays.length > 0 ? envSmartWidgetRelays : ["wss://relay.yakihonne.com"]
```
**Impact:** Without env var override, all Smart Widget discovery is routed through a single third-party relay. If that relay goes down or changes policy, widget discovery breaks entirely.

#### Finding 22: Hardcoded Kind Constants
**File:** `flotilla/src/app/core/state.ts:183` and `commands.ts:133`
```typescript
export const EXTENSIONS_KIND = 31990
const SMART_WIDGET_KIND = 30033
```
**Impact:** These are fine as constants but should be in the same file for discoverability. Currently split between `state.ts` and `commands.ts`.

---

### Phase 6 — Settings UI (`routes/settings/extensions/+page.svelte`)

#### Finding 23: Recommended ID Mismatch
**File:** `flotilla/src/routes/settings/extensions/+page.svelte:62`
```typescript
{name: "Hello World", url: "/extensions/example.json", id: "hello-world"},
```
But `static/extensions/example.json` has `"id": "example-hello-world"`.
**Impact:** The "Installed" indicator for the Hello World recommended extension will never show correctly because the IDs don't match.

#### Finding 24: No Manifest Validation on Discovery
**File:** `flotilla/src/routes/settings/extensions/+page.svelte:87-94`
```typescript
const m = JSON.parse(e.content)
if (m && m.id && m.name && m.entrypoint) {
  discoveredMap.set(m.id, m as ExtensionManifest)
}
```
**Impact:** No signature validation, no schema validation, no URL normalization, no HTTPS enforcement. Any relay event with `{id, name, entrypoint}` in its content is accepted as a valid extension manifest. Malicious manifests could point to phishing pages.
**Recommendation:** Validate manifest structure, enforce HTTPS for entrypoints, consider web-of-trust verification.

#### Finding 25: Live Discovery Subscription Never Filtered
**File:** `flotilla/src/routes/settings/extensions/+page.svelte:83`
```typescript
request({relays: INDEXER_RELAYS, filters: [{kinds: [31990]}], signal: controller!.signal, ...})
```
**Impact:** Subscribes to ALL kind 31990 events on INDEXER_RELAYS with no author filter, no limit on the subscription. Could receive large volumes of events on busy relays.

---

### Phase 7 — Repo Extension Panel (Dual Runtime Path)

#### Finding 26: Contract Drift — `context:update` vs `context:repoUpdate`
**File:** `flotilla/src/routes/spaces/.../extensions/[extId]/+page.svelte:98`
```typescript
bridge.post("context:update", ctx)  // ← different from registry's "context:repoUpdate"
```
**Impact:** Third-party extensions must listen for BOTH event names to work across both runtime paths.

#### Finding 27: Missing Lifecycle Events
The repo extension panel does NOT send `widget:init` or `widget:mounted` events. Extensions expecting initialization metadata via `widget:init` won't receive it.

#### Finding 28: Fake SmartWidgetEvent Construction
**File:** `flotilla/src/routes/spaces/.../extensions/[extId]/+page.svelte:63-78`
```typescript
return {
  type: "widget",  // ← type is "widget" even though source is NIP-89
  widget: { kind: 30033, widgetType: "tool", ... }  // ← fabricated
}
```
**Impact:** Extensions get wrong type metadata. Storage scoping uses composed `id` (`manifestId:pubkey:name`) that differs from registry path. `repoContext` is never set on this path, so `storage:*` with `repoScoped: true` throws an error.

#### Finding 29: Different Sandbox Policy
```html
sandbox="allow-scripts allow-same-origin allow-forms"  <!-- repo panel -->
```
vs registry's `allow-scripts allow-same-origin` (no `allow-forms`).

#### Finding 30: Fixed Iframe Height
```css
.extension-iframe { height: 600px; }
```
**Impact:** No responsive sizing. Extensions cannot communicate their desired height to the host.

---

### Phase 8 — Dead / Unfinished Features

#### Finding 31: Policy Signer — Dead Code
**File:** `flotilla/src/app/extensions/policySigner.ts`
Kind 31993 policy signing is fully defined but never called anywhere in the codebase. No UI surfaces it. No enforcement exists in the bridge or registry.
**Impact:** The documented user consent flow for extension permissions doesn't exist.

#### Finding 32: `nostr:subscribe` Permission — No Handler
**File:** `flotilla/static/extensions/huddle.json:9`
```json
"permissions": ["nostr:publish", "nostr:subscribe", "ui:toast"]
```
No `registerBridgeHandler("nostr:subscribe", ...)` exists in bridge.ts.
**Impact:** Huddle extension's subscription capability silently fails (returns `undefined`). (See Finding 0c for the architectural significance.)

#### Finding 33: Slot System — Host-Only Registration
**File:** `flotilla/src/app/extensions/slots.ts`
Slot handlers can only be registered by host-side code. Third-party iframe extensions have no mechanism to register slot handlers or mount UI into slot positions.
**Impact:** Third-party extensions can only present UI via dedicated routes (repo extension panel), not via slot-based integration points.

#### Finding 34: Static Manifests — Dev URLs and Empty Hashes
**File:** `flotilla/static/extensions/kanban.json`
```json
"entrypoint": "http://localhost:5178",
"sha256": ""
```
**Impact:** `kanban.json` won't work in production (mixed content over HTTPS). All manifests have empty SHA-256 hashes, making integrity validation a no-op. (See Finding 0e for the architectural concern.)

---

## Root Cause Analysis

The extension system was built incrementally with initial focus on hosted/first-party extensions (NIP-89 manifests for known internal tools). Smart Widget support was added later as a second path. This created:

1. **Nostr treated as REST** — the extension bridge uses a standalone `SimplePool` from nostr-tools with one-shot `querySync` calls and artificial timeouts, instead of leveraging the application's welshman relay infrastructure with persistent subscriptions. Nostr is a pub/sub protocol with persistent connections to relays, EOSE signaling, and real-time event delivery — none of which the extension system uses
2. **Two divergent runtime paths** that were never unified, producing inconsistent behavior for the same extension depending on how it's loaded
3. **Application-specific code leaked into the host framework** — Kanban event kinds, Gas Town protocol kinds, and NIP-100 filter validation rules were built directly into the bridge rather than being declared by extensions. Even the variable name `NIP100_ALLOWED_KINDS` reveals this was designed for a specific extension, not a generic framework
4. **Static bundled manifests** instead of relay-event-driven discovery and loading — the recommended extensions are JSON files served alongside the app, not discovered from relay events
5. **Timeout-based workarounds** standing in for proper event-driven handshakes (readiness, cleanup acknowledgment, EOSE)
6. **An identity model** adequate for a small number of known extensions but insufficient at ecosystem scale
7. **A policy/consent system** that was designed and documented but never wired into the runtime

---

## Recommendations (Prioritized)

### P0 — Architectural Foundation (Nostr-Native)

These changes address the fundamental architectural mismatch and must be done first, as all other improvements build on them.

1. **Replace `SimplePool` with welshman relay integration** in bridge.ts. All extension Nostr operations (`nostr:query`, `nostr:publish`, and the new `nostr:subscribe`) should route through welshman's `request()`, `load()`, and `subscribe()` APIs, sharing the app's relay connections, authentication, and event cache. Extensions (in iframes) continue to depend only on nostr-tools — the welshman integration is entirely host-side.
2. **Implement `nostr:subscribe` as a first-class bridge action** — extensions can open persistent subscriptions and receive real-time events via bridge messages. The host tracks subscriptions per extension and cleans them up on unload. This is the primary data interface for Nostr-native extensions.
3. **Rewrite `nostr:query` as a convenience wrapper** over the subscription model — use welshman's `load()` which handles EOSE properly instead of artificial timeouts. Keep `nostr:query` as a simple "get stored events matching this filter" interface.
4. **Convert extension discovery to persistent subscriptions** — maintain open subscriptions for kind 31990 and kind 30033 events on discovery relays. New/updated extensions appear reactively. The settings page consumes a reactive store, not one-shot async functions.
5. **Externalize the recommended list to relay events** — publish a NIP-51 list referencing extension events by `a`-tag. The app subscribes to this list and discovers referenced extensions from relays. Static bundled manifests become dev-only.

### P0 — Critical for Third-Party Extension Support

6. **Implement Smart Widget Handler protocol compatibility** — add a dual-protocol detection layer so widgets built with `smart-widget-handler` (per the spec) work in Flotilla alongside native bridge extensions. Implement missing spec features: `sign-event`, `user-metadata` delivery, `app-loaded` readiness
7. **Remove all application-specific kinds from the host** (NIP-100 Kanban and Gas Town kinds) and the NIP-100-specific filter validation rules. Extensions must declare their required kinds via `nostrKinds` in their manifest. The host may provide a minimal set of universally-safe read-only kinds (kind 0, 10002) but NO application-specific ones
8. **Unify the two runtime paths** — repo extension panel should reuse `ExtensionRegistry` with `setRepoContext()` instead of constructing its own bridge/fake widget
9. **Fix discovery dedup** to actually select newest `created_at` per identifier
10. **Add "unknown action" error response** in bridge message handler
11. **Fix recommended ID mismatch** (`hello-world` → `example-hello-world`)

### P1 — Required for Production Reliability

12. **Add in-flight load locking** in registry to prevent duplicate iframe creation
13. **Fix provider.svelte race conditions** — add cancellation tokens, await loads properly, reject pending promises on detach
14. **Implement readiness handshake** — replace iframe `load` event with `widget:ready` / `app-loaded` acknowledgment
15. **Fix enable/disable ordering** — only persist enabled state after successful load, or add error state
16. **Add request timeout** to `ExtensionBridge.request()` with configurable duration
17. **Reject pending promises** in `bridge.detach()` instead of silently clearing them

### P2 — Required for Ecosystem Scale

18. **Implement composite extension keys** (`type:pubkey:identifier`) to prevent identity collisions
19. **Separate enabled arrays** for NIP-89 and Widget extensions (or use composite keys)
20. **Add manifest validation** — schema validation, HTTPS enforcement, optional signature verification
21. **Wire policy signer** into the enable flow — require user consent for privileged permissions
22. **Make sandbox policy configurable** per extension with validated allowlist

### P3 — Quality of Life / Polish

23. **Pull `hostVersion` from package.json** instead of hardcoding `"1.0.0"`
24. **Standardize context event names** — pick one of `context:update`/`context:repoUpdate` and use it everywhere
25. **Update template docs** to match actual host contract (`widget:init` payload, correct event names)
26. **Fix static manifest dev URLs** (for any that remain as dev tools)
27. **Rate limit `ui:*` actions** or make them privileged
28. **Add responsive iframe sizing** protocol (extension sends height changes, host resizes)
29. **Add extension error UI** — show users when an extension fails to load with actionable information
30. **Move kind constants** to a single location for discoverability

---

## Dependency Boundary

A critical architectural principle for the extension system:

```
┌─────────────────────────────┐
│  Extension (iframe)          │
│  - nostr-tools only          │
│  - postMessage bridge client │
│  - No relay connections      │
│  - Requests: nostr:query,    │
│    nostr:subscribe,          │
│    nostr:publish             │
└──────────┬──────────────────┘
           │ postMessage
┌──────────┴──────────────────┐
│  Host Bridge (bridge.ts)     │
│  - Receives bridge requests  │
│  - Routes through welshman   │
│  - Manages subscriptions     │
│  - Tracks per-extension subs │
│  - Cleanup on unload         │
└──────────┬──────────────────┘
           │
┌──────────┴──────────────────┐
│  Welshman Relay Pool         │
│  - Shared connections        │
│  - Auth (NIP-42)             │
│  - Connection pooling        │
│  - Router/relay selection    │
│  - Event cache (repository)  │
└─────────────────────────────┘
```

**Extensions** depend only on `nostr-tools` for event construction, signing, and utility functions. They never open relay connections directly. All Nostr operations go through the bridge.

**The host bridge** is the only place that touches welshman. It translates bridge requests into welshman operations, tracks active subscriptions per extension, and handles cleanup on extension unload.

This means:
- Extensions are lightweight and have no framework coupling
- The host controls all relay access (security, rate limiting, policy enforcement)
- Welshman's connection pooling and auth benefit all extensions transparently
- Extension developers only need to know the bridge protocol, not welshman internals

---

## Preventive Measures

1. **Single runtime path principle** — all extension hosting should go through `ExtensionRegistry`. New routes should call registry methods, not construct their own bridges.
2. **Subscription-first design** — new bridge actions that involve relay data should default to subscription-based interfaces, with one-shot queries as convenience wrappers.
3. **No application-specific code in the host** — any code that references specific event kinds, tag schemas, or protocol logic belongs in the extension, not the host framework.
4. **Contract tests** — add automated tests that verify the host sends expected lifecycle events in the correct order with the correct payloads. Run these against both NIP-89 and Widget paths.
5. **Extension integration test harness** — a minimal test extension that validates it receives all expected events and can exercise all bridge actions, run as part of CI.
6. **Manifest schema validation** — define a JSON Schema for manifests and validate at install time.
7. **Version negotiation** — extensions should be able to query host capabilities before attempting to use them (vs. discovering "unknown action" at runtime).
8. **Documentation as code** — generate bridge handler documentation from the registered handler map so docs can never drift from implementation.

---

_Investigation completed: 2026-02-15_
_Updated: 2026-02-15 — Added Phase 0 architectural findings (0a-0e), dependency boundary diagram, Nostr-native recommendations_
_Files examined: bridge.ts, registry.ts, settings.ts, types.ts, slots.ts, policySigner.ts, provider.svelte, commands.ts, state.ts, sync.ts, +page.svelte (settings/extensions), +page.svelte (repo extensions), static manifests (4), docs (6), template docs (5), kanban extension docs (5), create-flotilla-widget CLI_
