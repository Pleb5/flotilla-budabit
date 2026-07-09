# Session Plan

## Objective

- Redesign Budabit notifications into a low-noise history of tightly user-relevant events.
- Fix stacked modal browser-back behavior so profile/detail modals opened from notifications fall back to the notification modal without losing scroll or expansion state.
- Remove repost notification concepts entirely from Budabit notification code and UI; reposts do not exist in Budabit for this workflow.
- Replace noisy notification sources with relevant events only: new incoming DMs, replies to user-authored events, reactions to user-authored events, mentions of the signed-in user, zaps to the user or user-authored events, repo events for user-owned/user-maintained repos, opt-in watched repo events, user assignments/review requests, community access/moderation decisions involving the user, and badge awards to the user if already available in app data.
- Preserve individual read/unread/highlight behavior in places that highlight concrete items such as new issues, PRs, comments, and chats; opening the notification modal must not erase those target-specific states.
- Redesign notification rows as compact expandable accordions inspired by Dark Wisp: compact list row first; expanded content shows quoted/referenced context and the notification event itself; no raw `nostr:nevent`, `nevent`, path, or long identifier strings.
- Clicking quoted/referenced events inside expanded notification content must navigate to the right Budabit route and scroll/open the target event directly.
- Keep existing notification history loading behavior: reset every modal open, initial two-week `since`, 50 visible rows, load-more expands loaded history and visible row count.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Commit and push each verified phase before starting the next phase.
- Branch `dev` tracks `origin/dev`; inspect status, diff, and recent commits before each phase commit.
- Stage only files intentionally changed for this workflow. Do not stage unrelated user changes if they appear.
- Every phase startup must inspect relevant Dark Wisp inspiration from `/home/johnd/Work/dark-wisp-android` before creating phase todos or implementation details.
- Mirror Dark Wisp concepts, not Android/Kotlin implementation details: compact row anatomy, type icons, one-expanded-row behavior, referenced-note expansion, zaps/reaction grouping, and click-through callbacks.
- No repost notifications, filters, icons, summary stats, tests, or row types in Budabit notification center.
- Do not reintroduce noisy general community activity: generic new room posts, generic new threads, generic calendar/goals, and generic community feed items are not notification-center history rows.
- Keep lower-level badges and route-specific unread/read systems intact where they already exist.
- The global notification-tab unread indicator may remain timestamp-based, but target-specific read/unread state must remain for concrete highlighted items.
- Keep checkpoints compact; put design details here.

## Phase 1: Modal Stack Back Navigation

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Inspect Dark Wisp notification navigation/back UX references in `/home/johnd/Work/dark-wisp-android`, especially `NotificationsScreen.kt`, before creating phase todos or edits.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Make stacked modals handle browser/app back correctly while preserving notification modal instance state beneath a profile/detail modal.

### Exit Criteria

- Opening a profile/detail modal from `NotificationsModal` keeps the notification modal mounted beneath it.
- Browser Back from the top modal returns to the previous modal hash and does not clear the whole stack.
- Backdrop/Escape closes only the top modal unless that modal has `noEscape`.
- Closing the last modal removes the hash and clears modal stack state.
- Navigating from a notification row still intentionally clears all modals.
- Modal stack pruning handles opening a new modal after navigating back in a stack.
- Focused modal helper tests or code-level tests cover stack derivation/pruning/back behavior if practical.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Refactor `src/app/util/modal.ts` to keep route/hash history and stack state consistent when the active hash changes from browser Back.
- Update `src/app/components/ModalContainer.svelte` only if necessary after the stack utility changes.
- Preserve existing `clearModals()` full-dismiss behavior for row navigation.
- Add focused tests for pure stack helpers if direct Svelte/router testing is too heavy.

### Verification

- Run focused modal tests if added.
- Run `pnpm vitest run src/app/util/notification-history.test.ts src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main`.
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

## Phase 2: Relevant Notification Sources And Read State

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Inspect Dark Wisp notification data/filtering inspiration in `/home/johnd/Work/dark-wisp-android`, especially `NotificationsViewModel.kt`, `NotificationItem.kt`, and notification routing snippets, before creating phase todos or edits.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Replace noisy notification-center source derivation with user-relevant notification item history and keep target-specific unread/highlight state intact.

### Exit Criteria

