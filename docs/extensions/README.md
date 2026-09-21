# Budabit Smart Widget Developer Guide

Budabit supports Smart Widgets as its extension model. A Smart Widget is a Nostr `kind:30033` addressable event that declares metadata, launch URLs, permissions, and an optional UI slot. Budabit renders `basic` widgets through host slot handlers and loads `action` or `tool` widgets in sandboxed iframes.

See [`XX.md`](./XX.md) for the Smart Widget specification details. This guide focuses on how Budabit interprets and hosts those events.

---

## Terminology

| Term               | Meaning                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Smart Widget Event | A `kind:30033` event describing a widget payload published to relays.                                                    |
| Widget Types       | `basic` (host-rendered), `action` (iframe app without return channel), `tool` (iframe app expecting bidirectional data). |
| Widget Slot        | A supported placement declared by the widget `slot` tag.                                                                 |
| Extension Runtime  | Budabit host infrastructure (`registry`, `provider`, `bridge`) that loads and enforces widgets.                          |
| Permissions        | Capabilities declared by widget `permission` tags.                                                                       |

---

## Support Matrix

| Capability        | Smart Widgets - `basic`                                                       | Smart Widgets - `action` / `tool`                              |
| ----------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Discovery         | Community-curated `kind:30033` events or direct `naddr`                       | Same as `basic`                                                |
| Install UX        | Search a community's curated widgets or paste `naddr` under Advanced settings | Same as `basic`                                                |
| Runtime Container | Host-rendered via slot handler, no iframe                                     | Sandboxed iframe from the widget app URL                       |
| Storage Bucket    | `extensionSettings.installed.widget[id]`                                      | `extensionSettings.installed.widget[id]`                       |
| Enable / Disable  | Settings `enabled[]` controls whether the widget is available to slots        | Settings `enabled[]` controls iframe preload/slot availability |
| Permissions       | Default deny for privileged bridge actions                                    | Same as `basic`, enforced before bridge requests               |
| UI Slot Rendering | Slot handlers see `extension.type === "widget"` and render metadata           | Slot handlers launch or mount the widget iframe                |

---

## Storage And Settings Layout

Budabit persists extension state in a single synced store:

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

- Widget ids are line ids derived from publisher pubkey, `kind:30033`, and the `d` identifier.
- Default community widgets are overlaid into effective settings as installed and enabled unless the user disables them.
- `widgetInstallSources` preserves direct install relay hints and `naddr` values for refresh/update operations.
- `legacy` can preserve old local data but is not an active extension runtime bucket.

---

## Discovery And Installation

Budabit installs Smart Widgets through these paths:

- Default community curation: `VITE_DEFAULT_COMMUNITY` contains a canonical `kind:32222` definition `naddr`. After resolving that exact branch, Budabit loads `kind:30033` widgets targeted by adjacent `h=<communityId>` and marked `a=<definitionAddress>` pairs in `kind:30222` wrappers.
- Settings discovery: users choose a community in Settings > Extensions and install from that community's curated widgets.
- Direct install: users paste a Smart Widget `naddr` in Settings > Extensions > Advanced.

Runtime parsing extracts the widget `identifier`, `widgetType`, `buttons`, `appUrl`, fallback `app-url` values, permissions, version metadata, and supported slot from event tags.

### Freelance workflow example

Budabit's default **Marketplace** section declares services `32765`, orders `32766`, jobs `32767`, proposals `32768`, reviews `1986`, and NIP-99 classified listings `30402`. Its shared workflow grants are separate from **Widget-curator** access for publishing/targeting widgets. Existing communities can use **Add Marketplace** when those kinds are unassigned, or rename their Freelance section and add `30402` in the definition editor.

The separately published Community Freelance widget uses `community:checkWriteCapabilities`, `nostr:sign`, `storage:get`, `storage:set`, `ui:resize`, and `ui:navigate`, with a `community-home-quicklinks` slot. Version 0.5.0 adds the read-only [`profiles:resolve`](profiles.md) API to reuse Budabit's profile resolver and shared cache for all displayed accounts. It owns community-relay workflow reads/publication and Blossom uploads; its signing declaration also includes `5`, `22242`, and `24242`. The host's bridge checks do not automatically govern a widget's direct network requests. See [Community Freelance](../features/freelance.md) for configuration and implementation boundaries.

