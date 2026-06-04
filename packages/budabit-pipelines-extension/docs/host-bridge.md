# Host Bridge Integration

Guide for Flotilla host developers integrating **Smart Widgets**.

## Overview

Flotilla Smart Widgets are represented on Nostr as **kind `30033` addressable events**. The host application discovers widget events, renders widget metadata, and (for `action`/`tool` widgets) loads an **iframe UI** that communicates with the host via an **action-based postMessage protocol**:

- Widget -> Host **request**: `{ type: "request", id, action, payload }`
- Host -> Widget **response**: `{ type: "response", id, action, payload }`
- Host -> Widget **event**: `{ type: "event", action, payload }`

The host is responsible for:
- creating a sandboxed iframe
- validating message origins + shapes
- enforcing permissions for privileged actions
- executing host-only capabilities (publishing, storage, etc.)
- correlating requests/responses by `id`

## Architecture

```
┌─────────────────────────────────────┐
│         Flotilla Host               │
│  ┌───────────────────────────────┐  │
│  │      Host Widget Bridge       │  │
│  │  - Validates origin + schema  │  │
│  │  - Correlates req/res by id   │  │
│  │  - Enforces permissions       │  │
│  │  - Executes host capabilities │  │
│  └──────────┬────────────────────┘  │
│             │ postMessage            │
└─────────────┼────────────────────────┘
              │
┌─────────────┼────────────────────────┐
│  Sandboxed iframe (Smart Widget UI)  │
│  ┌──────────▼────────────────────┐   │
│  │   WidgetBridge (in iframe)     │   │
│  │  - request(action,payload)     │   │
│  │  - onEvent(action, handler)    │   │
│  │  - onRequest(action, handler)  │   │
│  └───────────────────────────────┘   │
└──────────────────────────────────────┘
```

## Smart Widget Event (kind 30033)

A Smart Widget is described by a kind `30033` event with tags the host parses:

- `d`: widget identifier (addressable key)
- `l`: widget type label (`action` or `tool`)
- `icon`, `image`: display metadata
- `button`: launch definition: `['button', '<label>', 'app', '<url>']`
- `permission`: declared permissions (one per permission string)

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

## Loading a Smart Widget

### 1) Discover the widget event (kind 30033)

```ts
import { SimplePool } from "nostr-tools/pool";

const pool = new SimplePool();
const relays = ["wss://relay.damus.io", "wss://nos.lol"];

const events = await pool.querySync(relays, {
  kinds: [30033],
  "#d": ["my-smart-widget"], // optional filter by identifier
});

const widgetEvent = events[0];
if (!widgetEvent) throw new Error("Widget not found");
```

### 2) Validate and parse required tags

At minimum, ensure:
- the event is kind `30033`
- it has a `d` tag and `l` tag
- it has a `button` tag with `app` URL
- URLs are `https:` (recommended)

Example parsing:

```ts
type NostrEvent = {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey: string;
  id: string;
  sig: string;
};

function getTagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

function getPermissions(tags: string[][]): string[] {
  return tags.filter((t) => t[0] === "permission").map((t) => t[1]).filter(Boolean);
}

function getButtonAppUrl(tags: string[][]): string | undefined {
  const button = tags.find((t) => t[0] === "button");
  if (!button) return undefined;

  // Expected shape: ["button", "Open", "app", "https://..."]
  const appTypeIdx = button.indexOf("app");
  if (appTypeIdx === -1) return undefined;
  return button[appTypeIdx + 1];
}

function assertHttpsUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error(`Non-HTTPS URL not allowed: ${url}`);
}

function parseWidgetEvent(ev: NostrEvent) {
  if (ev.kind !== 30033) throw new Error("Not a Smart Widget event");

  const identifier = getTagValue(ev.tags, "d");
  const widgetType = getTagValue(ev.tags, "l");
  const appUrl = getButtonAppUrl(ev.tags);

  if (!identifier) throw new Error("Missing d tag");
  if (widgetType !== "action" && widgetType !== "tool") throw new Error("Missing/invalid l tag");
  if (!appUrl) throw new Error("Missing button/app URL");

  assertHttpsUrl(appUrl);

  return {
    identifier,
    widgetType,
    appUrl,
    permissions: getPermissions(ev.tags),
    title: ev.content,
    iconUrl: getTagValue(ev.tags, "icon"),
    imageUrl: getTagValue(ev.tags, "image"),
  };
}
```

### 3) Create a sandboxed iframe

Use a baseline sandbox and add capabilities only when needed.

```ts
const iframe = document.createElement("iframe");
iframe.src = parsed.appUrl;

// Baseline sandbox for Smart Widgets.
iframe.sandbox.add("allow-scripts");
iframe.sandbox.add("allow-same-origin");

// Optional: if you explicitly want to allow additional capabilities.
// iframe.allow = "microphone; camera; display-capture";

document.getElementById("extension-container")?.appendChild(iframe);
```

### 4) Create a host bridge (request/response/event)

The host bridge:
- listens for `message` events
- validates `origin` and message shape
- routes by `action`
- enforces permissions for privileged actions
- responds with `{ type: "response", id, action, payload }`

#### Wire shapes

```ts
type WidgetWireMessage =
  | { type: "request"; id: string; action: string; payload?: unknown }
  | { type: "response"; id: string; action: string; payload?: unknown }
  | { type: "event"; action: string; payload?: unknown };
```

#### Minimal host bridge skeleton

