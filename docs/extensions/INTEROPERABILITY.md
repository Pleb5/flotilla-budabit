# Smart Widget Interoperability Guide

This document describes how Flotilla Budabit implements the Smart Widget specification (NIP-XX, kind 30033) and documents any Flotilla-specific extensions for interoperability with other Smart Widget hosts.

> Related: See [`XX.md`](./XX.md) for the full NIP-XX specification.
> Related: See [`README.md`](./README.md) for the Flotilla extension developer guide.

---

## NIP-XX Compliance Summary

Flotilla Budabit implements Smart Widgets according to the NIP-XX specification with the following compliance notes:

### Event Structure (Kind 30033)

| Field | NIP-XX Requirement | Flotilla Implementation |
|-------|-------------------|------------------------|
| `kind` | `30033` | Compliant |
| `content` | Widget title | Compliant |
| `d` tag | Required unique identifier | Compliant |
| `l` tag | Required widget type | Compliant (defaults to `basic` for unknown types) |
| `image` tag | Required for action/tool | Compliant |
| `icon` tag | Required for action/tool | Compliant |
| `button` tags | Type-specific limits | Compliant |
| `input` tag | Max 1 | Compliant |
| `permission` tags | Optional | Compliant (also accepts `perm` for compatibility) |
| `client` tag | Optional | Compliant (used for origin hints) |

### Widget Types

| Type | NIP-XX Description | Flotilla Implementation |
|------|-------------------|------------------------|
| `basic` | Host-rendered, no iframe | Compliant - rendered via slot handlers |
| `action` | Iframe app, no return channel | Compliant - sandboxed iframe with appUrl |
| `tool` | Iframe app with bidirectional data | Compliant - sandboxed iframe with bridge |

### Button Types

| Type | NIP-XX Description | Flotilla Support |
|------|-------------------|------------------|
| `redirect` | Opens URL in new tab | Supported |
| `nostr` | Handles nostr: URIs | Supported |
| `zap` | Lightning payment | Supported |
| `post` | Form submission | Supported |
| `app` | Opens iframe application | Supported |

---

## Flotilla-Specific Extensions

The following features extend the base NIP-XX specification. Widgets relying on these features should degrade gracefully when running on other hosts.

### 1. Repository Context (`repoContext`)

Flotilla provides repository context to widgets when they are loaded within a repository view (e.g., as a repo-tab extension).

**Lifecycle Event: `widget:init`**

When a widget iframe loads, Flotilla sends an init event that may include repository context:

```typescript
{
  extensionId: string,
  type: "widget",
  origin: string,
  hostVersion: string,
  widget: {
    identifier: string,
    widgetType: "basic" | "action" | "tool",
    content: string,
    imageUrl?: string,
    iconUrl?: string,
    inputLabel?: string,
    buttons: WidgetButton[],
    permissions?: string[]
  },
  // Flotilla-specific extension:
  repoContext?: {
    pubkey: string,      // Repository owner's pubkey
    name: string,        // Repository name (d-tag identifier)
    naddr?: string,      // Full naddr for the repository
    relays?: string[],   // Associated relay URLs
    address: string      // Canonical address (30617:pubkey:name)
  }
}
```

**Compatibility Note:** Widgets should check for `repoContext` presence before using it:

```javascript
SWHandler.client.listen(data => {
  if (data.kind === "widget:init" && data.repoContext) {
    // Running in a repository context
    loadRepoData(data.repoContext.address)
  } else {
    // Generic context or non-Flotilla host
    showGenericUI()
  }
})
```

### 2. Extended Lifecycle Events

Flotilla implements additional lifecycle events beyond the base NIP-XX specification:

| Event | Payload | Description |
|-------|---------|-------------|
| `widget:init` | See above | Sent after iframe loads |
| `widget:mounted` | `{ timestamp: number }` | Sent after init completes |
| `context:repoUpdate` | RepoContext object | Sent when repo context changes |
| `widget:unmounting` | `{ timestamp: number }` | Sent before widget removal |

**Compatibility Note:** Handle missing events gracefully:

```javascript
// Always set a ready state even if mounted event doesn't arrive
let mounted = false
setTimeout(() => {
  if (!mounted) initializeWidget()
}, 1000)

SWHandler.client.listen(data => {
  if (data.kind === "widget:mounted") {
    mounted = true
    initializeWidget()
  }
})
```

### 3. Permission Tag Aliases

Flotilla accepts both `permission` and `perm` tags for permission declarations:

```json
// Both are equivalent in Flotilla:
["permission", "nostr:read"]
["perm", "nostr:read"]
```

