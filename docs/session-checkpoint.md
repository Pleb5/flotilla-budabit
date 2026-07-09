# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Redesign Budabit notifications into a low-noise, tightly user-relevant history.
- Fix stacked modal browser-back behavior so top modals dismiss back to underlying modals without losing state.
- Remove repost notification concepts entirely from Budabit notification-center code and UI.
- Make compact notification rows expandable with quoted/referenced content and direct navigation/scroll targets.
- Use Dark Wisp notification UX/data patterns as inspiration during every phase startup.

## Current Phase

- Phase 3: Compact Expandable Notification UI

## Phase Exit Criteria

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

## Completed With Evidence

- Previous notification correction workflow completed at commit `43ef40f7` and checkpoint said `Current Phase: Complete`.
- Pre-work base commit `4bdd24cd feat: add notification history loading and modal stacking` was pushed to `origin/dev` before starting this workflow.
- New workflow startup inspected current Budabit modal/notification code, existing checkpoint/plan, git state, and Dark Wisp notification references:
  - `/home/johnd/Work/dark-wisp-android/app/src/main/kotlin/com/darkwisp/app/ui/screen/NotificationsScreen.kt`
  - `/home/johnd/Work/dark-wisp-android/app/src/main/kotlin/com/darkwisp/app/viewmodel/NotificationsViewModel.kt`
  - `/home/johnd/Work/dark-wisp-android/app/src/main/kotlin/com/darkwisp/app/nostr/NotificationItem.kt`
  - `/home/johnd/Work/dark-wisp-android/app/src/main/kotlin/com/darkwisp/app/viewmodel/EventRouter.kt`
- Dark Wisp inspiration identified: compact rows, one expanded row, type icons, referenced-note expansion, grouped zaps, filter summary, and click callbacks for referenced content.
- Phase 1 startup reread this checkpoint and the full session plan, inspected current git state, and re-inspected Dark Wisp notification navigation/back UX in `NotificationsScreen.kt`.
- Phase 1 implemented modal stack browser-back fixes:
  - Added pure modal stack helpers in `src/app/util/modal-stack.ts` for active-hash stack derivation, hash-sync pruning, top-close planning, and history-close decisions.
  - Added focused tests in `src/app/util/modal-stack.test.ts` covering browser-back pruning, missing hash clearing, top-only close plans, and replace-state history fallback.
  - Updated `src/app/util/modal.ts` so active-hash stack derivation and new modal pushes use the same helper rules.
  - Updated `closeTopModal()` so pushed stacked modals close via real browser Back, preserving previous modal history and avoiding duplicate hash entries; `replaceState` modals still fall back to direct hash replacement.
  - Added `syncModalStoresToActiveId()` and wired `ModalContainer.svelte` to prune abandoned top modal state when browser Back moves to a lower hash.
  - Preserved `clearModals()` full-dismiss behavior for row navigation.
- Phase 1 verification passed:
  - `pnpm vitest run src/app/util/modal-stack.test.ts --project=main` passed: 1 file, 5 tests.
  - `pnpm vitest run src/app/util/notification-history.test.ts src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main` passed: 4 files, 18 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
  - Pre-closeout inspected `git status --short --branch`, `git diff`, and `git log --oneline -10 --decorate`.
- Phase 2 startup reread this checkpoint and the full session plan, inspected current git state, and inspected Dark Wisp notification data/filtering references in `NotificationsViewModel.kt`, `NotificationItem.kt`, and `EventRouter.kt`.
- Phase 2 implemented relevant notification source/read-state corrections:
  - Removed generic notification-center community rows for ordinary room messages, new threads, calendar events, goals, and community route fallback rows.
  - Kept user-specific community rows for room replies to the signed-in user's room messages, thread replies to the signed-in user's comments, and community membership/access profile-list updates.
  - Added targeted engagement rows under `source: "other"` / `sourceLabel: "Engagement"` for replies to user-authored targets, direct mentions, reactions to user-authored targets, and verified zaps to user-authored targets.
  - Added zap validation before zap rows are emitted.
  - Added optional `eventIds` row metadata for grouped reactions/zaps.
  - Added owned/maintained repo notification baseline refs with default issue/PR/comment/status/assignment/review coverage while preserving explicit watched-repo options as opt-in expansion.
  - Added review-request label handling for repo notifications.
  - Preserved global notification read timestamp behavior without clearing route-specific checked/read state.
