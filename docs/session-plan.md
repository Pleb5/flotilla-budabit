# Session Plan

## Objective

- Adjust Budabit notification semantics so important roots notify their creators for meaningful descendant activity while keeping noisy ongoing discussions out of notification history.
- Important community roots: thread roots, calendar date/time events, and goals.
- Important Git roots: user-authored issues and pull requests, plus important activity under them including comments, pull request updates, and status changes.
- Room roots are the explicit exception: rooms are unbounded ongoing discussions, so room notifications remain direct-parent only for user-authored kind `9` messages and direct mentions.
- Reactions and zaps stay direct-target only: notify only when the reaction/zap targets an event the signed-in user authored directly.
- Add user-facing notification rows for permission and moderation outcomes that affect the signed-in user where current app data can support them.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Branch `dev` tracks `origin/dev`; inspect status, diff, and recent commits before each phase commit.
- Current branch started this workflow one commit ahead of `origin/dev` at `3efb5428 fix: bootstrap older dm conversations` with existing dirty notification files.
- Stage only files intentionally changed for each phase. Do not stage unrelated user changes.
- If unrelated existing changes overlap a phase file, inspect and work with current code; stop only if the overlap conflicts with this objective.
- Commit and push each verified phase before starting the next phase.
- Do not reintroduce `Other` as a user-facing notification source or filter.
- Keep Budabit context buckets as DMs, Git, and Communities; keep reply/mention/reaction/zap/status as action types, not source filters.
- Do not reintroduce generic noisy community activity as notification-center history.
- Keep the checkpoint compact; put durable design details here.

## Phase 1: Plan Bootstrap

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Replace the completed previous workflow checkpoint/plan with this new notification-root workflow and record current repository facts.

### Exit Criteria

- `docs/session-plan.md` describes all phases with `Phase Startup`, `Mandatory Closeout`, and `Continue` sections.
- `docs/session-checkpoint.md` records the new objective, current phase, current dirty state, branch/upstream facts, and next action.
- No code files are intentionally changed in this phase.
- Checkpoint is advanced to Phase 2 before commit.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Create the durable plan and checkpoint for this workflow.
- Inspect `git status --short --branch`, `git log --oneline -10 --decorate`, and remotes.
- Commit only the plan/checkpoint changes for Phase 1.

### Verification

- Read both durable files after editing.
- Inspect `git status --short --branch`, `git diff -- docs/session-plan.md docs/session-checkpoint.md`, and `git log --oneline -10 --decorate` before committing.

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

## Phase 2: Community Important Roots And Chain Depth

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Implement community notification semantics for direct room replies versus important-root thread/calendar/goal comments.

### Exit Criteria

- Room message replies notify only when the immediate `q` parent is the signed-in user's kind `9` message; replies to replies do not notify the original room message author.
- Thread creators receive notifications for comments under their thread root at any depth.
- Calendar date/time creators receive notifications for comments under their calendar root at any depth.
- Goal creators receive notifications for comments under their goal root at any depth.
- Direct parent authors of kind `1111` comments still receive one-level reply notifications.
- Root-owner and direct-parent qualification dedupe to one row per event.
- Reactions/zaps remain direct-target only and do not become root-owner descendant notifications.
- Tests cover room second-order suppression, thread nested root-owner notification, calendar nested root-owner notification, goal nested root-owner notification, and direct comment parent notification.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Import/use existing community parsers for threads and calendar replies; add minimal goal reply parsing if no helper exists.
- Add descriptor-aware important-root ownership checks for community roots.
- Adjust community/engagement row building so root-owner comments and direct-parent replies are classified as Communities.
- Ensure target event loading/filter derivation loads both immediate parents and important roots needed for decisions.
- Add focused unit tests in notification source tests.

### Verification

- Run `pnpm vitest run src/app/util/notification-sources.test.ts src/app/util/notification-display.test.ts --project=main`.
- Run `pnpm check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10 --decorate` before committing.

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

