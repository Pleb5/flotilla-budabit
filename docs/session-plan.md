# Session Plan

## Objective

- Implement Budabit community management notification semantics for applications, moderator requests, reports, censoring, and person bans.
- Section write-access applications must notify only moderators who can grant that exact section, plus the admin who can grant all sections.
- Applicants must be notified when moderators grant, reject, or revoke a write-access application.
- Moderator-role applicants must be notified when the admin accepts or rejects the moderator request.
- New reports must notify the reported member and moderators/admin for the relevant section.
- Event censoring must notify the censored author, the original reporter when a prior report exists, and other moderators/admin for the relevant section.
- Person bans must notify all active community members, not just admin and moderators, and must still notify the banned pubkey where current data can identify it.
- Keep notification sources as DMs, Git, and Communities; do not add user-facing `Other` source/filter.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Branch `dev` tracks `origin/dev`; inspect status, diff, and recent commits before each phase commit.
- Existing dirty files are present before this workflow and must not be staged unless intentionally touched by a phase:
  - `src/app/components/NotificationsModal.svelte`
  - `src/app/util/notifications.test.ts`
  - `src/app/components/NotificationDmContent.svelte`
- If unrelated existing changes overlap a phase file, inspect and work with current code; stop only if the overlap conflicts with this objective.
- Stage only files intentionally changed for each phase.
- Commit and push each verified phase before starting the next phase.
- Keep the checkpoint compact; put durable design details here.
- Prefer pure row-building helpers with focused unit tests before wiring live stores.
- Admin is one-community-per-keypair in Budabit; admin notification work should be robust for the admin's community without assuming one account administers multiple communities.

## Phase 1: Plan Bootstrap

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Replace the completed prior workflow checkpoint/plan with this new community management notification workflow and record current repository facts.

### Exit Criteria

- `docs/session-plan.md` describes all phases with `Phase Startup`, `Mandatory Closeout`, and `Continue` sections.
- `docs/session-checkpoint.md` records the new objective, current phase, dirty state, branch/upstream facts, decisions, and next action.
- No code files are intentionally changed in this phase.
- Checkpoint is advanced to Phase 2 before commit.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Create the durable plan and checkpoint for this workflow.
- Inspect `git status --short --branch`, `git log --oneline -12 --decorate`, and remotes.
- Commit only the plan/checkpoint changes for Phase 1.

### Verification

- Read both durable files after editing.
- Inspect `git status --short --branch`, `git diff -- docs/session-plan.md docs/session-checkpoint.md`, and `git log --oneline -12 --decorate` before committing.

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

## Phase 2: Access And Moderator Applications

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add modal/notification-center rows for section write-access applications, write-access judgments, and moderator-request judgments.

### Exit Criteria

- Pending `FORM_RESPONSE_KIND` applications produce Community modal rows for moderators who can grant the exact form section and for the admin.
- Moderators of other sections do not receive application rows.
- `COMMUNITY_FORM_REVIEW_KIND` write-access judgments produce applicant outcome rows for granted, rejected, and revoked outcomes where represented by current events.
- Admin judgments of moderator-role requests continue to produce requester outcome rows and tests cover the behavior.
- Rows route to `/moderation` for reviewer work and `/access` for applicant outcomes.
- Focused tests cover section-specific moderator filtering, applicant outcomes, and moderator request outcomes.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect application form, response, delete, and review helpers plus current notification source builders.
- Add pure helper logic for grantable pending applications and applicant review rows.
- Wire live notification rows to existing active user community references and user-targeted review events with minimal new filters.
- Add or adjust route candidate display copy only where it improves modal clarity.
- Add focused unit tests.

### Verification

- Run `pnpm vitest run src/app/util/notification-sources.test.ts src/app/util/notifications.test.ts --project=main`.
- Run `pnpm check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -12 --decorate` before committing.

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

## Phase 3: Reports, Censoring, And Person Bans

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add Community modal rows for reports, event censoring outcomes, report review outcomes, and person bans including all-member person-ban visibility.

### Exit Criteria

- New content reports notify the reported content author and moderators/admin who can review that section.
- Effective event censors notify the censored content author.
- Effective event censors notify original reporters when a prior content report matches the censored event/address and section.
- Effective event censors notify other moderators/admin for the section, excluding the actor's own event where standard self-notification suppression applies.
- Effective person bans notify all active members in that community, not only admins/moderators, and still notify the banned pubkey when target data is available.
- Report review labels notify original reporters that their report was reviewed.
- Deleted reports are suppressed from pending report notifications.
- Focused tests cover reporter, reported member, section moderator/admin, all-member person-ban, and deleted/reviewed suppression cases.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 3 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect report parsing, effective report state, content report grouping, and moderation route logic.
- Reuse existing `canReviewCommunityContentReport`, `getCommunityContentReports`, and effective report state where possible.
- Add notification row helpers for report and moderation cases with explicit recipient qualification.
- Add focused tests for target author, reporter, reviewer, and member visibility.

### Verification

- Run `pnpm vitest run src/app/util/notification-sources.test.ts --project=main`.
- Run `pnpm check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -12 --decorate` before committing.

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

## Phase 4: Route Clearing And Final Review

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Verify notification behavior end-to-end, add missing clear-on-visit behavior, and close the workflow.

### Exit Criteria

- `/moderation` marks its notification path checked on page exit.
- `/access` and `/admin` outcome clearing still works.
- Modal rows remain under Communities source; no `Other` source/filter is introduced.
- Focused notification tests pass.
- `pnpm check` passes.
- `git diff --check` passes.
- Checkpoint records `Current Phase: Complete` and final evidence.
- Final closeout commit is pushed before final response if files changed.

### Steps

- Add `setChecked` to `/moderation` if missing.
- Run focused tests and source/filter grep checks.
- Inspect final diff/status/log.
- Update checkpoint to `Complete` and commit/push final closeout.

### Verification

- Run `pnpm vitest run src/app/util/notification-sources.test.ts src/app/util/notifications.test.ts src/app/util/notification-display.test.ts --project=main`.
- Run `pnpm check`.
- Run `git diff --check`.
- Run grep checks for notification `Other` source/filter regressions.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -12 --decorate` before committing.

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
