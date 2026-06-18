# Session Plan

## Objective

- Reduce Smart Widget slot support to the currently intended, renderable set: `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, and `global-menu`.
- Use dashed Smart Widget slot IDs, not colon-separated legacy extension registry IDs.
- Keep `repo-tab` and community home slots working while adding semantic Smart Widget handling for chat message action launchers and community-scoped global menu launchers.
- Make the supported slots community-targetable through existing targeted publication curation.
- Update the BudaBit extension template and SDK documentation/generators so new widgets only target supported slots.

## Constraints

- Current repository state is authoritative over this plan.
- Existing dirty extension/widget work is treated as in-progress repository state; preserve it and do not revert it unless evidence shows a direct conflict.
- Do not stage unrelated user changes. If unrelated dirty files remain, leave them unstaged.
- Keep changes minimal and localized; prefer semantic launchers over inline iframes in compact UI slots.
- `global-menu` means “always accessible while in the targeted community”; only load/render global-menu widgets on community routes.
- `chat-message-actions` must render as compact per-message launchers and must not create per-message network fetches or inline iframes.
- `repo-tab` keeps its existing full-route iframe model.
- Community home slots keep their existing card/launcher model.
- Commit and push each verified phase before starting the next phase.
- Use `docs/session-checkpoint.md` as the compact durable checkpoint and update it before every phase commit.

## Phase 1: Supported Slot Model And Community Management

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Make the supported Smart Widget slot vocabulary explicit in Budabit and community widget management, without changing compact slot renderers yet.

### Exit Criteria

- `WidgetSlotConfig` supports exactly `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, and `global-menu`.
- `ExtensionSlotId` contains only the kept legacy registry placeholders that are still intentionally mounted, or is narrowed to the kept dashed IDs if used by current code.
- `parseSmartWidget` parses dashed `chat-message-actions` and `global-menu`, plus existing repo/home slots, and ignores unsupported old colon slots.
- Community widget creation/management UI can publish and display labels for all supported non-repo Smart Widget slots.
- Settings/community widget cards show badges for all supported slots.
- Focused tests cover parsing supported slots and rejecting/ignoring unsupported colon slot names.

### Steps

- Update `src/app/extensions/types.ts` with a strict supported slot union.
- Update `src/app/extensions/registry.ts` slot parsing.
- Update `src/routes/c/[community]/widgets/+page.svelte` slot picker, labels, and generated `slot` tags.
- Update `src/routes/settings/extensions/+page.svelte` widget badge labels.
- Add or update focused registry/community widget tests.
- Keep old SlotRenderer mounts for Phase 2 cleanup unless they block type-checking in this phase.

### Verification

- Run focused tests for registry parsing and community curation/slot behavior.
- Run `pnpm check` if TypeScript/Svelte types are affected.

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

## Phase 2: Community Slot Loading And Budabit Renderers

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Render supported community-targeted Smart Widget slots in Budabit with semantic launchers and cached community curation data.

### Exit Criteria

- Old unsupported `SlotRenderer` mounts are removed from composer actions, room header actions, community sidebar widgets, settings panel, and room panel paths.
- `chat-message-actions` renders compact action launchers in `ChannelMessage.svelte` and `RoomItem.svelte` and passes message/community context only when the user clicks.
- `chat-message-actions` does not load curation data once per message row.
- `global-menu` renders only on community routes and only for widgets targeted to that community, as an always-accessible community launcher.
- Community home slots use the same supported slot typing and continue to render installed+enabled targeted widgets.
- Widget launchers open widgets without inline iframes in compact slots.
- Focused tests or `pnpm check` cover changed components/helpers.

### Steps

- Add a small cached community widget slot helper or component that loads curated widgets once per community input and filters installed+enabled widgets by slot.
- Reuse the helper from home slots, message actions, and community global-menu launchers.
- Add a shared compact Smart Widget launcher/button component where useful.
- Wire message action launchers into `ChannelMessage.svelte` and `RoomItem.svelte` with existing `url`, relay, scope, and event props.
- Wire `global-menu` into `src/routes/c/[community]/+layout.svelte` or another community-only shell location.
- Remove unsupported `SlotRenderer` imports/usages from current UI.
- Run type/check and focused tests.

### Verification

- Run `pnpm check`.
- Run focused extension/widget tests affected by slot loading and parsing.

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

## Phase 3: Extension Template And SDK Alignment

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Align the extension template SDK, manifest generators, examples, and docs with the supported Smart Widget slot set.

### Exit Criteria

- Template/SDK manifest generator types define the supported slot union.
- Generator emits `repo-tab` tags with label/path and non-repo slot tags with label only.
- CLI validates supported slots and no longer documents unsupported colon slot names.
- Template package tests cover supported slot generation and invalid slot handling.
- Template app/docs explain only the supported slots and include dashed `chat-message-actions` and `global-menu` examples.
- No template docs under `packages/flotilla-extension-template` mention removed slots except in intentional migration notes, if any.

### Steps

- Update `packages/flotilla-extension-template/packages/sdk/src/manifest/generator.ts` and matching `packages/manifest` generator.
- Update CLI validation in both generator CLIs.
- Update generator tests.
- Rewrite slot docs in root template docs and scaffold template docs.
- Update scaffold `package.json` manifest generation example if useful.
- Run template package tests/typecheck where practical.

### Verification

- Run focused template SDK manifest tests.
- Run template typecheck or package tests if practical.
- Search template docs/code for removed colon slots.

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

## Phase 4: Regression Sweep And Completion

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Sweep Budabit and template code for removed slot names, verify the full slot workflow, and close the durable plan.

### Exit Criteria

- Searches show no remaining active Budabit UI mount for unsupported slots.
- Searches show no remaining template docs/examples for removed colon slot names except explicit migration notes, if intentionally kept.
- Supported slots parse, publish, display labels, and render as semantic launchers in their intended places.
- Final focused tests and `pnpm check` pass, or any failure is recorded as a real blocker.
- Checkpoint says `Current Phase: Complete` before final commit/push.

### Steps

- Search for removed slot names across `src`, `docs/extensions`, and `packages/flotilla-extension-template`.
- Add small missing tests or cleanup only where evidence shows a gap.
- Run final focused tests and `pnpm check`.
- Update checkpoint to `Current Phase: Complete` and commit/push final closeout.

### Verification

- Run final focused test commands from earlier phases.
- Run `pnpm check`.
- Inspect final diff and status before committing.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to `Complete`.
  - Set `Phase Exit Criteria` to the final completion criteria.
  - Set `Next Action` to final response.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is the final transition.
- Read the session checkpoint again to verify `Current Phase: Complete`.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