- Phase 2 verification passed:
  - `pnpm vitest run src/app/util/modal-stack.test.ts src/app/util/notification-history.test.ts src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main` passed: 5 files, 26 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
  - Grep over notification app files found no repost notification symbols.
  - Grep over notification app files found no `social` notification source/filter symbols.
  - Pre-closeout inspected `git status --short --branch`, `git diff --stat`, `git diff`, and `git log --oneline -10 --decorate`.

## Decisions

- Treat this as a new durable workflow because the previous checkpoint says `Complete`.
- Use `docs/session-plan.md` and `docs/session-checkpoint.md` for durable state.
- Every phase startup must inspect Dark Wisp before implementation todos/edits.
- Reposts are explicitly out of scope and must not exist as Budabit notification concepts.
- Generic community activity is noise and must not appear as notification-center history.
- Keep global bell timestamp read state separate from per-target read/unread/highlight state.
- Keep notification history loading behavior from commit `4bdd24cd` unless directly contradicted by the redesign.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Current HEAD at workflow setup: `4bdd24cd`.
- Worktree was clean after pushing `4bdd24cd`.
- Plan/checkpoint setup files changed for this workflow: `docs/session-plan.md`, `docs/session-checkpoint.md`.
- Phase 1 changed files: `docs/session-checkpoint.md`, `docs/session-plan.md`, `src/app/components/ModalContainer.svelte`, `src/app/util/modal.ts`, `src/app/util/modal-stack.ts`, and `src/app/util/modal-stack.test.ts`.
- Phase 1 is verified and closed by the current phase transition commit.
- Phase 2 changed files: `docs/session-checkpoint.md`, `src/app/util/notification-display.ts`, `src/app/util/notification-sources.ts`, `src/app/util/notification-sources.test.ts`, `src/app/util/repo-watch-notifications.ts`, and `src/app/util/repo-watch-notifications.test.ts`.
- Phase 2 is verified and closed by the current phase transition commit.

## Next Action

- Phase 3 startup: reread this checkpoint and the full session plan, inspect current git state, inspect Dark Wisp notification UI references, then redesign notification rows into compact expandable accordions with safe context display and direct navigation metadata.

## Verification

- Startup ran `git status --short --branch`.
- Startup ran `git log --oneline -10 --decorate`.
- Startup reread prior checkpoint and plan.
- Startup inspected Budabit modal/notification files and Dark Wisp notification files.
- Setup push of existing commit `4bdd24cd` succeeded.
- Phase 1 focused modal test command passed.
- Phase 1 focused notification regression command passed.
- Phase 1 project check passed.
- Phase 1 whitespace check passed.
- Phase 1 pre-closeout inspected status, diff, and recent commits.
- Phase 2 focused notification/modal regression command passed.
- Phase 2 project check passed.
- Phase 2 whitespace check passed.
- Phase 2 no-repost/no-social-source greps passed.
- Phase 2 pre-closeout inspected status, diff summary, diff, and recent commits.

## Risks Or Blockers

- No current blocker.
- Browser Back behavior is covered by pure stack-helper tests and code evidence; no browser e2e was added in Phase 1.
- Maintained repo baseline notifications use repo announcements known to Budabit plus actively loaded owned repo announcements; NIP-34 maintainer data is stored in a multi-value `maintainers` tag that cannot be targeted by a relay tag filter.
- Phase 3 must avoid rendering raw event/share paths from engagement rows.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/util/modal.ts`
- `src/app/util/modal-stack.ts`
- `src/app/util/modal-stack.test.ts`
- `src/app/components/ModalContainer.svelte`
- `src/app/components/NotificationsModal.svelte`
- `src/app/util/notification-display.ts`
- `src/app/util/notification-sources.ts`
- `src/app/util/notification-sources.test.ts`
- `src/app/util/notification-center.ts`
- `src/app/util/repo-watch-notifications.ts`
- `src/app/util/repo-watch-notifications.test.ts`
- `src/app/util/routes.ts`
