# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Correct the notification center so it excludes standalone social-media notifications and uses only Budabit/community/git/chat contexts.
- Remove generic kind `1`, kind `7`, repost, and generic zap-receipt notification derivation from the notification center.
- Replace per-event read/unread state with a global notification-tab timestamp unread flag.
- Update the modal UI, filters, search, and avatar behavior as requested.
- Complete three code-review/improvement cycles before final closeout.

## Current Phase

- Phase 1: Source Scope And Global Read State

## Phase Exit Criteria

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

## Completed With Evidence

- Previous notification-center workflow completed at commit `a303d660` and left the branch clean on `dev...origin/dev`.
- New correction workflow startup reread the completed checkpoint and full prior session plan.
- Startup inspection found `/home/johnd/Work/budabit` on clean `dev...origin/dev` at `a303d660`.
- Startup inspected current notification center source, display, modal, primary nav, community message/thread helpers, git issue search patterns, profile modal usage, and available icons.

## Decisions

- Treat this as a new durable workflow because the prior checkpoint says `Complete`.
- Use `docs/session-plan.md` and `docs/session-checkpoint.md` for this correction workflow.
- Do not add standalone social-media notification rows.
- Kind `1`, kind `7`, reposts, and generic zap receipts must not be notification-center source kinds.
- Keep community-context reply support limited to existing Budabit/community kinds already used by the app.
- Use global timestamp read state for the notification tab unread flag; do not display row read/unread state.
- Run and record three review/improvement cycles before final completion.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Starting HEAD: `a303d660`.
- Worktree was clean at workflow startup.
- Existing notification code still contains the previous social source and per-event read state before Phase 1 implementation.

## Next Action

- Phase 1 startup: reread this checkpoint and the full session plan, inspect current git state, then implement source scope and global read-state corrections.

## Verification

- Startup ran `git status --short --branch`.
- Startup ran `git log --oneline -10 --decorate`.
- Startup read prior completed checkpoint and full prior session plan.
- Startup inspected relevant implementation files before replacing this plan/checkpoint.

## Risks Or Blockers

- No current blocker.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/util/notification-center.ts`
- `src/app/util/notification-center.test.ts`
- `src/app/util/notification-display.ts`
- `src/app/util/notification-sources.ts`
- `src/app/util/notification-sources.test.ts`
- `src/app/components/NotificationsModal.svelte`
- `src/app/components/PrimaryNav.svelte`
