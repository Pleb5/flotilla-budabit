# Budabit Blossom Architecture

This document defines Budabit's Blossom upload, optimization, mirroring, and media-management model for personal, community, and fallback media storage. It supersedes the earlier community-only replication design.

## Purpose

Budabit should make Blossom usable without asking people to understand every server capability up front. The app should pick safe defaults, explain important tradeoffs, and expose enough control for users and communities that care about durability, bandwidth, or storage policy.

The design has five product goals:

- Publish media quickly after one successful upload.
- Preserve Blossom's content-addressed hash model across every mirror.
- Use server-side optimization when available without depending on it.
- Let users choose which uploads are important enough to mirror.
- Provide a first-class Blossom dashboard instead of sending users to random media tools.

## Standards Context

Budabit should remain compatible with NIP-B7 and the Blossom BUD family.

| Source | Budabit behavior |
| --- | --- |
| NIP-B7 | Read and write user `kind:10063` Blossom server lists for personal media preferences. |
| BUD-01 | Retrieve blobs with `GET /<sha256>` and optional file extension. |
| BUD-02 | Upload exact bytes with `PUT /upload`. |
| BUD-03 | Support user server lists, but do not force all uploads to every user server. |
| BUD-04 | Prefer `PUT /mirror` for background mirroring when available. |
| BUD-05 | Use `PUT /media` for server-side media optimization when available. |
| BUD-06 | Use `HEAD /upload` and `HEAD /media` as optional preflights, never as hard requirements. |
| BUD-08 | Preserve useful returned NIP-94 metadata when servers provide it. |
| BUD-10 | Blossom URIs can be considered later, but normal HTTPS URLs remain supported. |
| BUD-11 | Authorization uses kind `24242`, `t`, `expiration`, server scoping, and scoped `x` tags where required. |

## Core Concepts

### Blob Identity

In Blossom, the identity of a blob is its SHA-256 hash, not the URL where it is hosted.

The same bytes can be hosted at many URLs:

```txt
https://community.example/<sha256>.webp
https://personal.example/<sha256>.webp
https://fallback.example/<sha256>.webp
```

These are equivalent Blossom copies only if the bytes and `sha256` are identical.

### Canonical URL

"Canonical URL" is a Budabit term, not a Blossom protocol term. It means the primary URL Budabit writes into the Nostr event `url` or `imeta` tags after an upload succeeds.

The canonical URL should usually come from the context that owns the content:

- Community posts should prefer the current community's Blossom servers when available.
- Personal/profile uploads should prefer the user's personal Blossom servers.
- Fallback servers are a last resort, not a branding or ownership signal.

The canonical URL may fail in the future. Readers should use the blob hash to recover from mirrors.

### Same-Hash Requirement

Mirrors must store the exact final bytes of the canonical blob.

Budabit must not independently optimize the same original file on multiple servers and treat the results as mirrors. Different `/media` implementations can produce different bytes and therefore different hashes.

Unsafe:

```txt
server A: PUT /media original.png -> hash A
server B: PUT /media original.png -> hash B
```

Safe:

```txt
server A: PUT /media original.png -> optimized hash A
server B: PUT /mirror https://server-a/hash-a.webp -> hash A
server C: PUT /upload exact optimized bytes -> hash A
```

## Server Sources

Budabit assembles Blossom servers from several sources.

| Source | Meaning | Default role |
| --- | --- | --- |
| Current community definition | Servers declared by the active community through `kind:10222` `blossom` tags. | Primary for current community content. |
| User personal list | The user's `kind:10063` Blossom server list. | Primary for personal content and optional mirrors. |
| Communities the user can publish to | Communities where the user has access to publish in at least one section, based on community profile-list membership. | Manual mirror candidates. |
| Last-resort servers | App-configured fallback servers. | Fallback only, not a preferred home for community media. |

Budabit should not default to Budabit-operated storage for all communities. Communities should be able to operate and prioritize their own storage.

## Community Membership For Upload And Mirror Targets

Member-community storage candidates should not be limited to communities where the user is an admin or moderator. Most users will not have those roles.

Budabit should derive "communities you are part of" app-wide:

- A user is part of a community when that community grants them publish access to at least one section.
- Access is based on the community definition's section profile lists and the user's membership in those lists.
- This derived list populates both initial-upload fallbacks and mirror target groups.

Starred communities alone should not imply storage intent. They can be useful discovery signals, but they should not be automatic mirror targets.

