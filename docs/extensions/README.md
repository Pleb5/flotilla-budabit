# Flotilla Extension Developer Guide

Flotilla ships two complementary runtime paths for building integrations:

1. **NIP‑89 Manifest Extensions** – sandboxed iframe apps described by JSON manifests (kind 31990) discovered via relays.
2. **Smart Widgets (NIP‑XX / kind 30033)** – rich, event-based widgets published directly to Nostr relays (YakiHonne ecosystem) that Flotilla can render inline or sandbox in an iframe depending on widget type.

This guide explains how to target both models, how they coexist inside Flotilla, and what you need to know about storage, permissions, discovery, and UI slots.

> 📚 See [`docs/extensions/XX.md`](./XX.md) for the full Smart Widget specification; this guide focuses on how Flotilla interprets and hosts those events.

---

## 📖 Terminology

| Term                   | Meaning                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Manifest Extension** | Legacy iframe-based integration defined by a NIP‑89 manifest (kind 31990 event or HTTPS URL).                             |
| **Smart Widget Event** | Kind 30033 event describing a widget payload published to relays.                                                         |
| **Widget Types**       | `basic` (host-rendered), `action` (iframe app without return channel), `tool` (iframe app expecting bi-directional data). |
| **Extension Runtime**  | Flotilla’s host infrastructure (registry, provider, bridge) that loads and enforces each integration.                     |
| **Permissions**        | Capabilities declared either in manifest `permissions[]` (NIP‑89) or widget tags.                                         |

---

## 🧩 Support Matrix

| Capability        | Manifest Extensions                                                   | Smart Widgets – `basic`                                                                                  | Smart Widgets – `action` / `tool`                    |
| ----------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Discovery         | Manual URL under Advanced settings                                    | Community-curated kind 30033 events or direct naddr                                                      | Same as `basic`                                      |
| Install UX        | Paste manifest URL under Advanced settings                            | Search a community's curated extensions or paste naddr under Advanced settings                           | Same as `basic`                                      |
| Runtime Container | Sandboxed iframe (`allow-scripts allow-same-origin`)                  | Host-rendered via slot handler (no iframe)                                                               | Sandboxed iframe (appUrl)                            |
| Storage Bucket    | `extensionSettings.installed.nip89[id]`                               | `extensionSettings.installed.widget[id]`                                                                 | `extensionSettings.installed.widget[id]`             |
| Enable / Disable  | `extensionRegistry.loadIframeExtension()`                             | `extensionRegistry.loadWidget()` (metadata only)                                                         | `extensionRegistry.loadWidget()` (iframe + bridge)   |
| Permissions       | Explicit `permissions[]` in manifest (default deny otherwise)         | Default deny; host recognizes widget tag-derived capabilities                                            | Same as `basic`, enforced before bridge requests     |
| UI Slot Rendering | Extension-specific slot handlers receive `extension.type === "nip89"` | Slot handlers see `extension.type === "widget"` and `widget.widgetType === "basic"`; render DOM directly | Slot handlers interact with widget iframe via bridge |

---

## 🧱 Storage & Settings Layout

Flotilla persists extension state in a single synced store:

```ts
type ExtensionSettings = {
  enabled: string[] // shared ids (manifest.id or widget.identifier)
  installed: {
    nip89: Record<string, ExtensionManifest>
    widget: Record<string, SmartWidgetEvent>
    legacy?: Record<string, unknown> // auto-migrated flat installs
  }
}
```

- Legacy installs stored as a flat `{[id]: manifest}` map are auto-migrated into `installed.nip89` on load.
- Both manifest ids and widget identifiers share the `enabled[]` list; disabling an id unloads whichever runtime is active.

---

## 🔍 Discovery & Installation

### Manifest Extensions (NIP‑89)

- **Relays:** `INDEXER_RELAYS` (same set used elsewhere in Flotilla).
- **Install flows:**
  - Paste manifest URL into **Settings → Extensions → Advanced → Install by URL**.
- **Runtime:** Flotilla validates optional `sha256`, registers the manifest with the registry, and spawns an iframe when enabled.

### Smart Widgets

- **Relays:** YakiHonne curated set (`SMART_WIDGET_RELAYS`, currently `wss://relay.yakihonne.com`). naddr installs honor relay hints in the address pointer.
- **Install flows:**
  - Search a valid community profile in **Settings → Extensions → Discover extensions** and pick from that community's curated widgets.
  - Paste `naddr` (kind 30033 address pointer) in **Settings → Extensions → Advanced → Install Smart Widget (naddr)**.
- **Event parsing:** Runtime extracts `identifier`, `widgetType`, `buttons`, `appUrl`, and permissions from event tags. See `parseSmartWidget` implementation for details.
- **Container:**
  - `basic` widgets render through host slot handlers (no iframe).
  - `action` / `tool` widgets create sandboxed iframes with the widget’s `appUrl`.

---

## 🔐 Permissions & Security Model

### Manifest Extensions

- Must declare privileges in the manifest `permissions[]` array (e.g., `"nostr:publish"`, `"ui:toast"`).
- Host denies privileged bridge requests unless allowed by the manifest.
- Optional SHA‑256 integrity hash is verified before install when provided.

