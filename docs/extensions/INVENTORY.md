# Budabit Extension Framework Inventory

This document inventories the current Budabit extension framework implementation: Smart Widgets, their lifecycle, persistence, bridge protocol, slots, and known gaps against the Smart Widget draft.

---

## Framework Architecture

Budabit supports a single extension runtime path: Smart Widgets published as Nostr `kind:30033` events.

```text
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
                    +------------v-------------+
                    |      Smart Widgets       |
                    |      (kind 30033)        |
                    +------------+-------------+
                                 |
                    +------------v-------------+
                    |   ExtensionBridge        |
                    |   (postMessage)          |
                    +------------+-------------+
                                 |
                    +------------v-------------+
                    | Sandboxed iframe         |
                    | for action/tool widgets  |
                    +--------------------------+
```

`basic` widgets are host-rendered through slot handlers and do not need iframes.

---

## Core Files

| File | Purpose |
| --- | --- |
| `src/app/extensions/types.ts` | Type definitions for widgets, slots, contexts, and loaded widget extensions. |
| `src/app/extensions/registry.ts` | Singleton registry for parsing, registering, loading, and unloading widgets. |
| `src/app/extensions/bridge.ts` | postMessage protocol implementation and bridge handlers. |
| `src/app/extensions/settings.ts` | Persistence layer for installed/enabled widgets and install sources. |
| `src/app/extensions/slots.ts` | Generic UI slot registration/rendering helpers. |
| `src/app/extensions/community-curation.ts` | Community profile validation and curated widget loading. |
| `src/app/extensions/community-widget-slots.ts` | Community-scoped widget slot lookup/cache helpers. |
| `src/app/extensions/provider.svelte` | Svelte component that preloads enabled widget runtimes when needed. |
| `src/app/extensions/index.ts` | Public exports. |
| `src/app/core/commands.ts` | Install/uninstall/enable/disable/update commands. |
| `src/routes/settings/extensions/+page.svelte` | Settings UI for extension management and discovery. |

---

## Extension Types

### Smart Widget Event

```ts
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
  appUrls?: string[]
  permissions?: string[]
  originHint?: string
  version?: string
  changelog?: string
  slot?: WidgetSlotConfig
}
```

### Loaded Extension State

```ts
type LoadedWidgetExtension = {
  type: "widget"
  id: string
  widget: SmartWidgetEvent
  origin: string
  iframe?: HTMLIFrameElement
  bridge?: ExtensionBridge
  communityContext?: CommunityWidgetContext
  repoContext?: RepoContext
}
```

`LoadedExtension` is an alias for `LoadedWidgetExtension`.

---

## Registry System

The registry manages loaded widget state via a Svelte writable store.

| Method | Description |
| --- | --- |
| `registerWidget(event)` | Register a parsed Smart Widget event. |
| `unregister(id)` | Remove a widget from the registry. |
| `get(id)` | Retrieve a loaded widget by line id or identifier fallback. |
| `list()` | List all registered widgets. |
| `setRepoContext(id, ctx)` | Attach repository context and notify a loaded widget. |
| `loadWidget(event)` | Register and load a Smart Widget runtime. |
| `unloadExtension(id)` | Send unmount lifecycle, detach bridge, remove iframe, and unregister. |
| `asStore()` | Return a derived Svelte store of loaded widgets. |

### Smart Widget Parsing

`parseSmartWidget` extracts structured data from `kind:30033` events:

- `identifier` from the `d` tag, falling back to event id.
- `widgetType` from the `l` tag, defaulting to `basic` for unknown values.
- `imageUrl` from the `image` tag; required for `action` and `tool` widgets.
- `iconUrl`, `inputLabel`, `buttons`, `appUrl`, and fallback `app-url` values.
- `permissions` from `permission` or `perm` tags.
- `originHint` from the `client` tag.
- `version` and `changelog` release metadata.
- A supported `slot` tag for repo or community surfaces.

---

## Bridge Protocol

### Message Shape

```ts
type ExtensionMessage = {
  id?: string
  type: "request" | "response" | "event"
  action: string
  payload?: unknown
}
```

### Bridge Handlers

| Action | Permission Required | Description |
| --- | --- | --- |
| `nostr:publish` | `nostr:publish` | Publish signed Nostr events. |
| `nostr:query` | `nostr:query` | Query allowed relay/event kinds. |
| `nostr:subscribe` | `nostr:subscribe` | Open relay subscriptions for allowed kinds. |
| `nostr:unsubscribe` | `nostr:unsubscribe` | Close widget subscriptions. |
| `nostr:sign` | `nostr:sign` | Sign an event with the active signer. |
| `nostr:nip44Encrypt` | `nostr:nip44Encrypt` | Encrypt content with NIP-44. |
| `community:checkWriteCapabilities` | Same action | Check active community write capabilities. |
| `community:queryEvents` | Same action | Query active community events through descriptors. |
| `community:querySharedConfig` | Same action | Read community shared configuration. |
| `community:publishSharedConfig` | Same action | Publish community shared configuration. |
| `storage:get` | `storage:get` | Read scoped localStorage. |
| `storage:set` | `storage:set` | Write scoped localStorage. |
| `storage:remove` | `storage:remove` | Remove scoped localStorage entry. |
| `storage:keys` | `storage:keys` | List scoped localStorage keys. |
| `repo:getBranches` | None | Read active repo branch metadata. |
| `repo:listWorkflows` | None | List workflow files from the active repo. |
| `context:getRepo` | None | Get current repository context. |
| `ui:toast` | None | Display a toast notification. |
| `ui:navigate` | None | Navigate within host-approved routes. |

