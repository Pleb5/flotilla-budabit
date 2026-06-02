# Architecture Overview

Technical architecture of Flotilla Smart Widgets.

> **Note:** This document covers Smart Widget architecture specifically. Flotilla also supports NIP-89 Manifest Extensions (kind 31990), which share the same postMessage bridge protocol but differ in discovery and registration. For the full extension architecture covering both models, see the [Flotilla Extension Developer Guide](../../../docs/extensions/README.md).

## System Architecture

Flotilla Smart Widgets are represented on Nostr as **kind `30033` addressable events**. Flotilla discovers these events, renders them into the UI, and (for `action`/`tool` widgets) loads an **iframe UI** that communicates with the host using an **action-based postMessage protocol**.

```
┌─────────────────────────────────────────────────────────────┐
│                         Nostr Network                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Relays (wss://relay.damus.io, etc.)                   │ │
│  │  - Store and forward kind 30033 events                 │ │
│  │  - Distribute to subscribers                           │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           ▲  │
                           │  │ WebSocket
                           │  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Flotilla Host Application                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                Smart Widget Registry                     │ │
│  │  - Discovers kind 30033 events                           │ │
│  │  - Parses tags (d, l, icon, image, button, permission)   │ │
│  │  - Chooses render strategy (basic/action/tool)           │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│                 Host Widget Bridge (postMessage)            │
│  │  - Enforces privileged actions via permissions           │ │
│  │  - Performs host-side capabilities (publish, storage)    │ │
│  │  - Routes request/response/event messages                │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           ▲  │
                           │  │ postMessage (action protocol)
                           │  ▼
┌─────────────────────────────────────────────────────────────┐
│            Sandboxed iframe (Widget UI, Svelte)              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │             WidgetBridge (@flotilla/ext-shared)          │ │
│  │  - request(action, payload) -> Promise(responsePayload) │ │
│  │  - onEvent(action, handler)                             │ │
│  │  - onRequest(action, handler)  (tool widgets)           │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                     Widget Logic                         │ │
│  │  - UI interactions                                       │ │
│  │  - Requests host actions (nostr:publish, ui:toast, ...)   │ │
│  │  - Optional: handles host context events                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Smart Widget Model

### Widget Types

Flotilla supports multiple widget types. This template demonstrates an **iframe-based `tool` widget** (bidirectional).

- **basic**: Host-rendered (no iframe). Not covered by this template.
- **action**: Iframe-based, typically one-way UX (host may not call back for work).
- **tool**: Iframe-based, bidirectional (host and widget can both initiate work).

### Smart Widget Event (kind 30033)

A Smart Widget is described by a kind `30033` Nostr event. Key tags (as expected by Flotilla):

- `d`: unique identifier (addressable key)
- `l`: widget type label (e.g., `tool` or `action`)
- `icon`, `image`: display metadata
- `button`: launch button definition, including `app` URL for iframe widgets
- `permission`: declared permissions for privileged actions

Example tag set:

```json
{
  "kind": 30033,
  "content": "My Smart Widget",
  "tags": [
    ["d", "my-smart-widget"],
    ["l", "tool"],
    ["icon", "https://cdn.example.com/my-widget/icon.png"],
    ["image", "https://cdn.example.com/my-widget/preview.png"],
    ["button", "Open", "app", "https://cdn.example.com/my-widget/index.html"],
    ["permission", "nostr:publish"],
    ["permission", "ui:toast"]
  ],
  "created_at": 1700000000
}
```

## Lifecycle

```
1. Discovery (query kind 30033)
   ↓
2. Parse + validate widget event (tags, urls, type)
   ↓
3. Permission review (declared permission tags)
   ↓
4. Iframe creation (sandboxed, allow-list capabilities)
   ↓
5. Widget active (postMessage request/response/event)
   ↓
6. Cleanup (remove iframe, listeners, pending requests)
```

Notes:
- There is no required "ready" handshake in the canonical Smart Widget protocol.
- Widgets should be resilient: render UI and be usable even if host context is not provided.

## Communication Flow (Action-Based Protocol)

### Wire Protocol

Smart Widgets communicate with Flotilla using these message shapes:

- Widget -> Host **request**:
  - `{ type: "request", id, action, payload }`
- Host -> Widget **response**:
  - `{ type: "response", id, action, payload }`
- Host -> Widget **event**:
  - `{ type: "event", action, payload }`

### Example: Widget Requests a Publish

```
Widget iframe                         Host
    │                                  │
    │ request nostr:publish             │
    ├─────────────────────────────────>│
    │                                  │
    │                    validate permission + payload
    │                                  │
    │                    publish to relays (host capability)
    │                                  │
    │ response nostr:publish            │
    │<─────────────────────────────────┤
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