**Recommendation:** Use `permission` for maximum compatibility with other hosts.

### 4. Extension Slot Configuration

Flotilla supports a `slot` configuration for manifest extensions that allows widgets to appear in specific UI locations. This is not part of the Smart Widget event structure but is relevant for NIP-89 manifest extensions:

```typescript
type ExtensionSlotConfig = {
  type: "repo-tab"
  label: string
  path: string
  builtinRoute?: string
}
```

**Note:** This configuration is only available for NIP-89 manifest extensions, not for Smart Widget events.

### 5. Origin Derivation

Flotilla derives the widget origin for security checks using the following priority:

1. `appUrl` from the first `app` button
2. `originHint` from the `client` tag's third element
3. `iconUrl` from the `icon` tag
4. `imageUrl` from the `image` tag
5. Fallback to host origin

**Recommendation:** Always include a valid URL in one of these locations for proper origin verification.

---

## Permission Namespace

Flotilla recognizes the following permission namespaces:

### Nostr Permissions

| Permission | Description |
|------------|-------------|
| `nostr:read` | Read events from relays |
| `nostr:write` | Publish events to relays |
| `nostr:signEvent` | Sign events with user's key |

### UI Permissions

| Permission | Description |
|------------|-------------|
| `ui:toast` | Show toast notifications |
| `ui:modal` | Show modal dialogs |

### Storage Permissions

| Permission | Description |
|------------|-------------|
| `storage:read` | Read from scoped storage |
| `storage:write` | Write to scoped storage |

**Implementation Note:** Permissions are enforced by the Flotilla bridge. Requests without declared permissions are denied.

---

## Testing Interoperability

### Validating Widget Events

Use the validation function from our test suite to check widget compliance:

```typescript
function validateSmartWidgetEvent(event: any): ValidationResult {
  const errors: string[] = []

  // Check kind
  if (event.kind !== 30033) {
    errors.push(`Invalid kind: expected 30033`)
  }

  // Check d tag
  const dTag = event.tags.find(t => t[0] === "d")
  if (!dTag?.[1]) {
    errors.push("Missing required 'd' tag")
  }

  // Check l tag
  const lTag = event.tags.find(t => t[0] === "l")
  if (!lTag?.[1]) {
    errors.push("Missing required 'l' tag")
  }

  // Type-specific checks
  const widgetType = lTag?.[1]
  if (widgetType === "action" || widgetType === "tool") {
    if (!event.tags.find(t => t[0] === "image")?.[1]) {
      errors.push(`Missing required 'image' tag for ${widgetType}`)
    }
    if (!event.tags.find(t => t[0] === "icon")?.[1]) {
      errors.push(`Missing required 'icon' tag for ${widgetType}`)
    }
    const buttons = event.tags.filter(t => t[0] === "button")
    if (!buttons.find(b => b[2] === "app")) {
      errors.push(`Missing required 'app' button for ${widgetType}`)
    }
  }

  return { valid: errors.length === 0, errors }
}
```

### Cross-Client Testing Checklist

When testing widgets for interoperability:

- [ ] Widget event passes validation against NIP-XX spec
- [ ] Widget renders correctly in YakiHonne (reference implementation)
- [ ] Widget renders correctly in Flotilla
- [ ] Flotilla-specific features degrade gracefully in other hosts
- [ ] Permissions are declared in standard `permission` tags
- [ ] Button types use only standard values
- [ ] Widget handles missing lifecycle events

---

## Known Compatibility Issues

### Issue 1: Permission Tag Variations

Some older widgets use `perm` instead of `permission`. Flotilla accepts both, but other hosts may not.

**Mitigation:** Always use `permission` tags when publishing new widgets.

### Issue 2: Missing Image Tags for Basic Widgets

The NIP-XX spec states image is optional for basic widgets, but some hosts may require it.

**Mitigation:** Include an image tag even for basic widgets for maximum compatibility.

### Issue 3: Lifecycle Event Timing

Different hosts may send lifecycle events at different times or not at all.

**Mitigation:** Use timeouts and defensive coding to handle missing events.

---

## Reference Implementations

- **YakiHonne Widget Editor**: https://yakihonne.com/smart-widget-builder
- **Smart Widget Handler (npm)**: https://www.npmjs.com/package/smart-widget-handler
- **Smart Widget Previewer (npm)**: https://www.npmjs.com/package/smart-widget-previewer
- **Flotilla Extension Template**: [`packages/flotilla-extension-template`](../../packages/flotilla-extension-template)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-24 | Initial documentation |

---

_This document is maintained as part of the Flotilla Budabit project. For questions about interoperability, please open an issue in the repository._
