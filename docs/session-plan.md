# Session Plan

## Objective

- Improve Git UX and performance by bounding repo-watch notification work, adding visible repo-card navigation feedback, reducing stale Git route loads, and bounding Git Natural in-memory cache growth.

## Constraints

- Preserve current route/path semantics and existing notification path identifiers.
- Prefer minimal changes in existing functions over large rewrites.
- Commit and push each verified phase before starting the next phase.
- Use current repository state as authoritative over this plan.
- Keep `docs/session-checkpoint.md` compact and update it before every phase commit.

## Phase 1: Bounded Repo-Watch Notifications

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Make repo-watch notification hydration/subscriptions bounded and scoped so old events do not flood users or keep stale requests alive.

### Exit Criteria

- Watched repo announcements are still discovered from base/user/git relays.
- After repo announcements are found, repo activity/root subscriptions use only repo-declared relays, not base relays.
- Repo-watch notification seen timestamps are stored in app-data-backed repo-watch state and missing watched repo paths are initialized to the current timestamp.
- Repo-watch load filters include a bounded `since` and hard `limit`; live request filters stay bounded and use abort signals.
- Stale repo-watch `load()` calls are aborted when filters or relays change.
- Existing notification path checks still work with local `checked` timestamps and the new app-data seen timestamps.
- Focused repo-watch tests pass.

### Steps

- Extend repo-watch app-data state with a notification seen map and update helpers.
- Update repo-watch notification derivations to baseline missing paths, bound filters by seen timestamps, and use strict repo activity relays.
- Ensure route-level repo issue/PR seen writes also update repo-watch app-data seen timestamps when applicable.
- Add or update focused tests for normalization and notification behavior.

### Verification

- Run focused repo-watch notification tests.
- Run focused repo-watch state tests if changed.
- Run type/check only if changes require it and time permits.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 2: Git Route Navigation And Load Cleanup

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Improve perceived `/git` and repo-card navigation responsiveness and avoid stale non-critical loads after route changes.

### Exit Criteria

- Repo cards show an immediate pending/disabled visual state during navigation from both `GitItem.svelte` and `/git/+page.svelte` wrapper cards.
- Repo card navigation failures clear pending state and surface the existing toast/error behavior.
- Non-critical `/git` repo-card evidence/profile loads are deferred until cards are rendered and are abortable or ignored after route destruction.
- Existing `/git` search/list rendering semantics are preserved.
- Focused Svelte check or suitable verification passes.

### Steps

- Add pending navigation state to repo cards without changing href generation.
- Defer repo-card evidence/profile hydration with timers and abort controllers where supported.
- Ensure cleanup on `/git` route destroy cancels pending timers/controllers.
- Keep changes local to Git list/card files unless evidence shows a route layout change is required.

### Verification

- Run a focused Svelte/type check or the smallest reliable project check available.
- Inspect diff for route/path stability.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 3: Git Natural Cache Bounds

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Bound Git Natural in-memory cache growth so Git/PR browsing does not retain unbounded object data.

### Exit Criteria

- Natural read cache in-memory object storage has deterministic count and byte limits.
- Eviction preserves recent reads and removes least-recently-used entries when limits are exceeded.
- IndexedDB durable cache behavior remains compatible with existing call sites.
- Lightweight diagnostics or tests cover cache insertion, hit refresh, and eviction.
- Focused nostr-git-core tests pass.

### Steps

- Inspect current Natural cache implementation and tests.
- Add minimal LRU accounting to in-memory cache maps.
- Keep durable IndexedDB limits unchanged unless evidence shows a bug.
- Add focused tests if an existing test harness covers the cache.

### Verification

- Run focused nostr-git-core tests for the cache, or the package test command if focused tests are not available.
- Inspect diff for accidental API changes.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
