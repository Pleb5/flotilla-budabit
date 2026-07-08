# Session Plan

## Objective

- Correct the Budabit notification center after the previous social-media notification pass.
- Remove standalone social-media notification sources and keep notification rows constrained to Budabit contexts: chats already present, communities, watched repos, and existing Budabit/community event flows.
- Do not add notifications for new global/social event kinds such as kind `1`, kind `7`, reposts, or generic zap receipts.
- Support community-context replies where existing Budabit kinds already apply, including kind `9` room replies and kind `1111` replies to thread comments.
- Simplify the notification modal UI: compact title only, no subtitle, no path clutter, no per-row read/unread visuals, Dark Wisp-style icon filter row and checkbox filters.
- Replace event-id read state with a single persisted global read timestamp/latest timestamp for the notification tab unread flag.
- Improve notification search to include profile display names and weighted searchable fields.
- Make notification row avatars open the existing profile modal.
- Finish with three explicit code-review/improvement cycles before declaring the workflow complete.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Commit and push each verified phase before starting the next phase.
- Branch `dev` tracks `origin/dev`; inspect status, diff, and recent commits before each phase commit.
- Stage only files intentionally changed for this workflow. Do not stage unrelated user changes if they appear.
- Use existing modal/popover/navigation/profile patterns: `pushModal`, `InlinePopover`, `ProfileDetail`, `ProfileCircle`, `ProfileName`, `PrimaryNavItem`, and existing icon/dataurl conventions.
- Do not introduce social-media notifications. Exclude kind `1` content entirely from notification derivation.
- Do not add new notification source kinds unless they are already Budabit/community notification contexts in this app.
- Keep lower-level badges and route-specific unread systems intact where they already exist.
- The global notification-tab unread indicator is timestamp-based only: no per-row read/unread state or per-event read history.
- DMs and lower-level group/chat badges may remain separate; they must not force per-row read state in the notification modal.
- Checkpoints should stay compact; put design details here.

## Phase 1: Source Scope And Global Read State

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Remove standalone social-media notification derivation and replace event-id read/unread tracking with a global timestamp model.

### Exit Criteria

- No notification-center source loads generic social media kinds `NOTE`, `REACTION`, or `ZAP_RESPONSE` as standalone notifications.
- `NotificationRowSource` and filters no longer include `social`.
- Notification rows are not marked read/unread per event and row sorting no longer prioritizes read state.
- The bell/top-level notification unread state is derived from a persisted global last-read timestamp and the latest notification row timestamp.
- Opening the notification modal updates the global read timestamp to the latest notification timestamp.
- Community-context reply rows are derived only from existing Budabit/community kinds: kind `9` room replies and kind `1111` replies to thread comments authored by the signed-in user.
- Kind `1111` replies to a thread root itself are not added as reply notifications; only replies to existing comments count.
- Focused tests cover removal of standalone social rows, global timestamp unread behavior, room reply notifications, and thread-comment reply notifications.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Replace or deprecate event-id read history in `src/app/util/notification-center.ts` with global timestamp helpers.
- Remove social source imports, types, live stores, and tests from `src/app/util/notification-sources.ts` and `src/app/util/notification-display.ts`.
- Add community reply derivation in `src/app/util/notification-sources.ts` using `readCommunityRoomMessage`, `readCommunityThreadReply`, and target events from the repository context.
- Update `src/app/components/NotificationsModal.svelte` and `src/app/components/PrimaryNav.svelte` to use timestamp read-state helpers instead of per-event read state.
- Update focused notification tests.

### Verification

- Run `pnpm vitest run src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main`.
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

## Phase 2: Modal UX, Search, And Filters

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Match the requested modal UX and filtering behavior while preserving existing Budabit design patterns.

### Exit Criteria

- Modal header shows only `Notifications` with a smaller title and no explanatory subtitle.
- Notification cards no longer render raw path-like strings such as `/nevent...` or route paths.
- Cards do not render read/unread badges or dots.
- Filter UI uses checkbox-style toggles, not radio buttons, and has no `All`, `Read`, or `Unread` options.
- Filter UI includes a compact icon row representing available notification types/sources.
- The `social` filter is absent.
- Search uses weighted fields similar to git issue search and includes profile display names for row actors where available.
- Profile avatars in notification rows are clickable and open the existing profile detail modal without triggering row navigation.
- Focused tests cover filter/search behavior including profile names and the absence of social/read filters.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Update `src/app/util/notification-display.ts` row metadata and filter/search helpers.
- Update `src/app/components/NotificationsModal.svelte` header, cards, filter popover, icon row, search usage, and avatar click handling.
- Add or adjust tests in `src/app/util/notification-sources.test.ts` or a display-focused test if needed.

### Verification

- Run focused notification/display tests added or changed in this phase.
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

## Phase 3: Review Cycles And Final Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Run three thorough code-review and improvement cycles, then complete final verification and close the workflow.

### Exit Criteria

- Review cycle 1 inspects source scope/read-state behavior, records findings, and applies any needed fixes.
- Review cycle 2 inspects modal UX/filter/search/profile interactions, records findings, and applies any needed fixes.
- Review cycle 3 inspects tests, edge cases, and regression risk, records findings, and applies any needed fixes.
- All focused notification tests pass.
- `pnpm check` passes.
- `git diff --check` passes.
- Final status/diff review shows no staged files and no unrelated files included.
- Checkpoint records `Current Phase: Complete` and final evidence.
- Final closeout commit is pushed before final response if the checkpoint changed.

### Steps

- Perform review/improvement cycle 1 over source scope and global read state.
- Perform review/improvement cycle 2 over modal UX, search, filters, and avatar profile modal behavior.
- Perform review/improvement cycle 3 over tests, edge cases, and regression risk.
- Rerun focused tests and full checks.
- Update checkpoint to `Complete` with evidence and residual risks.

### Verification

- Run all focused notification tests added or changed during this workflow.
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
