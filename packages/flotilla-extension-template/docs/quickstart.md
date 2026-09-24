# Quick Start Guide

Get a BudaBit **Smart Widget** up and running in a few minutes.

This template builds an **iframe-based widget** and generates an **unsigned Nostr kind `30033`** event you can sign + publish.

> **Note:** This guide covers Smart Widgets, the supported extension model in BudaBit. For host-specific behavior, see the [BudaBit Extension Developer Guide](../../../docs/extensions/README.md).

## Prerequisites

- Node.js 18+
- pnpm 8+
- Basic TypeScript and Svelte knowledge

## 1) Install

```bash
pnpm install
```

## 2) Run the iframe app locally

```bash
pnpm dev
```

Open:

- http://localhost:5173

## 3) Build

```bash
pnpm build
```

The built iframe HTML will be at:

- `packages/iframe-app/dist/index.html`

## 4) Generate Smart Widget files (kind 30033)

This writes:

- `dist/widget/event.json` (unsigned kind `30033` event)
- `dist/widget/widget.json` (optional `/.well-known/widget.json`)
- `dist/widget/PUBLISHING.md` (signing + publishing steps)

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
  --nostr-kinds "30301,30302" \
  --output "dist/widget"
```

Notes:

- `--type` should be `tool` (bidirectional) or `action` (one-way UX).
- `--identifier` is optional for local experiments, but public release workflows should set an explicit stable value and reuse it for every update.
- `--version` and `--changelog` are optional release metadata shown by BudaBit when an installed widget update is available.
- `--fallback-app-urls` is optional. Use it for Blossom mirrors or other HTTPS artifact URLs; BudaBit tries them if the primary URL fails.
- `--pubkey` is optional; if provided, publishing instructions can include an `naddr` hint.
- `--nostr-kinds` declares which Nostr event kinds your widget needs to query/subscribe to.
- `--permissions` should include `nostr:subscribe` for real-time subscriptions, `community:checkWriteCapabilities` / `community:queryEvents` for descriptor-based community APIs, and `community:querySharedConfig` for shared community configuration.

## 5) Test the widget against a minimal host (local)

Smart Widgets communicate using an **action-based postMessage protocol**:

- Widget → Host requests: `{ type: "request", id, action, payload }`
- Host → Widget responses: `{ type: "response", id, action, payload }`
- Host → Widget events: `{ type: "event", action, payload }`

Create `host-test.html` next to the repo root and open it in your browser:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Smart Widget Host Test</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        margin: 16px;
      }
      iframe {
        width: 100%;
        height: 700px;
        border: 1px solid #ccc;
        border-radius: 8px;
      }
      pre {
        background: #f7f7f7;
        padding: 12px;
        border-radius: 8px;
        overflow: auto;
      }
    </style>
  </head>
  <body>
    <h1>Smart Widget Host Test</h1>

    <iframe
      id="widget"
      src="http://localhost:5173"
      sandbox="allow-scripts allow-same-origin"
    ></iframe>

    <h2>Log</h2>
    <pre id="log"></pre>

    <script>
      const iframe = document.getElementById('widget');
      const logEl = document.getElementById('log');

      const log = (...args) => {
        logEl.textContent += args.map(String).join(' ') + '\n';
        console.log(...args);
      };

      window.addEventListener('message', async (ev) => {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object') return;

        // Handle BudaBit bridge protocol
        if (msg.type === 'request') {
          log('[host] request:', msg.action, JSON.stringify(msg.payload));

          if (msg.action === 'nostr:publish') {
            iframe.contentWindow.postMessage(
              {
                type: 'response',
                id: msg.id,
                action: msg.action,
                payload: { status: 'ok', result: { eventId: 'fake-event-id' } },
              },
              '*'
            );
            return;
          }

          if (msg.action === 'nostr:query') {
            iframe.contentWindow.postMessage(
              {
                type: 'response',
                id: msg.id,
                action: msg.action,
                payload: { events: [], status: 'ok' },
              },
              '*'
            );
            return;
          }

          if (msg.action === 'ui:toast' || msg.action === 'ui:resize') {
            iframe.contentWindow.postMessage(
              {
                type: 'response',
                id: msg.id,
                action: msg.action,
                payload: { status: 'ok' },
              },
              '*'
            );
            return;
          }

          // Unknown action
          iframe.contentWindow.postMessage(
            {
              type: 'response',
              id: msg.id,
              action: msg.action,
              payload: { error: 'Unknown action: ' + msg.action },
            },
            '*'
          );
        }
      });

      // Send widget:init immediately (before load)
      log('[host] sending widget:init');
      iframe.contentWindow?.postMessage(
        {
          type: 'event',
          action: 'widget:init',
          payload: {
            extensionId: 'demo-widget',
            hostVersion: '1.0.0',
            repoContext: {
              owner: 'demo-org',
              name: 'demo-repo',
              fullName: 'demo-org/demo-repo',
              defaultBranch: 'main',
            },
          },
        },
        '*'
      );

      // Send widget:mounted once iframe is loaded
      iframe.addEventListener('load', () => {
        log('[host] iframe loaded; sending widget:mounted');
        iframe.contentWindow.postMessage(
          {
            type: 'event',
            action: 'widget:mounted',
            payload: {
              mountedAt: Date.now(),
              slot: 'repo-tab',
            },
          },
          '*'
        );
      });
    </script>
  </body>
</html>
```

## 6) Customize

### Implement your widget logic

- UI lives in `packages/iframe-app/src/App.svelte`
- Bridge + types live in `packages/shared/src/`
- Nostr event helpers live in `packages/shared/src/signaling.ts`

### Key patterns

```typescript
import { WidgetBridge } from '@budabit/ext-shared'

const bridge = new WidgetBridge()

// 1. Listen for initialization
bridge.onEvent("widget:init", (payload) => {
  console.log("Extension ID:", payload.extensionId)
  console.log("User pubkey:", payload.pubkey)
  console.log("Relays:", payload.relays)

  if (payload.repoContext) {
    console.log("Repo:", payload.repoContext.name)
  }
})

// 2. Listen for repo context updates
bridge.onEvent("context:repoUpdate", (ctx) => {
  console.log("Repo updated:", ctx.name)
})

// 3. Signal readiness (triggers widget:mounted)
bridge.signalReady()

// 4. Make bridge requests
const result = await bridge.request("nostr:publish", unsignedEvent)
await bridge.request("ui:toast", { message: "Published!", type: "success" })

// 5. Open real-time subscriptions
const sub = await bridge.subscribe({
  relays: ["wss://relay.example.com"],
  filter: { kinds: [30301] },
})
bridge.onEvent("nostr:subscription:event", ({ subscriptionId, event }) => { ... })

// 6. Resize iframe
await bridge.request("ui:resize", { height: 800 })
```

## 7) Publish

Follow the generated instructions:

- `dist/widget/PUBLISHING.md`

It walks you through signing and publishing the kind `30033` event.

For Blossom-backed releases:

1. Build the iframe app with `pnpm build`.
2. Upload the built `index.html` to Blossom, or run `pnpm widget:publish:blossom` to upload before signing.
3. Publish a kind `30033` event whose `button`/`app` URL points at the Blossom URL.
4. For updates, regenerate with the same `--identifier`, a newer `--version` / `--changelog`, and publish the newer event.
5. BudaBit detects the same publisher pubkey + kind `30033` + same `d` identifier and shows installed users a manual update.

## Common Commands

```bash
pnpm dev
pnpm build
pnpm test
pnpm e2e
pnpm manifest:generate
```