### Shared Package (`@flotilla/ext-shared`)

Framework-agnostic, reusable building blocks:

- `WidgetWireMessage`, `WidgetActionMap`, `WidgetContext`
- `WidgetBridge`: action-based postMessage bridge for iframes
- Nostr helpers: `createEvent`, `validateEvent`, etc.

### Iframe App (`@flotilla/ext-iframe`)

A Svelte 5 Smart Widget UI demonstrating a `tool` widget:

- Calls host actions via `bridge.request(\"nostr:publish\", ...)`
- Shows UI feedback via `bridge.request(\"ui:toast\", ...)`
- Handles lifecycle events: `widget:init`, `widget:mounted`, `widget:unmounting`
- Optionally handles `context:repoUpdate` for repository context changes

### Manifest/Generator (`@flotilla/ext-manifest`)

Smart Widget generator CLI:

- Generates unsigned kind `30033` event JSON
- Generates `widget.json` for optional `/.well-known/widget.json` hosting
- Generates `PUBLISHING.md` with signing + publishing steps (including naddr hint when possible)

### Test Utilities (`@flotilla/test-utils`)

Mocks for action-based request/response/event messaging to make unit tests predictable.

### Worker (`@flotilla/ext-worker`) (Optional)

Stubbed worker bridge aligned with the same action protocol (useful for future background tasks).

## Security Architecture

### Sandboxing

Widgets run in sandboxed iframes to isolate untrusted code:

- No access to the parent DOM
- No access to user private keys (signing/publishing occurs in host)
- Communication only via postMessage

Recommended sandbox baseline:

- `sandbox=\"allow-scripts allow-same-origin\"`

Additional capabilities (camera/microphone/screen share) must be explicitly granted by the host via iframe `allow=` and should correspond to explicit user intent.

### Privileged Actions + Permissions

Flotilla may treat some actions as privileged (for example `nostr:*` and `storage:*`) and enforce them based on the widget’s declared `permission` tags.

- Widget declares: `permission` tags (e.g., `nostr:publish`)
- Host enforces: checks action string against declared permissions
- Widget should handle permission denial as a normal error case (display a toast, etc.)

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
Generate kind 30033 event + widget.json
    ↓
Sign + publish kind 30033 to Nostr relays
```

## Testing Architecture

### Unit Tests (Vitest)

- Bridge request/response correlation
- Message parsing and schema validation (where applicable)
- Nostr helper logic

### E2E Tests (Playwright)

- Load the built widget
- Simulate host request/response
- Assert UI updates and outgoing messages

## Deployment Architecture

```
Developer                     CDN                       Nostr Network
   │                           │                           │
   │ build (pnpm build)        │                           │
   │                           │                           │
   │ upload widget UI          │                           │
   ├──────────────────────────>│                           │
   │                           │                           │
   │ generate event.json       │                           │
   │ pnpm manifest:generate    │                           │
   │                           │                           │
   │ sign + publish kind 30033 │                           │
   ├──────────────────────────────────────────────────────>│
   │                           │                           │
User's Flotilla                │                           │
   │ query kind 30033          │                           │
   ├──────────────────────────────────────────────────────>│
   │ receive widget event      │                           │
   │<───────────────────────────────────────────────────────┤
   │ load iframe from button/app URL                         │
   ├──────────────────────────>│                           │
   │                           │                           │
   │ render widget UI in iframe │                           │
```

## Performance Considerations

- Keep widget UI small and fast to load.
- Avoid heavy dependencies.
- Use host actions for privileged operations (publish, storage) rather than embedding sensitive logic.

## Future Enhancements

Potential improvements:

- Standardize more host -> widget events (context, theme, route, selection, etc.)
- Richer capability negotiation beyond action strings
- Cross-widget messaging via host routing (not direct postMessage)
- Optional integrity verification / content addressing for hosted widget HTML

## Resources

- [Nostr NIP-33: Parameterized Replaceable Events](https://github.com/nostr-protocol/nips/blob/master/33.md)
- [postMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#attr-sandbox)
- [Svelte 5](https://svelte.dev)