## Upload Priorities

Initial upload should produce one successful canonical blob quickly.

Community-facing content:

```txt
current community Blossom servers
user personal Blossom servers
communities the user can publish to
last-resort servers
```

Personal/profile content:

```txt
user personal Blossom servers
communities the user can publish to
last-resort servers
```

Generic upload tool:

```txt
selected context servers
user personal Blossom servers
communities the user can publish to
last-resort servers
```

Current-community canonical upload is preferred but not mandatory. If community servers are unavailable, Budabit may publish a personal URL, a URL from another community that has granted the user publish access, or a last-resort URL after showing clear initial-upload feedback.

## Optimization Model

Optimization is an initial-upload concern. It should not be shown in mirror target selection.

Budabit supports these optimization modes:

| Mode | Behavior |
| --- | --- |
| Auto | Use server-side `/media` when it is safe and available. Otherwise fall back to regular upload. |
| Server optimize | Prefer `/media`; ask or warn before falling back to original upload when optimization is unavailable. |
| Client compress | Compress images in the browser before regular upload. Videos are not locally transcoded. |
| Original | Upload the selected file bytes unchanged. |

Recommended default: `Auto`.

### Safe Optimizer Selection

Budabit should prefer optimizing on the intended canonical server.

If the intended canonical server does not support `/media`, Budabit may use another server as the optimizer only when the intended canonical server supports server-side `/mirror`. That allows the optimized output to be copied back to the canonical server without a browser download before publishing.

Example:

```txt
community server: supports /upload and /mirror, no /media
personal server: supports /media
```

Safe flow:

```txt
1. PUT /media original file to personal server.
2. Receive optimized URL/hash from personal server.
3. PUT /mirror optimized URL to community server.
4. Publish the community server URL/hash.
```

If the canonical server cannot `/mirror` the optimizer result, Budabit should prefer a direct `/upload` path to the canonical server instead of forcing a browser fetch-back in the initial publish path.

## Initial Upload Flow

For unencrypted image and video uploads in `Auto` mode:

```txt
1. Build prioritized upload candidates from the current context.
2. Probe capability enough to choose an initial upload path.
3. Prefer /media on the canonical candidate.
4. If needed, use a safe optimizer only when the canonical candidate can /mirror the optimized result.
5. Otherwise fall back to /upload with optional client-side image compression according to settings.
6. Return one canonical descriptor: url, sha256, size, type.
7. Publish using that canonical descriptor.
8. Offer optional background mirroring.
```

For non-media files:

```txt
1. Use /upload.
2. Do not use /media.
3. Offer optional background mirroring after success.
```

For encrypted uploads:

```txt
1. Encryption remains disabled for public/community-facing uploads.
2. Future private contexts may compress before encryption, then upload encrypted bytes with /upload.
3. /media cannot optimize encrypted bytes.
```

## Mirroring Model

Mirroring happens after initial upload and should not block publishing.

The user receives fast initial feedback, then mirroring runs as a background best-effort queue.

Preferred mirror order per target:

```txt
1. Try server-side /mirror from the canonical URL.
2. Verify the returned sha256 matches the canonical hash.
3. If settings allow browser-assisted mirroring, fetch canonical bytes and PUT /upload exact bytes.
4. Verify returned sha256 matches the canonical hash.
```

Budabit should not surface random background mirror errors as disruptive toasts. Background failures belong in the Blossom dashboard. Initial upload failures should still be shown immediately.

### Mirror Target UI

The post-upload mirror modal groups targets for human parsing:

```txt
Current community servers
Your personal servers
Communities you are part of
Last-resort servers
```

Mirror target rows show mirroring-specific details:

- Server-side mirror available or likely available.
- Upload-only mirror requires browser download.
- Unavailable or recently failed.
- Last known failure reason.

They should not show server-side optimization status. Optimization is relevant only to the first upload.

### Mirror Modes

Mirroring settings:

| Mode | Behavior |
| --- | --- |
| Ask after upload | Show a toast after successful initial uploads. |
| Server-side mirroring only | Only attempt targets that can mirror without browser download. |
| Allow browser-assisted mirroring | Ask before downloading canonical media and uploading exact bytes to upload-only targets. |
| Always mirror to selected defaults | Automatically enqueue mirrors for selected target groups. |
| Never ask | Do not prompt after upload. Manual dashboard actions remain available. |

Recommended defaults:

