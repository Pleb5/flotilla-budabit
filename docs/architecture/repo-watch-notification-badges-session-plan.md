# Session Plan

## Objective

- Implement repository notification badges only for explicitly watched repositories.
- Watch settings must control which repository activity creates in-app badges.
- New watch activity filters must support all activity, maintainer-only, community-only, and maintainer-or-community activity.
- Review-request notifications are intentionally out of scope for this session.
- Enabling or changing watch settings must not surface historical unread activity.

## Constraints

- Current repository state is authoritative.
- Preserve unrelated dirty worktree changes, especially the existing community notification baseline edits.
- Do not use ownership, maintainership, stars, or community membership alone to create badges; a repo must be explicitly watched.
- Maintainer scope means repo owner plus all maintainers declared in the repo announcement, not verified maintainers only.
- Community-only activity applies only when the repo announcement tags a community and should use existing community writer/member permission helpers.
- Do not include review-request notification logic or UI because reviews are not a full feature yet.
- Avoid duplicate `/git` notification entries that inflate app badge counts; global Git navigation should derive its indicator from repo notification paths.
- Each completed phase must update `docs/architecture/repo-watch-notification-badges-session-checkpoint.md`, verify, commit, push, then reread the checkpoint before continuing.

## Phase 1: Durable Planning

### Phase Startup

- Read the session checkpoint if it exists.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Create a durable plan and checkpoint for the repo-watch notification badge work.

### Exit Criteria

- Session plan exists with objective, constraints, phases, verification, risks, `Phase Startup`, `Mandatory Closeout`, and `Phase Transition` sections.
- Session checkpoint exists with compact current state and points to Phase 2.
- Existing unrelated dirty changes are documented and not staged.

### Steps

- Inspect existing session-plan conventions.
- Create this plan under `docs/architecture/`.
- Create/update the checkpoint.

### Verification

- Read the plan and checkpoint after writing them.
- Run `git status --short --branch`.

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

### Phase Transition

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 2: Watch Settings Model And UI

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Extend repo watch settings with an activity filter and expose the filter in the watch modal.

### Exit Criteria

- `RepoWatchOptions` supports an `activityFilter` with default `all` and normalization for older stored settings.
- `RepoWatchModal` renders a `Filter activity` radio group with tooltips.
- `All activity` is first and selected by default.
- `Community-only` and `Maintainers + community only` are hidden when the repo announcement does not tag a community.
- `Maintainer-only` includes owner plus declared maintainers by design.
- Review-request UI is not shown or added.
- Saving watch settings sets issue/PR watch checkpoints to the current time when enabling or changing watch settings, preventing historical unread activity.

### Steps

- Add activity filter types/defaults/normalization to `src/app/core/repo-watch.ts`.
- Add or update unit tests for normalization.
- Pass repo community presence from repo layout to `RepoWatchModal`.
- Add the radio group, labels, and tooltips to `RepoWatchModal`.
- Mark repo issue/PR notification paths checked at save time.

### Verification

- Run focused repo-watch and notification-related unit tests if available.
- Run `pnpm test:main -- src/app/core/repo-watch.test.ts src/app/util/notifications.test.ts` or the closest supported Vitest command.

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

### Phase Transition

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 3: Watched Repo Badge Pipeline

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Generate in-app repo badge paths only from explicitly watched repositories and enabled watch options.

### Exit Criteria

- Watched repo activity produces `/git/{naddr}/issues` and `/git/{naddr}/prs` paths only when the repo is explicitly watched.
- Activity respects enabled issue, PR, comment, status, and assignment watch options; reviews are ignored.
- Activity filters apply by author: all, maintainer-only, community-only, maintainer-or-community.
- Community filtering uses eligible community writer/member logic and is skipped when no tagged community is present.
- Global Git navigation badges derive from watched repo notification paths without adding a duplicate `/git` notification entry.
- Existing repo card and repo tab badge consumers continue to work with canonical `/git/{naddr}` paths.

### Steps

- Add a repo-watch notification utility/store that derives watched repo notification paths.
- Load or subscribe to watched repo root activity, comments, status events, labels, and repo announcements as needed.
- Wire the repo notification path augmenter into app startup without replacing community/chat candidate generation.
- Update global Git nav/community-home badge consumers to use a git-path helper rather than `$notifications.has("/git")`.
- Add focused tests for watched-only behavior and git parent badge derivation.

### Verification

- Run focused notification tests.
- Run Svelte check if changes touch UI/components significantly.

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

### Phase Transition

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 4: Final Verification And Cleanup

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Verify the full repo-watch badge workflow and mark the durable plan complete.

### Exit Criteria

- Focused tests pass or any failure is documented as a blocker.
- `pnpm check` or a justified narrower check passes.
- Checkpoint says `Current Phase: Complete`.
- Any unrelated dirty changes remain unstaged and documented.

### Steps

- Run final verification commands.
- Inspect `git status` and `git diff`.
- Update checkpoint to `Current Phase: Complete` with evidence.

### Verification

- Run focused tests from earlier phases.
- Run `pnpm check` if feasible.

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

### Phase Transition

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
