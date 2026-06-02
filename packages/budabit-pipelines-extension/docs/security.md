# Security Best Practices

Security guidelines for Flotilla **Smart Widget** developers and host integrators.

Smart Widgets are represented on Nostr as **kind `30033` addressable events** and (for `action`/`tool` widgets) run as **sandboxed iframes** that communicate with the host via an **action-based postMessage protocol**:

- Widget → Host **request**: `{ type: "request", id, action, payload }`
- Host → Widget **response**: `{ type: "response", id, action, payload }`
- Host → Widget **event**: `{ type: "event", action, payload }`

This document focuses on isolating untrusted widget code, validating messages, and enforcing permissions for privileged host capabilities.

## Sandboxing

### Iframe Sandbox Attributes

Smart Widgets should run in sandboxed iframes with restricted capabilities. A recommended baseline:

```html
<iframe
  src="https://cdn.example.com/widget/index.html"
  sandbox="allow-scripts allow-same-origin"
></iframe>
```

**Sandbox Notes**:
- ✅ `allow-scripts` - Required for JavaScript execution
- ✅ `allow-same-origin` - Typically required for postMessage and some web APIs (use with care)
- ❌ No access to parent window DOM
- ❌ No top-level navigation by default
- ❌ No popups (unless explicitly allowed)
- ❌ No forms / automatic downloads (unless explicitly allowed)

Only add additional sandbox allowances when necessary and tied to explicit user intent.

### Permission Attributes (`allow=`)

Use the iframe `allow` attribute for media permissions and other powerful APIs:

```html
<!-- Microphone only -->
<iframe allow="microphone"></iframe>

<!-- Camera only -->
<iframe allow="camera"></iframe>

<!-- Both -->
<iframe allow="microphone; camera"></iframe>

<!-- Screen sharing -->
<iframe allow="display-capture"></iframe>
```

Host policy should be:
- default deny for microphone/camera/screen capture
- enable only after explicit user consent and clear UI

## Message Validation (Host Bridge)

### Origin + Source Validation

Hosts should validate at least:
- `ev.origin === widgetOrigin` where `widgetOrigin` is derived from the widget `button` tag `app` URL
- `ev.source === iframe.contentWindow` (recommended)
- message shape: expected keys and types

Recommended minimum checks for widget → host requests:
- `type === "request"`
- `id` is a string
- `action` is a string
- `payload` is present only when expected

### Strict Action Allow-List

Treat actions as an API surface. Hosts should implement an allow-list:
- known actions only
- per-action payload validation
- per-action rate limits
- per-action permission enforcement (see next section)

Unknown actions should return a safe error response.

## Permission Model (Action-Based)

### Declaring Permissions (kind 30033 tags)

Widgets declare permissions via `permission` tags on the kind `30033` event:

```json
{
  "kind": 30033,
  "tags": [
    ["permission", "nostr:publish"],
    ["permission", "ui:toast"]
  ]
}
```

### Enforcing Permissions (Host)

A common host policy is to treat these action namespaces as privileged:
- privileged: `nostr:*`, `storage:*`
- non-privileged (still validated/rate-limited as needed): `ui:*`

Example enforcement:

```ts
function isPrivileged(action: string): boolean {
  return action.startsWith("nostr:") || action.startsWith("storage:");
}

function isActionAllowed(action: string, declaredPermissions: string[]): boolean {
  if (!isPrivileged(action)) return true;
  return declaredPermissions.includes(action);
}
```

Hosts may choose to be stricter (for example, requiring explicit permission tags for `ui:*` actions too). If you do, document it and ensure widgets handle denials gracefully.

### User Consent

For privileged actions, the host should:
- show clear user prompts when appropriate
- explain the action and data being used (e.g., what will be published)
- remember per-widget decisions if your UX calls for it

## Event Validation (Before Signing / Publishing)

### Validate Before `nostr:publish`

Widgets should send **unsigned** Nostr events to the host for signing/publishing. The host must validate before signing:

- Allowed `kind` values (host policy)
- `created_at` within an acceptable window (e.g., ±1 hour)
- Content size limits (e.g., 100KB)
- Tag count and tag value limits
- Any host-specific constraints (relays, mentions, etc.)

Example:

```ts
type UnsignedEvent = {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
};

function validateUnsignedEvent(event: UnsignedEvent, allowedKinds: number[]): void {
  if (!allowedKinds.includes(event.kind)) {
    throw new Error(`Event kind ${event.kind} not allowed`);
  }

  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - event.created_at);
  if (diff > 3600) {
    throw new Error("Event timestamp out of range");
  }

  if (event.content.length > 100000) {
    throw new Error("Event content too large");
  }

  if (event.tags.length > 100) {
    throw new Error("Too many tags");
  }

  for (const tag of event.tags) {
    if (tag.length > 10) throw new Error("Tag too long");
    for (const value of tag) {
      if (value.length > 1000) throw new Error("Tag value too long");
    }
  }
}
```

## Rate Limiting

Rate limit expensive actions (especially privileged ones) per widget and/or per user.

Example:

