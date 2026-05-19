# Budabit Community Blossom Implementation Plan

This plan implements the architecture in `docs/architecture/Budabit-Community-Blossom-Architecture.md` in small phases. Each phase should leave the app working, be committed, pushed, and followed by re-reading the remaining unchecked items.

## Phase 0: Documentation

Status: completed.

Scope:

- Add the community Blossom architecture document.
- Add this implementation plan.

Verification:

- Read both docs for consistency with `Budabit-Community-Architecture.md` and `Communikeys.md`.

Exit criteria:

- Docs are committed and pushed.

## Phase 1: Upload Helper Foundation

Status: completed.

Scope:

- Extend `UploadFileOptions` with community mirror inputs, without changing existing callers.
- Add normalized Blossom server collection helpers for primary and mirror targets.
- Upload exact final bytes to the selected primary server and best-effort mirror servers.
- Include `X-SHA-256`, `Content-Type`, and `Content-Length` upload metadata where available.
- Avoid requiring successful `HEAD /upload`; treat it as optional preflight only.
- Return the existing upload result shape while adding optional mirror summary data.

Verification:

- Add focused unit tests for primary selection, deduplication, successful mirror upload, non-blocking mirror failure, and no-regression default behavior.
- Run the focused command tests.

Exit criteria:

- Existing `uploadFile(file)` callers keep working.
- Mirror failures do not make `uploadFile` fail when the primary upload succeeds.

## Phase 2: Active Community Blossom State

Status: completed.

Scope:

- Add an `activeCommunityBlossomServers` derived store from the active community definition.
- Add a synchronous helper for one-off callers that need the current community Blossom server list.
- Keep route/session behavior unchanged.

Verification:

- Add focused tests for derived community Blossom server behavior if the existing state test setup supports it.
- Run community-state focused tests.

Exit criteria:

- Community Blossom server lists are available to components without re-parsing definitions.

## Phase 3: Community Composer Replication

Status: pending.

Scope:

- Thread community mirror servers into `makeEditor` and editor upload calls.
- Update community `RoomCompose` uses for rooms, thread replies, and calendar comments.
- Keep direct DM and non-community editor behavior unchanged.
- Surface mirror warnings without blocking message publication.

Verification:

- Run focused component/type checks for editor and community routes.
- Manually inspect event `imeta` behavior in code to ensure `x`, `m`, and `size` are preserved.

Exit criteria:

- Community attachment uploads replicate to all configured community Blossom servers when possible.

## Phase 4: Badge And Community-Owned Asset Uploads

Status: pending.

Scope:

- Update community badge image uploads to prefer the first community Blossom server as primary.
- Mirror badge image uploads to all remaining community Blossom servers.
- Preserve badge image dimensions and existing NIP-58 metadata behavior.
- Apply the same community-owned upload policy to community profile images in the community create/edit flow if an upload path exists there.

Verification:

- Run badge tests and focused Svelte checks for the badges route.

Exit criteria:

- Badge image uploads use community infrastructure first and replicate best-effort.

## Phase 5: Read Fallbacks

Status: pending.

Scope:

- Extract the last 64-character lowercase hex hash from failed media URLs when `imeta` `x` is unavailable.
- Try active community Blossom servers after original URL failure.
- Try author `kind:10063` Blossom servers in accordance with NIP-B7.
- Verify downloaded fallback bytes match the expected SHA-256 before display.
- Keep encrypted media decryption behavior intact after fallback download.

Verification:

- Add focused tests for hash extraction and fallback URL generation.
- Manually inspect `ContentLinkBlockImage.svelte` flow for encrypted and non-encrypted cases.

Exit criteria:

- Community media can recover from dead primary URLs when a community or author Blossom server has the blob.

## Phase 6: Spec Compatibility Hardening

Status: pending.

Scope:

- Add Budabit-owned BUD-11 auth header generation if Welshman remains non-compliant with base64url/server-domain scoping.
- Add optional `PUT /mirror` support as a later optimization only after direct upload replication works.
- Consider adding Blossom URI generation or rendering support only if a product use case appears.

Verification:

- Focused tests for auth event/header formatting.
- Manual comparison against local `~/Work/blossom/buds/11.md`.

Exit criteria:

- New Budabit Blossom helpers are compatible with current BUD-11 expectations without requiring a Welshman upgrade.

## Phase 7: Full Verification

Status: pending.

Scope:

- Run focused unit tests added in this plan.
- Run `npm run check`.
- Run the relevant app test suite if time allows.
- Run `npm run build` if the check and focused tests pass.

Exit criteria:

- The feature is verified end-to-end or documented with clear residual risks.
