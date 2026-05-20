# Budabit Blossom Implementation Plan

This plan implements `docs/architecture/Budabit-Community-Blossom-Architecture.md` in phases. Each phase should leave the app working. After each phase:

1. Run the relevant checks.
2. Commit the phase.
3. Push the branch.
4. Re-read the architecture document and this plan before starting the next phase.

The final phase is a thorough review pass that looks for bugs, simplifies code, and reruns the full verification set.

## Phase 0: Documentation Refresh

Status: completed.

Scope:

- Replace the earlier community-only Blossom docs with the revised Blossom architecture.
- Document server roles, canonical URLs, same-hash mirroring, optimization, post-upload mirroring, dashboard state, and privacy constraints.
- Create this phased implementation plan.

Verification:

- Read both docs for internal consistency.
- Confirm they describe the agreed product decisions:
  - Same hash is mandatory for mirrors.
  - Initial upload should complete quickly.
  - Mirroring is background best-effort.
  - Random background failures are dashboard-only.
  - Encryption is not exposed for public/community uploads.

Exit criteria:

- Documentation is committed and pushed.

## Phase 1: Upload Domain Model And Settings Skeleton

Status: completed.

Scope:

- Introduce Budabit-owned Blossom domain types for upload contexts, server sources, capabilities, optimization modes, mirror modes, upload records, and mirror jobs.
- Add typed settings defaults for Blossom behavior:
  - Optimization mode: `auto`.
  - Mirror prompt mode: ask after upload.
  - Server-side mirroring preferred.
  - Browser-assisted mirroring requires user consent.
  - Encryption unavailable for public/community uploads.
- Add local persistence for the new settings and upload dashboard records, using the existing app storage layer first.
- Leave encrypted `APP_DATA` sync as a clearly isolated follow-up if the current APP_DATA helpers are not ready for immediate reuse.
- Preserve the existing `Content Settings -> Media Server` behavior until the new Blossom UI is ready.

Verification:

- Add unit tests for default settings normalization and persistence helpers.
- Run focused tests for the new Blossom module.
- Run `npm run check` if type-level changes touch shared app types.

Exit criteria:

- Code can read/write Blossom settings locally.
- No upload behavior changes yet.

## Phase 2: Server Source Aggregation

Status: pending.

Scope:

- Build helpers that assemble grouped Blossom server candidates:
  - Current community servers.
  - Personal `kind:10063` servers from `userBlossomServerList`.
  - Communities the user can publish to.
  - Last-resort configured servers.
- Reuse the existing personal server list from `Content Settings -> Media Server` / `userBlossomServerList`.
- Add app-wide derivation for "communities you are part of": communities where the user has publish access to at least one section based on community profile-list membership.
- Keep starred communities out of automatic mirror groups.
- Deduplicate servers while preserving source metadata for UI grouping.

Verification:

- Add unit tests for target aggregation, deduplication, and grouping.
- Add focused tests for publish-access-derived community membership if existing community test fixtures support it.
- Re-read current community access logic before committing.

Exit criteria:

- Upload code can request grouped candidates for a context without knowing UI state internals.

## Phase 3: Capability Probing

Status: pending.

Scope:

- Add a capability probe/cache layer for Blossom servers.
- Probe enough to answer:
  - Can this server accept `/upload` for this file?
  - Can this server accept `/media` for this file?
  - Is this server likely to support `/mirror`?
- Treat `HEAD /upload` and `HEAD /media` as optional preflights.
- Avoid noisy user-facing errors for background probes.
- Persist last-known capability results for dashboard display and future decisions.

Verification:

- Add tests for probe result classification:
  - supported.
  - unavailable.
  - disabled.
  - too large.
  - auth/signing failed.
  - CORS/network failure.
- Ensure probe failures do not throw into normal rendering paths.

Exit criteria:

- Upload planner can make decisions using capability results and safe fallbacks.

## Phase 4: Initial Upload Planner

Status: pending.

Scope:

- Replace ad-hoc `uploadFile` server choice with a planner that separates:
  - Nostr publish context.
  - Blossom upload targets.
  - Mirror target candidates.
- Implement optimization-mode behavior:
  - `auto`.
  - `server optimize`.
  - `client compress`.
  - `original`.
- Implement safe optimizer selection:
  - Prefer `/media` on the canonical server.
  - Use a non-canonical optimizer only when the canonical server can `/mirror` the optimized result.
  - Otherwise fall back to direct `/upload` to the canonical server.
- Do not fetch back optimized bytes in the initial publish path unless absolutely necessary and explicitly allowed by settings.
- Keep `/upload` fallback for servers without `/media`.
- Keep public/community encryption unavailable.

Verification:

- Add focused tests for upload plans:
  - community server supports `/media`.
  - community server lacks `/media` but can `/mirror` from personal optimizer.
  - no safe optimizer available, fallback to `/upload`.
  - non-media file uses `/upload`.
  - public/community encrypted upload is rejected or disabled.
- Run focused command/upload tests.
- Run `npm run check`.

Exit criteria:

