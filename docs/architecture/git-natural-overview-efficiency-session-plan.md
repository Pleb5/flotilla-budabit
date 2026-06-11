# Session Plan

## Objective

- Preserve Git natural as the primary read source while reducing unnecessary overview-page Git Smart HTTP work and making natural commit metadata reads resilient to `we tried to decompress too much data at the same time` pack-parser failures.
- Use findings from `~/Work/gitworkshop`: batch commit history reads, retry smaller batches on BigBatch-style parser failures, dedupe/reuse natural objects, and avoid overview flows that request more commit metadata than the UI needs.

## Constraints

- Git natural read remains the primary source. Provider REST APIs stay fallback only.
- Current repository state is authoritative. Do not touch or stage unrelated user changes, especially the existing local modification in `docs/architecture/git-natural-read-pivot.md`.
- Use minimal correct changes and keep behavior compatible with existing natural read caches.
- Keep durable session state in `docs/architecture/git-natural-overview-efficiency-session-checkpoint.md` and this plan.
- Each completed phase must update the checkpoint, verify, commit, push, reread the checkpoint, and continue if not complete.

## Phase 1: Adaptive Natural Commit Batching

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Make `GitNaturalReadProvider.listCommits` request commit metadata in bounded `tree:0` batches and retry smaller batches when the pack parser reports BigBatch/decompression-boundary failure.

### Exit Criteria

- `listCommits` no longer issues a single `tree:0` upload-pack request for arbitrary requested depth above the configured batch size.
- BigBatch-style errors are detected through wrapped causes/messages and retried with smaller batch sizes before URL fallback.
- Successful batch results are still cached in the natural history cache for the original request and useful subranges.
- Unit tests cover batching and BigBatch retry behavior without requiring network access.

### Steps

- Add a small internal batch size constant and BigBatch detection helper in `packages/nostr-git-core/src/git/natural-read-provider.ts`.
- Refactor `listCommits` to fetch commit history by walking first-parent batches from the tip.
- Cache successful sub-batches and the final requested depth.
- Extend `packages/nostr-git-core/test/git/natural-read.spec.ts` with provider-level tests using a fake adapter/cache.

### Verification

- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts packages/nostr-git-core/test/git/natural-read.spec.ts`
- If that command is unsupported by Vitest config, run `pnpm test:nostr-git-core -- packages/nostr-git-core/test/git/natural-read.spec.ts` or the nearest focused core test command and record the actual result.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 2: Overview Natural Read De-Duplication

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Stop the repo overview from triggering duplicate or oversized natural commit reads while keeping Git natural primary for README/latest commit.

### Exit Criteria

- Overview latest-commit loading does not request a 30-commit page when only one commit is needed.
- Overview latest-commit loading reuses already loaded/cached natural commit metadata when available.
- Optional latest-commit failures caused by repo initialization state remain quiet/benign and do not surface as fatal errors.
- README loading remains Git-natural-first and does not trigger clone/fetch solely for overview.

### Steps

- Inspect `src/routes/git/[id=naddr]/+page.svelte`, `Repo.svelte.ts`, `CommitManager.ts`, and `VendorReadRouter.ts` for the smallest safe overview-only adjustment.
- Prefer reusing existing commit manager state or requesting depth `1` over adding broad new APIs.
- Treat `RepoNotReady`/initialization errors as optional latest-commit skips on overview.
- Add or update focused tests where practical; otherwise verify with typecheck/test commands covering touched code.

### Verification

- `pnpm test:nostr-git-ui -- VendorReadRouter`
- `pnpm check`
- If full `pnpm check` is too slow or fails due unrelated baseline issues, record the focused command and evidence.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 3: Natural Read Diagnostics And Final Verification

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add enough lightweight diagnostics to understand future natural pack-size/parser failures without demoting Git natural, then run final verification.

### Exit Criteria

- Natural commit/file pack failures log or expose operation, filter, requested depth, remote/effective URL, and parser failure class without dumping secrets or full payloads.
- Diagnostics are compact and only appear on fallback/failure paths or existing debug logging paths.
- Final checkpoint says `Current Phase: Complete` with evidence from verification and commits.

### Steps

- Add compact logging/metadata around natural upload-pack failures if existing error formatting loses request details.
- Re-run focused tests from earlier phases and any feasible typecheck.
- Update final checkpoint to `Current Phase: Complete`.

### Verification

- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts packages/nostr-git-core/test/git/natural-read.spec.ts`
- `pnpm check`

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to `Complete`.
  - Set `Phase Exit Criteria` to the final completed state.
  - Set `Next Action` to final response.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify `Current Phase: Complete`.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
