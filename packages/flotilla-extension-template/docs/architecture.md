# Architecture Overview

Technical architecture of BudaBit Smart Widgets.

> **Note:** This document covers Smart Widget architecture for BudaBit. For host-specific behavior, see the [BudaBit Extension Developer Guide](../../../docs/extensions/README.md).

## System Architecture

BudaBit Smart Widgets are represented on Nostr as **kind `30033` addressable events**. BudaBit discovers these events via persistent relay subscriptions, renders them into the UI, and (for `action`/`tool` widgets) loads an **iframe UI** that communicates with the host using an **action-based postMessage protocol**.

```
┌─────────────────────────────────────────────────────────────┐
│                         Nostr Network                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Relays (wss://relay.damus.io, etc.)                   │  │
│  │  - Store and forward kind 30033 events                 │  │
│  │  - Persistent subscriptions (not one-shot queries)     │  │
│  │  - New/updated widgets appear automatically            │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ▲  │
                           │  │ WebSocket (via welshman)
                           │  ▼
┌─────────────────────────────────────────────────────────────┐
│                    BudaBit Host Application                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │           Discovery Service (discovery.ts)              │  │
│  │  - Persistent subscriptions for kind 30033             │  │
│  │  - Reactive Svelte stores for discovered extensions    │  │
│  │  - Auto-update detection for installed extensions      │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │           Extension Registry (registry.ts)              │  │
│  │  - Lifecycle management (load locking, readiness)      │  │
│  │  - Unified runtime for all extension types             │  │
│  │  - Error tracking per extension                         │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │         Host Widget Bridge (bridge.ts)                  │  │
│  │  - Enforces permissions + nostrKinds                   │  │
│  │  - Routes Nostr operations through welshman            │  │
│  │  - Manages per-extension subscriptions (max 10)        │  │
│  │  - Rate limits ui:* actions                            │  │
│  │  - 30s request timeout, reject on detach               │  │
│  │  - Dual-protocol: BudaBit + SW Handler compat         │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ▲  │
                           │  │ postMessage
                           │  ▼
┌─────────────────────────────────────────────────────────────┐
│            Sandboxed iframe (Widget UI, Svelte)              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │             WidgetBridge (@budabit/ext-shared)          │  │
│  │  - request(action, payload) → Promise<response>        │  │
│  │  - onEvent(action, handler)                             │  │
│  │  - signalReady()                                        │  │
│  │  - subscribe(opts) → { unsubscribe() }                  │  │
│  │  - nostr-tools dependency only (no welshman)            │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                     Widget Logic                         │  │
│  │  - UI interactions                                       │  │
│  │  - Requests host actions (nostr:publish, nostr:query)    │  │
│  │  - Opens subscriptions (nostr:subscribe)                │  │
│  │  - Handles lifecycle events                              │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Dependency Boundary

```
Extensions (iframes)          Host Bridge            Welshman Relay Pool
─────────────────────   ───────────────────────   ─────────────────────
nostr-tools ONLY          welshman integration       Shared connections
signalReady()             widget:init / ready        Auth, NIP-42
request('nostr:query')    → load() via welshman      Connection pooling
subscribe()               → request() via welshman
request('nostr:publish')  → publishThunk()
```

Extensions **never** import or depend on welshman. The postMessage bridge is the boundary.

## Widget Types

- **basic**: Host-rendered (no iframe). Not covered by this template.
- **action**: Iframe-based, one-way UX.
- **tool**: Iframe-based, bidirectional (host and widget can both initiate work).

This template demonstrates a **`tool` widget** (bidirectional).

## Lifecycle

```
1. Discovery (persistent subscriptions for kind 30033)
   ↓
2. Parse + validate (tags, urls, type, nostrKinds)
   ↓
3. Permission review (declared permission tags)
   ↓
4. Iframe creation (sandboxed, allow-list capabilities)
   ↓
5. Bridge attachment + widget:init sent
   ↓
6. Readiness handshake:
   - Widget calls bridge.signalReady()
   - Or sends {kind: "app-loaded"} (SW Handler compat)
   - Or 5s timeout fallback
   ↓
7. widget:mounted sent → Widget fully active
   ↓
8. Active:
   - Bridge processes request/response/event messages
   - Subscriptions tracked per-extension (max 10)
   - Rate limiting on ui:* actions
   ↓
9. Unloading:
   - All subscriptions aborted
   - widget:unmounting sent
   - Bridge detached (pending promises rejected)
   - Iframe removed
```

## Communication Flow

### Wire Protocol

```ts
type WidgetWireMessage =
  | { type: 'request'; id: string; action: string; payload?: unknown }
  | { type: 'response'; id: string; action: string; payload?: unknown }
  | { type: 'event'; action: string; payload?: unknown };
```

### Example: Widget Publishes an Event

```
Widget iframe                         Host
    │                                  │
    │ request nostr:publish            │
    ├─────────────────────────────────>│
    │                                  │
    │               validate permission + nostrKinds
    │               sign via host signer
    │               publish via welshman publishThunk
    │                                  │
    │ response nostr:publish           │
    │<─────────────────────────────────┤