- Existing upload call sites still work.
- Initial upload returns one canonical descriptor.
- Same-hash mirror constraints are represented in the plan.

## Phase 5: Upload Status Feedback

Status: pending.

Scope:

- Replace boolean-only upload feedback where practical with structured upload stages.
- Show concise initial-upload status in editor and asset upload flows:
  - Preparing file.
  - Checking Blossom servers.
  - Uploading.
  - Optimizing media.
  - Saving to community server.
  - Ready to publish.
- Surface initial upload failures clearly.
- Do not surface background mirror failures as intrusive toasts.
- Add explanatory copy and tooltips for optimization behavior.

Verification:

- Run Svelte/type checks for components touched.
- Manually inspect key flows in code:
  - Room compose.
  - Thread reply.
  - Calendar comment.
  - Badge image upload.
  - Profile image upload if touched.

Exit criteria:

- Users can tell what is happening during slow initial media uploads.

## Phase 6: Background Mirroring Queue

Status: pending.

Scope:

- Add a background mirror queue that runs after a successful initial upload.
- Store mirror jobs with canonical URL, hash, size, type, context, target group, selected policy, and status.
- Prefer server-side `/mirror`.
- Verify returned `sha256` equals the canonical hash.
- If settings and user consent allow, perform browser-assisted mirroring by fetching canonical bytes and uploading exact bytes with `/upload`.
- Limit concurrency to avoid stressing the browser or servers.
- Stop silently when server-side-only mirroring cannot continue; record details in dashboard state.

Verification:

- Add unit tests for queue state transitions and target selection.
- Add mocked tests for server-side mirror success, hash mismatch, server failure, and browser-assisted fallback.
- Ensure background failures do not reject initial upload promises.

Exit criteria:

- Mirroring can run independently of publishing.
- Failed background jobs are visible in state but not intrusive.

## Phase 7: Post-Upload Mirror Prompt And Modal

Status: pending.

Scope:

- Show a 20-second post-upload toast when settings say to ask.
- Toast action opens a mirror modal.
- Modal groups targets:
  - Current community servers.
  - Your personal servers.
  - Communities you are part of.
  - Last-resort servers.
- Modal shows mirroring-specific capability only:
  - Server-side mirror available or likely available.
  - Upload-only mirror requires browser download.
  - Unavailable or recently failed.
- Add quick selection for "Mirror without download".
- Warn before browser-assisted mirroring.

Verification:

- Run Svelte/type checks for new UI components.
- Add focused tests for grouping and selection helpers where possible.

Exit criteria:

- Users can choose optional mirroring after initial upload without blocking publish.

## Phase 8: Blossom Dashboard And Menu Entry

Status: pending.

Scope:

- Add `Blossom` to the avatar menu.
- Create a tabbed Blossom page:
  - Dashboard.
  - Servers.
  - Optimization.
  - Mirroring.
  - Advanced.
- Dashboard shows recent uploads, canonical URL, hash, size, type, context, policy, and mirror status.
- Add actions:
  - Continue/retry mirroring.
  - Copy URLs.
  - Download file.
  - Remove local dashboard record.
- Servers tab reuses the existing personal Blossom server list currently shown as `Media Server` in Content settings.
- Add explanatory copy and tooltips for every non-obvious setting.

Verification:

- Run route/component checks.
- Manually inspect that the old personal server list is not duplicated or lost.

Exit criteria:

- Blossom management has a first-class home in the app.

## Phase 9: Generic Blossom Upload Surface

Status: pending.

Scope:

- Add a simple generic upload flow inside the Blossom dashboard.
- Let users upload media or files for sharing without composing a post.
- Use the same upload planner, optimization settings, and mirror prompt.
- Show shareable canonical URL and optional mirror URLs.
- Store the upload in the dashboard record list.

Verification:

- Run focused upload planner tests and Svelte checks.
- Manually inspect that generic uploads do not accidentally publish Nostr content.

Exit criteria:

- Budabit can serve as a basic Blossom media manager.

## Phase 10: Optional Server Listing Integration

Status: pending.

Scope:

- Where servers support `/list`, add a dashboard action to inspect existing Blossom uploads.
- Keep this separate from local Budabit upload records.
- Clearly mark listed server data as server-provided and potentially incomplete.

Verification:

- Add tests for list result normalization if implemented.
- Verify list failures stay non-intrusive.

Exit criteria:

- The dashboard can become generic without depending only on local history.

## Phase 11: Final Review And Full Verification

Status: pending.

Scope:

- Perform a thorough code review of the entire feature.
- Look for bugs, race conditions, duplicated logic, confusing copy, and over-engineering.
- Simplify code where possible.
- Re-read the architecture and plan one last time and verify the implemented behavior matches the decisions.
- Run all relevant tests again.

Verification:

- Run focused Blossom/upload tests.
- Run `npm run check`.
- Run `npm run test:main` or the closest focused main test suite.
- Run `npm run build` if checks pass.
- Document any residual risks in the final commit message or PR notes.

Exit criteria:

- The implementation is verified end-to-end or any remaining gaps are explicitly documented.
