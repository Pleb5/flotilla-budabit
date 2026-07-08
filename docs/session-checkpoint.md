# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Make community-home smart widgets, especially the featured calendar events widget, load reliably after mobile backgrounding, session/auth expiry, stale relay sockets, and transient widget CDN failures.
- Improve host-side widget discovery/retry behavior first, then harden the host iframe lifecycle and calendar widget self-retry.

## Current Phase

- Phase 3: Calendar Widget Resume Retry

## Phase Exit Criteria

- The calendar widget tracks last successful data load or failed load state for capabilities, shared config, and calendar events.
- The widget retries stale or failed data loads on `pageshow`, visible `visibilitychange`, `focus`, and `online` when it has a current community context.
- Retry logic respects `contextSessionId` / `contextVersion` stale-response guards already present in the widget.
- The widget avoids duplicate concurrent reloads where practical.
- Calendar widget verification passes.
- Phase 3 changes are committed and pushed in the calendar widget repo, the Budabit checkpoint is advanced and pushed, and the checkpoint is reread.

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

## Next Action

- Start Phase 3 by adding retry bookkeeping and browser lifecycle listeners to `/home/johnd/Work/budabit-calendar-widget/src/App.svelte`.

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

## Risks Or Blockers

- Pre-existing unrelated dirty files in Budabit require careful staging.
- Cross-repo Phase 3 requires separate commits and pushes for the calendar widget repo and Budabit checkpoint.
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