## Phase 3: Git Important Roots And Status Activity

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Notify issue/PR creators about important Git activity under their issues/PRs, including comments, pull request updates, and status changes.

### Exit Criteria

- User-authored `GIT_ISSUE` roots notify the issue creator for comments and status changes rooted at that issue.
- User-authored `GIT_PULL_REQUEST` roots notify the PR creator for comments, PR updates, and status changes rooted at that PR.
- Direct parent authors of Git comments still receive one-level reply notifications.
- Reactions/zaps remain direct-target only and do not become issue/PR root-owner descendant notifications.
- Git rows use `source: "git"`, source label `Git`, and navigate to the issue/PR route or anchored comment/status path where available.
- Tests cover issue nested comments, PR updates, status changes, direct comment parent notification, and reaction non-expansion.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 3 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Identify Git important-root references from NIP-34/NIP-22 tags: repo `a`, root `E`/`K`, status root `e` with marker `root`, PR update `E`/`P`.
- Add Git important-root ownership lookup using loaded target events.
- Adjust engagement row building for Git descendant comments/status/PR updates without expanding reactions/zaps.
- Ensure target loading filters include roots required by status and PR-update events.
- Add focused unit tests.

### Verification

- Run `pnpm vitest run src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main`.
- Run `pnpm check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10 --decorate` before committing.

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

## Phase 4: Permission And Moderation Outcomes

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add explicit notification rows for access decisions and moderation outcomes that affect the signed-in user.

### Exit Criteria

- Moderator request accepted/rejected outcomes for the signed-in requester produce explicit community notification rows.
- Publishing permission request granted/rejected outcomes for the signed-in applicant produce explicit community notification rows where form/review state is available.
- Person bans targeting the signed-in user produce explicit community notification rows.
- Event moderation reports targeting events authored by the signed-in user produce explicit community notification rows where report state includes the target author.
- Rows are source `community`, have action-specific titles/labels, and route to relevant access/moderation/context pages.
- Tests cover at least moderator decision rows and one publishing permission or moderation outcome supported by current state.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 4 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect active community request/report stores and row builders.
- Add minimal row-building helpers or candidates from existing state without broad architecture changes.
- Prefer explicit rows over generic `Community access update` when the outcome is known.
- Add tests for supported outcomes.

### Verification

- Run `pnpm vitest run src/app/util/notification-sources.test.ts src/app/util/notifications.test.ts --project=main`.
- Run `pnpm check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10 --decorate` before committing.

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

## Phase 5: Review And Final Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Verify the full notification-root workflow, guard against noisy regressions, and close the checkpoint as complete.

### Exit Criteria

- Review confirms room notifications remain direct-parent only and do not notify room-root creators for reply chains.
- Review confirms thread/calendar/goal creators receive comment activity at any depth.
- Review confirms issue/PR creators receive comment, PR update, and status activity at any depth under their roots.
- Review confirms reactions/zaps remain direct-target only.
- Review confirms context sources remain DMs, Git, and Communities with no user-facing Other filter/source.
- Focused notification tests pass.
- `pnpm check` passes.
- `git diff --check` passes.
- Checkpoint records `Current Phase: Complete` and final evidence.
- Final closeout commit is pushed before final response if the checkpoint changed.

### Steps

- Run source grep checks for `Other` notification source/filter regressions.
- Review notification source derivation for root-owner and direct-parent rules.
- Rerun focused tests and checks.
- Update checkpoint to `Complete` with evidence and residual risks.

### Verification

- Run focused notification tests changed during this workflow.
- Run `pnpm check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10 --decorate` before committing.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to `Complete`.
  - Set `Phase Exit Criteria` to final completion criteria.
  - Set `Next Action` to final response.
  - Record any remaining risks or blockers.
- Commit and push checkpoint updates if files changed in this phase.
- Read the session checkpoint again to verify `Current Phase: Complete`.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
