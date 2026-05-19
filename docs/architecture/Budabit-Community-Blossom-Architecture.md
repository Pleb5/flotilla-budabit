# Budabit Community Blossom Architecture

This document defines Budabit's community-enhanced Blossom behavior for media and badge assets. It extends the Communikey community model without changing community identity, relay selection, or write-permission rules.

## Goals

Budabit should preserve the user's normal Blossom upload preference while also making community-scoped media durable on community infrastructure.

Community definitions already expose Blossom infrastructure through `kind:10222` tags:

```json
["blossom", "https://blossom.community.example"]
```

Those servers should be used whenever Budabit publishes media in a community context.

## Standards Context

Budabit should remain compatible with NIP-B7 and the Blossom BUDs.

| Source | Requirement for Budabit |
|---|---|
| NIP-B7 | Use user `kind:10063` server lists for user media fallback. |
| BUD-01 | Retrieve blobs with `GET /<sha256>` and optional file extension. |
| BUD-02 | Upload exact bytes with `PUT /upload`; include `Content-Type`, `Content-Length`, and preferably `X-SHA-256`. |
| BUD-03 | Upload to at least the first user server; optionally upload or mirror to additional servers. |
| BUD-04 | `PUT /mirror` may be used when available, but is optional and must not be required. |
| BUD-06 | `HEAD /upload` is an optional preflight and must not be required for upload support. |
| BUD-08 | Preserve useful returned NIP-94 metadata when servers provide it. |
| BUD-10 | Blossom URIs can provide portable hints, but Budabit may continue publishing normal URLs. |
| BUD-11 | Authorization uses kind `24242`, `t`, `expiration`, and scoped `x` tags. |

## Server Roles

| Server source | Purpose |
|---|---|
| User `kind:10063` list | User-owned primary media preference. |
| `VITE_DEFAULT_BLOSSOM_SERVERS` | Application fallback when no user server exists. |
| Community `kind:10222` `blossom` tags | Community durability mirror and optional primary upload target for community-owned assets. |
| Original media URL origin | First read attempt for already-published media. |

## Upload Model

Budabit should distinguish primary upload from community replication.

| Upload role | Behavior |
|---|---|
| Primary upload | Produces the URL inserted into the event. Must succeed before publishing. |
| Community replication | Uploads the same final bytes to community Blossom servers. Should not block publication if the primary upload succeeded. |

Primary upload selection remains compatible with existing behavior:

1. Use an explicit valid Blossom URL when provided.
2. Otherwise use the first user `kind:10063` server.
3. Otherwise use the first `VITE_DEFAULT_BLOSSOM_SERVERS` entry.

Community replication selection:

1. Use all active community `kind:10222` Blossom servers.
2. Deduplicate against the primary upload server.
3. Upload the exact final bytes after compression and optional encryption.
4. Report mirror failures as warnings rather than failed publishes.

For community-owned assets, such as badge images, the first community Blossom server may be used as the primary upload target. The same asset should still replicate to the remaining community Blossom servers.

## Community Contexts

Community replication applies when publishing an event that is authored or composed inside an active community context.

| Context | Media behavior |
|---|---|
| Room messages | Primary upload from user preference unless a community server is explicitly selected; replicate to community servers. |
| Room message replies | Same as room messages. |
| Forum replies and comments | Replicate attachments to community servers. |
| Calendar comments | Replicate attachments to community servers. |
| Targeted calendar and goal forms with attachments | Replicate attachments to community servers when attachment uploads are enabled. |
| Community badge images | Prefer community Blossom as primary and replicate to all configured community servers. |
| Community profile picture | Prefer community Blossom when creating/editing a community profile. |
| Non-community profile pictures and DMs | Keep user/default Blossom behavior only. |

## Event Metadata

Budabit's editor already emits `imeta` tags with `url`, `x`, `ox`, `m`, and `size` for uploaded files. Community replication should not change the primary `url` unless the caller chooses a community server as primary.

When a server returns NIP-94 metadata through BUD-08, Budabit may merge useful tags into the upload result, but should keep a stable `x` hash derived from the uploaded bytes.

## Read Fallback Model

Reads should remain URL-first and become more resilient when the URL fails.

Fallback order for media rendered in a community context:

1. Original URL.
2. Community Blossom servers from the active definition using the event `imeta` `x` hash or a hash extracted from the URL.
3. Author `kind:10063` Blossom servers, matching NIP-B7.
4. Existing default/public fallback servers if configured.

Every fallback download should verify that the downloaded bytes hash to the expected SHA-256 before displaying decrypted or plaintext media.

## Authorization Compatibility

Budabit currently relies on Welshman Blossom helpers. Welshman `0.8.13` does not materially change the Blossom API from `0.7.1`, so Budabit should own any stricter spec compatibility needed here.

Upload auth should include `x` tags for target hashes. Budabit should prefer BUD-11-compatible authorization headers when adding new Blossom upload paths, including base64url encoding and server-domain scoping where practical.

## Failure Policy

Primary upload failure blocks publishing and shows an error.

Community replication failure does not block publishing. Budabit should surface a concise warning when useful, and should log per-server failure details for troubleshooting.

## Security And Privacy

Encrypted uploads must replicate only encrypted bytes. Decryption metadata remains in event tags as today.

DM and private contexts must not replicate to community servers unless explicitly requested by a future feature.

Community badge images and community profile images are public assets and are safe to prefer community infrastructure.

## Non-Goals

Budabit will not require `PUT /mirror`, `/list`, or Blossom URI publishing for the first implementation.

Budabit will not make community Blossom replication a hard requirement for community publishing.

Budabit will not update Welshman as part of this feature.
