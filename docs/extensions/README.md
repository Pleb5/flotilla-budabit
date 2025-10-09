# Flotilla Extension Developer Guide

Welcome to the **Flotilla Extensions Platform**, a modular system enabling you to build sandboxed integrations that enhance the Flotilla client using the Welshman ecosystem.

---

## 🧩 Architecture Overview

Flotilla’s extension system is composed of:

| Module | Responsibility |
|--------|----------------|
| **Registry** | Discovers, stores, and loads extension manifests (NIP‑89) |
| **Provider** | Spins up sandboxed iframes/workers for each enabled extension |
| **Bridge** | Handles `postMessage`  messaging between host and extension |
| **Policy Signer** | Verifies user consent with signed policy events (kind 31993) |
| **UI Slots** | Host components expose fixed insertion points for extension UI |
| **Settings UI** | Manage installed extensions, permissions, and enablement |

---

## 🧱 Manifest Structure (NIP‑89)

Extensions are defined using a JSON manifest (kind 31990). Required fields: `id` , `name` , `entrypoint` .

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
  "icon": "/images/extensions/huddle-icon.png",
  "sha256": "optional-integrity-hash"
}
```

---

## 🔐 Permissions & Security Model

Extensions must declare required capabilities. The host enforces these before performing privileged actions.

| Permission | Description |
|------------|-------------|
| `nostr:publish`  | Publish events using Welshman’s `publishThunk`  |
| `nostr:subscribe`  | Subscribe to Nostr filters through the repository |
| `nostr:getProfile`  | Request cached profiles from the host |
| `ui:toast`  | Trigger host UI toast notifications |
| `storage:get`  / `storage:set`  | _(Reserved for future data APIs)_ |

Security highlights:

- Iframes are sandboxed (`allow-scripts`  / `allow-same-origin`  only).
- Optional `sha256`  integrity validation.
- User consent recorded via kind 31993 policy events.
- Host-side handlers verify permissions per request.

---

## 🎨 UI Slot Integration Points

Extensions insert UI via registered slot handlers.

| Slot ID | Placement | Context Object |
|---------|-----------|----------------|
| `chat:composer:actions`  | Buttons near message composer | `{ room, composerState }`  |
| `chat:message:actions`  | Message action menu | `{ message, room }`  |
| `room:header:actions`  | Header action buttons on room page | `{ url, room }`  |
| `room:panel`  | Collapsible sidebar panel | `{ url, room }`  |
| `space:sidebar:widgets`  | Sidebar widgets in primary nav | `{ navigation }`  |

Use:

```ts
import {registerSlotHandler} from "@app/extensions"

registerSlotHandler("chat:composer:actions", ({root, context, extension}) => {
  const button = document.createElement("button")
  button.textContent = "Hello"
  button.onclick = () => extension.bridge?.post("ui:toast", {message: "Hello!"})
  root.appendChild(button)
})
```

---

## 🔄 Bridge API Reference

Extensions communicate using `postMessage` .

```ts
interface ExtensionMessage {
  id?: string
  type: "request" | "response" | "event"
  action: string
  payload?: unknown
}
```

### Host Actions

| Action | Request Payload | Response | Permission |
|--------|-----------------|----------|------------|
| `nostr:publish`  | `{ event }`  | `{ id }`  | `nostr:publish`  |
| `nostr:subscribe`  | `{ filters }`  | Stream of events | `nostr:subscribe`  |
| `nostr:getProfile`  | `{ pubkey }`  | Profile object | `nostr:getProfile`  |
| `ui:toast`  | `{ message, theme }`  | void | `ui:toast`  |

To send a request:

```js
const request = (action, payload) =>
  new Promise(resolve => {
    const id = crypto.randomUUID()
    const listener = event => {
      if (event.source === window.parent && event.data?.id === id) {
        window.removeEventListener("message", listener)
        resolve(event.data.payload)
      }
    }
    window.addEventListener("message", listener)
    window.parent.postMessage({id, type: "request", action, payload}, "*")
  })
```

---

## ⚡ Quick Start

1. Host your extension bundle + `manifest.json`  on HTTPS.
2. In Flotilla, open **Settings → Extensions → Install Extension** and enter the manifest URL.
3. Review requested permissions.
4. Enable the extension. UI hooks render via slot handlers.

---

## 🧠 Troubleshooting

- **No UI rendering:** ensure slot handler registered and extension is enabled.
- **Permission denied:** user may need to grant via policy signer (kind 31993).
- **Integrity warning:** check `sha256`  hash for manifest corrections.
- **Bridge handshake fails:** confirm `window.parent`  messaging and sandbox attributes.

---

## 🧩 Example Extension

A minimal iframe script:

```js
// index.js
import {request} from "./bridge.js"

document.getElementById("toast").onclick = () => {
  request("ui:toast", {message: "Hello from my extension!", theme: "info"})
}
```

---

## 🤝 Resources

- `flotilla-extension-template` 
- Welshman SDK: https://github.com/bizarro/welshman
- NIP‑89 spec: https://github.com/nostr-protocol/nips/blob/master/89.md

_© 2024 Flotilla Project — Extensions API v1.0_
