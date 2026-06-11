# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Keep Git natural as the primary read source while reducing unnecessary overview Git Smart HTTP work and making natural commit metadata reads resilient to pack parser BigBatch/decompression failures.

## Current Phase

- Phase 3: Natural Read Diagnostics And Final Verification

## Phase Exit Criteria

- Natural commit/file pack failures log or expose operation, filter, requested depth, remote/effective URL, and parser failure class without dumping secrets or full payloads.
- Diagnostics are compact and only appear on fallback/failure paths or existing debug logging paths.
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

## Decisions

- Git natural remains primary; provider REST remains fallback only.
- Start with core adaptive commit batching because it directly addresses `we tried to decompress too much data at the same time` without changing read-source policy.
- Do not touch or stage the pre-existing local modification in `docs/architecture/git-natural-read-pivot.md`.
- Phase 1 uses the same mitigation pattern observed in `gitworkshop`: batch at 15 and shrink on BigBatch before URL fallback.
- Phase 2 keeps Git natural primary and only reduces overview commit metadata demand.

## Current State

- Branch: `dev` tracking `origin/dev`.
- Existing local uncommitted change: `docs/architecture/git-natural-read-pivot.md`.
- Phase 1 is committed and pushed as `a5c7aef0 feat: batch git natural commit reads`.
- Phase 2 implementation and verification are complete; checkpoint advances to Phase 3.

## Next Action

- Start Phase 3 by inspecting natural read fallback diagnostics in `VendorReadRouter`, `WorkerManager`, and `GitNaturalReadProvider`.

## Verification

- Phase 1: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts packages/nostr-git-core/test/git/natural-read.spec.ts` passed: 1 file, 12 tests.
- Phase 1: `pnpm --dir packages/nostr-git-core typecheck` passed.
- Phase 2: `pnpm test:nostr-git-ui -- VendorReadRouter` passed: 29 files, 183 tests.
- Phase 2: `pnpm check` passed: 0 errors, 0 warnings.

## Risks Or Blockers

- Existing local modification in `docs/architecture/git-natural-read-pivot.md` remains unrelated and must not be staged.
- Phase 3 must avoid demoting Git natural; REST remains fallback only.

## Files

- `docs/architecture/git-natural-overview-efficiency-session-plan.md`
- `docs/architecture/git-natural-overview-efficiency-session-checkpoint.md`
- `packages/nostr-git-core/src/git/natural-read-provider.ts`
- `packages/nostr-git-core/test/git/natural-read.spec.ts`
- `src/routes/git/[id=naddr]/+page.svelte`