```ts
function createHostWidgetBridge(opts: {
  iframe: HTMLIFrameElement;
  widgetOrigin: string; // must match iframe src origin
  permissions: string[];
  handleAction: (action: string, payload: unknown) => Promise<unknown>;
}) {
  const { iframe, widgetOrigin, permissions, handleAction } = opts;

  const postToWidget = (msg: WidgetWireMessage) => {
    iframe.contentWindow?.postMessage(msg, widgetOrigin);
  };

  const isPrivileged = (action: string) => action.startsWith("nostr:") || action.startsWith("storage:");

  const isActionAllowed = (action: string) => {
    if (!isPrivileged(action)) return true;
    return permissions.includes(action);
  };

  const onMessage = async (ev: MessageEvent) => {
    if (ev.origin !== widgetOrigin) return;
    const msg = ev.data as Partial<WidgetWireMessage> | null;

    if (!msg || typeof msg !== "object") return;
    if (msg.type !== "request") return;

    if (typeof msg.id !== "string" || typeof msg.action !== "string") return;

    if (!isActionAllowed(msg.action)) {
      postToWidget({
        type: "response",
        id: msg.id,
        action: msg.action,
        payload: { error: `Permission denied for action: ${msg.action}` },
      });
      return;
    }

    try {
      const result = await handleAction(msg.action, msg.payload);
      postToWidget({
        type: "response",
        id: msg.id,
        action: msg.action,
        payload: { status: "ok", result },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      postToWidget({
        type: "response",
        id: msg.id,
        action: msg.action,
        payload: { error: message },
      });
    }
  };

  window.addEventListener("message", onMessage);

  return {
    postEvent(action: string, payload: unknown) {
      postToWidget({ type: "event", action, payload });
    },
    destroy() {
      window.removeEventListener("message", onMessage);
    },
  };
}
```

### 5) Send lifecycle events and context

The host should send lifecycle events to the widget at appropriate times. See [Lifecycle Events](./lifecycle.md) for full documentation.

```ts
const widgetOrigin = new URL(parsed.appUrl).origin;

const bridge = createHostWidgetBridge({
  iframe,
  widgetOrigin,
  permissions: parsed.permissions,
  async handleAction(action, payload) {
    if (action === "ui:toast") {
      // Host UI toast; payload shape is host-defined.
      console.log("Toast:", payload);
      return { ok: true };
    }

    if (action === "nostr:publish") {
      // payload is an unsigned nostr event; host signs/publishes.
      // return a result payload that the widget can display.
      return { eventId: "fake-event-id" };
    }

    if (action === "context:getRepo") {
      // Widget is proactively requesting repo context
      return {
        owner: "example-org",
        name: "example-repo",
        fullName: "example-org/example-repo",
        defaultBranch: "main",
      };
    }

    throw new Error(`Unknown action: ${action}`);
  },
});

// Send widget:init immediately after iframe creation
bridge.postEvent("widget:init", {
  extensionId: parsed.identifier,
  hostVersion: "1.0.0",
  repoContext: {
    owner: "example-org",
    name: "example-repo",
    fullName: "example-org/example-repo",
    defaultBranch: "main",
  },
});

// Send widget:mounted once iframe is loaded and bridge ready
iframe.addEventListener("load", () => {
  bridge.postEvent("widget:mounted", {
    mountedAt: Date.now(),
    slot: "room:panel",
    viewport: { width: 400, height: 600 },
  });
});

// Send widget:unmounting before removal
function unmountWidget() {
  bridge.postEvent("widget:unmounting", {
    reason: "navigation",
    gracePeriodMs: 1000,
  });

  // Give widget time to cleanup, then remove
  setTimeout(() => {
    iframe.remove();
    bridge.destroy();
  }, 1000);
}

// For repo context changes, send context:repoUpdate
function onRepoChange(newRepo) {
  bridge.postEvent("context:repoUpdate", {
    owner: newRepo.owner,
    name: newRepo.name,
    fullName: newRepo.fullName,
    defaultBranch: newRepo.defaultBranch,
  });
}
```

## Handling Actions

### `nostr:publish`

The canonical privileged action is to publish a Nostr event. The widget sends an *unsigned* event; the host should validate, sign, and publish.

```ts
import { SimplePool } from "nostr-tools/pool";

const pool = new SimplePool();
const relays = ["wss://relay.damus.io", "wss://nos.lol"];

async function handleNostrPublish(unsignedEvent: any) {
  // 1) Validate schema, size, tags, timestamp, and allowed kinds.
  // 2) Sign with host-controlled signer.
  // 3) Publish to relays.
  // 4) Return event id (or other confirmation payload).

  // NOTE: signing is host-specific; shown as pseudocode:
  // const signed = await signer.signEvent(unsignedEvent);
  // await Promise.all(pool.publish(relays, signed));
  // return { eventId: signed.id };

  return { eventId: "fake-event-id" };
}
```

### `ui:toast`

The widget may request simple UI feedback from the host.

```ts
async function handleToast(payload: unknown) {
  // payload typically looks like: { message: string, type?: "info"|"success"|"warning"|"error" }
  console.log("ui:toast", payload);
  return { ok: true };
}
```

## Security

### Origin + Source Validation

Hosts should validate at least:
- `ev.origin === widgetOrigin` derived from `button/app` URL
- `ev.source === iframe.contentWindow` (recommended)
- message shape: `{ type, action, id }`

### Permission Enforcement

Enforce privileged actions by checking declared `permission` tags.

A common policy is:
- privileged: `nostr:*`, `storage:*`
- non-privileged: `ui:*` (host may still choose to validate/rate-limit)

### Rate Limiting

For expensive actions like publish, apply rate limiting per widget (and possibly per user).

### Never expose private keys to widgets

Widgets must not have access to user secret keys. All signing must occur in the host application.

## Resources

- [Nostr NIP-33: Parameterized Replaceable Events](https://github.com/nostr-protocol/nips/blob/master/33.md)
- [postMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#attr-sandbox)
