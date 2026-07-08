# Session Plan

## Objective

- Build a Budabit global notification center opened from a bell item in the primary navigation.
- The notification center is global across the signed-in user's communities, watched repos, chats, and later direct social activity; it is not limited to the active community route.
- Persist only compact notification history/read state, primarily event ids and timestamps. Derive labels, source, reason, paths, previews, and available actions from `TrustedEvent` plus existing Budabit/Welshman helpers at runtime.
- Keep a capped history of notification events in the modal and indicate read/unread state.
- Use explicit clearing: clicking/tapping a notification or explicit mark-read actions clear unread state; opening the modal does not clear notifications.
- Remove top-level notification badges from global nav items such as Messages and Git; the global bell becomes the only top-level unread indicator. Preserve lower-level badges/highlights such as chat rows, repo tabs, community menu sections, and route-specific badges.
- Reuse Welshman repository, store, filter, tag, content, profile, zap, DM/plaintext, and search helpers instead of recreating Nostr protocol plumbing.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Commit and push each verified phase before starting the next phase.
- Branch `dev` tracks `origin/dev`; inspect status, diff, and recent commits before each phase commit. This branch was already ahead of `origin/dev` by three commits at workflow startup.
- Stage only files intentionally changed for this workflow. Do not stage unrelated user changes if they appear during the workflow.
- Use existing modal/popover/navigation patterns: `pushModal`, `Dialog`, `InlinePopover`, `PrimaryNavItem`, and existing icon/dataurl conventions.
- Use `TrustedEvent` as the source object for notifications. Do not persist rich duplicated notification records.
- Use Welshman helpers where possible: `repository`, `tracker`, `deriveEventsById`, `deriveEventsAsc/Desc`, `getReplyTags`, `getCommentTags`, `getParentIdOrAddr`, `getReplyFilters`, `getIdFilters`, `createSearch`, `parse`, `renderAsText`, `getValidZap`, `ensurePlaintext`, `displayProfileByPubkey`, and related utilities.
- Apply personal mutes and Budabit community moderation/write-permission rules before surfacing community notifications.
- Apply repo-watch settings and repo/community authority rules for git notifications.
- No repost notification support for Budabit. Quote notifications are low priority and should not block the core feature.
- Keep checkpoints compact; put phase design details here.

## Phase 1: Navigation, Modal Shell, And Event-Id State

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Establish the global bell entry point, top-level badge policy, modal shell, and compact event-id/read-state foundation without implementing every notification source yet.

### Exit Criteria

- Desktop primary nav shows a Notifications bell under Explore.
- Mobile primary nav shows the Notifications bell between Search and Settings/Profile.
- Messages and Git no longer show top-level primary-nav badges; lower-level route badges remain untouched.
- Bell shows the only top-level unread indicator using the existing unread path set as an interim source until richer event sources are connected.
- Clicking/tapping the bell opens a scrollable Notifications modal through the existing modal system.
- Modal includes a search input, filter popover trigger using `InlinePopover`, read/unread filter controls, empty states, and an explicit mark-read affordance placeholder.
- Add a notification-center utility module that persists capped history ids and read timestamps, exposes read/mark-read helpers, and is intentionally event-id based.
- Focused unit tests cover notification history capping and read-state helpers.
- `pnpm vitest run src/app/util/notification-center.test.ts --project=main` passes.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Add or update `src/app/util/notification-center.ts` with `synced` stores for capped ids and per-event read timestamps.
- Add focused tests in `src/app/util/notification-center.test.ts`.
- Add `src/app/components/NotificationsModal.svelte` with scrollable modal layout, search, filter popover, read/unread controls, and placeholder/event-history state.
- Update `src/app/components/PrimaryNav.svelte` to import a bell icon, open the modal, add the nav item in the requested positions, and remove top-level Git/Messages badge props.
- Keep lower-level badge logic untouched.

### Verification

- Run `pnpm vitest run src/app/util/notification-center.test.ts --project=main`.
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

## Phase 2: Core Notification Event Sources And Modal Rows

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Render real repository-backed notification rows for currently available sources while keeping the persisted state event-id based.

### Exit Criteria

