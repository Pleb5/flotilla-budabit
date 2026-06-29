# Session Plan

## Objective

- Fix the Settings > Extensions widget preview regression comprehensively while keeping context-aware preview behavior.
- Make the modal preview usable without cropping, header overlap, or padding that visually extends the header area.
- Prefer host-side layout and resize fixes over widget-specific scrollbar workarounds, because the deployed calendar widget did not regress by itself.
- Add host support for the SDK-defined `ui:resize` action so resize-aware widgets can let the host modal/page scroll instead of forcing native iframe scrollbars.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Commit and push each verified phase before starting the next phase.
- Branch `dev` tracks `origin/dev`; inspect push state before each phase push.
- Do not stage unrelated user changes. The current Budabit worktree has unrelated dirty files outside this workflow.
- Keep widget URLs unchanged; preview context remains host-provided.
- Do not rely on calendar-widget-specific scrollbar CSS as the primary fix.
- External repo `/home/johnd/Work/budabit-calendar-widget` has unrelated dirty changes; do not edit or commit it unless a later phase explicitly requires and the worktree can be separated safely.

## Phase 1: Stabilize Settings Modal Layout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Fix the immediate host modal layout regression so the widget preview has padding around the widget area, the header remains visually separate, and the frame no longer forces a 500px minimum inside a constrained modal.

### Exit Criteria

- `ExtensionCard.svelte` modal body uses a padded widget surface below the header, not header padding.
- The preview frame does not force `minHeight={500}` inside the modal.
- The modal body allows the frame to size within the available area without clipping from missing `min-h-0`.
- No calendar-widget-specific scrollbar styling is added as part of this phase.
- `pnpm check` passes for Budabit.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Update `src/app/components/ExtensionCard.svelte` modal body classes.
- Keep changes minimal and host-side.
- Run `pnpm check`.

### Verification

- Run `pnpm check`.
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

## Phase 2: Add Host Resize Bridge Support

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Implement host support for the SDK-defined `ui:resize` widget action and wire `WidgetFrame` so resize-aware widgets can resize their iframe wrapper, allowing the settings modal body to scroll at the host level instead of exposing native iframe scrollbars.

### Exit Criteria

- `bridge.ts` registers a `ui:resize` handler that validates positive finite dimensions and forwards them to the loaded widget extension runtime.
- `LoadedWidgetExtension` can carry an internal resize callback without exposing it to widget payloads.
- `WidgetFrame.svelte` applies a bounded requested height to its wrapper when a widget requests resize.
- Settings preview modal body can host-scroll when a resize-aware widget grows taller than the available modal body.
- Existing non-resize-aware widgets continue to preview with the fallback frame size.
- Focused bridge tests cover `ui:resize` callback behavior.
- Focused tests and `pnpm check` pass.
- Checkpoint records `Current Phase: Complete` and final closeout is committed and pushed.

### Steps

- Add an internal resize callback field to widget extension types.
- Add a `ui:resize` bridge handler.
- Wire `WidgetFrame` state to apply requested heights with sensible bounds.
- Update `ExtensionCard.svelte` modal body/frame usage if needed for host-level scrolling.
- Add focused tests in `src/app/extensions/bridge.test.ts`.

### Verification

- Run focused bridge tests touched by this phase.
- Run `pnpm check`.
- Inspect root `git status`, `git diff`, and recent commits before committing.

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
