# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Build a global Budabit notification center opened from a bell nav item.
- Persist compact event-id/read-state history and derive display/context/actions from repository events with existing Welshman and Budabit helpers.
- Cover all signed-in user communities and watched repos, then mentions/replies/reactions/zaps, while preserving lower-level badges and explicit clearing.

## Current Phase

- Complete

## Phase Exit Criteria

- Global notification-center workflow is complete.
- Final focused notification tests passed.
- Final `pnpm check` passed.
- Final `git diff --check` passed.
- Final closeout checkpoint commit is pushed before final response.

## Completed With Evidence

- Previous `docs/session-plan.md` and `docs/session-checkpoint.md` described a completed widget reliability workflow and were replaced for this global notification-center workflow.
- Startup inspection found `/home/johnd/Work/budabit` on `dev...origin/dev [ahead 3]` with no dirty working-tree paths reported by `git status --short --branch`.
- Startup inspection found remotes including `origin` and upstream tracking `origin/dev`.
- Startup read the completed previous checkpoint and the full previous session plan before replacing them.
- Phase 1 implemented the nav/modal/event-id foundation:
  - Added `src/app/util/notification-center.ts` with capped event-id history, read timestamps, read helpers, unread derived stores, and clear helper.
  - Added focused `src/app/util/notification-center.test.ts` coverage for normalization/capping, upsert dedupe, and read-state behavior.
  - Added `src/app/components/NotificationsModal.svelte` with search, read/unread filter popover, scrollable content, current unread path rows, event-history rows, explicit mark-read controls, and empty states.
  - Updated `src/app/components/PrimaryNav.svelte` to place the bell under Explore on desktop and between Search and Settings/Profile on mobile.
  - Removed top-level primary-nav notification badges from Messages and Git while leaving lower-level badge code untouched.
- Phase 1 verification passed:
  - `pnpm vitest run src/app/util/notification-center.test.ts --project=main` passed: 1 file, 3 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
  - Pre-closeout inspected `git status --short --branch`, intended phase diff, and `git log --oneline -10 --decorate`.
- Phase 1 commit `a4aa1fb1` was pushed to `origin/dev`.
- Phase 1 closeout checkpoint commit `2bc74edb` was pushed to `origin/dev`.
- Phase 2 implemented core notification event rows:
  - Added `src/app/util/notification-display.ts` with row types, source/read/search filters, `createSearch`-backed search, and stable sorting.
  - Added `src/app/util/notification-sources.ts` with `TrustedEvent`-backed DM/chat rows, route fallback rows for unread paths without event rows, and derived unread row stores for the bell.
  - Added focused `src/app/util/notification-sources.test.ts` coverage for DM rows, path/history read-state handling, route fallback rows, and filters/search.
  - Updated `src/app/components/NotificationsModal.svelte` to render compact row cards with actor, timestamp, preview, path, source/read badges, source filters, and explicit event/path read handling on row click or mark-visible-read.
  - Updated `src/app/components/PrimaryNav.svelte` so the bell uses the notification-center unread derivation instead of the raw unread path set.
- Phase 2 verification passed:
  - `pnpm vitest run src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts --project=main` passed: 2 files, 7 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
  - Pre-closeout inspected `git status --short --branch`, intended phase source diff, and `git log --oneline -10 --decorate`.
- Phase 2 commit `617192f1` was pushed to `origin/dev`.
- Phase 3 implemented global community and git notification coverage:
  - Exported `repoWatchNotificationCandidates` from `src/app/util/repo-watch-notifications.ts` for reuse by the notification center.
  - Added global community event loading in `src/app/util/notification-sources.ts` using `activeUserCommunityRefs`, global member/moderator profile-list events, `communityMemberReportStates`, and each community's relays.
  - Added community row derivation for room messages, threads, calendar/goal targeting events, and access/profile-list updates with `canWriteCommunityTarget`, `isCommunityPersonBanned`, `getCommunityCensorReason`, and personal mute suppression.
  - Added repo-watch row derivation from watched repo candidates with readable labels for issues, PRs, comments, statuses, assignments, detail target paths, and `repoWatchSeenPath` metadata.
  - Updated `src/app/components/NotificationsModal.svelte` so mark-read and row-click set local checked timestamps and sync repo rows to `repoWatchNotificationSeen`.
  - Extended `src/app/util/notification-sources.test.ts` with community permission/moderation/mute coverage and repo-watch row/read-state coverage.
- Phase 3 verification passed:
  - `pnpm vitest run src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main` passed: 3 files, 13 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
  - Pre-closeout inspected `git status --short --branch`, intended phase source diff, and `git log --oneline -10 --decorate`.
- Phase 3 commit `9405a5d8` was pushed to `origin/dev`.
- Phase 4 startup reread this checkpoint and the full session plan, inspected a clean `dev...origin/dev` working tree, and confirmed current HEAD `9405a5d8`.
- Phase 4 implemented social notification coverage:
  - Added social source rows for mentions, replies, reactions, and zaps in `src/app/util/notification-sources.ts`.
  - Loaded social candidates by `#p`, loaded referenced target events, and validated zap receipts with `getValidZap` before showing zap rows in the live notification store.
  - Classified replies with Welshman `getReplyTags`/`getCommentTags` plus owned target events from repository context.
  - Suppressed reaction and zap false positives unless the referenced target event is owned by the signed-in user.
  - Used `zap.request.pubkey` as the zap actor and applied personal mute/self filters to social actors.
  - Collapsed reactions and zaps by target while preserving underlying event ids through `NotificationRow.eventIds`.
  - Added the Social filter/source label and updated modal read handling to mark every collapsed event id read.
  - Linked reply/mention rows to existing event/community routes rather than adding a new inline composer.