- Add reusable notification source/inference modules that operate on `TrustedEvent` and existing stores rather than duplicating event data.
- DM/chat notification events appear in the modal with actor, timestamp, preview, path, read/unread state, and search text.
- Existing active badge paths are represented in the modal as interim route notifications when no event-backed row is available, without persisting rich records.
- Modal rows are compact, readable on desktop/mobile, and clicking a row marks the related event/path read explicitly.
- Search filters notification rows by actor/source/preview/path text using `createSearch` or equivalent existing helper.
- Filter popover controls at least All, Unread, Read, Chats, Git, Communities, and Other.
- Bell unread state starts using the notification-center unread derivation when event-backed rows exist, while still reflecting existing unread path badges during migration.
- Focused tests cover row derivation/search/read filtering where practical.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Add `src/app/util/notification-sources.ts` or equivalent reusable module for event-backed source derivation.
- Add `src/app/util/notification-display.ts` or equivalent pure helpers for runtime display descriptors.
- Wire the modal to real rows and read-state operations.
- Keep lower-level badge behavior untouched.

### Verification

- Run any focused tests added for notification derivation.
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

## Phase 3: Global Community And Git Notification Coverage

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Expand beyond active-community context so the modal and bell cover all signed-in user communities and watched repos with moderation and permission filters.

### Exit Criteria

- Community notification derivation uses `activeUserCommunityRefs` and `communityMemberReportStates`, not only active-community stores.
- Community source derivation applies `canWriteCommunityTarget`, `isCommunityPersonBanned`, and `getCommunityCensorReason` or equivalent existing moderation helpers before surfacing rows.
- Community notification rows include community/source context and link to the correct room/thread/calendar/goal/admin/membership route.
- Repo-watch notification rows show issues/PRs/comments/status/assignments from watched repos with readable labels and target paths.
- Repo notifications continue to respect repo-watch settings and update both local checked state and `repoWatchNotificationSeen` where applicable.
- Top-level bell reflects global community and git unread state; lower-level badges still work.
- Focused tests cover global community filtering and repo notification display/read behavior where practical.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 3 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Replace active-only community notification candidate use in the notification center with global user-community source derivation.
- Reuse existing community bootstrap/profile-list/report-state stores and avoid duplicating permission logic.
- Export or adapt repo-watch candidate data for modal display without changing existing lower-level badge behavior.
- Add focused tests for moderation/permission suppression and repo read-state updates.

### Verification

- Run focused notification tests added or changed in this phase.
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

## Phase 4: Mentions, Replies, Reactions, Zaps, And Inline Actions

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add direct social notification types and action affordances inspired by Dark Wisp while preserving Budabit's existing actions and permissions.

### Exit Criteria

- Mentions and replies to user-authored content are detected using Welshman tag/parent helpers and repository context.
- Reactions and zaps notify only when the referenced event belongs to the signed-in user or otherwise passes an explicit ownership/context check; do not trust inherited `p` tags alone.
- Zaps are validated with Welshman zap helpers where possible.
- No repost notifications are added. Quote support remains low priority and optional.
- Reply/mention rows can expose an inline reply affordance or link to an existing reply flow; reaction/zap rows do not show reply composer actions.
- Repeated noisy zap/reaction rows are de-duped or collapsed enough to avoid spammy modal output, while read state remains event-id based.
- Focused tests cover false-positive suppression for reactions/zaps and mention/reply classification.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 4 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Add social notification source derivation for mentions, replies, reactions, and zaps.
- Reuse existing `publishComment`, `publishReaction`, `ZapButton`/zap helpers, profile display, and content rendering components where practical.
- Add minimal inline action UI only where it is safe and existing publish helpers already support the action.

### Verification

- Run focused notification/social tests added or changed in this phase.
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

## Phase 5: Final Verification And Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Run final verification, ensure the checkpoint records completion, and close the durable workflow.

### Exit Criteria

- All focused notification tests pass.
- `pnpm check` passes.
- `git diff --check` passes.
- Final status/diff review shows no staged files and no unrelated files included in this workflow.
- Checkpoint records `Current Phase: Complete` and final verification evidence.
- Final closeout commit is pushed before final response if the checkpoint changed in this phase.

### Steps

- Rerun focused notification tests.
- Run full project check.
- Inspect final diffs and status.
- Update checkpoint to `Complete` with evidence and residual risks.

### Verification

- Run all focused notification tests added during this workflow.
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