Privileged actions are those under `nostr:*`, `storage:*`, and `community:*`; they require exact `permission` tags on the widget event.

### Host-to-Widget Events

| Action | Description |
| --- | --- |
| `widget:init` | Sent after bridge attachment with widget metadata and optional repo context. |
| `widget:mounted` | Sent after init with timestamp. |
| `widget:unmounting` | Sent before cleanup. |
| `context:repoUpdate` | Sent when repository context changes. |

---

## Lifecycle

```text
1. Discovery
   - Default/community: validate latest kind 10222 community definition, then fetch targeted kind 30033 widgets.
   - Advanced: install a kind 30033 naddr directly.

2. Installation
   - Parse the widget event.
   - Store it in extensionSettings.installed.widget.
   - Store naddr/relay hints in widgetInstallSources when available.

3. Registration
   - Call registry.registerWidget() or registry.loadWidget().
   - Widget added to the registry store.

4. Enablement
   - Add the widget line id to extensionSettings.enabled[].
   - Provider preloads action/tool runtimes when needed.

5. Loading
   - Basic widgets stay host-rendered with no iframe.
   - Action/tool widgets create a sandboxed iframe.
   - Attach ExtensionBridge after iframe load.
   - Send widget:init and widget:mounted events.

6. Active
   - Bridge processes request/response/event messages.
   - Storage is scoped by widget id and optionally repo context.

7. Unloading
   - Send widget:unmounting.
   - Detach bridge.
   - Remove iframe.
   - Unregister from store.
```

---

## Storage And Persistence

```ts
type ExtensionSettings = {
  enabled: string[]
  disabledDefaultIds: string[]
  installed: {
    widget: Record<string, SmartWidgetEvent>
    legacy?: Record<string, unknown>
  }
  widgetInstallSources: Record<string, {naddr?: string; relays?: string[]}>
}
```

Key: `flotilla/extensions` in localStorage.

Extension-scoped storage keys:

```text
flotilla:ext:{extId}:{key}
flotilla:ext:{extId}:repo:{pubkey}:{name}:{key}
```

Limits:

- Max key length: 256 characters.
- Max value size: 1 MB.

---

## Slot System

### Supported Slots

```ts
type WidgetHomeSlotType =
  | "community-home-before-quicklinks"
  | "community-home-after-quicklinks"

type WidgetActionSlotType = "chat-message-actions" | "global-menu"

type WidgetSlotType = "repo-tab" | WidgetHomeSlotType | WidgetActionSlotType
```

### Slot Tags

```ts
type RepoTabSlotTag = ["slot", "repo-tab", label: string, path: string]
type CommunitySlotTag = ["slot", WidgetHomeSlotType | WidgetActionSlotType, label: string]
```

### Rendering Model

- `repo-tab` renders as a full repository tab iframe under `/git/[id=naddr]/extensions/[extId]`.
- `community-home-before-quicklinks` and `community-home-after-quicklinks` render as community home cards or launchers.
- `chat-message-actions` renders compact per-message launchers and opens the widget iframe in a modal on click.
- `global-menu` renders a community-route top control launcher for the targeted community and opens the widget iframe in a modal on click.

---

## Divergences From Smart Widgets Draft

| Feature | Budabit Status |
| --- | --- |
| Kind 30033 event structure | Implemented. |
| Widget types (`basic`, `action`, `tool`) | Implemented. |
| Button types (`redirect`, `nostr`, `zap`, `post`, `app`) | Parsed; `app` is used for iframe URLs. |
| Input field | Parsed as `inputLabel`; host UI does not render submission controls. |
| Image/icon tags | Parsed and stored. |
| Permission tags | Implemented and enforced for privileged bridge actions. |
| `app-url` fallback URLs | Budabit-specific fallback launch URLs for iframe widgets. |
| Repository context | Budabit-specific `repoContext` in lifecycle events and storage scoping. |
| Community context/actions | Budabit-specific bridge actions under `community:*`. |
| `/.well-known/widget.json` | Not consumed by the host. |
| Non-app button handling | Parsed but not executed by the host. |
| Widget reply events | Not implemented. |

---

## Summary Statistics

| Metric | Count |
| --- | --- |
| Runtime extension types | 1 (`widget`) |
| Widget types | 3 (`basic`, `action`, `tool`) |
| Supported slots | 5 |
| Button types parsed | 5 (`redirect`, `nostr`, `zap`, `post`, `app`) |
| Lifecycle events | 4 |
| Storage scopes | 2 (`global`, `repo`) |

---

## Related Documentation

- [`README.md`](./README.md) - Developer guide.
- [`INTEROPERABILITY.md`](./INTEROPERABILITY.md) - Host interoperability notes.
- [`XX.md`](./XX.md) - Smart Widget specification draft.

_Last updated: 2026-06-27_
