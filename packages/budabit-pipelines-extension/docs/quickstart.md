# Quick Start Guide

Get a Flotilla **Smart Widget** up and running in a few minutes.

This template builds an **iframe-based widget** and generates an **unsigned Nostr kind `30033`** event you can sign + publish.

> **Note:** This guide covers Smart Widgets specifically. Flotilla also supports NIP-89 Manifest Extensions (kind 31990). For guidance on choosing between extension types or building NIP-89 extensions, see the [Flotilla Extension Developer Guide](../../../docs/extensions/README.md).

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
  --icon "https://cdn.example.com/my-widget/icon.png" \
  --image "https://cdn.example.com/my-widget/preview.png" \
  --button-title "Open" \
  --permissions "nostr:publish,ui:toast" \
  --output "dist/widget"
```

Notes:
- `--type` should be `tool` (bidirectional) or `action` (one-way UX).
- `--identifier` is optional; if omitted it will be derived from `--title`.
- `--pubkey` is optional; if provided, publishing instructions can include an `naddr` hint.

## 5) Test the widget against a minimal host (local)

Smart Widgets communicate using an **action-based postMessage protocol**:

- Widget -> Host requests: `{ type: "request", id, action, payload }`
- Host -> Widget responses: `{ type: "response", id, action, payload }`
- Host -> Widget events: `{ type: "event", action, payload }`

Create `host-test.html` next to the repo root and open it in your browser:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Smart Widget Host Test</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 16px; }
      iframe { width: 100%; height: 700px; border: 1px solid #ccc; border-radius: 8px; }
      pre { background: #f7f7f7; padding: 12px; border-radius: 8px; overflow: auto; }
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
      const iframe = document.getElementById("widget");
      const logEl = document.getElementById("log");

      const log = (...args) => {
        logEl.textContent += args.map(String).join(" ") + "\n";
        console.log(...args);
      };

      window.addEventListener("message", async (ev) => {
        // In a real host, validate ev.origin + schema.
        const msg = ev.data;

        if (!msg || typeof msg !== "object") return;

        if (msg.type === "request") {
          log("[host] request:", msg.action, JSON.stringify(msg.payload));

          if (msg.action === "nostr:publish") {
            // Demo: pretend publishing succeeded and return a fake event id.
            iframe.contentWindow.postMessage(
              {
                type: "response",
                id: msg.id,
                action: msg.action,
                payload: { status: "ok", result: { eventId: "fake-event-id" } }
              },
              "*"
            );
            return;
          }

          if (msg.action === "ui:toast") {
            // Demo: host acknowledges toast.
            iframe.contentWindow.postMessage(
              {
                type: "response",
                id: msg.id,
                action: msg.action,
                payload: { status: "ok" }
              },
              "*"
            );
            return;
          }

          // Unknown action
          iframe.contentWindow.postMessage(
            {
              type: "response",
              id: msg.id,
              action: msg.action,
              payload: { error: "Unknown action: " + msg.action }
            },
            "*"
          );
        }
      });

      // Send widget:init immediately (before load)
      log("[host] sending widget:init");
      iframe.contentWindow?.postMessage(
        {
          type: "event",
          action: "widget:init",
          payload: {
            extensionId: "demo-widget",
            hostVersion: "1.0.0",
            repoContext: {
              owner: "demo-org",
              name: "demo-repo",
              fullName: "demo-org/demo-repo",
              defaultBranch: "main"
            }
          }
        },
        "*"
      );

      // Send widget:mounted once iframe is loaded
      iframe.addEventListener("load", () => {
        log("[host] iframe loaded; sending widget:mounted");
        iframe.contentWindow.postMessage(
          {
            type: "event",
            action: "widget:mounted",
            payload: {
              mountedAt: Date.now(),
              slot: "room:panel"
            }
          },
          "*"
        );
      });
    </script>
  </body>
</html>
```

## 6) Customize

### Update package names (optional)

```bash
# Example: replace @flotilla/ext with your own scope/name
find . -type f -name "package.json" -exec sed -i '' 's/@flotilla\/ext/@my-org\/my-widget/g' {} +
```

### Implement your widget logic

- UI lives in `packages/iframe-app/src/App.svelte`
- Bridge + types live in `packages/shared/src/`
- Nostr event helpers live in `packages/shared/src/signaling.ts`

## 7) Publish

Follow the generated instructions:

- `dist/widget/PUBLISHING.md`

It walks you through signing and publishing the kind `30033` event.

## Common Commands

```bash
pnpm dev
pnpm build
pnpm test
pnpm e2e
pnpm manifest:generate
```
