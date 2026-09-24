# Smart Widget Event (kind 30033)

Guide to BudaBit **Smart Widget** metadata published to Nostr as a **kind `30033` addressable event**.

Smart Widgets are the supported extension model in BudaBit. They are event-based, discovered as kind `30033` events, and can render inline or launch iframe widgets using the `button` tag.

For host-specific behavior, see the [BudaBit Extension Developer Guide](../../../docs/extensions/README.md).

## Overview

A Smart Widget is represented by:

- A Nostr event of **kind `30033`**
- A stable identifier in the `d` tag (addressable key)
- A widget type in the `l` tag: `action` or `tool`
- Display metadata (`icon`, `image`)
- A launch button that includes an `app` URL (iframe entry point)
- Zero or more `permission` tags (one per permission string)
- Zero or more `nostrKinds` tags (one per Nostr event kind the widget needs)
- Optional `version` and `changelog` tags for release/update display

BudaBit uses this event to:

- discover and list the widget
- render metadata
- create a sandboxed iframe pointed at the `button`/`app` URL
- enforce privileged actions based on declared `permission` tags
- restrict Nostr queries/subscriptions to declared `nostrKinds`

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
    ["app-url", "https://mirror.example.com/my-widget/index.html"],
    ["permission", "nostr:publish"],
    ["permission", "nostr:query"],
    ["permission", "nostr:subscribe"],
    ["permission", "ui:toast"],
    ["nostrKinds", "30301"],
    ["nostrKinds", "30302"],
    ["version", "1.0.0"],
    ["changelog", "Initial Blossom-backed release"]
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

#### `app-url` (Fallback launch URL)

Optional repeatable fallback iframe URLs. BudaBit preserves the first `button`/`app` URL as the primary URL and tries ordered `app-url` fallbacks if iframe loading fails.

- **Expected shape**: `["app-url", "<url>"]`
- **Example**: `["app-url", "https://mirror.example.com/my-widget/index.html"]`

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

- Privileged actions (`nostr:*`, `storage:*`) require explicit permission tags.
- `ui:*` actions are rate-limited but don't require explicit permission.
- Include `nostr:subscribe` if your widget uses real-time subscriptions.

### Nostr Kinds

#### `nostrKinds`

Declare which Nostr event kinds the widget needs (one tag per kind).

- **Example**:
  - `["nostrKinds", "30301"]`
  - `["nostrKinds", "30302"]`

Notes:

- Only declared kinds (plus universal kinds 0 and 10002) can be queried/subscribed.
- Omitting `nostrKinds` limits to profiles (kind 0) and relay lists (kind 10002).

### Release Metadata

#### `version`

Optional display metadata for release/update UI.

- **Example**: `["version", "1.0.0"]`

#### `changelog`

Optional short release notes shown when BudaBit detects a newer installed widget event.

- **Example**: `["changelog", "Added Blossom-backed deployment"]`

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
  --fallback-app-urls "https://mirror.example.com/my-widget/index.html" \
  --icon "https://cdn.example.com/my-widget/icon.png" \
  --image "https://cdn.example.com/my-widget/preview.png" \
  --button-title "Open" \
  --identifier "my-smart-widget" \
  --version "1.0.0" \
  --changelog "Initial release" \
  --permissions "nostr:publish,nostr:query,nostr:subscribe,community:checkWriteCapabilities,community:queryEvents,community:querySharedConfig,ui:toast" \
  --shared-config "budabit-calendar-widget=featured-calendar-event" \
  --nostr-kinds "30301,30302" \
  --output "dist/widget"
```

Optional:

- `--identifier "my-smart-widget"` (strongly recommended for public releases; if omitted, derived for local experiments)
- `--version "1.0.0"` (optional update display metadata)
- `--changelog "Initial release"` (optional update display metadata)
- `--fallback-app-urls "https://mirror.example.com/widget.html,https://backup.example.com/widget.html"` (optional ordered fallback artifact URLs)
- `--pubkey "<hex pubkey>"` (if provided, publishing instructions can include an `naddr` hint)
- `--nostr-kinds "30301,30302"` (declares which Nostr event kinds the widget needs)
- `--shared-config "namespace=key"` (repeatable; emits one `shared-config` tag per declaration)
- Shared-config consumers must also declare the `community:querySharedConfig` permission.

## Signing and Publishing (kind 30033)

The generator outputs an **unsigned** event. To publish it, you must:

1. sign it with a Nostr private key (host-controlled; never expose keys to widgets)
2. publish the signed event to relays

Example using `nostr-tools`:

```ts
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import widgetEvent from './dist/widget/event.json' assert { type: 'json' };

const sk = generateSecretKey(); // Or load your secret key securely
const signed = finalizeEvent(widgetEvent, sk);

const pool = new SimplePool();
const relays = (process.env.COMMUNITY_RELAYS ?? '').split(',').map((url) => url.trim()).filter(Boolean);
if (relays.length === 0) throw new Error('Missing tagged community relays');

await Promise.all(pool.publish(relays, signed));

// Optional: naddr hint (requires your pubkey)
const pubkeyHex = signed.pubkey;
const identifier = signed.tags.find((t) => t[0] === 'd')?.[1];
if (identifier) {
  const naddr = nip19.naddrEncode({
    pubkey: pubkeyHex,
    kind: 30033,
    identifier,
    relays,
  });
  console.log('naddr:', naddr);
}
```

### Updating

Smart Widgets are **addressable events** (kind `30033` + `d` tag). Publishing a new event with the same `d` value replaces the previous version.

For stable Blossom-backed releases:

1. Choose an explicit `--identifier` before the first public release.
2. Build the iframe app and upload the built HTML to Blossom.
3. Publish the kind `30033` event with the same `d` identifier and a `button`/`app` URL pointing to the Blossom URL.
4. For every update, reuse the same `d`, publish a newer event with a newer `created_at`, and update optional `version` / `changelog` tags.
5. BudaBit treats the same publisher pubkey + kind `30033` + same `d` value as one widget line, shows update availability, and lets installed users manually apply it.

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
