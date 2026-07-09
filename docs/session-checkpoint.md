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

- Phase 2: Relevant Notification Sources And Read State

## Phase Exit Criteria

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

## Next Action

- Phase 2 startup: reread this checkpoint and the full session plan, inspect current git state, inspect Dark Wisp notification data/filtering references, then replace noisy notification sources with tightly user-relevant rows while preserving per-target read state.

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

## Risks Or Blockers

- No current blocker.
- Browser Back behavior is covered by pure stack-helper tests and code evidence; no browser e2e was added in Phase 1.
- Notification redesign scope is broad; later phases may need targeted follow-up if repo ownership/maintainer data is incomplete.

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