```

### Example: Real-time Subscription

```
Widget iframe                         Host
    │                                  │
    │ request nostr:subscribe          │
    ├─────────────────────────────────>│
    │                                  │
    │               validate + open via welshman request()
    │                                  │
    │ response {status: "ok"}          │
    │<─────────────────────────────────┤
    │                                  │
    │ event nostr:subscription:event   │  ← real-time
    │<─────────────────────────────────┤
    │ event nostr:subscription:event   │  ← real-time
    │<─────────────────────────────────┤
    │ event nostr:eose {relay}         │  ← stored events done
    │<─────────────────────────────────┤
    │                                  │
    │ request nostr:unsubscribe        │
    ├─────────────────────────────────>│
```

### Example: Host Sends Lifecycle Events

The host sends lifecycle events at key moments. See [Lifecycle Events](./lifecycle.md) for full documentation.

**Initialization:**

- `widget:init` - Initial context with extensionId, repoContext, hostVersion

**Mount:**

- `widget:mounted` - Iframe loaded and bridge ready

**Context Updates:**

- `context:repoUpdate` - Repository context has changed

**Cleanup:**

- `widget:unmounting` - Widget about to be removed, cleanup now

```
Host                                Widget iframe
  │                                     │
  │ event widget:init                   │
  ├────────────────────────────────────>│
  │     { extensionId, repoContext,     │
  │       hostVersion }                 │
  │                                     │
  │ event widget:mounted                │
  ├────────────────────────────────────>│
  │     { mountedAt, slot, viewport }   │
  │                                     │
  │                          updates UI, starts operations
```

Widgets can also proactively fetch context using `context:getRepo` request action.

## Package Architecture (Template)

### Shared Package (`@budabit/ext-shared`)

Framework-agnostic, reusable building blocks:

- `WidgetWireMessage`, `WidgetActionMap` — full type definitions for all actions and events
- `WidgetBridge` — action-based postMessage bridge with `signalReady()` and `subscribe()` helpers
- `WidgetInitPayload`, `RepoContext` — lifecycle event types
- Nostr helpers: `createEvent`, `validateEvent`, etc.

### Iframe App (`@budabit/ext-iframe`)

Svelte 5 Smart Widget UI demonstrating a `tool` widget:

- Calls host actions via `bridge.request(\"nostr:publish\", ...)`
- Shows UI feedback via `bridge.request(\"ui:toast\", ...)`
- Handles lifecycle events: `widget:init`, `widget:mounted`, `widget:unmounting`
- Optionally handles `context:repoUpdate` for repository context changes

### Manifest/Generator (`@budabit/ext-manifest`)

Smart Widget generator CLI:

- Generates unsigned kind `30033` event JSON with `nostrKinds` tags
- Accepts `--nostr-kinds "30301,30302"` flag
- Generates `widget.json` for optional `/.well-known/widget.json`
- Generates `PUBLISHING.md` with signing + publishing steps

### Test Utilities (`@budabit/test-utils`)

Mocks for action-based request/response/event messaging.

### Worker (`@budabit/ext-worker`) (Optional)

Stubbed worker bridge aligned with the same action protocol.

## Security Architecture

### Sandboxing

- Baseline: `sandbox="allow-scripts allow-same-origin"`
- No access to parent DOM or user private keys
- Additional capabilities (camera/microphone) must be explicitly granted

### Permission Enforcement

- **Privileged:** `nostr:*`, `storage:*` — require explicit `permission` tags
- **Rate-limited:** `ui:*` — 10 actions / 5 seconds / extension
- **nostrKinds:** queries/subscriptions only for declared kinds + universal (0, 10002)
- **Unknown actions:** return `{error: "Unsupported action: \"...\""}` (not undefined)

### Message Validation

Hosts should validate:

- `origin` of the message
- the message shape (`type`, `action`, `id`)
- payload schema per action
- rate limits for expensive/privileged actions

Widgets should:

- validate incoming messages (defensive parsing)
- never trust host-provided payloads as safe without checking types

## Data Flow

### UI / Local State

Widgets typically manage:

- local reactive state (Svelte)
- host-provided context via lifecycle events (`widget:init`, `context:repoUpdate`)
- async in-flight requests (publish results, error states)

### Nostr Publish Flow (Host Capability)

```
User action
    ↓
Widget creates UnsignedEvent
    ↓
Widget request(\"nostr:publish\", event)
    ↓
Host validates permission + payload
    ↓
Host signs/publishes (host-controlled capability)
    ↓
Host responds with ok/error
    ↓
Widget updates UI + optionally requests ui:toast
```

## Build Architecture

### Development

```
Source (.svelte, .ts)
    ↓
Vite dev server
    ↓
Browser iframe (http://localhost:5173)
```

### Production

```
Source Files
    ↓
TypeScript + Svelte compile
    ↓
Vite bundling
    ↓
Static assets (index.html, JS, CSS)
    ↓
Host on HTTPS (CDN)
    ↓
Generate kind 30033 event (with nostrKinds) + widget.json
    ↓
Sign + publish kind 30033 to Nostr relays
```

## Resources

- [Nostr NIP-33: Parameterized Replaceable Events](https://github.com/nostr-protocol/nips/blob/master/33.md)
- [postMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#attr-sandbox)
- [smart-widget-handler](https://www.npmjs.com/package/smart-widget-handler)
- [Svelte 5](https://svelte.dev)
