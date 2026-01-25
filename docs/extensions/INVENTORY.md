# Budabit Extension Framework Inventory

> Audit of the current Flotilla extension framework implementation.

This document provides a comprehensive inventory of the existing extension system, including entry points, lifecycle hooks, rendering models, persistence assumptions, and divergences from the Smart Widgets NIP specification.

---

## Table of Contents

1. [Framework Architecture](#framework-architecture)
2. [Core Files](#core-files)
3. [Extension Types](#extension-types)
4. [Registry System](#registry-system)
5. [Bridge Protocol](#bridge-protocol)
6. [Lifecycle Hooks](#lifecycle-hooks)
7. [Storage & Persistence](#storage--persistence)
8. [Permission System](#permission-system)
9. [Slot System](#slot-system)
10. [Divergences from Smart Widgets NIP](#divergences-from-smart-widgets-nip)

---

## Framework Architecture

The Flotilla extension system supports two runtime paths:

```
                    +--------------------------+
                    |    ExtensionSettings     |
                    |  (localStorage synced)   |
                    +------------+-------------+
                                 |
                    +------------v-------------+
                    |   ExtensionRegistry      |
                    |   (singleton store)      |
                    +------------+-------------+
                                 |
         +-----------------------+------------------------+
         |                                                |
+--------v---------+                           +----------v---------+
| NIP-89 Extensions |                          |   Smart Widgets    |
| (kind 31990)      |                          |   (kind 30033)     |
+--------+---------+                           +----------+---------+
         |                                                |
         |    +------------------+                        |
         +--->|  ExtensionBridge |<-----------------------+
              |  (postMessage)   |
              +--------+---------+
                       |
              +--------v---------+
              |  Sandboxed       |
              |  iframe          |
              +------------------+
```

---

## Core Files

### Primary Implementation Files

| File | Purpose |
|------|---------|
| `src/app/extensions/types.ts` | Type definitions for manifests, widgets, slots, and loaded extensions |
| `src/app/extensions/registry.ts` | Singleton registry for managing extension lifecycle |
| `src/app/extensions/bridge.ts` | postMessage protocol implementation and bridge handlers |
| `src/app/extensions/settings.ts` | Persistence layer (localStorage via welshman synced store) |
| `src/app/extensions/slots.ts` | UI slot registration and rendering |
| `src/app/extensions/policySigner.ts` | Kind 31993 policy event signing/verification |
| `src/app/extensions/provider.svelte` | Svelte component that manages extension loading |
| `src/app/extensions/index.ts` | Public exports |

### Supporting Files

| File | Purpose |
|------|---------|
| `src/app/core/commands.ts` | Install/uninstall/enable/disable commands |
| `src/routes/settings/extensions/+page.svelte` | Settings UI for extension management |

---

## Extension Types

### Type Definitions (`types.ts`)

```typescript
// NIP-89 Manifest Extension
type ExtensionManifest = {
  id: string
  name: string
  description?: string
  author?: string
  homepage?: string
  version?: string
  permissions?: string[]
  entrypoint: string
  icon?: string
  sha256?: string
  kind?: number
  slot?: ExtensionSlotConfig
}

// Smart Widget Event (kind 30033)
type SmartWidgetEvent = {
  id: string
  kind: 30033
  content: string
  pubkey?: string
  created_at?: number
  tags: string[][]
  identifier: string
  widgetType: "basic" | "action" | "tool"
  imageUrl?: string
  iconUrl?: string
  inputLabel?: string
  buttons: WidgetButton[]
  appUrl?: string
  permissions?: string[]
  originHint?: string
}

// Widget Button Types
type WidgetButtonType = "redirect" | "nostr" | "zap" | "post" | "app"
```

### Loaded Extension States

```typescript
type LoadedNip89Extension = {
  type: "nip89"
  id: string
  manifest: ExtensionManifest
  origin: string
  iframe?: HTMLIFrameElement
  bridge?: ExtensionBridge
  repoContext?: RepoContext
}

type LoadedWidgetExtension = {
  type: "widget"
  id: string
  widget: SmartWidgetEvent
  origin: string
  iframe?: HTMLIFrameElement
  bridge?: ExtensionBridge
  repoContext?: RepoContext
}
```

---

## Registry System

### `ExtensionRegistry` (Singleton)

The registry manages extension state via a Svelte writable store:

| Method | Description |
|--------|-------------|
| `register(manifest)` | Register a NIP-89 manifest extension |
| `registerWidget(event)` | Register a Smart Widget from parsed event |
| `unregister(id)` | Remove extension from registry |
| `get(id)` | Retrieve loaded extension by ID |
| `list()` | List all registered extensions |
| `setRepoContext(id, ctx)` | Attach repository context for scoped storage |
| `load(manifestUrl)` | Fetch, validate, and register a manifest |
| `loadWidget(event)` | Parse and load a Smart Widget |
| `loadIframeExtension(manifest)` | Create iframe and attach bridge for NIP-89 |
| `unloadExtension(id)` | Cleanup iframe, bridge, and unregister |
| `asStore()` | Return derived Svelte store of extensions |

### Smart Widget Parsing (`parseSmartWidget`)

Extracts structured data from kind 30033 events:

- `identifier` from `d` tag (fallback: event ID)
- `widgetType` from `l` tag (defaults to "basic")
- `imageUrl` from `image` tag (required for action/tool)
- `iconUrl` from `icon` tag
- `inputLabel` from `input` tag
- `buttons` from `button` tags
- `appUrl` from first button with type "app"
- `permissions` from `permission` or `perm` tags
- `originHint` from `client` tag

---

## Bridge Protocol

### Message Types (`ExtensionMessage`)

```typescript
type ExtensionMessage = {
  id?: string
  type: "request" | "response" | "event"
  action: string
  payload?: any
}
```

### Registered Bridge Handlers

| Action | Permission Required | Description |
|--------|---------------------|-------------|
| `nostr:publish` | `nostr:publish` | Publish signed Nostr events |
| `nostr:query` | `nostr:query` | Query relays for events (kinds 30301, 30302 only) |
| `ui:toast` | None | Display toast notification |
| `storage:get` | `storage:get` | Read from scoped localStorage |
| `storage:set` | `storage:set` | Write to scoped localStorage |
| `storage:remove` | `storage:remove` | Remove from scoped localStorage |
| `storage:keys` | `storage:keys` | List storage keys |
| `context:getRepo` | None | Get current repository context |

### Host-to-Widget Events (outbound)

| Action | Description |
|--------|-------------|
| `widget:init` | Sent after bridge attachment with extension metadata |
| `widget:mounted` | Sent after init with timestamp |
| `widget:unmounting` | Sent before cleanup |
| `context:repoUpdate` | Sent when repository context changes |

---

## Lifecycle Hooks

### Extension Lifecycle

```
1. Discovery
   - NIP-89: Fetch kind 31990 events from INDEXER_RELAYS
   - Widget: Fetch kind 30033 events from SMART_WIDGET_RELAYS

2. Installation
   - Parse manifest/event
   - Store in extensionSettings.installed.{nip89|widget}

3. Registration
   - Call registry.register() or registry.registerWidget()
   - Extension added to store (no iframe yet)

4. Enablement
   - Add ID to extensionSettings.enabled[]
   - Trigger loadRuntime()

5. Loading (loadRuntime)
   - Create sandboxed iframe (action/tool widgets, NIP-89)
   - Wait for iframe load event
   - Attach ExtensionBridge
   - Send widget:init + widget:mounted events

6. Active
   - Bridge processes request/response/event messages
   - Storage scoped by extension ID (and optionally repo context)

7. Unloading (unloadExtension)
   - Send widget:unmounting event
   - Brief delay for cleanup
   - Detach bridge
   - Remove iframe from DOM
   - Unregister from store
```

### Provider Component (`provider.svelte`)

The `ExtensionProvider` Svelte component:

1. Subscribes to `extensionSettings` for enabled IDs
2. Subscribes to `extensionRegistry.asStore()` for registered extensions
3. Calls `loadIframeExtension()` or `loadWidget()` for enabled extensions
4. Tracks loaded IDs to prevent duplicate loading
5. Cleans up on destroy

---

## Storage & Persistence

### Settings Store (`extensionSettings`)

```typescript
type ExtensionSettings = {
  enabled: string[]
  installed: {
    nip89: Record<string, ExtensionManifest>
    widget: Record<string, SmartWidgetEvent>
    legacy?: Record<string, unknown>  // auto-migrated
  }
}
```

Key: `flotilla/extensions` in localStorage

### Extension-Scoped Storage

Bridge handlers scope storage keys:

```
flotilla:ext:{extId}:{key}                           // global scope
flotilla:ext:{extId}:repo:{pubkey}:{name}:{key}      // repo scope
```

Limits:
- Max key length: 256 characters
- Max value size: 1MB

---

## Permission System

### Permission Model

- Permissions declared in `manifest.permissions[]` (NIP-89) or `permission` tags (Widget)
- Default: deny all privileged actions
- Privileged prefixes: `nostr:*`, `storage:*`
- Non-privileged: `ui:*` (allowed by default)

### Policy Events (Kind 31993)

```typescript
const EXTENSION_POLICY_KIND = 31993

// Tags:
// ["manifest", manifestId]
// ["granted", "true"|"false"]
```

Note: Policy events are defined but not currently enforced in the runtime.

---

## Slot System

### Available Slot IDs

```typescript
type ExtensionSlotId =
  | "chat:composer:actions"
  | "chat:message:actions"
  | "room:header:actions"
  | "room:panel"
  | "global:menu"
  | "settings:panel"
  | "space:sidebar:widgets"
```

### Slot Configuration (for NIP-89)

```typescript
type ExtensionSlotConfig = {
  type: "repo-tab"
  label: string
  path: string         // URL path segment
  builtinRoute?: string // For built-in extensions
}
```

### Slot API

```typescript
registerSlotHandler(slot: ExtensionSlotId, handler: ExtensionSlotHandler)
getSlotHandlers(slot: ExtensionSlotId): ExtensionSlotHandler[]
invokeSlot(slot, {root, context, extension})
renderSlot(slot, root, context, extension)
```

---

## Divergences from Smart Widgets NIP

### Implemented Features

| NIP Feature | Flotilla Status |
|-------------|-----------------|
| Kind 30033 event structure | Implemented |
| Widget types (basic/action/tool) | Implemented |
| Button types (redirect/nostr/zap/post/app) | Parsed, app type used for iframe URL |
| Input field | Parsed (`inputLabel`), not rendered by host |
| Image/icon tags | Parsed and stored |
| Permission tags | Implemented and enforced |

### Flotilla-Specific Extensions

| Feature | Description |
|---------|-------------|
| `nostr:query` action | Query relays (limited to kinds 30301, 30302) |
| `storage:*` actions | Scoped localStorage access |
| `context:getRepo` | Get repository context |
| `context:repoUpdate` | Receive repo context changes |
| `widget:init/mounted/unmounting` | Lifecycle events |
| Repository scoping | Extensions can operate in repo-scoped mode |

### Divergences and Gaps

| NIP Feature | Flotilla Behavior |
|-------------|-------------------|
| `basic` widget rendering | Host-rendered via slots (no iframe) |
| POST button handling | Not implemented (buttons parsed but not executed) |
| `smart-widget-handler` protocol | Different lifecycle events (`widget:*` vs `SWHandler.*`) |
| `/.well-known/widget.json` | Not consumed by host |
| `redirect` button | Not handled by host |
| `zap` button | Not handled by host |
| `nostr` button | Not handled by host |
| Widget reply events | Not implemented |
| Input submission | Not implemented |

### Security Model Differences

| Aspect | NIP Spec | Flotilla Implementation |
|--------|----------|------------------------|
| Iframe sandbox | Recommended | `allow-scripts allow-same-origin` enforced |
| Origin validation | Recommended | Strictly enforced in bridge |
| Permission model | Tag-based | Same, with additional `storage:*` namespace |
| Content Security | CSP recommended | Inherits host CSP |

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Core TypeScript files | 7 |
| Bridge handlers | 8 |
| Slot types | 7 |
| Lifecycle events | 4 |
| Extension types | 2 (nip89, widget) |
| Widget types | 3 (basic, action, tool) |
| Button types | 5 (redirect, nostr, zap, post, app) |
| Storage scopes | 2 (global, repo) |

---

## Related Documentation

- [`README.md`](./README.md) - Developer guide
- [`XX.md`](./XX.md) - Smart Widget NIP specification
- [`BREAKING_CHANGES.md`](./BREAKING_CHANGES.md) - Migration breaking changes
- [`MIGRATION.md`](./MIGRATION.md) - Migration guidance

---

_Last updated: 2026-01-24_