### Smart Widgets

- Permission tags (`["permission", "nostr:publish"]`, etc.) are parsed into an allowlist.
- Flotilla currently recognizes the same privilege namespace as manifest extensions (`nostr:*`, `ui:*`). Requests without explicit permission are rejected.
- `basic` widgets have no iframe to message; they call host slot APIs and should surface UI without privileged operations unless granted.

### Common Safeguards

- Action/tool iframes use `allow-scripts allow-same-origin` only.
- Kind 31993 policy events (user consent) remain available for gating future capabilities.
- Bridge always checks origin matches the registered iframe/app URL.

---

## 🎛️ UI Slot Integration

Smart Widgets declare one supported slot with a `slot` tag in the kind 30033 event. Current supported slots are:

| Slot | Tag shape | Rendering model |
| --- | --- | --- |
| `repo-tab` | `["slot", "repo-tab", label, path]` | Full repository tab iframe |
| `community-home-before-quicklinks` | `["slot", "community-home-before-quicklinks", label]` | Community home card/launcher |
| `community-home-after-quicklinks` | `["slot", "community-home-after-quicklinks", label]` | Community home card/launcher |
| `chat-message-actions` | `["slot", "chat-message-actions", label]` | Compact message action launcher that opens a modal |
| `global-menu` | `["slot", "global-menu", label]` | Community-route top control launcher that opens a modal |

Example `chat-message-actions` tag:

```json
["slot", "chat-message-actions", "Summarize"]
```

`global-menu` is scoped to the targeted community route where the widget is installed, not to every route in the app.

---

## ⚡ Quick Start Workflows

### Build a Manifest Extension (NIP‑89)

1. Scaffold an iframe app (see [`flotilla-extension-template`](../../flotilla-extension-template/README.md)).
2. Host the bundled HTML + assets on HTTPS.
3. Create a manifest JSON with metadata, entrypoint URL, and requested permissions.
4. Publish the manifest to relays (kind 31990) or share the HTTPS URL directly.
5. In Flotilla, install via URL or discovery, then enable.

### Build a Smart Widget

1. Decide on widget type (`basic`, `action`, `tool`).
2. For `basic`, craft the event tags (image, buttons, optional app URL) using YakiHonne tooling or your own signer.
3. For `action/tool`, deploy the iframe application and reference it via a button of type `app`.
4. Publish the kind 30033 event (naddr) to Smart Widget relays.
5. Install in Flotilla via naddr or discovery and enable.

> Refer to [`docs/extensions/XX.md`](./XX.md) for detailed tag schemas, button semantics, and YakiHonne builder references.

---

## 🔁 Migration Guidance

- Existing NIP‑89 extensions continue to function unchanged; their manifests live in `installed.nip89`.
- To “widgetize” an iframe extension:
  1. Identify the primary user interaction you want to expose in a widget slot.
  2. Publish a Smart Widget event pointing to the same iframe entrypoint (`action`/`tool`) or provide host-renderable metadata (`basic`).
  3. Optionally keep both manifest + widget entries enabled; Flotilla treats them independently.
- Legacy settings stored as `{[id]: manifest}` are automatically migrated to the `nip89` bucket the next time Flotilla loads the store.

---

## 🧠 Troubleshooting

- **Widget installs but renders blank:** double-check required tags (`d`, `l`, `image`, `button` for `action/tool`).
- **Bridge request denied:** confirm permission in manifest or widget tags matches the action (`nostr:publish`, etc.).
- **Iframe fails to load:** ensure `appUrl` / `entrypoint` is served over HTTPS and allows embedding.
- **Discovery missing my widget:** verify relays include YakiHonne defaults or publish to additional relays the install flow can reach.

---

## 🧾 Reference Examples

### Sample Manifest (NIP‑89)

```json
{
  "id": "flotilla-huddle",
  "name": "Huddle",
  "description": "Lightweight audio/room interaction extension.",
  "author": "Flotilla Team",
  "version": "1.0.0",
  "homepage": "https://flotilla.app/extensions/huddle",
  "entrypoint": "https://cdn.flotilla.app/extensions/huddle/index.html",
  "permissions": ["nostr:publish", "ui:toast"],
  "icon": "/images/extensions/huddle-icon.png"
}
```

### Sample Smart Widget Event (Kind 30033)

```json
{
  "kind": 30033,
  "content": "Weather Widget",
  "tags": [
    ["d", "weather-widget-123"],
    ["l", "basic"],
    ["slot", "community-home-after-quicklinks", "Weather"],
    ["image", "https://example.com/widget.jpg"],
    ["button", "Get Weather", "redirect", "https://weather.example.com"],
    ["permission", "ui:toast"]
  ]
}
```

---

## 🤝 Resources

- [`flotilla-extension-template`](../../flotilla-extension-template/README.md)
- Welshman SDK: https://github.com/bizarro/welshman
- NIP‑89 spec: https://github.com/nostr-protocol/nips/blob/master/89.md
- Smart Widget Spec (NIP‑XX draft): [`docs/extensions/XX.md`](./XX.md)
- YakiHonne Smart Widget tooling: https://yakihonne.com/docs/sw/intro

_© 2026 Flotilla Project — Extensions Runtime v2_
