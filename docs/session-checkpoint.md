# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Make community-home smart widgets, especially the featured calendar events widget, load reliably after mobile backgrounding, session/auth expiry, stale relay sockets, and transient widget CDN failures.
- Improve host-side widget discovery/retry behavior first, then harden the host iframe lifecycle and calendar widget self-retry.

## Current Phase

- Complete

## Phase Exit Criteria

- Host targeted widget-slot tests passed after all changes.
- Host `pnpm check` passed.
- Calendar widget `pnpm check` passed after all changes.
- `git diff --check` passed in every touched repository.
- Final diff review showed no staged files and only pre-existing unrelated dirty Budabit files outside this workflow.
- Checkpoint records `Current Phase: Complete` and final verification evidence.
- Final closeout commit is pushed before final response.

## Completed With Evidence

- Previous session files described a completed community-renunciation workflow and were replaced for this widget-loading reliability workflow.
- Startup inspection found `/home/johnd/Work/budabit` on `dev...origin/dev` and `/home/johnd/Work/budabit-calendar-widget` on `master...origin/master`.
- Startup inspection found pre-existing unrelated Budabit modifications in community-renunciation, notifications, and community access files; these must not be staged for this workflow.
- Phase 1 implemented host slot discovery recovery:
  - Added bounded cache metadata to `loadCachedCommunityCuratedWidgets`, including explicit force refresh, short TTL for empty/non-community results, and longer TTL for non-empty community results.
  - Preserved in-flight request deduplication for normal cache loads and eviction on thrown errors.
  - Added `pageshow`, `focus`, `online`, and visible `visibilitychange` force-refresh triggers to `CommunityHomeWidgetSlot.svelte` and `CommunityWidgetSlotLaunchers.svelte`.
  - Kept installed/enabled/curated slot selection semantics unchanged.
- Phase 1 verification passed:
  - `pnpm vitest run src/app/extensions/community-widget-slots.test.ts --project=main` passed: 1 file, 8 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
- Phase 2 implemented host widget frame lifecycle recovery:
  - Added an iframe load watchdog in `WidgetFrame.svelte` with bounded automatic retries and cache-busted retry URLs.
  - Added `pageshow`, `focus`, `online`, and visible `visibilitychange` recovery hooks for unloaded or uninitialized frames.
  - Preserved existing iframe sandbox and origin checks; context/theme posting still happens through the existing load/ready bridge path.
  - Added a visible `Retry widget` fallback after automatic retries are exhausted.
- Phase 2 verification passed:
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
- Phase 3 implemented calendar widget resume retry in `/home/johnd/Work/budabit-calendar-widget`:
  - Added per-load success timestamps and failure flags for write capabilities, shared config, and calendar events.
  - Added concurrency guards so lifecycle recovery skips already running loads.
  - Added `pageshow`, `focus`, `online`, and visible `visibilitychange` retry triggers for stale or failed data loads with a current community context.
  - Kept existing `contextSessionId` / `contextVersion` stale-response guards around all response handling.
- Phase 3 verification passed:
  - Calendar widget `pnpm check` passed with 0 errors and 0 warnings, including production build.
  - Calendar widget `git diff --check` passed.
  - Budabit `git diff --check` passed.
- Phase 4 final verification passed:
  - Host `pnpm vitest run src/app/extensions/community-widget-slots.test.ts --project=main` passed: 1 file, 8 tests.
  - Host `pnpm check` passed with 0 errors and 0 warnings.
  - Calendar widget `pnpm check` passed with 0 errors and 0 warnings, including production build.
  - Budabit `git diff --check` passed.
  - Calendar widget `git diff --check` passed.
  - Final status/diff review found `/home/johnd/Work/budabit-calendar-widget` clean, no staged files in either repo, and only known unrelated dirty Budabit files remaining.

## Decisions