- Phase 4 verification passed:
  - `pnpm vitest run src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main` passed: 3 files, 15 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
  - Pre-closeout inspected `git status --short --branch`, intended phase source diff, and `git log --oneline -10 --decorate`.
- Phase 4 commit `d0a42dbc` was pushed to `origin/dev`.
- Phase 5 final verification and closeout completed:
  - Reread this checkpoint and the full session plan.
  - Inspected `git status --short --branch` and `git log --oneline -10 --decorate` at Phase 5 startup; branch was clean at `d0a42dbc` tracking `origin/dev`.
  - Reran all focused notification tests added during this workflow.
  - Reran the project check and whitespace diff check.
  - Updated this checkpoint to `Current Phase: Complete`.
- Phase 5 verification passed:
  - `pnpm vitest run src/app/util/notification-center.test.ts src/app/util/notification-sources.test.ts src/app/util/repo-watch-notifications.test.ts --project=main` passed: 3 files, 15 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.

## Decisions

- Use `docs/session-plan.md` and `docs/session-checkpoint.md` for durable state.
- The bell is the only top-level unread indicator; remove top-level badges from Messages and Git, but preserve lower-level badges/highlights.
- Persist notification history/read state as compact event ids/timestamps. Do not persist duplicated rich notification records.
- Runtime display descriptors may exist as presentation adapters, but source data remains `TrustedEvent` plus existing repository/context helpers.
- Explicit clearing only: opening the modal does not mark notifications read.
- No repost notifications; quote support remains low priority.
- Reuse Welshman repository/store/tag/filter/content/profile/zap/DM/search helpers and Budabit community moderation/permission helpers.
- Social zap rows use the zap request pubkey as actor identity instead of the receipt pubkey.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`, ahead by three commits at workflow startup before Phase 1 commit.
- Existing completed durable workflow files were replaced for this workflow.
- Phase 1 changed files: `docs/session-plan.md`, `docs/session-checkpoint.md`, `src/app/components/PrimaryNav.svelte`, `src/app/components/NotificationsModal.svelte`, `src/app/util/notification-center.ts`, and `src/app/util/notification-center.test.ts`.
- Phase 1 is verified, committed, pushed, and closed.
- Phase 2 changed files: `docs/session-checkpoint.md`, `src/app/components/NotificationsModal.svelte`, `src/app/components/PrimaryNav.svelte`, `src/app/util/notification-display.ts`, `src/app/util/notification-sources.ts`, and `src/app/util/notification-sources.test.ts`.
- Phase 2 is verified, committed, pushed, and closed.
- Phase 3 changed files: `docs/session-checkpoint.md`, `src/app/components/NotificationsModal.svelte`, `src/app/util/notification-display.ts`, `src/app/util/notification-sources.ts`, `src/app/util/notification-sources.test.ts`, and `src/app/util/repo-watch-notifications.ts`.
- Phase 3 is verified and closed by the current phase transition commit.
- Phase 4 changed files: `docs/session-checkpoint.md`, `src/app/components/NotificationsModal.svelte`, `src/app/util/notification-display.ts`, `src/app/util/notification-sources.ts`, and `src/app/util/notification-sources.test.ts`.
- Phase 4 is verified and closed by the current phase transition commit.
- Phase 5 changed files: `docs/session-checkpoint.md`.
- Phase 5 is verified and closed by the final closeout commit.

## Next Action

- Final response.

## Verification

- Startup ran `git status --short --branch` and `git remote -v`.
- Startup ran `git log --oneline -10 --decorate` and observed three local commits ahead of `origin/dev`.
- Startup read the old completed checkpoint and full old session plan.
- Phase 1 startup reread this checkpoint and the full session plan, then inspected `git status --short --branch`.
- Phase 1 focused test command passed.
- Phase 1 project check passed.
- Phase 1 whitespace check passed.
- Phase 1 pre-closeout inspected status, intended diff, and recent commits.
- Phase 1 commit `a4aa1fb1` was pushed to `origin/dev`.
- Phase 2 startup reread this checkpoint and the full session plan, then inspected `git status --short --branch` and `git log --oneline -10 --decorate`.
- Phase 2 focused test command passed.
- Phase 2 project check passed.
- Phase 2 whitespace check passed.
- Phase 2 pre-closeout inspected status, intended diff, and recent commits.
- Phase 2 commit `617192f1` was pushed to `origin/dev`.
- Phase 3 startup reread this checkpoint and the full session plan, then inspected `git status --short --branch` and `git log --oneline -10 --decorate`.
- Phase 3 focused test command passed.
- Phase 3 project check passed.
- Phase 3 whitespace check passed.
- Phase 3 pre-closeout inspected status, intended diff, and recent commits.
- Phase 4 startup reread this checkpoint and the full session plan, then inspected `git status --short --branch` and `git log --oneline -10 --decorate`.
- Phase 4 focused test command passed.
- Phase 4 project check passed.
- Phase 4 whitespace check passed.
- Phase 4 pre-closeout inspected status, intended diff, and recent commits.
- Phase 4 commit `d0a42dbc` was pushed to `origin/dev` and the checkpoint was reread.
- Phase 5 startup reread this checkpoint and the full session plan, then inspected `git status --short --branch` and `git log --oneline -10 --decorate`.
- Phase 5 focused test command passed.
- Phase 5 project check passed.
- Phase 5 whitespace check passed.

## Risks Or Blockers

- No current blocker.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/components/PrimaryNav.svelte`
- `src/app/components/NotificationsModal.svelte`
- `src/app/util/notification-center.ts`
- `src/app/util/notification-center.test.ts`
- `src/app/util/notification-display.ts`
- `src/app/util/notification-sources.ts`
- `src/app/util/notification-sources.test.ts`
- `src/app/util/repo-watch-notifications.ts`
