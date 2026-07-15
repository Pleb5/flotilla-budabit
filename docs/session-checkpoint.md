# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Eliminate relay scheduler starvation and duplicate persistent traffic so community rooms, threads, calendar events, and goals load reliably.
- Complete the seven-phase plan in `docs/session-plan.md`, committing and pushing every verified phase.

## Current Phase

- Phase 3: Community Discovery And Completeness

## Phase Exit Criteria

- Community startup finitely discovers historical room/thread roots and targeting wrappers after authority bootstrap.
- Existing calendar/goal wrappers trigger exact finite original hydration.
- Feature loaders and route states distinguish complete, incomplete, failed, queued, and loading evidence where absence decisions depend on it.
- Calendar/goal timeout does not mark hydration complete; details do not claim not-found after incomplete reads.
- Failed auth relays remain isolated and room authorization rules agree.
- Focused community/feature tests, `pnpm check`, and `git diff --check` pass.
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
- Phases 1 and 2 are verified; the checkpoint has advanced to Phase 3.

## Next Action

- Add finite community root/targeting-wrapper discovery and trace complete/incomplete state through calendar, goal, thread, and room empty-state decisions.

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

## Risks Or Blockers

- No current blocker.
- Route feature loaders currently conflate timeout/abort with complete empty results; Phase 3 must avoid broad UI rewrites while correcting authoritative absence decisions.
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
