# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Eliminate relay scheduler starvation and duplicate persistent traffic so community rooms, threads, calendar events, and goals load reliably.
- Complete the seven-phase plan in `docs/session-plan.md`, committing and pushing every verified phase.

## Current Phase

- Phase 4: Activity Coordinator And Immediate Duplicates

## Phase Exit Criteria

- `EventActivity` is repository-driven with one route-scoped coordinator for finite history and grouped live references.
- Core community `COMMENT #h` coverage suppresses duplicate activity live IDs.
- Group replacement uses fixed route `since`, overlap, cleanup, and make-before-break behavior.
- `CommunityMenu` opens no room-root live request and Git issue-label prefetch is finite.
- One hundred covered components add zero persistent IDs; uncovered compatible components remain bounded.
- Focused activity/menu/issue tests, `pnpm check`, and `git diff --check` pass.
- Phase changes and checkpoint advancement are committed and pushed.

## Completed With Evidence

- Previous Welshman `0.8.16` upgrade workflow was complete before this plan started.
- Existing relay scheduling/community loading work is committed through `45f97bd0`.
- Full verification before this workflow passed: 275 test files, 2,246 tests, and `pnpm check` with no diagnostics.
- Investigation traced the missing-content failure to non-preemptive persistent live slots plus timeout-as-empty route behavior.
- Phase 1 implemented lifetime-aware scheduling in the Welshman patch:
  - Finite, critical-live, and background-live accounting is separate.
  - Persistent logical requests are admitted atomically; oversized groups throw `RequestAdmissionError` before any REQ.
  - Finite chunks retain wave scheduling and receive bounded queue-age priority boosts.
  - `onStart` reports physical request admission.
- Phase 1 changed public and unknown defaults to direct 9 IDs, 5 filters, 7 live IDs, 5 background-live IDs, critical threshold 200, and 128 KiB; stricter NIP-11 limits win.
- Phase 1 verification passed:
  - Frozen-lockfile install succeeded.
  - Focused scheduler/policy tests passed: 2 files, 25 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
- Phase 2 corrected required authentication:
  - Nonterminal auth states are ignored by the terminal waiter.
  - Typed timeout and socket failure reject the waiter.
  - Concurrent callers share one socket promise; signer rejection becomes `DeniedSignature`; a new challenge can retry.
  - Public `auth:none` relays do not create an auth socket/attempt.
- Phase 2 added relay policy adaptation:
  - First use refreshes NIP-11 without blocking, active use refreshes hourly, and reconnect forces refresh.
  - NIP-11 `max_limit` is exposed as `maxLimit`.
  - Resolver policy and per-request limits are separated so idle/reconnect policy relaxation is possible; overflow learning resets on reconnect.
  - Finite array-size rejection repartitions once; live rejection closes the logical request.
- Phase 2 verification passed:
  - Frozen-lockfile install succeeded.
  - Focused auth/policy/transport tests passed: 3 files, 62 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
- Phase 3 added finite post-bootstrap discovery for `THREAD #h`, recent messages, and calendar/goal targeting wrappers; incomplete discovery retries with bounded delay.
- Phase 3 added status-aware hydration states and completion-only hydration caching, preserving partial events and distinguishing queued/loading/incomplete/failed reads.
- Phase 3 exact wrapper follow-up includes referenced relay hints and publishes through the shared repository.
- Phase 3 corrected calendar/feed timeout completion and updated room/thread/calendar/goal list/detail empty states so incomplete reads are retryable rather than authoritative absence.
- Phase 3 aligned CommunityMenu room filtering with approved room authors and made historical route requests explicitly finite/interactive.
- Phase 3 verification passed:
  - Focused community state/live/feed/room/thread/calendar tests passed: 6 files, 48 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.

## Decisions

- Use a direct `9/5/2` scheduler model for the public relay: 9 managed IDs, 5 filters per ID, at most 7 live IDs, at most 5 background-live IDs.
- Separate lifetime from priority; priority alone cannot prevent starvation.
- Keep finite historical activity exact and background-priority because UI counts depend on full history.
- Preserve unrelated modified files under `packages/nostr-git-core/`.
- Push verified phase commits to the tracked `origin/dev` branch.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Unrelated worktree changes exist only under `packages/nostr-git-core/`.
- Phases 1 through 3 are verified; the checkpoint has advanced to Phase 4.

## Next Action

- Implement the route-scoped activity coordinator, convert `EventActivity` to repository consumption, then remove menu live ownership and make issue-label prefetch finite.

## Verification

- Startup inspected checkpoint, full previous plan, status, branch/upstream, remotes, and recent commits.
- Phase 1: `pnpm install --frozen-lockfile --ignore-scripts` passed.
- Phase 1: focused Vitest passed, 2 files and 25 tests.
- Phase 1: `pnpm check` passed with no diagnostics.
- Phase 1: `git diff --check` passed.
- Phase 2: `pnpm install --frozen-lockfile --ignore-scripts` passed.
- Phase 2: focused Vitest passed, 3 files and 62 tests.
- Phase 2: `pnpm check` passed with no diagnostics.
- Phase 2: `git diff --check` passed.
- Phase 3: focused Vitest passed, 6 files and 48 tests.
- Phase 3: `pnpm check` passed with no diagnostics.
- Phase 3: `git diff --check` passed.

## Risks Or Blockers

- No current blocker.
- `EventActivity` still creates one or three persistent requests per mounted item until Phase 4 replaces ownership.
- Existing unrelated `nostr-git-core` changes must remain unstaged.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `patches/@welshman__net@0.8.16.patch`
- `pnpm-lock.yaml`
- `src/app/core/welshman-request-patch.test.ts`
- `src/app/core/relay-policy.ts`
- `src/app/core/relay-policy.test.ts`
- `src/app/core/community-state.ts`
- `src/app/core/community-state-loading.test.ts`
- `src/app/core/community-live.ts`
- `src/routes/c/[community]/+layout.svelte`
- `src/routes/c/[community]/calendar/+page.svelte`
- `src/routes/c/[community]/calendar/[event]/+page.svelte`
- `src/routes/c/[community]/goals/+page.svelte`
- `src/routes/c/[community]/goals/[goal]/+page.svelte`
- `src/routes/c/[community]/threads/[thread]/+page.svelte`
- `src/routes/c/[community]/rooms/[room]/+page.svelte`
- `src/app/core/event-activity-io.ts`
- `src/app/core/event-activity-io.test.ts`
- `src/app/components/EventActivity.svelte`
- `src/app/components/CommunityMenu.svelte`
- `src/routes/git/[id=naddr]/issues/+page.svelte`
