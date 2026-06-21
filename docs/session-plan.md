# Session Plan

## Objective

- Add a minimal, user-controlled Smart Widget update workflow for installed widgets.
- Preserve the current community-endorsed vs other widget distinction and avoid auto-update for now.
- Notify users in Settings when installed widgets have newer kind `30033` events at the same address.
- Let users manually update installed widgets while preserving enablement, display settings, and community targets.
- Improve the extension template publish/release UX so publishers can safely release Blossom-backed widget versions with stable identifiers, version metadata, and changelog metadata.
- Use Welshman utilities where they fit, especially address/tag/relay helpers, and avoid duplicating existing helpers when current project utilities already exist.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Keep the implementation minimal: no auto-update, no review protocol, no full marketplace, no rollback UI unless it falls out naturally.
- User control is required: updates are detected and presented, but the user manually applies them.
- Installed widget identity is the addressable event line: same publisher pubkey, kind `30033`, same `d` identifier.
- For Blossom-hosted releases, the widget event metadata must move to the new content-addressed app URL; stale code bytes are avoided only after BudaBit updates its stored widget metadata.
- Preserve existing community widget discovery and community endorsement distinction.
- Preserve NIP-89 update behavior and avoid broad refactors.
- The nested template repo at `packages/flotilla-extension-template` has its own git history and may need a separate commit/push before updating the root submodule pointer.
- Commit and push each verified phase before starting the next phase.
- Stage only files intentionally changed for the current phase.

## Phase 1: Widget Update Foundations

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add the data model and pure/update-command foundation needed to detect and apply newer Smart Widget events without UI work yet.

### Exit Criteria

- `SmartWidgetEvent` parses optional release metadata tags such as `version` and `changelog`.
- Installed widget source metadata can preserve manual install naddr and relay hints for future update checks.
- New pure helpers identify latest update candidates by same `pubkey` + `identifier` and newer `created_at`.
- New helpers produce a small diff summary for app URL, permissions, slot, widget type, version, and changelog.
- Commands exist to check one installed widget for updates and refresh an installed widget while preserving existing settings.
- Focused tests cover update candidate detection, diff summaries, source metadata normalization, and refresh behavior where practical.

### Steps

- Inspect existing settings/commands tests and Welshman address/tag utilities.
- Add release metadata fields to `SmartWidgetEvent` and parse them in `parseSmartWidget`.
- Add `widgetInstallSources` metadata to extension settings, normalize it, and keep it scoped to installed widget ids.
- Update install paths to store naddr/relay hints when installing by naddr and optional relay hints when installing from an event.
- Add `src/app/extensions/widget-updates.ts` with pure helpers for matching update candidates, sorting by freshness, diffing, relay hint selection, and version/changelog extraction.
- Add command-level `checkForWidgetUpdate` and `refreshWidget` functions using existing Welshman request/repository flow.
- Add focused tests.

### Verification

- Run focused extension/settings/commands/widget-update tests.
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

## Phase 2: Manual Widget Update UX

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Surface installed Smart Widget updates in Settings with badges and manual update actions.

### Exit Criteria

- Settings checks installed Smart Widgets for newer events without auto-applying them.
- Installed section shows an update count/badge when widget updates are available.
- Widget cards show per-widget update availability and a manual update button.
- Update application replaces the stored widget metadata, preserves existing settings, and reloads enabled widgets through the command added in Phase 1.
- Widget cards show a concise update summary without adding a complex marketplace/review flow.
- Existing community-endorsed vs other widget discovery distinction remains intact.
- Focused tests and/or `pnpm check` cover changed UI/types.

### Steps

- Add update state to `src/routes/settings/extensions/+page.svelte` for installed widgets.
- Use Phase 1 commands to check for updates on settings load and after manual install/update.
- Pass update availability and update actions into `ExtensionCard.svelte`.
- Add small badge/count UI near Installed and per-card update controls.
- Keep NIP-89 update UI intact.
- Run focused tests/check.

### Verification

- Run focused extension tests affected by update helpers.
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
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 3: Publisher Release UX

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Improve the template publisher workflow enough to support stable, versioned Blossom-backed widget releases without building a complex release system.

### Exit Criteria

- Template manifest generator supports optional `version` and `changelog` tags.
- Generator/CLI docs strongly encourage explicit stable `--identifier` for release workflows.
- Publish/generate output previews include identifier, version/changelog when present, app URL, and relay targets.
- Template quickstart/docs describe the simple release workflow: build, upload to Blossom, publish same `d` with newer `created_at`, and users see update availability in BudaBit.
- Focused template tests cover version/changelog tag generation.

### Steps

- Update both template generator copies under `packages/sdk` and `packages/manifest`.
- Update generator CLI options and warnings/previews.
- Update generator tests.
- Update template docs/quickstart/publishing instructions.
- Commit/push nested template repo, then update root submodule pointer/checkpoint.

### Verification

- Run focused template SDK manifest tests.
- Run template SDK/manifest typecheck where practical.
- Run root pointer status checks before root commit.

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

- Verify the end-to-end minimal update/publish workflow and close the durable plan.

### Exit Criteria

- Installed widget update detection exists and is manually applied, not automatic.
- Settings exposes update badges/actions for installed widgets.
- Widget install source relay hints are preserved and normalized.
- Template publisher flow supports stable identifier, version/changelog metadata, and Blossom-backed release explanation.
- Final focused tests and `pnpm check` pass, or any failure is recorded as a real blocker.
- Checkpoint says `Current Phase: Complete` before final commit/push.

### Steps

- Search for update helper usage and stale TODOs/doc contradictions.
- Run final focused root tests and `pnpm check`.
- Run focused template tests if template changed.
- Update checkpoint to `Current Phase: Complete` and commit/push final closeout.

### Verification

- Run final focused root test commands from earlier phases.
- Run `pnpm check`.
- Run final focused template manifest tests if Phase 3 changed template files.
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
