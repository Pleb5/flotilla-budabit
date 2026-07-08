# Session Plan

## Objective

- Make community-home smart widgets load reliably after mobile backgrounding, session/auth expiry, stale relay sockets, and transient widget CDN failures.
- Prioritize the calendar widget case while improving the host-side widget slot scheduler for all community-bound widgets.
- Preserve the existing extension permission and curation model: installed and enabled widgets must still be curated into the community slot before rendering.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Commit and push each verified phase before starting the next phase.
- Branch `dev` tracks `origin/dev`; inspect push state before each phase push.
- The calendar widget repository at `/home/johnd/Work/budabit-calendar-widget` tracks `origin/master` and is clean at planning time.
- Stage only files intentionally changed for this workflow. Do not stage existing unrelated modified files in `src/app/core/community-renunciations.ts`, `src/app/core/community-renunciations.test.ts`, `src/app/util/notifications.ts`, `src/app/util/notifications.test.ts`, or `src/routes/c/[community]/access/+page.svelte` unless the current repository state proves they became part of this objective.
- Prefer minimal host-side changes before changing widget-specific behavior.
- Preserve community widget security: no weakening permission checks, origin checks, sandboxing, or secure URL requirements.
- Keep checkpoints compact; put phase details here.

## Phase 1: Host Slot Discovery Recovery

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Prevent transient authenticated relay failures from permanently hiding community-home widgets until a manual refresh.

### Exit Criteria

- `loadCachedCommunityCuratedWidgets` supports explicit refresh and does not cache empty community results indefinitely.
- Failed, empty, and successful curation loads have bounded cache behavior that allows recovery without full page refresh.
- Community home widget slots retry discovery on browser resume/focus/online and can force-refresh stale empty results.
- Community action launcher slots use the same recovery behavior where practical.
- Existing selection semantics remain unchanged: curated widgets must match installed and enabled widgets for the requested slot.
- Focused tests cover cache reuse, forced refresh, and empty-result TTL behavior.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Extend `src/app/extensions/community-widget-slots.ts` with cache metadata, TTLs, and a `force` option.
- Keep in-flight request deduplication for normal loads.
- Add lifecycle-triggered reloads to `CommunityHomeWidgetSlot.svelte` and `CommunityWidgetSlotLaunchers.svelte` using `visibilitychange`, `pageshow`, `focus`, and `online`.
- Add or update focused unit tests in `community-widget-slots.test.ts`.

### Verification

- Run `pnpm vitest run src/app/extensions/community-widget-slots.test.ts --project=main`.
- Run `pnpm check` if Svelte components or shared types changed.
- Run `git diff --check`.
- Inspect root `git status`, `git diff`, and recent commits before committing.

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

## Phase 2: Host Widget Frame Lifecycle Recovery

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Recover inline widget iframes that stall or lose handshake after mobile resume or CDN/network hiccups.

### Exit Criteria

- `WidgetFrame` detects iframe load stalls and retries with bounded attempts.
- `WidgetFrame` retries unloaded or uninitialized widgets on browser resume/focus/online without weakening origin or sandbox behavior.
- Widget context and theme posting still happens only after load/bridge setup and remains compatible with the existing `widget:ready` handshake.
- Visible fallback state gives users a retry path after bounded automatic retry attempts.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Add a small load watchdog and retry counter to `src/app/components/WidgetFrame.svelte`.
- Retry the current app URL with a cache-busting nonce after stalls; preserve fallback app URL behavior.
- Add lifecycle listeners for `pageshow`, visible `visibilitychange`, `focus`, and `online` to retry only when needed.
- Keep `ExtensionBridge` detach/setup behavior intact unless current code proves a minimal bridge fix is necessary.

### Verification

- Run `pnpm check`.
- Run `git diff --check`.
- Inspect root `git status`, `git diff`, and recent commits before committing.

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

## Phase 3: Calendar Widget Resume Retry

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state in both `/home/johnd/Work/budabit` and `/home/johnd/Work/budabit-calendar-widget` before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Make the featured calendar events widget retry its host bridge data loads after mobile backgrounding, request timeout, or restored network connectivity.

### Exit Criteria

- The calendar widget tracks last successful data load or failed load state for capabilities, shared config, and calendar events.
- The widget retries stale or failed data loads on `pageshow`, visible `visibilitychange`, `focus`, and `online` when it has a current community context.
- Retry logic respects `contextSessionId` / `contextVersion` stale-response guards already present in the widget.
- The widget avoids duplicate concurrent reloads where practical.
- Calendar widget verification passes.
- Phase 3 changes are committed and pushed in the calendar widget repo, the Budabit checkpoint is advanced and pushed, and the checkpoint is reread.

### Steps

- Modify `/home/johnd/Work/budabit-calendar-widget/src/App.svelte` with minimal retry bookkeeping and browser lifecycle listeners.
- Reuse existing `refreshCalendarCapabilities`, `loadSharedConfig`, and `loadCalendarEvents` instead of adding new bridge APIs.
- Run the calendar widget's local check command.
- Commit and push the calendar widget repo separately, then update and commit/push the Budabit checkpoint.

### Verification

- In `/home/johnd/Work/budabit-calendar-widget`, run `pnpm check`.
- In `/home/johnd/Work/budabit-calendar-widget`, run `git diff --check`.
- In `/home/johnd/Work/budabit`, run `git diff --check`.
- Inspect status, diff, and recent commits in both repos before committing.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files and both repository commits when applicable.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase. For this cross-repo phase, commit/push the calendar widget code and the Budabit checkpoint update separately. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 4: Final Verification And Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Run final verification, ensure checkpoint completeness, and close the durable workflow.

### Exit Criteria

- Host targeted widget-slot tests pass after all changes.
- Host `pnpm check` passes.
- Calendar widget `pnpm check` passes after all changes.
- `git diff --check` passes in every touched repository.
- Final diff review shows only intentional files for this workflow plus pre-existing unrelated dirty files are not staged.
- Checkpoint records `Current Phase: Complete` and final verification evidence.
- Final closeout commit is pushed before final response.

### Steps

- Rerun host targeted widget-slot tests.
- Run host full Svelte/TypeScript project check.
- Rerun calendar widget check.
- Inspect final diffs and status in touched repositories.
- Update checkpoint to `Complete` with evidence and residual risks.

### Verification

- In `/home/johnd/Work/budabit`, run `pnpm vitest run src/app/extensions/community-widget-slots.test.ts --project=main`.
- In `/home/johnd/Work/budabit`, run `pnpm check`.
- In `/home/johnd/Work/budabit`, run `git diff --check`.
- In `/home/johnd/Work/budabit-calendar-widget`, run `pnpm check`.
- In `/home/johnd/Work/budabit-calendar-widget`, run `git diff --check`.
- Inspect status, diff, and recent commits before committing.

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
