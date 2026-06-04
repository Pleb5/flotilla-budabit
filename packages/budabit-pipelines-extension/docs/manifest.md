# Smart Widget Event (kind 30033)

Guide to Flotilla **Smart Widget** metadata published to Nostr as a **kind `30033` addressable event**.

Smart Widgets are one of two extension models supported by Flotilla. The other model is **NIP-89 Manifest Extensions (kind 31990)**, which use JSON manifests for configuration. Both models coexist and serve different use cases:

- **Smart Widgets (kind 30033)**: Event-based, discovered via YakiHonne relays, ideal for rich inline widgets
- **NIP-89 Extensions (kind 31990)**: Manifest-based, discovered via INDEXER_RELAYS or direct URL, ideal for full-featured iframe apps

For comprehensive documentation covering both models, see the [Flotilla Extension Developer Guide](../../../docs/extensions/README.md).

This document focuses on the Smart Widget event structure. Flotilla discovers Smart Widgets via kind `30033` events and launches iframe widgets using the `button` tag.

## Overview

A Smart Widget is represented by:

- A Nostr event of **kind `30033`**
- A stable identifier in the `d` tag (addressable key)
- A widget type in the `l` tag: `action` or `tool`
- Display metadata (`icon`, `image`)
- A launch button that includes an `app` URL (iframe entry point)
- Zero or more `permission` tags (one per permission string)

Flotilla uses this event to:
- discover and list the widget
- render metadata
- create a sandboxed iframe pointed at the `button`/`app` URL
- enforce privileged actions based on declared `permission` tags

## Event Structure

A Smart Widget event is a standard Nostr event with:

- `kind: 30033`
- `content`: human-readable title (recommended)
- `tags`: metadata tags (described below)
- `created_at`: unix timestamp

Example:

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

## Tag Reference

### Required tags (for iframe widgets)

#### `d` (Identifier)

Unique widget identifier used for addressable event lookup.

- **Format**: lowercase alphanumeric with hyphens (recommended)
- **Example**: `["d", "my-smart-widget"]`

#### `l` (Widget type label)

Declares the widget type.

- **Allowed values (template)**: `action`, `tool`
- **Examples**:
  - `["l", "action"]`
  - `["l", "tool"]`

#### `button` (Launch definition)

Declares how the host launches the widget UI.

- **Expected shape**: `["button", "<label>", "app", "<url>"]`
- **Example**: `["button", "Open", "app", "https://cdn.example.com/my-widget/index.html"]`

Notes:
- The `app` URL should be **HTTPS** in production.
- The host typically derives the widget origin from this URL and validates `postMessage` origins against it.

### Recommended tags

#### `icon`

Icon URL.

- **Example**: `["icon", "https://cdn.example.com/my-widget/icon.png"]`

#### `image`

Preview/cover image URL.

- **Example**: `["image", "https://cdn.example.com/my-widget/preview.png"]`

### Permissions

#### `permission`

Declare a permission string (one tag per permission).

- **Example**:
  - `["permission", "nostr:publish"]`
  - `["permission", "ui:toast"]`

Notes:
- Flotilla may treat some actions as privileged (commonly `nostr:*`, `storage:*`) and enforce them based on declared permissions.
- This template’s demo defaults to `nostr:publish` and `ui:toast`.

## Generating Smart Widget files (CLI)

This repository includes a generator that outputs:

- `event.json`: unsigned kind `30033` event
- `widget.json`: optional `/.well-known/widget.json` for web discovery/hosting
- `PUBLISHING.md`: signing + publishing instructions

From the repo root:

```bash
pnpm manifest:generate \
  --type tool \
  --title "My Smart Widget" \
  --app-url "https://cdn.example.com/my-widget/index.html" \
  --icon "https://cdn.example.com/my-widget/icon.png" \
  --image "https://cdn.example.com/my-widget/preview.png" \
  --button-title "Open" \
  --permissions "nostr:publish,ui:toast" \
  --output "dist/widget"
```

Optional:
- `--identifier "my-smart-widget"` (if omitted, derived from `--title`)
- `--pubkey "<hex pubkey>"` (if provided, publishing instructions can include an `naddr` hint)

## Signing and Publishing (kind 30033)

The generator outputs an **unsigned** event. To publish it, you must:
1) sign it with a Nostr private key (host-controlled; never expose keys to widgets)
2) publish the signed event to relays

Example using `nostr-tools`:

```ts
import { finalizeEvent, generateSecretKey, nip19 } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import widgetEvent from "./dist/widget/event.json" assert { type: "json" };

const sk = generateSecretKey(); // Or load your secret key securely
const signed = finalizeEvent(widgetEvent, sk);

const pool = new SimplePool();
const relays = ["wss://relay.damus.io", "wss://nos.lol"];

await Promise.all(pool.publish(relays, signed));

// Optional: naddr hint (requires your pubkey)
const pubkeyHex = signed.pubkey;
const identifier = signed.tags.find((t) => t[0] === "d")?.[1];
if (identifier) {
  const naddr = nip19.naddrEncode({
    pubkey: pubkeyHex,
    kind: 30033,
    identifier,
    relays,
  });
  console.log("naddr:", naddr);
}
```

### Updating

Smart Widgets are **addressable events** (kind `30033` + `d` tag). Publishing a new event with the same `d` value replaces the previous version.

## Optional: Hosting `/.well-known/widget.json`

The generator can also emit `widget.json` intended for hosting at:

- `https://your-domain.example/.well-known/widget.json`

This is optional and does not replace publishing the Nostr event. It can be useful for:
- web-based discovery
- debugging metadata in a browser
- linking from documentation

## Security Notes

- Prefer **HTTPS** for all URLs (`app-url`, `icon`, `image`).
- Hosts should enforce iframe sandboxing (at minimum: `allow-scripts allow-same-origin`).
- Hosts should validate `postMessage` origin and message shape before acting.
- Widgets must never receive private keys; signing/publishing must occur in the host.

## Resources

- [Nostr NIP-33: Parameterized Replaceable Events](https://github.com/nostr-protocol/nips/blob/master/33.md)
- [postMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#attr-sandbox)