---

## Permissions And Security Model

Smart Widgets declare privileges with repeatable `permission` tags:

```json
["permission", "nostr:publish"]
["permission", "storage:get"]
["permission", "community:queryEvents"]
["permission", "community:queryLiveStreams"]
```

Budabit enforces these rules:

- Privileged bridge actions under `nostr:*`, `storage:*`, `community:*`, and `profiles:*` require an exact matching permission tag.
- UI actions such as `ui:toast` and `ui:navigate` are not privileged by the bridge policy, but handlers still validate payload shape and host constraints.
- `action` and `tool` widgets run in iframes with `allow-scripts allow-same-origin` only.
- The bridge checks that incoming messages originate from the registered widget origin.
- `action` and `tool` app URLs must be secure and embeddable.

---

## UI Slot Integration

Smart Widgets declare one supported slot with a `slot` tag in the `kind:30033` event. Current supported slots are:

| Slot                               | Tag shape                                             | Rendering model                                         |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `repo-tab`                         | `["slot", "repo-tab", label, path]`                   | Full repository tab iframe                              |
| `community-home-before-quicklinks` | `["slot", "community-home-before-quicklinks", label]` | Community home card/launcher                            |
| `community-home-after-quicklinks`  | `["slot", "community-home-after-quicklinks", label]`  | Community home card/launcher                            |
| `community-home-quicklinks`        | `["slot", "community-home-quicklinks", label]`        | Home quicklink button; opens a wide modal on demand      |
| `chat-message-actions`             | `["slot", "chat-message-actions", label]`             | Compact message action launcher that opens a modal      |
| `global-menu`                      | `["slot", "global-menu", label]`                      | Community-route top control launcher that opens a modal |

Example `chat-message-actions` tag:

```json
["slot", "chat-message-actions", "Summarize"]
```

`global-menu` is scoped to the targeted community route where the widget is installed, not to every route in the app.

`community-home-quicklinks` uses the same exact-community curation and installed/enabled selection as the other community slots. Its icon and label join the home quicklink grid. No widget iframe is mounted or preloaded until the button is clicked; the dialog receives the selected community's runtime context and tears down the iframe on close.

---

## Build A Smart Widget

1. Decide on widget type: `basic`, `action`, or `tool`.
2. For `basic`, publish host-renderable metadata and button tags.
3. For `action` or `tool`, deploy the iframe application and reference it via a `button` tag of type `app`.
4. Add a supported `slot` tag if the widget should appear in a Budabit surface.
5. Publish the `kind:30033` event to relays reachable by the target community or installation flow.
6. Install in Budabit via community discovery or direct `naddr`, then enable.

The widget template in [`packages/flotilla-extension-template`](../../packages/flotilla-extension-template/README.md) provides a Svelte iframe app, bridge helpers, publishing scripts, and Smart Widget event generation.

---

## Troubleshooting

- Widget installs but renders blank: check required tags (`d`, `l`, `image`, and `button` for `action`/`tool`).
- Bridge request denied: confirm the exact `permission` tag matches the requested action.
- Iframe fails to load: ensure every app URL is HTTPS and passes Budabit's embeddable URL policy.
- Discovery misses a widget: verify it was published to relays used by the target community or included in the `naddr` relay hints.
- Slot does not appear: confirm the widget is enabled and its `slot` tag uses one of the supported slot names above.

---

## Sample Smart Widget Event

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

## Resources

- Smart Widget Spec draft: [`XX.md`](./XX.md)
- Interoperability notes: [`INTEROPERABILITY.md`](./INTEROPERABILITY.md)
- Smart Widget template: [`packages/flotilla-extension-template`](../../packages/flotilla-extension-template/README.md)
- Welshman SDK: https://github.com/bizarro/welshman
- YakiHonne Smart Widget tooling: https://yakihonne.com/docs/sw/intro

_Last updated: 2026-06-27_
