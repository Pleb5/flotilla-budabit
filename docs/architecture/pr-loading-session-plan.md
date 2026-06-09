# Session Plan

## Objective

- Make PR pages load in a clear sequential flow: fetch PR source and target, populate commits/files, then allow explicit merge analysis and merge actions.
- Keep inline comment navigation dependent on PR review data, not merge analysis.
- Reduce misleading branch/ref errors by using fetched commit OIDs instead of hardcoded remote-tracking refs where possible.

## Constraints

- Current repository state is authoritative over this plan.
- Keep changes minimal and phase-based.
- Do not auto-run merge analysis on PR page load.
- Conflict is a valid analysis result, not an analysis error.
- Commit and push each verified phase.
- Avoid pushing or staging unrelated worktree changes.

## Phase 1: Decouple Review Loading And Stop Auto Analysis

### Goal

- Preserve the current PR review-data decoupling work and make it safer by removing auto merge analysis and avoiding hardcoded target remote refs in the new review loader.

### Exit Criteria

- PR source/target review data loads automatically into commits/files without requiring merge analysis.
- `Analyze` does not run automatically on page load.
- `Analyze` is disabled until PR review data is loaded successfully.
- PR review and merge-analysis target fetches use fetch result OIDs (`fetchHead` or `FETCH_HEAD`) before remote-tracking refs.
- UI branch-ref loading does not hard-block explicit merge analysis.
- Existing inline comment jumps still wait for PR review diffs/anchors.
- `pnpm check` passes.

### Steps

- Create the session plan and checkpoint under `docs/architecture/`.
- Update the new worker `getPRReviewData` target fetch path to resolve from `fetchHead`/`FETCH_HEAD` before any remote-tracking ref.
- Update merge-analysis target fetch to resolve from `fetchHead`/`FETCH_HEAD` before temporary remote-tracking refs.
- Remove UI branch-ref prevalidation as a hard blocker for merge analysis.
- Remove the `$effect` that auto-runs `runPRMergeAnalysis()`.
- Gate the `Analyze` button on successful PR review data.
- Keep merge UI gated on successful merge analysis.
- Update the checkpoint with evidence.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`
- `git diff --check`

### Commit And Push

- Final step after verification: commit and push this phase.

## Phase 2: Structured PR Fetch States And Retry Actions

### Goal

- Represent PR loading as progressive source, target, and review phases with specific retry actions.

### Exit Criteria

- PR review loader returns structured phase errors for `source`, `target`, and `review` failures.
- UI renders specific retry actions such as `Retry fetching source`, `Retry fetching target`, or `Retry loading files` instead of generic analysis retries.
- `Analyze` is hidden/disabled when source/target/review loading has failed.
- Inline comment navigation reports the same phase-specific failure detail.

### Steps

- Extend worker review-data result with phase-specific error metadata.
- Track PR loading phase state in `PRView.svelte`.
- Add specific retry handlers that re-run only the needed PR review fetch path.
- Update user-facing copy for retriable source/target/review errors.

### Verification

- `pnpm check`
- Targeted unit tests for review-data phase errors if practical.
- Manual reasoning against source-error, target-error, and review-error branches.

### Commit And Push

- Final step after verification: commit and push this phase.

## Phase 3: Explicit Analysis And Merge State Model

### Goal

- Make merge analysis and merge actions follow the loaded PR review state, with conflicts shown as terminal analysis results until the PR is refetched or updated.

### Exit Criteria

- Before analysis, maintainer UI offers `Analyze`, not `Merge`.
- During analysis, UI shows `Analyzing...`.
- Clean analysis enables `Merge`.
- Conflict analysis shows conflict status without presenting conflict as a retryable error.
- Runtime/fetch analysis errors map to appropriate retry/refetch actions.

### Steps

- Add derived analysis/merge UI states.
- Adjust merge section rendering and buttons.
- Ensure merge action refuses to run without review-ready and clean analysis.
- Remove misleading `Retry sync + analyze` copy for conflict results.

### Verification

- `pnpm check`
- Targeted UI state tests if available, otherwise inspect rendered branches and manual state reasoning.

### Commit And Push

- Final step after verification: commit and push this phase.

## Phase 4: Fetch Performance And Depth Strategy

### Goal

- Reduce PR load latency while preserving correctness.

### Exit Criteria

- Target branch head fetch uses shallow depth where safe.
- Source tip/merge-base fetch avoids all-ref deep fetch unless required.
- Expensive deepening is deferred to review diff or merge analysis when objects are missing.
- Repeated target/source fetches are deduped or avoided where practical.

### Steps

- Audit target/source fetch depths and fallback paths.
- Lower branch-head fetch depth where only commit OID is needed.
- Add object-presence checks and incremental deepen only on missing object errors.
- Avoid duplicate target sync before merge analysis when worker analysis already refreshes target.

### Verification

- `pnpm check`
- Core tests without coverage.
- Document expected fetch sequence in checkpoint.

### Commit And Push

- Final step after verification: commit and push this phase.