```txt
Mirroring: Ask after upload
Server-side mirroring: preferred
Browser-assisted mirroring: ask first
Auto-mirror to personal servers: off
Auto-mirror to current community servers: off initially
Auto-mirror everywhere: off
```

If `Server-side mirroring only` is enabled and all server-side mirror attempts fail, Budabit should stop silently and record failures in the dashboard. The user can resume or change policy later.

## Blossom Dashboard

Budabit should provide a Blossom menu item from the avatar menu. It should be a generic Blossom dashboard, not only a community upload settings page.

Recommended tabs:

```txt
Dashboard
Servers
Optimization
Mirroring
Advanced
```

Dashboard tab:

- Recent Budabit uploads.
- Discovered/listed server uploads when supported by `/list`.
- Canonical URL, hash, type, size, and context.
- Mirror status per target.
- Chosen policy at upload time.
- Retry or continue mirroring.
- Copy shareable URLs.
- Download file.
- Remove from dashboard.

Servers tab:

- Personal Blossom servers from `kind:10063`.
- Current community servers.
- Communities the user can publish to.
- Last-resort servers.
- Capability and status cache.

Optimization tab:

- `Auto`.
- `Server optimize`.
- `Client compress`.
- `Original`.
- Tooltips explaining quality, speed, bandwidth, and compatibility tradeoffs.

Mirroring tab:

- Prompt behavior.
- Server-side-only behavior.
- Browser-assisted mirror permission.
- Auto-mirror target groups.
- Queue/retry preferences.

Advanced tab:

- Clear capability cache.
- Clear upload history.
- Export diagnostics.
- Reset Blossom settings.

The existing `Content Settings -> Media Server` field is the user's personal Blossom server list. It should be reused as `Blossom -> Servers -> Personal servers`, not duplicated.

## State And Persistence

Budabit should store Blossom settings and dashboard state in encrypted `APP_DATA` where available so preferences sync across devices.

Store:

- Blossom settings.
- Mirror preferences.
- Capability cache metadata.
- Upload records.
- Mirror task statuses.
- Chosen policy per upload.

Do not store:

- Actual media bytes.
- Public decryption keys for encrypted media.
- Large blobs.

If encrypted `APP_DATA` is unavailable, Budabit may fall back to local-only storage and mark it as not synced.

## Feedback And Copy

Initial upload feedback should be clear because media optimization can take longer than normal upload.

Stage labels:

```txt
Preparing file
Checking Blossom servers
Uploading to optimizer
Optimizing media
Saving to community server
Ready to publish
```

Post-upload toast:

```txt
Uploaded to blossom.community.example.
Mirror this file to additional Blossom servers?
```

Mirror modal copy:

```txt
Server-side mirroring asks the target server to fetch the blob directly. It is usually faster and does not use your bandwidth.
```

Browser-assisted warning:

```txt
This target cannot mirror directly. Budabit will download the file once and upload the same bytes to this server. This uses your bandwidth and may take longer.
```

Optimization tooltip:

```txt
Server optimization may reduce file size and improve compatibility. Budabit mirrors the optimized result byte-for-byte so every Blossom copy has the same hash.
```

## Failure Policy

Initial upload failures block publishing and should be shown immediately.

Background mirror failures should not interrupt the user. Record them in the dashboard with enough detail for retry and diagnosis.

Actionable initial upload failures:

- File too large.
- Server unavailable.
- CORS blocked.
- Signing failed or cancelled.
- Server optimization failed.
- No usable Blossom server found.

For oversized images, Budabit may offer client-side compression. For oversized videos, Budabit should suggest a smaller file or a different server unless a future client-side video transcoder exists.

## Security And Privacy

Encryption should not be exposed for public or community-facing uploads yet.

If decryption tags are published in a public event, the blob is encrypted but the key is public. That harms interoperability without providing real privacy.

Rules:

- Public rooms: encryption unavailable.
- Community threads/comments: encryption unavailable.
- Badge uploads: encryption unavailable.
- Profile images: encryption unavailable.
- DM/private contexts: future-only.

When encrypted media is eventually supported, decryption metadata should live inside encrypted/private message content, not public `imeta` tags.

## Non-Goals For The First Complete Iteration

- Do not require every server to support `/media`, `/mirror`, or `/list`.
- Do not make Budabit-operated Blossom storage the default home for communities.
- Do not expose encryption for public/community media.
- Do not store media bytes in synced app data.
- Do not block publishing on background mirrors.