- No Budabit notification type/source/filter references reposts.
- Generic new community room messages, generic new threads, generic calendar/goals, and generic community activity no longer appear as notification-center history rows.
- Notification history includes incoming DMs, replies to user-authored events, reactions to user-authored events, mentions, zaps to the user or user-authored events, user-owned/user-maintained repo events, opt-in watched repo events, assignments/review requests tagging the user, and user-specific community access/moderation decisions where existing data supports them.
- Repo notification baseline includes owned/maintained repos without requiring opt-in watch, while watched repos remain opt-in expansion.
- Opening the notification modal may mark the global bell timestamp read but does not clear per-target read/unread markers for issues, PRs, comments, chats, or concrete route targets.
- Tests assert noisy generic community rows are absent and relevant user-targeted rows are present.
- Tests assert no repost notification/filter symbols remain in notification-center code.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Add or refine a normalized notification item layer in `src/app/util/notification-display.ts` and `src/app/util/notification-sources.ts`.
- Remove generic community rows from `buildCommunityNotificationRows` and related source filters.
- Add targeted reaction/mention/zap/reply derivation only where target ownership can be verified.
- Add owned/maintained repo candidate derivation or expand repo-watch candidate inputs to include baseline repos.
- Preserve existing checked/read state flows for target-specific highlights.
- Update focused notification source tests.

### Verification

- Run focused notification source/read-state tests.
- Run `pnpm vitest run src/app/util/notification-history.test.ts src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main`.
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

## Phase 3: Compact Expandable Notification UI

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Inspect Dark Wisp notification UI inspiration in `/home/johnd/Work/dark-wisp-android`, especially `ZenNotificationRow`, `NotificationTypeIcon`, `ReplyExpansion`, `NoteExpansion`, and `GroupChatExpansion`, before creating phase todos or edits.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Redesign the notification modal into compact expandable rows with quoted/referenced context and direct event navigation/scrolling.

### Exit Criteria

- Notification rows are compact by default and visually similar in spirit to Dark Wisp: type icon, actor avatar, actor name, verb/action text, source/target context when useful, timestamp.
- Rows expand/collapse in place; at most one row is expanded at a time unless a simpler accessible multi-expand approach is explicitly chosen and documented.
- Expanded reply rows show the quoted/referenced event and the reply event itself where data is loaded.
- Expanded reaction/zap/mention/repo rows show the referenced context and the notification event/context without raw ids.
- Clicking the row toggles expansion; clicking explicit action/quoted target navigates to the correct route and scrolls/opens the target event directly.
- No raw `nostr:nevent`, `nevent`, route path, or long event id is rendered in compact or expanded UI.
- Search filters all loaded notification rows, not only the currently visible 50-row slice.
- Load-more behavior remains functional.
- Profile avatar click still opens stacked profile modal and returns to notification state after dismissal.
- Focused tests or source tests cover row display metadata, no raw ids, expansion route metadata, and no repost UI.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 3 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Extend `NotificationRow` metadata with `type`, `action`, `target`, `context`, `expandable`, and navigation target ids/paths as needed.
- Update `NotificationsModal.svelte` to render compact accordion rows and expanded content blocks.
- Add helper functions to build safe display labels and route/scroll targets.
- Use existing route helpers and `scrollToEvent` patterns for event anchors where possible.
- Add missing route anchors if needed for community replies or repo comments.
- Update tests around display metadata and raw-id suppression.

### Verification

- Run focused notification display/source tests.
- Run `pnpm vitest run src/app/util/notification-history.test.ts src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main`.
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

## Phase 4: Review And Final Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Re-inspect Dark Wisp notification UX/data references in `/home/johnd/Work/dark-wisp-android` and compare against Budabit implementation before creating phase todos or edits.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Review the full redesign for noisy source regressions, modal stack correctness, UI polish, route navigation/scroll behavior, and test coverage, then close the workflow.

### Exit Criteria

- Review confirms modal Back/Escape/backdrop stack behavior works by code evidence and tests where practical.
- Review confirms no repost notification concepts remain in Budabit notification-center files.
- Review confirms generic noisy community rows are absent from notification-center history.
- Review confirms compact/expanded row UI suppresses raw ids/paths and has direct target navigation metadata.
- All focused notification/modal tests pass.
- `pnpm check` passes.
- `git diff --check` passes.
- Final status/diff review shows no staged files and no unrelated files included.
- Checkpoint records `Current Phase: Complete` and final evidence.
- Final closeout commit is pushed before final response if the checkpoint changed.

### Steps

- Run source grep checks for repost and raw-id/path rendering risks.
- Review notification source derivation for noisy event classes.
- Review modal stack code for browser Back edge cases.
- Review expanded row navigation/scroll code paths.
- Apply minimal fixes for findings.
- Rerun focused tests and full checks.
- Update checkpoint to `Complete` with evidence and residual risks.

### Verification

- Run all focused notification/modal tests added or changed during this workflow.
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
