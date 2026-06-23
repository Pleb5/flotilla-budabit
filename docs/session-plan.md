# Session Plan

## Objective

- Prevent Smart Widget identity collisions caused by using only the widget `d` identifier as the installed/runtime/storage ID.
- Use canonical widget line identity, publisher pubkey + kind `30033` + `d` identifier, for runtime, settings, discovery, updates, and bridge storage identity.
- Preserve `SmartWidgetEvent.identifier` as the raw Nostr `d` tag and preserve legacy behavior where widgets lack pubkey metadata.
- Migrate existing settings and bridge storage reads where practical so existing installs and widget data keep working.
- Add regression coverage for duplicate dash identifiers from different publishers, settings migration, and storage fallback.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Keep update application manual; do not auto-update installed widgets.
- Treat the same publisher pubkey plus kind `30033` plus same `d` identifier as one widget line.
- Do not use Nostr event `id` as installed widget identity because it changes every release.
- If widget `pubkey` is missing, retain legacy bare identifier fallback rather than inventing an unstable identity.
- New bridge storage writes should use a versioned BudaBit prefix; legacy `flotilla:ext:` storage should be read-compatible only.
- Commit and push each verified phase before starting the next phase.
- Stage only files intentionally changed for the current phase.

## Phase 1: Identity Foundation And Registry

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add canonical widget line identity helpers and apply them to registry/discovery/update-adjacent runtime identity without persisted settings migration yet.

### Exit Criteria

- A single exported helper computes canonical widget line IDs as `30033:<pubkey>:<identifier>` when pubkey and identifier exist, with a legacy fallback for missing pubkey.
- Registry stores and loads widgets by canonical widget line ID, allowing two publishers to register widgets with the same `d` identifier.
- Discovery dedupes widgets by canonical widget line ID rather than bare `identifier`.
- Update same-line logic and filters remain publisher + identifier based.
- Focused tests cover canonical ID computation and duplicate `d` widgets from different publishers where practical.

### Steps

- Inspect `src/app/extensions/types.ts`, `registry.ts`, `widget-updates.ts`, `settings.ts`, and command tests.
- Add a small widget identity helper module or exported helper.
- Update widget registry IDs and discovery dedupe to use canonical widget line IDs.
- Add focused tests.

### Verification

- Run focused extension registry/update/command tests touched by the phase.
- Run `pnpm check` if Svelte/types changed.

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

## Phase 2: Settings And UI Key Migration

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Migrate installed widget settings, enabled IDs, display configs, install sources, default widgets, update maps, and UI keys from bare identifiers to canonical widget line IDs.

### Exit Criteria

- New widget installs persist under canonical widget line IDs.
- Existing settings keyed by bare identifiers migrate to canonical IDs when stored widgets include pubkey + identifier.
- Enabled IDs, disabled default IDs, widget display config, widget install sources, and update state use canonical widget line IDs.
- Settings UI can display and operate on two installed widgets with the same `d` identifier from different publishers.
- Focused settings/UI helper tests cover migration and duplicate identifiers.

### Steps

- Inspect `src/app/extensions/settings.ts`, `src/app/core/commands.ts`, `src/routes/settings/extensions/+page.svelte`, and related tests.
- Add migration helpers for widget-keyed records.
- Update install/uninstall/enable/disable/update paths to use canonical widget line IDs.
- Update UI `each` keys and local maps to use canonical IDs.
- Add focused tests for migration and duplicate publisher IDs.

### Verification

- Run focused settings, command, widget update, and route-adjacent tests.
- Run `pnpm check`.

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
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 3: Bridge Storage Namespace Migration

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Replace legacy bridge storage key construction with canonical, encoded, versioned BudaBit storage keys while preserving legacy read compatibility.

### Exit Criteria

- New bridge storage writes use a versioned BudaBit prefix such as `budabit:ext:v2:` and encoded canonical extension/widget IDs.
- Repo-scoped storage uses an encoded repo address component rather than raw `repo:{pubkey}:{name}` delimiters.
- `storage:get` falls back to legacy `flotilla:ext:` keys when no v2 value exists.
- `storage:keys` can report v2 keys and legacy keys during transition without duplicates.
- `storage:set`/`storage:remove` write/remove v2 keys and do not create new legacy keys.
- Focused bridge tests cover v2 keys, legacy fallback, repo-scoped keys, and duplicate widget identifiers from different publishers.

### Steps

- Inspect `src/app/extensions/bridge.ts` storage handlers and bridge tests.
- Add small key builder helpers with encoded components.
- Update storage handlers.
- Add regression tests.

### Verification

- Run focused bridge tests.
- Run `pnpm check`.

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
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 4: Final Regression And Documentation

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Close the identity/storage migration with final regression coverage and concise documentation for widget line IDs versus widget `d` identifiers.

### Exit Criteria

- Tests cover duplicate publisher widgets with same `d` through install/discovery/update/storage-critical paths.
- Developer-facing docs or comments explain widget line ID versus `d` identifier and storage namespace compatibility.
- Final focused tests and `pnpm check` pass.
- Checkpoint says `Current Phase: Complete` before final commit/push.

### Steps

- Inspect coverage gaps after Phases 1-3.
- Add minimal docs/comments where maintainers will look first.
- Run final focused tests and full check.
- Update checkpoint to `Complete` and commit/push final closeout.

### Verification

- Run focused identity/settings/bridge/update tests.
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
