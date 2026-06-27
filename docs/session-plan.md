# Session Plan

## Objective

- Make Settings > Extensions widget preview render context-aware Smart Widgets, especially community widgets such as `~/Work/budabit-calendar-widget`.
- Derive preview community context from community recommendation/curation provenance, not from the preview URL and not only from targeting events authored by the logged-in user.
- Reuse the existing widget host bridge path (`WidgetFrame`) so previews receive `communityContext` in `widget:init` and community bridge actions resolve against the preview community.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Commit and push each verified phase before starting the next phase.
- Branch `dev` tracks `origin/dev`; inspect push state before each phase push.
- Do not stage unrelated user changes if any appear.
- Prefer minimal, correct changes and reuse existing widget-frame/community-context infrastructure.
- Settings preview must not depend on mutating the active community route/session.
- Widget app URLs should stay unchanged; community identity should be host-provided context.
- User-authored widget targeting events can be fallback evidence, but recommendation provenance from community curation is the primary source.

## Phase 1: Preserve Recommendation Context And Bridge Runtime Context

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Preserve community recommendation provenance when community-curated widgets are loaded and allow widget bridge handlers to use a supplied preview community runtime context instead of only active community stores.

### Exit Criteria

- Community-curated widget loading records per-widget recommendation contexts keyed by widget line id.
- Recommendation context includes community pubkey, relays/relay hints, trust metadata, definition, profile-list events, and enough data to build a `CommunityWidgetContext` for the current viewer.
- `LoadedWidgetExtension` can carry an internal community runtime context for bridge handlers.
- `WidgetFrame` passes the runtime context to `ExtensionBridge` when provided by its `context` prop.
- Community bridge handlers use the extension runtime context when present and fall back to active community stores otherwise.
- Focused tests cover recommendation recording and bridge community actions with preview runtime context.
- Phase 1 changes are verified, committed, pushed, and the checkpoint is reread.

### Steps

- Add a small recommendation-context module under `src/app/extensions/`.
- Record recommendation contexts from `loadCommunityCuratedWidgets` after curated widget events are parsed.
- Add `CommunityWidgetRuntimeContext` to extension types and thread it through `WidgetFrame` and `ExtensionBridge`.
- Update focused unit tests or add new focused tests for the context store and bridge runtime path.

### Verification

- Run focused tests for community curation/recommendation context and bridge behavior.
- Run `pnpm check` if focused tests pass.
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

## Phase 2: Wire Settings Preview To Recommendation Context

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Make Settings > Extensions preview use `WidgetFrame` with recommendation-derived community context and expose community selection when more than one recommended context exists.

### Exit Criteria

- Settings installed widget cards derive preview community options from recommendation contexts, not only logged-in user targeting events.
- `ExtensionCard` preview uses `WidgetFrame`/host bridge instead of a raw iframe.
- Context-aware widgets receive `communityContext` during settings preview when recommendation provenance exists.
- Multiple recommendation contexts can be selected before preview; single context defaults automatically.
- Context-free widgets continue to preview with no required community.
- Focused tests and `pnpm check` pass, or a concrete blocker is recorded.
- Checkpoint records `Current Phase: Complete` and final closeout is committed and pushed.

### Steps

- Pass preview context options from `src/routes/settings/extensions/+page.svelte` into `ExtensionCard`.
- Update `ExtensionCard.svelte` to render optional preview community selector and use `WidgetFrame` in the modal.
- Add or update focused tests where feasible.
- Run final focused and project-level verification.

### Verification

- Run focused extension/community/widget tests touched by this workflow.
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