- Use `docs/session-plan.md` and `docs/session-checkpoint.md` for durable state.
- Treat transient empty curation results as recoverable rather than durable proof that no widgets exist.
- Keep widget permission, origin, sandbox, and secure URL policies intact.
- Include the separate calendar widget repo in Phase 3 because it has a clean upstream branch.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Calendar widget repository: `/home/johnd/Work/budabit-calendar-widget`, branch `master`, tracking `origin/master`.
- Known unrelated dirty Budabit files at startup: `src/app/core/community-renunciations.test.ts`, `src/app/core/community-renunciations.ts`, `src/app/util/notifications.test.ts`, `src/app/util/notifications.ts`, and `src/routes/c/[community]/access/+page.svelte`.
- Additional unrelated dirty Budabit files observed before Phase 1 closeout: `src/app/core/community-live.ts`, `src/app/core/requests.ts`, `src/routes/c/[community]/+layout.svelte`, `src/routes/c/[community]/calendar/+page.svelte`, `src/routes/c/[community]/goals/+page.svelte`, `src/routes/c/[community]/rooms/[room]/+page.svelte`, `src/routes/c/[community]/threads/+page.svelte`, and `src/app/core/community-live.test.ts`.
- Phase 1 changed files: `docs/session-plan.md`, `docs/session-checkpoint.md`, `src/app/extensions/community-widget-slots.ts`, `src/app/extensions/community-widget-slots.test.ts`, `src/app/components/community/CommunityHomeWidgetSlot.svelte`, and `src/app/components/community/CommunityWidgetSlotLaunchers.svelte`.
- Additional unrelated dirty Budabit files observed before Phase 2 closeout: `src/app/core/community-feeds.ts`, `src/app/core/community-feeds.test.ts`, `src/routes/c/[community]/calendar/[event]/+page.svelte`, `src/routes/c/[community]/goals/[goal]/+page.svelte`, and `src/routes/c/[community]/threads/[thread]/+page.svelte`.
- Phase 2 changed files: `docs/session-checkpoint.md` and `src/app/components/WidgetFrame.svelte`.
- Phase 3 changed files: `/home/johnd/Work/budabit-calendar-widget/src/App.svelte` and Budabit `docs/session-checkpoint.md`.
- Phase 3 calendar widget commit `2e6d005` was pushed to `origin/master`.
- Phase 3 Budabit checkpoint commit `39e4f27f` was pushed to `origin/dev`.
- Phase 4 changed files: Budabit `docs/session-checkpoint.md`.

## Next Action

- Final response.

## Verification

- Startup read the prior completed checkpoint and full prior session plan.
- Startup inspected Budabit `git status --short --branch`, `git remote -v`, and `git log --oneline -10`.
- Startup inspected calendar widget `git status --short --branch`, `git remote -v`, and `git log --oneline -5`.
- Phase 1 startup reread this checkpoint and the full session plan, then inspected `git status --short --branch`.
- Phase 1 focused tests passed.
- Phase 1 project check passed.
- Phase 1 whitespace check passed.
- Phase 1 pre-closeout inspected `git status --short --branch`, the intended phase diff, and `git log --oneline -10`.
- Phase 1 commit `30d75c26` was pushed to `origin/dev`.
- Phase 2 startup reread this checkpoint and the full session plan, then inspected `git status --short --branch`.
- Phase 2 project check passed.
- Phase 2 whitespace check passed.
- Phase 2 pre-closeout inspected `git status --short --branch`, the intended phase diff, and `git log --oneline -10`.
- Phase 2 commit `cf3b8d2d` was pushed to `origin/dev`.
- Phase 3 startup reread this checkpoint and the full session plan, then inspected Budabit and calendar widget `git status --short --branch`.
- Phase 3 calendar widget project check passed.
- Phase 3 calendar widget whitespace check passed.
- Phase 3 Budabit whitespace check passed.
- Phase 3 pre-closeout inspected calendar widget status, diff, and recent commits before committing, then inspected Budabit status, checkpoint diff, and recent commits before committing the checkpoint.
- Phase 4 startup reread this checkpoint and inspected Budabit and calendar widget `git status --short --branch`.
- Phase 4 host targeted widget-slot tests passed.
- Phase 4 host project check passed.
- Phase 4 calendar widget project check passed.
- Phase 4 whitespace checks passed in both touched repositories.
- Phase 4 final status/diff review confirmed no staged files and no remaining workflow diffs outside this checkpoint update.

## Risks Or Blockers

- Pre-existing unrelated dirty files in Budabit remain outside this workflow.
- No current blocker.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/extensions/community-widget-slots.ts`
- `src/app/extensions/community-widget-slots.test.ts`
- `src/app/components/community/CommunityHomeWidgetSlot.svelte`
- `src/app/components/community/CommunityWidgetSlotLaunchers.svelte`
- `src/app/components/WidgetFrame.svelte`
- `/home/johnd/Work/budabit-calendar-widget/src/App.svelte`
