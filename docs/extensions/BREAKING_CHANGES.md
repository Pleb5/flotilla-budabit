# Breaking Changes: NIP-89 to Smart Widgets Migration

> Differences between legacy NIP-89 extensions and the new Smart Widgets model that may break existing extension authors.

This document identifies breaking changes and compatibility issues for developers migrating from NIP-89 manifest-based extensions (kind 31990) to Smart Widgets (kind 30033).

---

## Table of Contents

1. [Summary of Breaking Changes](#summary-of-breaking-changes)
2. [Event Kind Change](#event-kind-change)
3. [Manifest Structure Changes](#manifest-structure-changes)
4. [Discovery Mechanism Changes](#discovery-mechanism-changes)
5. [Permission Declaration Changes](#permission-declaration-changes)
6. [Lifecycle Event Changes](#lifecycle-event-changes)
7. [Entrypoint URL Changes](#entrypoint-url-changes)
8. [Storage Bucket Changes](#storage-bucket-changes)
9. [Bridge Protocol Compatibility](#bridge-protocol-compatibility)
10. [UI Slot Handling Changes](#ui-slot-handling-changes)
11. [Deprecation Timeline](#deprecation-timeline)

---

## Summary of Breaking Changes

| Area | NIP-89 (Legacy) | Smart Widgets (New) | Impact |
|------|-----------------|---------------------|--------|
| Event kind | 31990 | 30033 | Re-publish required |
| Manifest format | JSON in `content` | Tags-based | Rewrite required |
| Discovery relays | INDEXER_RELAYS | SMART_WIDGET_RELAYS | Different relay sets |
| Identifier | `manifest.id` | `d` tag value | ID format change |
| Entry URL | `manifest.entrypoint` | `button` tag with type `app` | Tag parsing |
| Permissions | `manifest.permissions[]` | `permission` tags | Format change |
| Widget types | N/A (all iframe) | basic/action/tool | New concept |
| Initialization | `widget:init` event | Same | Compatible |
| Storage bucket | `installed.nip89[id]` | `installed.widget[id]` | Different storage paths |

---

## Event Kind Change

### NIP-89 (Legacy)

Extensions are discovered via **kind 31990** events:

```json
{
  "kind": 31990,
  "content": "{\"id\":\"my-ext\",\"name\":\"My Extension\",\"entrypoint\":\"https://...\"}",
  "tags": [["d", "my-ext"]]
}
```

### Smart Widgets (New)

Widgets use **kind 30033** events:

```json
{
  "kind": 30033,
  "content": "My Widget",
  "tags": [
    ["d", "my-widget"],
    ["l", "tool"],
    ["button", "Open", "app", "https://..."],
    ["permission", "nostr:publish"]
  ]
}
```

### Migration Impact

- **Breaking**: Existing kind 31990 events are not discoverable as Smart Widgets
- **Action Required**: Publish a new kind 30033 event
- **Dual Support**: Both can coexist; Flotilla loads from separate buckets

---

## Manifest Structure Changes

### NIP-89 Manifest (JSON in content)

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "description": "Description text",
  "author": "Author Name",
  "homepage": "https://example.com",
  "version": "1.0.0",
  "permissions": ["nostr:publish", "ui:toast"],
  "entrypoint": "https://cdn.example.com/extension/index.html",
  "icon": "/images/icon.png",
  "sha256": "optional-hash"
}
```

### Smart Widget Tags

| NIP-89 Field | Smart Widget Equivalent | Notes |
|--------------|------------------------|-------|
| `id` | `d` tag | Must be in tags, not content |
| `name` | `content` field | Title in content |
| `description` | N/A | Not directly supported |
| `author` | Event `pubkey` | Implicit from signing |
| `homepage` | N/A | Not directly supported |
| `version` | N/A | Use `created_at` for versioning |
| `permissions` | `permission` tags | One tag per permission |
| `entrypoint` | `button` tag with `app` type | Different format |
| `icon` | `icon` tag | Same purpose |
| `sha256` | N/A | Not supported |

### Migration Impact

- **Breaking**: JSON manifest format is not compatible
- **Action Required**: Convert manifest fields to event tags
- **Lost Data**: `description`, `homepage`, `version` have no direct equivalent

---

## Discovery Mechanism Changes

### NIP-89 Discovery

```typescript
// Fetches from INDEXER_RELAYS
const events = await request({
  relays: INDEXER_RELAYS,
  filters: [{kinds: [31990], limit: 100}]
})
```

### Smart Widget Discovery

```typescript
// Fetches from SMART_WIDGET_RELAYS (wss://relay.yakihonne.com)
const events = await request({
  relays: SMART_WIDGET_RELAYS,
  filters: [{kinds: [30033], limit: 200}]
})
```

### Migration Impact

- **Breaking**: Different relay sets for discovery
- **Action Required**: Publish to SMART_WIDGET_RELAYS
- **Compatibility**: Can publish to both relay sets for transition period

---

## Permission Declaration Changes

### NIP-89 Permissions

```json
{
  "permissions": ["nostr:publish", "ui:toast", "storage:get"]
}
```

### Smart Widget Permissions

```json
{
  "tags": [
    ["permission", "nostr:publish"],
    ["permission", "ui:toast"],
    ["permission", "storage:get"]
  ]
}
```

Alternative tag name:
```json
["perm", "nostr:publish"]
```

### Migration Impact

- **Breaking**: Array format not supported in widgets
- **Action Required**: Convert each permission to a separate tag
- **Compatible**: Same permission strings work in both systems

---

## Lifecycle Event Changes

### Lifecycle Events (Compatible)

Both systems receive the same lifecycle events from the host:

| Event | Payload | Compatibility |
|-------|---------|---------------|
| `widget:init` | Extension metadata | Compatible |
| `widget:mounted` | `{ timestamp }` | Compatible |
| `widget:unmounting` | `{ timestamp }` | Compatible |
| `context:repoUpdate` | Repo context | Compatible |

### Init Payload Differences

**NIP-89 init payload:**
```typescript
{
  extensionId: string,
  type: "nip89",
  origin: string,
  hostVersion: string,
  manifest: {
    id, name, version, permissions
  },
  repoContext?: {...}
}
```

**Smart Widget init payload:**
```typescript
{
  extensionId: string,
  type: "widget",
  origin: string,
  hostVersion: string,
  widget: {
    identifier, widgetType, content,
    imageUrl, iconUrl, inputLabel,
    buttons, permissions
  },
  repoContext?: {...}
}
```

### Migration Impact

- **Breaking**: `payload.type` changes from `"nip89"` to `"widget"`
- **Breaking**: `payload.manifest` becomes `payload.widget`
- **Action Required**: Update init handler to check for both formats

---

## Entrypoint URL Changes

### NIP-89 Entrypoint

Specified in manifest JSON:

```json
{
  "entrypoint": "https://cdn.example.com/extension/index.html"
}
```

### Smart Widget App URL

Specified in button tag:

```json
["button", "Open", "app", "https://cdn.example.com/widget/index.html"]
```

### Migration Impact

- **Breaking**: Different parsing required
- **Action Required**: Create button tag with `app` type
- **Note**: Button label (e.g., "Open") is required

---

## Storage Bucket Changes

### NIP-89 Storage Path

```typescript
extensionSettings.installed.nip89[manifestId]
```

### Smart Widget Storage Path

```typescript
extensionSettings.installed.widget[identifier]
```

### Extension-Scoped Storage

Both systems use the same scoped storage format:

```
flotilla:ext:{extensionId}:{key}
```

### Migration Impact

- **Breaking**: Settings stored in different buckets
- **Impact**: Users must re-install as Smart Widget
- **Data Preserved**: Extension-scoped storage keys unchanged if ID matches

---

## Bridge Protocol Compatibility

### Compatible Actions

The bridge protocol is fully compatible:

| Action | NIP-89 | Smart Widget | Status |
|--------|--------|--------------|--------|
| `nostr:publish` | Yes | Yes | Compatible |
| `nostr:query` | Yes | Yes | Compatible |
| `ui:toast` | Yes | Yes | Compatible |
| `storage:get` | Yes | Yes | Compatible |
| `storage:set` | Yes | Yes | Compatible |
| `storage:remove` | Yes | Yes | Compatible |
| `storage:keys` | Yes | Yes | Compatible |
| `context:getRepo` | Yes | Yes | Compatible |

### Message Format (Compatible)

```typescript
// Request (widget -> host)
{ type: "request", id: "...", action: "nostr:publish", payload: {...} }

// Response (host -> widget)
{ type: "response", id: "...", action: "nostr:publish", payload: {...} }

// Event (host -> widget)
{ type: "event", action: "widget:init", payload: {...} }
```

### Migration Impact

- **Compatible**: Same message format
- **Compatible**: Same action strings
- **Compatible**: Same payload structures

---

## UI Slot Handling Changes

### Slot Handler Type Check

Extensions should update slot handlers to check extension type:

```typescript
// Before (NIP-89 only)
registerSlotHandler("chat:message:actions", ({extension}) => {
  if (!extension) return
  extension.bridge?.post("ui:toast", {message: "Hello"})
})

// After (both types)
registerSlotHandler("chat:message:actions", ({extension}) => {
  if (!extension) return

  if (extension.type === "widget") {
    // Smart Widget
    const {widget} = extension
    if (widget.widgetType === "basic") {
      // Render without iframe
    } else {
      extension.bridge?.post("ui:toast", {message: "Hello"})
    }
  } else {
    // NIP-89 extension
    extension.bridge?.post("ui:toast", {message: "Hello"})
  }
})
```

### Basic Widget Rendering

**New in Smart Widgets**: `basic` type widgets render without iframe:

```typescript
if (extension.type === "widget" && extension.widget.widgetType === "basic") {
  // No bridge available - render directly from widget metadata
  const button = document.createElement("button")
  button.textContent = extension.widget.content
  root.appendChild(button)
}
```

### Migration Impact

- **Breaking**: Type check required in slot handlers
- **New Feature**: Basic widgets have no bridge
- **Action Required**: Add type guards in slot handlers

---

## Deprecation Timeline

### Current Status (v2)

| Feature | Status |
|---------|--------|
| NIP-89 Manifests (kind 31990) | Supported |
| Smart Widgets (kind 30033) | Supported |
| Legacy flat settings | Auto-migrated |

### Planned Deprecations

| Timeline | Change |
|----------|--------|
| v2.1 | Deprecation warning for NIP-89 discovery |
| v2.2 | NIP-89 discovery disabled by default |
| v3.0 | NIP-89 support removed |

### Migration Recommendation

1. **Now**: Publish Smart Widget event alongside NIP-89 manifest
2. **v2.1**: Test Smart Widget installation flow
3. **v2.2**: Migrate users to Smart Widget version
4. **v3.0**: Remove NIP-89 manifest

---

## Compatibility Matrix

| Feature | NIP-89 | Smart Widget | Action Required |
|---------|--------|--------------|-----------------|
| Event publishing | Yes | Yes | Re-publish as 30033 |
| Relay discovery | INDEXER | YAKIHONNE | Publish to new relays |
| Permissions | Array | Tags | Convert format |
| Entrypoint | JSON field | Button tag | Add button tag |
| Bridge protocol | Full | Full | None |
| Storage | Scoped | Scoped | None (if ID matches) |
| Lifecycle | Full | Full | Handle type change |
| Slots | Full | Full | Add type guards |

---

## Quick Migration Checklist

- [ ] Create kind 30033 event with equivalent tags
- [ ] Add `d` tag with widget identifier
- [ ] Add `l` tag with widget type (`action` or `tool`)
- [ ] Add `button` tag with `app` type and URL
- [ ] Convert permissions array to `permission` tags
- [ ] Add `icon` and `image` tags if needed
- [ ] Publish to SMART_WIDGET_RELAYS
- [ ] Update init handler to check `payload.type`
- [ ] Update slot handlers with type guards
- [ ] Test with both NIP-89 and Smart Widget installs

---

## Related Documentation

- [`INVENTORY.md`](./INVENTORY.md) - Framework inventory
- [`MIGRATION.md`](./MIGRATION.md) - Step-by-step migration guide
- [`README.md`](./README.md) - Developer guide
- [`XX.md`](./XX.md) - Smart Widget NIP specification

---

_Last updated: 2026-01-24_
