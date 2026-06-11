# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Keep Git natural as the primary read source while reducing unnecessary overview Git Smart HTTP work and making natural commit metadata reads resilient to pack parser BigBatch/decompression failures.

## Current Phase

- Complete

## Phase Exit Criteria

- Natural commit/file pack failures expose high-level operation through existing fallback context and upload-pack diagnostics with redacted remote/effective URL, filter, requested depth, and parser failure class.
- Diagnostics are compact and only appear on natural upload-pack failure paths or existing fallback logging paths.
- Final checkpoint says `Current Phase: Complete` with evidence from verification and commits.

## Completed With Evidence

- Created durable session plan and checkpoint under `docs/architecture/` following repository convention.
- Compared `budabit` Git natural reads against `~/Work/gitworkshop`:
  - `gitworkshop` batches commit history with `COMMIT_BATCH_SIZE = 15` and halves on BigBatch-style errors.
  - `gitworkshop` dedupes `blob:none` raw object fetches and reuses commit objects from README/tree discovery.
  - `budabit` currently requests the requested commit depth in a single natural `tree:0` read and overview can duplicate latest-commit work.
- Phase 1 implemented adaptive natural commit batching:
  - Added `COMMIT_HISTORY_BATCH_SIZE = 15` to `GitNaturalReadProvider`.
  - Refactored `listCommits` to walk first-parent history through bounded `tree:0` batches instead of one arbitrary-depth request.
  - Added BigBatch-style detection through wrapped causes/messages and retry by halving batch size.
  - Cached successful sub-batches and the original requested history depth.
  - Added provider-level unit tests for bounded batching and wrapped BigBatch retry.
- Phase 2 implemented overview latest-commit de-duplication:
  - Overview latest-commit loading reuses the first already loaded commit when `CommitManager` is on the overview main branch.
  - Replaced progressive latest-commit probes at depths 5, 10, and 25 with a single depth-1 `getCommitHistory` call.
  - Treats `RepoNotReady`, still-initializing, worker-not-ready, not-cloned, and repository-not-available errors as optional latest-commit skips.
  - README loading remains on the existing `repoClass.getFileContent` Git-natural-first path and no overview clone/fetch trigger was added.
- Phase 3 implemented compact natural upload-pack diagnostics:
  - `GitNaturalReadError` now exposes `filter`, `depth`, and `parserFailureClass` metadata.
  - `GitNaturalApiAdapter` annotates upload-pack and missing-ref failures with redacted remote/effective URLs, filter, depth, and parser class.
  - Parser classification covers BigBatch/decompression, pkt-line, zlib, checksum, and generic pack-parser failures.
  - Core tests assert `blob:none` and `tree:0` failures expose the diagnostic metadata and redact URL credentials.

## Decisions

- Git natural remains primary; provider REST remains fallback only.
- Start with core adaptive commit batching because it directly addresses `we tried to decompress too much data at the same time` without changing read-source policy.
- Do not touch or stage the pre-existing local modification in `docs/architecture/git-natural-read-pivot.md`.
- Phase 1 uses the same mitigation pattern observed in `gitworkshop`: batch at 15 and shrink on BigBatch before URL fallback.
- Phase 2 keeps Git natural primary and only reduces overview commit metadata demand.
- Phase 3 keeps diagnostics on failure paths and does not change Git natural/provider fallback order.

## Current State

- Branch: `dev` tracking `origin/dev`.
- Existing local uncommitted change: `docs/architecture/git-natural-read-pivot.md`.
- Phase 1 is committed and pushed as `a5c7aef0 feat: batch git natural commit reads`.
- Phase 2 is committed and pushed as `7358a4ff fix: dedupe overview latest commit reads`.
- Phase 3 implementation and verification are complete; checkpoint marks the session complete.

## Next Action

- Final response.

## Verification

- Phase 1: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts packages/nostr-git-core/test/git/natural-read.spec.ts` passed: 1 file, 12 tests.
- Phase 1: `pnpm --dir packages/nostr-git-core typecheck` passed.
- Phase 2: `pnpm test:nostr-git-ui -- VendorReadRouter` passed: 29 files, 183 tests.
- Phase 2: `pnpm check` passed: 0 errors, 0 warnings.
- Phase 3: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts packages/nostr-git-core/test/git/natural-read.spec.ts` passed: 1 file, 12 tests.
- Phase 3: `pnpm check` passed: 0 errors, 0 warnings.

## Risks Or Blockers

- Existing local modification in `docs/architecture/git-natural-read-pivot.md` remains unrelated and must not be staged.
- Git natural remains primary; REST remains fallback only.

## Files

- `docs/architecture/git-natural-overview-efficiency-session-plan.md`
- `docs/architecture/git-natural-overview-efficiency-session-checkpoint.md`
- `packages/nostr-git-core/src/git/natural-read-provider.ts`
- `packages/nostr-git-core/src/git/natural-read-api-adapter.ts`
- `packages/nostr-git-core/src/git/natural-read-transport.ts`
- `packages/nostr-git-core/test/git/natural-read.spec.ts`
- `src/routes/git/[id=naddr]/+page.svelte`