```ts
class RateLimiter {
  private counts = new Map<string, number[]>();

  check(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const timestamps = this.counts.get(key) || [];

    const recent = timestamps.filter((t) => now - t < windowMs);
    if (recent.length >= limit) return false;

    recent.push(now);
    this.counts.set(key, recent);
    return true;
  }

  reset(key: string): void {
    this.counts.delete(key);
  }
}

const limiter = new RateLimiter();

// Example usage inside host action handler:
async function handleAction(action: string, payload: unknown, widgetId: string) {
  if (action === "nostr:publish") {
    // 10 publish requests per minute per widget
    if (!limiter.check(`publish:${widgetId}`, 10, 60_000)) {
      throw new Error("Rate limit exceeded");
    }
  }

  // ...perform action...
}
```

## Content Security Policy (CSP)

### For Widget HTML (Recommended)

Widget authors should ship a CSP that reduces XSS risk. Example (adjust for your CDN/relay list):

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self';
           script-src 'self';
           style-src 'self' 'unsafe-inline';
           img-src 'self' https:;
           connect-src https: wss:;
           frame-ancestors 'none';"
/>
```

Notes:
- Avoid `unsafe-inline` for scripts when possible.
- If you must use inline styles (common in some tooling), keep `style-src 'unsafe-inline'` but keep scripts strict.

### For Host Application (Recommended)

Hosts should enforce a CSP that restricts what can be framed:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self';
           frame-src https://cdn.example.com;
           script-src 'self';
           style-src 'self';"
/>
```

## Secure Storage

### Never Expose Private Keys to Widgets

Widgets must never receive private keys. All signing must happen in the host.

Widget code should never attempt to load secret keys from local storage:

```ts
// ❌ BAD: Don't do this in a widget
const privateKey = localStorage.getItem("sk");
```

Instead, request host capabilities through actions:

```ts
// ✅ GOOD: Request publish via host action
await bridge.request("nostr:publish", unsignedEvent);
```

### Sensitive Data

As a widget author:
- assume the widget environment is untrusted and user-controlled
- avoid storing secrets in the widget at all
- if you must store sensitive values (discouraged), encrypt them and consider whether this belongs in the host instead (via `storage:*` actions)

As a host integrator:
- treat `storage:*` actions as privileged
- implement per-widget quotas and clear user-facing UI for stored data

## Network Security

### HTTPS Only

All Smart Widget URLs should use HTTPS:
- `button/app` URL (iframe entry point)
- `icon` and `image` URLs
- any other external resources

```ts
function assertHttpsUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error(`Non-HTTPS URL not allowed: ${url}`);
}
```

### Validate URLs and Origins

Hosts should:
- derive `widgetOrigin` from the `app` URL
- use it for `postMessage` targetOrigin and origin validation
- reject mismatched origins

## Dependency Security

### Regular Updates

```bash
pnpm audit
pnpm update
pnpm audit fix
```

### Lock File

Always commit `pnpm-lock.yaml`:

```bash
git add pnpm-lock.yaml
git commit -m "Update dependencies"
```

### Minimal Dependencies

Keep widget dependencies small to reduce attack surface and load times.

## Error Handling

### Don’t Leak Sensitive Details

Hosts should return generic errors to widgets, while logging full details internally.

```ts
// ❌ BAD: Leaks internal stack traces to untrusted widget
catch (error) {
  return { error: String((error as any)?.stack ?? error) };
}

// ✅ GOOD: Generic error response; internal logs for debugging
catch (error) {
  console.error("Host internal error:", error);
  return { error: "An error occurred" };
}
```

## Logging

### Sanitize Logs

Avoid printing sensitive data (potential keys, tokens, full event contents) to logs.

```ts
function sanitizeForLog(data: unknown): unknown {
  if (typeof data === "string") {
    // Redact potential 64-hex strings that could be private keys or identifiers
    return data.replace(/[0-9a-f]{64}/gi, "[REDACTED]");
  }
  return data;
}

console.log("Widget payload:", sanitizeForLog(payload));
```

## Security Checklist

For widget authors (before publishing):
- [ ] All URLs in kind 30033 tags use HTTPS (`app`, `icon`, `image`)
- [ ] Permissions are minimal (only what the widget actually needs)
- [ ] No private keys or secrets in widget code
- [ ] Outgoing publish payloads are reasonable (size, tags, kinds)
- [ ] CSP is configured (recommended)
- [ ] Dependencies up to date (`pnpm audit`)
- [ ] Tests passing

For host integrators:
- [ ] Iframe uses sandbox baseline (`allow-scripts allow-same-origin`) and only adds capabilities intentionally
- [ ] postMessage validates `origin` and `source`
- [ ] Strict action allow-list + payload validation per action
- [ ] Privileged actions (`nostr:*`, `storage:*`) enforced via declared `permission` tags + user consent
- [ ] Rate limiting for expensive actions
- [ ] Errors returned to widgets are generic (no sensitive details)

## Reporting Vulnerabilities

If you discover a security vulnerability:

1. **Do not** open a public issue
2. Email security@example.com
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Resources

- [Nostr NIP-33: Parameterized Replaceable Events](https://github.com/nostr-protocol/nips/blob/master/33.md)
- [postMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#attr-sandbox)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
