# Extension Migration Guide: NIP-89 to Smart Widgets

> Step-by-step migration guide for extension authors transitioning from NIP-89 manifest extensions to Smart Widgets.

This guide provides practical migration steps, code examples, and adapter patterns for converting existing NIP-89 extensions to the Smart Widgets model.

---

## Table of Contents

1. [Overview](#overview)
2. [Migration Strategy](#migration-strategy)
3. [Step 1: Analyze Your Extension](#step-1-analyze-your-extension)
4. [Step 2: Convert Manifest to Widget Event](#step-2-convert-manifest-to-widget-event)
5. [Step 3: Update Initialization Handler](#step-3-update-initialization-handler)
6. [Step 4: Publish the Widget Event](#step-4-publish-the-widget-event)
7. [Step 5: Test Both Installations](#step-5-test-both-installations)
8. [Common Migration Patterns](#common-migration-patterns)
9. [Adapter Shim for Dual Support](#adapter-shim-for-dual-support)
10. [Troubleshooting](#troubleshooting)

---

## Overview

### What Changes

| Aspect | NIP-89 | Smart Widget |
|--------|--------|--------------|
| Event Kind | 31990 | 30033 |
| Metadata | JSON in content | Event tags |
| Discovery | INDEXER_RELAYS | SMART_WIDGET_RELAYS |
| Storage Key | `nip89[id]` | `widget[identifier]` |

### What Stays the Same

- Bridge protocol (`nostr:publish`, `ui:toast`, etc.)
- Iframe sandboxing
- Lifecycle events (`widget:init`, `widget:mounted`)
- Permission enforcement
- Extension-scoped storage

---

## Migration Strategy

### Recommended Approach: Parallel Support

During migration, maintain both NIP-89 and Smart Widget versions:

```
Phase 1: Publish Smart Widget event (keep NIP-89)
Phase 2: Update extension code for dual compatibility
Phase 3: Monitor adoption metrics
Phase 4: Deprecate NIP-89 version
```

### Quick Migration (New Extensions)

For new extensions, skip NIP-89 entirely:

1. Create Smart Widget event
2. Publish to SMART_WIDGET_RELAYS
3. Use widget-aware initialization code

---

## Step 1: Analyze Your Extension

### Inventory Your Manifest

Start with your existing NIP-89 manifest:

```json
{
  "id": "my-analytics-extension",
  "name": "Analytics Dashboard",
  "description": "Real-time analytics for your Nostr activity",
  "author": "Extension Author",
  "homepage": "https://example.com/analytics",
  "version": "2.1.0",
  "permissions": ["nostr:publish", "nostr:query", "storage:get", "storage:set"],
  "entrypoint": "https://cdn.example.com/analytics/index.html",
  "icon": "https://cdn.example.com/analytics/icon.png"
}
```

### Identify Widget Type

Choose your widget type based on behavior:

| Type | Use Case |
|------|----------|
| `action` | One-way iframe interactions (no data return) |
| `tool` | Two-way data exchange with host |
| `basic` | Host-rendered without iframe |

Most NIP-89 extensions map to `tool` (bidirectional communication).

---

## Step 2: Convert Manifest to Widget Event

### Mapping Fields to Tags

```javascript
// NIP-89 Manifest
const manifest = {
  id: "my-analytics-extension",
  name: "Analytics Dashboard",
  permissions: ["nostr:publish", "nostr:query", "storage:get", "storage:set"],
  entrypoint: "https://cdn.example.com/analytics/index.html",
  icon: "https://cdn.example.com/analytics/icon.png"
}

// Smart Widget Event (unsigned)
const widgetEvent = {
  kind: 30033,
  content: manifest.name,  // Title goes in content
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["d", manifest.id],    // Identifier
    ["l", "tool"],         // Widget type
    ["icon", manifest.icon],
    ["image", manifest.icon],  // Required for action/tool
    ["button", "Open", "app", manifest.entrypoint],
    // Convert permissions array to individual tags
    ...manifest.permissions.map(p => ["permission", p])
  ]
}
```

### Complete Conversion Example

**Before (NIP-89 kind 31990):**

```json
{
  "kind": 31990,
  "content": "{\"id\":\"my-analytics\",\"name\":\"Analytics Dashboard\",\"permissions\":[\"nostr:publish\",\"storage:get\"],\"entrypoint\":\"https://cdn.example.com/analytics/index.html\",\"icon\":\"https://cdn.example.com/icon.png\"}",
  "tags": [["d", "my-analytics"]]
}
```

**After (Smart Widget kind 30033):**

```json
{
  "kind": 30033,
  "content": "Analytics Dashboard",
  "tags": [
    ["d", "my-analytics"],
    ["l", "tool"],
    ["icon", "https://cdn.example.com/icon.png"],
    ["image", "https://cdn.example.com/preview.png"],
    ["button", "Open Dashboard", "app", "https://cdn.example.com/analytics/index.html"],
    ["permission", "nostr:publish"],
    ["permission", "storage:get"]
  ],
  "created_at": 1700000000
}
```

---

## Step 3: Update Initialization Handler

### Current NIP-89 Handler

```typescript
// widgets/src/main.ts (NIP-89 version)
window.addEventListener("message", (event) => {
  if (event.data.action === "widget:init") {
    const { manifest, repoContext } = event.data.payload
    console.log("Extension ID:", manifest.id)
    console.log("Permissions:", manifest.permissions)
    initializeExtension(repoContext)
  }
})
```

### Updated Dual-Compatible Handler

```typescript
// widgets/src/main.ts (dual support)
interface InitPayload {
  extensionId: string
  type: "nip89" | "widget"
  origin: string
  hostVersion: string
  manifest?: {
    id: string
    name: string
    version: string
    permissions: string[]
  }
  widget?: {
    identifier: string
    widgetType: "basic" | "action" | "tool"
    content: string
    imageUrl?: string
    iconUrl?: string
    buttons: Array<{ label: string; type: string; url: string }>
    permissions?: string[]
  }
  repoContext?: {
    pubkey: string
    name: string
    naddr?: string
    relays?: string[]
    address: string
  }
}

window.addEventListener("message", (event) => {
  if (event.data.action === "widget:init") {
    const payload = event.data.payload as InitPayload

    // Extract common data regardless of type
    const extensionId = payload.extensionId
    const repoContext = payload.repoContext

    // Handle type-specific data
    let permissions: string[] = []
    let displayName = ""

    if (payload.type === "nip89" && payload.manifest) {
      // NIP-89 extension
      permissions = payload.manifest.permissions || []
      displayName = payload.manifest.name
    } else if (payload.type === "widget" && payload.widget) {
      // Smart Widget
      permissions = payload.widget.permissions || []
      displayName = payload.widget.content
    }

    console.log(`Initialized as ${payload.type}: ${displayName}`)
    initializeExtension({ extensionId, permissions, repoContext })
  }
})
```

### TypeScript Type Guard

```typescript
function isNip89Init(payload: InitPayload): payload is InitPayload & { type: "nip89" } {
  return payload.type === "nip89" && !!payload.manifest
}

function isWidgetInit(payload: InitPayload): payload is InitPayload & { type: "widget" } {
  return payload.type === "widget" && !!payload.widget
}

// Usage
if (isNip89Init(payload)) {
  // payload.manifest is guaranteed to exist
  console.log(payload.manifest.version)
} else if (isWidgetInit(payload)) {
  // payload.widget is guaranteed to exist
  console.log(payload.widget.widgetType)
}
```

---

## Step 4: Publish the Widget Event

### Using nostr-tools

```typescript
import { finalizeEvent, generateSecretKey, nip19 } from "nostr-tools"
import { SimplePool } from "nostr-tools/pool"

// Load your secret key securely (never commit to repo!)
const sk = generateSecretKey() // Or load from secure storage

// Create unsigned event
const unsignedEvent = {
  kind: 30033,
  content: "Analytics Dashboard",
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["d", "my-analytics"],
    ["l", "tool"],
    ["icon", "https://cdn.example.com/icon.png"],
    ["image", "https://cdn.example.com/preview.png"],
    ["button", "Open Dashboard", "app", "https://cdn.example.com/analytics/index.html"],
    ["permission", "nostr:publish"],
    ["permission", "storage:get"]
  ]
}

// Sign and publish
const signedEvent = finalizeEvent(unsignedEvent, sk)

const pool = new SimplePool()
const relays = [
  "wss://relay.yakihonne.com",  // SMART_WIDGET_RELAYS
  "wss://relay.damus.io",        // Additional coverage
  "wss://nos.lol"
]

await Promise.all(pool.publish(relays, signedEvent))

// Generate naddr for sharing
const naddr = nip19.naddrEncode({
  pubkey: signedEvent.pubkey,
  kind: 30033,
  identifier: "my-analytics",
  relays
})

console.log("Published! naddr:", naddr)
```

### Using the Generator CLI

If using `flotilla-extension-template`:

```bash
pnpm manifest:generate \
  --type tool \
  --title "Analytics Dashboard" \
  --app-url "https://cdn.example.com/analytics/index.html" \
  --icon "https://cdn.example.com/icon.png" \
  --image "https://cdn.example.com/preview.png" \
  --button-title "Open Dashboard" \
  --permissions "nostr:publish,storage:get" \
  --identifier "my-analytics" \
  --output "dist/widget"
```

This generates:
- `dist/widget/event.json` - Unsigned event to sign and publish
- `dist/widget/widget.json` - Optional `/.well-known/widget.json`
- `dist/widget/PUBLISHING.md` - Publishing instructions

---

## Step 5: Test Both Installations

### Install via NIP-89 (Legacy)

1. Navigate to **Settings > Extensions**
2. Paste manifest URL in "Install by URL"
3. Enable the extension
4. Verify initialization with `type: "nip89"`

### Install via Smart Widget

1. Navigate to **Settings > Extensions**
2. Paste naddr in "Install Smart Widget"
3. Enable the widget
4. Verify initialization with `type: "widget"`

### Verification Checklist

- [ ] Both installations show in extension list
- [ ] Bridge actions work (`nostr:publish`, `storage:*`)
- [ ] Lifecycle events fire correctly
- [ ] UI renders properly
- [ ] Permissions enforced correctly

---

## Common Migration Patterns

### Pattern 1: Version Detection Adapter

Create an adapter that normalizes the initialization payload:

```typescript
// adapters/init-adapter.ts
export interface NormalizedInit {
  extensionId: string
  extensionType: "nip89" | "widget"
  displayName: string
  permissions: string[]
  repoContext?: {
    pubkey: string
    name: string
    address: string
    relays?: string[]
  }
}

export function normalizeInit(payload: any): NormalizedInit {
  const base = {
    extensionId: payload.extensionId,
    extensionType: payload.type,
    repoContext: payload.repoContext
  }

  if (payload.type === "nip89" && payload.manifest) {
    return {
      ...base,
      displayName: payload.manifest.name,
      permissions: payload.manifest.permissions || []
    }
  }

  if (payload.type === "widget" && payload.widget) {
    return {
      ...base,
      displayName: payload.widget.content,
      permissions: payload.widget.permissions || []
    }
  }

  throw new Error(`Unknown extension type: ${payload.type}`)
}
```

### Pattern 2: Feature Flag for Widget-Only Features

```typescript
// config.ts
export function isSmartWidget(payload: InitPayload): boolean {
  return payload.type === "widget"
}

// main.ts
window.addEventListener("message", (event) => {
  if (event.data.action === "widget:init") {
    const payload = event.data.payload
    const normalized = normalizeInit(payload)

    // Common initialization
    initCore(normalized)

    // Widget-only features
    if (isSmartWidget(payload)) {
      // Use widget-specific features like imageUrl, buttons
      initWidgetFeatures(payload.widget)
    }
  }
})
```

### Pattern 3: Storage Key Compatibility

Ensure storage keys work across both types:

```typescript
// Use extensionId (same for both) as storage scope
async function getStoredData(key: string) {
  const result = await bridge.request("storage:get", { key })
  return result.data
}

// Don't rely on type-specific identifiers
// BAD: const key = `${payload.manifest.id}:settings`
// GOOD: const key = `${payload.extensionId}:settings`
```

---

## Adapter Shim for Dual Support

### Complete Adapter Module

```typescript
// adapters/flotilla-compat.ts

export interface FlotillaExtensionContext {
  id: string
  type: "nip89" | "widget"
  name: string
  permissions: string[]
  origin: string
  hostVersion: string
  repo?: {
    pubkey: string
    name: string
    address: string
    naddr?: string
    relays?: string[]
  }
}

export class FlotillaAdapter {
  private context: FlotillaExtensionContext | null = null
  private initResolve: ((ctx: FlotillaExtensionContext) => void) | null = null
  private initPromise: Promise<FlotillaExtensionContext>

  constructor() {
    this.initPromise = new Promise((resolve) => {
      this.initResolve = resolve
    })

    window.addEventListener("message", this.handleMessage.bind(this))
  }

  private handleMessage(event: MessageEvent) {
    const { action, payload } = event.data || {}

    switch (action) {
      case "widget:init":
        this.context = this.parseInit(payload)
        this.initResolve?.(this.context)
        break
      case "widget:mounted":
        console.log("Extension mounted at", payload.timestamp)
        break
      case "widget:unmounting":
        console.log("Extension unmounting")
        this.cleanup()
        break
      case "context:repoUpdate":
        if (this.context) {
          this.context.repo = {
            pubkey: payload.pubkey,
            name: payload.name,
            address: payload.address,
            naddr: payload.naddr,
            relays: payload.relays
          }
        }
        break
    }
  }

  private parseInit(payload: any): FlotillaExtensionContext {
    const base = {
      id: payload.extensionId,
      type: payload.type,
      origin: payload.origin,
      hostVersion: payload.hostVersion,
      repo: payload.repoContext ? {
        pubkey: payload.repoContext.pubkey,
        name: payload.repoContext.name,
        address: payload.repoContext.address,
        naddr: payload.repoContext.naddr,
        relays: payload.repoContext.relays
      } : undefined
    }

    if (payload.type === "nip89") {
      return {
        ...base,
        name: payload.manifest.name,
        permissions: payload.manifest.permissions || []
      }
    }

    return {
      ...base,
      name: payload.widget.content,
      permissions: payload.widget.permissions || []
    }
  }

  async waitForInit(): Promise<FlotillaExtensionContext> {
    return this.initPromise
  }

  getContext(): FlotillaExtensionContext | null {
    return this.context
  }

  hasPermission(permission: string): boolean {
    return this.context?.permissions.includes(permission) ?? false
  }

  private cleanup() {
    // Cleanup logic here
  }
}

// Singleton instance
export const flotilla = new FlotillaAdapter()
```

### Usage

```typescript
// main.ts
import { flotilla } from "./adapters/flotilla-compat"

async function main() {
  const ctx = await flotilla.waitForInit()

  console.log(`Running as ${ctx.type}: ${ctx.name}`)
  console.log(`Permissions: ${ctx.permissions.join(", ")}`)

  if (ctx.repo) {
    console.log(`Repo context: ${ctx.repo.address}`)
  }

  // Check permissions before using features
  if (flotilla.hasPermission("nostr:publish")) {
    enablePublishFeature()
  }

  if (flotilla.hasPermission("storage:get")) {
    loadStoredSettings()
  }
}

main()
```

---

## Troubleshooting

### Widget Not Discovered

**Problem**: Smart Widget doesn't appear in discovery list

**Solutions**:
1. Verify publishing to correct relays (`wss://relay.yakihonne.com`)
2. Check event has valid `d` tag
3. Confirm `l` tag has valid type (`basic`, `action`, or `tool`)
4. Wait for relay propagation (up to 30 seconds)

### Permissions Denied

**Problem**: Bridge requests fail with permission errors

**Solutions**:
1. Verify `permission` tags in widget event (not `permissions`)
2. Check for typos in permission strings
3. Republish widget event with correct permissions

### Init Payload Missing Data

**Problem**: `payload.widget` or `payload.manifest` is undefined

**Solutions**:
1. Check `payload.type` before accessing type-specific fields
2. Use type guards or adapter pattern
3. Handle both types in initialization code

### Storage Data Lost

**Problem**: Storage data from NIP-89 version not accessible

**Solutions**:
1. Storage is scoped by `extensionId` - ensure ID matches
2. NIP-89 uses `manifest.id`, Smart Widget uses `d` tag value
3. Keep the same identifier for data continuity

### Iframe Not Loading

**Problem**: Widget iframe fails to load

**Solutions**:
1. Verify `button` tag has `app` type and valid URL
2. Check URL is HTTPS
3. Verify CORS headers allow embedding
4. Check browser console for CSP errors

---

## Related Documentation

- [`INVENTORY.md`](./INVENTORY.md) - Framework inventory
- [`BREAKING_CHANGES.md`](./BREAKING_CHANGES.md) - Breaking changes list
- [`README.md`](./README.md) - Developer guide
- [`XX.md`](./XX.md) - Smart Widget NIP specification
- [`flotilla-extension-template`](../../packages/flotilla-extension-template/README.md) - Extension template

---

_Last updated: 2026-01-24_
