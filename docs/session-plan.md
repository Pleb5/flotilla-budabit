# Session Plan

## Objective

- Improve community boot and hard-reload behavior so community relay auth, permissions, moderator state, shared config, and moderation evidence load in priority order.
- Preserve cached/warm-start rendering where it is safe; do not gate every page behind fresh relay data.
- Prevent misleading UI states caused by incomplete high-priority data, including false moderator invite CTAs, premature empty feed states, empty shared config responses, and false unreviewed application/report counts.
- Keep non-critical data progressive and cache-first, with copy such as "loading permissions" or "loading review evidence" when state is intentionally incomplete.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Branch `dev` tracks `origin/dev` and is the implementation target.
- Stage only files intentionally changed for each phase.
- Never revert unrelated user changes. If unrelated changes appear in files needed by a phase, stop and ask.
- Do not use notifier relay config as community-relay authority; `VITE_NOTIFIER_HANDLER_RELAY` is alert/notifier config.
- Use cached state where it is safe and useful. Prefer cache-first plus prioritized refresh over absolute fresh-relay gates.
- Do not add broad additive relay subscription work unless directly required by the current phase.
- Every phase must be verified, checkpointed, committed, pushed, and followed by rereading the checkpoint before continuing.

## Phase 1: Priority Community Relay Auth

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Give community relays a bounded auth head start sourced only from community session/default community data.

### Exit Criteria

- `authenticateCommunityRelays` supports priority relay ordering and bounded timeouts.
- Root boot warms active/default community relays using community config only, not notifier config.
- Community bootstrap waits for a bounded auth head start on community definition relays before marking bootstrap ready.
- Focused tests cover priority auth ordering and bootstrap waiting before content loads.
- `pnpm exec vitest run src/app/core/community-state-loading.test.ts` passes.
- `pnpm run check` passes.
- `git diff --check` passes.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect current community relay/auth bootstrap code and existing worktree changes.
- Centralize priority auth ordering in `src/app/core/community-state.ts`.
- Wire warm-up in `src/routes/+layout.svelte` using active/default community relay hints.
- Add focused tests in `src/app/core/community-state-loading.test.ts`.

### Verification

- Run `pnpm exec vitest run src/app/core/community-state-loading.test.ts`.
- Run `pnpm run check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10` before committing.

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

## Phase 2: Permission And Moderator Readiness

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Prioritize the permission graph and current-user moderator evidence while preserving cached UI when available.

### Exit Criteria

- Community profile-list/permission loads are explicitly prioritized after definition/auth and before low-priority feeds.
- Current-user moderator invite evidence has a readiness/loading state and does not show an accept/decline CTA merely because profile-list evidence has not loaded yet.
- Publish/access gates show loading copy while higher-priority permission/application state is incomplete instead of prematurely showing access CTAs or unavailable states.
- Feed pages and community-home actions that depend on permissions respect the high-priority loading state without blocking already-cached content from rendering.
- Focused tests cover moderator invite evidence readiness or permission gate readiness where practical.
- `pnpm run check` passes.
- `git diff --check` passes.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect `CommunityMenu.svelte`, `PublishGate.svelte`, community home, and relevant permission stores.
- Add compact readiness state in `community-state.ts` only where needed to distinguish cached-known, loading, and settled-empty evidence.
- Load active community profile lists and current-user moderator invite evidence before lower-priority home/feed empties.
- Adjust copy/disabled states on community home and publish gates.
- Add focused tests around newly extracted readiness helpers if UI-only behavior is otherwise hard to unit test.

### Verification

- Run focused tests for changed helpers/components where available.
- Run `pnpm run check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10` before committing.

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

## Phase 3: Shared Config And Widget Loads

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Prevent extension shared-config queries from returning successful empty state when required community data or auth is still loading.

### Exit Criteria

- `community:querySharedConfig` is cache-first from the local repository when possible.
- Shared config bridge loads use prioritized community auth and do not silently convert auth/loading timeouts into successful empty config.
- Widget community context changes when permission/profile-list/report readiness changes so widgets get a retry signal when high-priority data becomes available.
- Calendar featured-event widget loads no longer wait for a stale-success empty config cycle when host data was not ready.
- Focused bridge tests cover shared config loading/not-ready behavior.
- `pnpm exec vitest run src/app/extensions/bridge.test.ts` passes.
- `pnpm run check` passes.
- `git diff --check` passes.
- Phase 3 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect `src/app/extensions/bridge.ts`, `WidgetFrame.svelte`, and community widget context producers.
- Return a not-ready error for shared-config loads when prerequisite snapshot/profile-list auth work times out, while preserving true empty config when loads have settled.
- Reuse cached repository events for `kind:30078` before network refresh.
- Add tests for latest moderator-authored shared config and not-ready behavior.

### Verification

- Run `pnpm exec vitest run src/app/extensions/bridge.test.ts`.
- Run `pnpm run check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10` before committing.

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

## Phase 4: Moderation Evidence Ordering

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Load moderation responses and review/delete evidence in an order that avoids false unreviewed/new states.

### Exit Criteria

- Moderation page and menu counts distinguish loading review/delete evidence from truly unreviewed/new applications or reports.
- Application responses can render from cache, but warnings/counts for “new” are withheld or labeled loading until matching review/delete evidence has settled.
- Report moderation counts do not show false pending states while report review/delete evidence is still loading.
- Relevant copy says review/moderation evidence is loading instead of showing premature empty or unreviewed state.
- Focused tests cover any extracted admission/moderation readiness helpers where practical.
- `pnpm run check` passes.
- `git diff --check` passes.
- Phase 4 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect `routes/c/[community]/moderation/+page.svelte`, `CommunityMenu.svelte`, and admission/report helper tests.
- Split response loading from review/delete evidence loading where needed.
- Gate warning badges/counts and unreviewed groups on evidence readiness, while still displaying cached data with loading copy.
- Add focused tests if helper logic is extracted.

### Verification

- Run focused admission/report tests touched by helper changes.
- Run `pnpm run check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10` before committing.

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

## Phase 5: Feed Empty-State Audit And Final Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Audit feed pages and final behavior so higher-priority loading states do not produce premature empty UI.

### Exit Criteria

- Community home rooms, threads, calendar, goals, git/community routes, widgets, publish gates, moderation, and menu badges have been inspected for premature empty/CTA states against the new readiness behavior.
- Any necessary copy adjustments are made so users see specific loading states rather than false empty states.
- Final focused tests and `pnpm run check` pass.
- `git diff --check` passes.
- Checkpoint records `Current Phase: Complete` and final evidence.
- Final closeout commit is pushed before final response if files changed.

### Steps

- Inspect all `/c/[community]` feed pages and community menu/home widget locations.
- Make minimal copy/readiness adjustments for any missed high-priority loading state.
- Run final focused tests, Svelte/TS check, and diff check.
- Update checkpoint to `Complete` with evidence and residual risks.

### Verification

- Run focused tests changed during the workflow.
- Run `pnpm run check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10` before committing.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to `Complete`.
  - Set `Phase Exit Criteria` to final completion criteria.
  - Set `Next Action` to final response.
  - Record any remaining risks or blockers.
- Commit and push checkpoint updates if files changed in this phase.
- Read the session checkpoint again to verify `Current Phase: Complete`.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
