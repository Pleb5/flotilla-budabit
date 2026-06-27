# Session Plan

## Objective

- Harmonize Budabit extensions around Smart Widgets only.
- Remove the confusing widget display selector so widgets are reachable through their declared slot plus the settings-page preview action only.
- Drop NIP-89 manifest extensions from the app because Smart Widgets are the only fully supported extension model and breaking changes are acceptable.
- Keep changes minimal and aligned with the currently supported slots: `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, and `global-menu`.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Commit and push each verified phase before starting the next phase.
- The branch `dev` tracks `origin/dev` and was already ahead of upstream by one commit when this workflow started; inspect push state before each phase push.
- Do not stage unrelated changes if new user edits appear while working.
- Prefer the smallest correct changes; remove obsolete compatibility code rather than preserving it unless current code requires a migration guard.
- Settings preview remains available for widgets with secure app URLs.
- Widget runtime surfaces should be driven by declared widget slots, not user-selected display locations.

## Phase 1: Remove Display Selector And Generic Launcher

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Remove the widget display-location selector and the generic `/widgets`/sidebar launcher path while preserving the settings-page widget preview action.

### Exit Criteria

- `WidgetDisplayLocation`, `widgetDisplay`, `getWidgetsForLocation`, and display-location setters/getters are removed from app settings code.
- Settings extension cards no longer render a display-location dropdown.
- The widget settings action is clearly a preview action, not a placement selector.
- Primary navigation no longer adds widget launcher entries from display settings.
- The generic `/widgets` route is removed or otherwise no longer reachable from app navigation.
- Focused settings/component tests are updated for the removed display selector.
- Phase 1 changes are verified, committed, pushed, and the checkpoint is reread.

### Steps

- Update `src/app/extensions/types.ts` and `src/app/extensions/settings.ts` to remove display-location types and persisted display settings.
- Update `src/app/components/ExtensionCard.svelte` to remove selector props and rename `Open App` to a settings preview action.
- Update `src/routes/settings/extensions/+page.svelte` to stop passing display-location props.
- Update `src/app/components/PrimaryNav.svelte` and remove the generic `/widgets` route.
- Update focused tests that asserted display setting normalization.

### Verification

- Run focused extension settings tests.
- Run type/project verification if feasible after focused tests pass.
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

## Phase 2: Drop NIP-89 Runtime And Settings Support

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Remove NIP-89 manifest extension support from app runtime, settings, commands, and repo-tab resolution so Smart Widgets are the only extension model.

### Exit Criteria

- `ExtensionManifest`, `LoadedNip89Extension`, and `installed.nip89` app code paths are removed.
- NIP-89 install-by-URL, manifest URL tracking, manifest update checks, discovery, and registry iframe loading are removed.
- Extension provider, bridge permissions, enable/disable/uninstall commands, and repo-tab rendering operate on widgets only.
- Settings Extensions UI lists and manages widgets only.
- Repo extension routes resolve repo-tab Smart Widgets only.
- Focused unit tests are updated and pass for widget-only settings/commands/registry behavior.
- Phase 2 changes are verified, committed, pushed, and the checkpoint is reread.

### Steps

- Simplify extension types to widget-only loaded extensions.
- Simplify settings normalization, effective installs, enabled IDs, default widgets, and install source handling around `installed.widget` only.
- Remove NIP-89 command exports and references from commands, provider, registry, bridge, settings UI, and repo routes.
- Update unit tests that previously constructed or asserted `nip89` buckets.

### Verification

- Run focused extension settings, commands, registry, and bridge tests.
- Run type/project verification if feasible after focused tests pass.
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

## Phase 3: Documentation Cleanup And Final Verification

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Update documentation/templates to describe Smart Widgets as the only supported extension model and complete final verification.

### Exit Criteria

- User-facing extension docs no longer say Budabit supports NIP-89 manifest extensions.
- Smart Widget template docs no longer direct developers to NIP-89 as a supported alternative.
- Remaining `NIP-89`/`31990` references are either outside the app extension feature or explicitly unrelated to extension support.
- End-to-end comments or docs that mention `installed.nip89` are updated.
- Final focused tests and project-level verification pass, or a concrete blocker is recorded.
- Checkpoint records `Current Phase: Complete` and final closeout is committed and pushed.

### Steps

- Update `docs/extensions/*`, `docs/Overview.md`, package template docs, and related extension docs.
- Search for stale NIP-89/display-location extension references and remove or narrow them.
- Run final focused and project-level verification.

### Verification

- Run focused extension tests.
- Run `pnpm check` if feasible or record the exact blocker/failure.
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
