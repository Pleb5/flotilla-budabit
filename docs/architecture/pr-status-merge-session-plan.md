# Session Plan

## Objective

- Make NIP-34 PR status semantics, merge gating, and PR review/analysis edge cases consistent and testable.
- Treat missing or unresolvable authorized status as `open` per NIP-34 expectations, with status semantics owned by `nostr-git-core` rather than duplicated in UI components.
- Fix observed PR analysis issues from the `test-merge` fixture set: missing merge action for owner/open PRs, up-to-date PR commit inflation, orphan-history diff-base failure, and likely false conflict reporting for clean non-fast-forward PRs.

## Constraints

- Current repository state is authoritative over this plan.
- Existing unrelated worktree change in `docs/architecture/git-natural-read-pivot.md` must not be staged or modified by this workflow.
- Keep status interpretation in `packages/nostr-git-core`; UI components should consume core effective status results.
- Preserve explicit merge analysis; do not restore auto-analysis on PR page load.
- Conflict remains a valid analysis result, not an analysis error.
- Orphan/unrelated-history PRs may show a target-head diff for review, but must not become mergeable unless unrelated-history merging is explicitly implemented.
- Commit and push each verified phase.

## Phase 1: Core Status Semantics And Merge Gate

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Move effective NIP-34 status interpretation into `nostr-git-core` and update PR merge gates to treat missing or unresolvable authorized status as `open`.

### Exit Criteria

- Core exposes a reusable status-state resolver that maps `1630 open`, `1631 applied/merged`, `1632 closed`, `1633 draft`, and defaults no authorized status to `open`.
- PR page merge gating uses the core effective status state, not `prStatus?.status` optional checks.
- Repo list/status consumers that already hand-roll status state are aligned to the core helper where practical.
- Owner/maintainer + clean analysis + no resolved status can show the merge action.
- Status resolver tests cover missing status and unauthorized/ignored status defaulting to `open`.
- `pnpm check`, targeted status tests, and `git diff --check` pass.

### Steps

- Add core status state types and resolver helper in `packages/nostr-git-core/src/events/nip34/status-resolver.ts`.
- Export the helper through existing core exports.
- Update `src/app/components/PRView.svelte` to derive PR effective status from the core helper and replace merge/status gates that use `prStatus?.status`.
- Update `src/routes/git/[id=naddr]/+layout.svelte`, `packages/nostr-git-ui/src/lib/components/git/Status.svelte`, and `packages/nostr-git-core/src/git/repo-core.ts` only where this avoids duplicate state mapping without broad churn.
- Add tests in existing status-resolver specs.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false test/status-resolver.spec.ts test/git/status-resolver.spec.ts`
- `git diff --check`

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
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 2: PR Review Edge Cases

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Fix PR review/analysis display for up-to-date and orphan-history PRs without making unsupported merges look safe.

### Exit Criteria

- Up-to-date analysis returns no PR commits or patch commits for UI commit counts.
- Up-to-date PR review remains able to show zero changed files and no commits before and after analysis.
- `getPRReviewData` handles no merge base by using target commit as review diff base when target commit is available.
- Orphan/unrelated-history review returns a clear warning/flag and usable diff data instead of `Unable to resolve a PR diff base`.
- Orphan/unrelated-history merge analysis remains non-mergeable unless explicit support is implemented.
- Tests cover up-to-date commit counts and no-merge-base review fallback.
- `pnpm check`, targeted core tests, and `git diff --check` pass.

### Steps

- Adjust `analyzePRMergeability` up-to-date result shape in `packages/nostr-git-core/src/git/merge-analysis.ts`.
- Extend `PRReviewData` with minimal warning/unrelated-history metadata if needed.
- Update `getPRReviewData` to use `targetCommitOid` as `baseOid` when no merge base is found.
- Surface review warnings in `PRView.svelte` without blocking normal review display.
- Add focused tests for up-to-date and no-merge-base review behavior.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false test/worker/pr-merge.spec.ts test/git/pr-preview.spec.ts`
- `git diff --check`

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
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 3: Clean Non-FF Analysis Regression

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Reproduce and fix the likely false conflict reported for a clean non-fast-forward PR, while keeping real conflict fixtures classified as conflicts.

### Exit Criteria

- A regression test reproduces a clean non-FF PR where target changed README and PR adds an unrelated file from an older base.
- The clean non-FF case returns `analysis: clean`, `canMerge: true`, and `hasConflicts: false`.
- A real same-file conflict test still returns `analysis: conflicts`.
- A rename/delete or modify/delete conflict remains classified as a conflict if covered by existing or new tests.
- Dry-run merge cleanup leaves no stale worktree/index state that can poison later analyses.
- `pnpm check`, targeted core tests, and `git diff --check` pass.

### Steps

- Add focused isomorphic-git tests around `analyzePRMergeUtil` or `analyzePRMergeability` using existing test harness utilities.
- Run conflict analysis before clean analysis in at least one test to catch stale-state pollution.
- Inspect and fix `performPRDryRunMerge` cleanup/reset behavior if the regression reproduces.
- Keep changes minimal and avoid broad merge implementation rewrites.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false test/worker/pr-merge.spec.ts`
- `git diff --check`

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
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.
