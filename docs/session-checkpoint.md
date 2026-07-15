# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Eliminate relay scheduler starvation and duplicate persistent traffic so community rooms, threads, calendar events, and goals load reliably.
- Complete the seven-phase plan in `docs/session-plan.md`, committing and pushing every verified phase.

## Current Phase

- Phase 2: Authentication And Adaptive Policy

## Phase Exit Criteria

- Required-auth waiters resolve only on terminal auth state, disconnect, or typed timeout and remain single-flight per socket session.
- Public relays never pre-authenticate.
- NIP-11 refreshes on first use/reconnect/periodic active use; policy tightening and controlled relaxation work.
- `max_limit` is represented and finite `arr too big` rejection retries once with a smaller group.
- Focused auth/policy/transport tests, `pnpm check`, and `git diff --check` pass.
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
- Phase 1 is verified and the checkpoint has advanced to Phase 2.

## Next Action

- Correct `waitForCommunityRelayAuth`, add realistic AuthState transition coverage, then implement refreshable/adaptive relay policy semantics.

## Verification

- Startup inspected checkpoint, full previous plan, status, branch/upstream, remotes, and recent commits.
- Phase 1: `pnpm install --frozen-lockfile --ignore-scripts` passed.
- Phase 1: focused Vitest passed, 2 files and 25 tests.
- Phase 1: `pnpm check` passed with no diagnostics.
- Phase 1: `git diff --check` passed.

## Risks Or Blockers

- No current blocker.
- Socket policy values still tighten monotonically during a session; Phase 2 must make controlled relaxation/reset explicit.
- Auth transition mocks currently do not prove nonterminal statuses are ignored.
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
