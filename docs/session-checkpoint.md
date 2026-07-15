# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Eliminate relay scheduler starvation and duplicate persistent traffic so community rooms, threads, calendar events, and goals load reliably.
- Complete the seven-phase plan in `docs/session-plan.md`, committing and pushing every verified phase.

## Current Phase

- Phase 1: Starvation-Free Scheduler And Baseline

## Phase Exit Criteria

- Scheduler distinguishes finite, critical-live, and background-live work.
- Public and unknown defaults use a direct 9-ID/5-filter baseline; public live/background-live caps are 7/5.
- Finite work always retains progress capacity; oversized live requests fail before partial installation.
- Focused scheduler/policy tests, `pnpm check`, and `git diff --check` pass.
- Phase changes and checkpoint advancement are committed and pushed.

## Completed With Evidence

- Previous Welshman `0.8.16` upgrade workflow was complete before this plan started.
- Existing relay scheduling/community loading work is committed through `45f97bd0`.
- Full verification before this workflow passed: 275 test files, 2,246 tests, and `pnpm check` with no diagnostics.
- Investigation traced the missing-content failure to non-preemptive persistent live slots plus timeout-as-empty route behavior.

## Decisions

- Use a direct `9/5/2` scheduler model for the public relay: 9 managed IDs, 5 filters per ID, at most 7 live IDs, at most 5 background-live IDs.
- Separate lifetime from priority; priority alone cannot prevent starvation.
- Keep finite historical activity exact and background-priority because UI counts depend on full history.
- Preserve unrelated modified files under `packages/nostr-git-core/`.
- Push verified phase commits to the tracked `origin/dev` branch.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev` and initially ahead by 10 commits.
- Unrelated worktree changes exist only under `packages/nostr-git-core/`.
- The current Welshman patch has priority scheduling and live slot retention but no lifetime class caps or atomic live admission.

## Next Action

- Read the current Welshman request patch/installed implementation and implement lifetime-aware scheduler accounting plus starvation regression tests.

## Verification

- Startup inspected checkpoint, full previous plan, status, branch/upstream, remotes, and recent commits.
- No implementation verification has run for Phase 1 yet.

## Risks Or Blockers

- No current blocker.
- The pnpm patch targets compiled Welshman `dist`; patch hash/application must be refreshed carefully.
- Existing unrelated `nostr-git-core` changes must remain unstaged.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `patches/@welshman__net@0.8.16.patch`
- `pnpm-lock.yaml`
- `src/app/core/welshman-request-patch.test.ts`
- `src/app/core/relay-policy.ts`
- `src/app/core/relay-policy.test.ts`
