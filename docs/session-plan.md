# Session Plan

## Objective

- Add true inline community home Smart Widget iframes for BudaBit community home slots.
- Provide a generic, host-computed `communityContext` to widgets so extensions can use community identity, relays, renamed content sections, and write capabilities without reimplementing BudaBit trust/grant logic.
- Add a community-aware bridge query that maps logical write targets to the current community's actual sections before constructing event filters, so section renames and per-community definitions work correctly.
- Update `flotilla-extension-template` SDK/docs/template so widget developers can consume the standard community context and query API end to end.
- Create a separate local widget repository at `~/Work/budabit-calendar-widget` for a featured calendar event widget based on the template. The user will push that repository later.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Do not restrict featured-event visibility by calendar write grant; restrict only configuration controls.
- Community section names can be renamed per community. Host context and query actions must expose target-to-section mappings and construct filters from the active community definition.
- Keep Budabit host APIs generic; avoid calendar-specific fields such as `canCreateCalendarEvents` in host payloads.
- Calendar-specific behavior belongs in the calendar widget or SDK helpers by interpreting generic write targets such as `calendar` and `calendarDate`.
- Keep changes minimal and compatible with existing modal/action widget behavior.
- Commit and push each verified BudaBit/root phase before starting the next phase.
- Commit and push the nested `packages/flotilla-extension-template` phase before updating the root submodule pointer.
- For `~/Work/budabit-calendar-widget`, create a local git repo and local commit for durability, but do not push because the user explicitly said they will push it later.
- Stage only files intentionally changed for the current phase.

## Phase 1: Budabit Host Inline Community Widget API

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add BudaBit host primitives for inline home widgets, generic community context, and dynamic community-target event queries.

### Exit Criteria

- Community home slots render enabled home-slot widgets as inline iframes instead of only launcher cards.
- Existing action slots and modal widgets continue using modal launchers.
- `widget:init` includes generic `communityContext` when a community context is available.
- `communityContext.writeTargets` is computed from `COMMUNITY_WRITE_TARGETS`, active community definition sections, profile lists, report state, and current user, including renamed section names and writable section names.
- A bridge request such as `community:queryTargetEvents` maps requested logical target IDs to the active community's actual sections/writers before constructing relay filters.
- The community query does not require write access; write access only affects configuration UI through `communityContext.writeTargets`.
- Focused tests cover context write-target mapping and bridge community query behavior.

### Steps

- Inspect `src/app/components/community/CommunityHomeWidgetSlot.svelte`, `src/app/components/WidgetModal.svelte`, `src/app/extensions/bridge.ts`, `src/app/extensions/types.ts`, and community permission/feed helpers.
- Add a generic community context builder module with exported types/helpers.
- Add a reusable `WidgetFrame` component shared by inline home slots and modal widgets.
- Update `CommunityHomeWidgetSlot.svelte` to render inline `WidgetFrame` instances.
- Update modal/action slot paths to pass standard community context where available.
- Add `community:queryTargetEvents` bridge handler with dynamic target-to-section/writer mapping.
- Add focused tests.

### Verification

- Run focused tests for community context and bridge behavior.
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

## Phase 2: Flotilla Extension Template SDK And Docs

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Update `packages/flotilla-extension-template` so generated widgets and SDK types understand community context, inline home slots, and community-target queries.

### Exit Criteria

- SDK types include `communityContext`, logical community write targets, and `community:queryTargetEvents` request/response types.
- Template docs explain inline home slots, generic community context, dynamic section-aware target querying, and write-access-only configuration gating.
- Template sample code demonstrates reading `communityContext` without relying on calendar-specific host fields.
- Template tests/build pass.
- The nested template repo is committed and pushed; the root repo records the updated submodule pointer if it changes.

### Steps

- Inspect template SDK types, bridge action map, docs, and sample app.
- Add community context and query action types to SDK/shared exports where appropriate.
- Update template docs and sample app with generic community context usage.
- Run template verification.
- Commit and push inside `packages/flotilla-extension-template`.
- Commit and push the root submodule pointer and checkpoint advancement.

### Verification

- Run relevant template package tests/typecheck/build.
- Run root status checks for the submodule pointer.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing root closeout:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push nested template changes before root submodule pointer changes.
- Commit and push root checkpoint/submodule pointer changes. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not consider the phase complete until verification, template commit/push, root checkpoint update, root commit/push, and checkpoint reread succeeded.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 3: Featured Calendar Widget Repository

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Create `~/Work/budabit-calendar-widget` as a separate local repository implementing the featured calendar event widget.

### Exit Criteria

- The widget repo exists at `/home/johnd/Work/budabit-calendar-widget` and is initialized as a git repository.
- The widget is based on the template structure and builds independently.
- The widget declares the home community slots, permissions needed for community target queries and publishing configuration, and default header `Featured event`.
- The widget reads generic `communityContext`, derives calendar configuration permission from `writeTargets.calendar` or `writeTargets.calendarDate`, and never relies on a host-provided calendar-specific boolean.
- The widget shows the selected featured event to all viewers when configured.
- The widget restricts only configuration controls. If no selected event exists and the viewer lacks calendar-event write capability, it displays `Request access to create calendar events in order to use this plugin`.
- The widget queries already-published community calendar events through the dynamic community query action, mapping logical targets rather than hard-coded section names.
- The widget has a local git commit for durability. No push is attempted because the user said they will push this repo later.

### Steps

- Create the repo directory under `/home/johnd/Work`.
- Add package, Vite/Svelte, docs, and source files based on the template.
- Implement bridge initialization, context handling, community event query, local/community config, selector UI, and event card rendering.
- Generate or document widget publishing outputs.
- Run widget verification.
- Commit locally in the widget repo.
- Update the root checkpoint with widget repo evidence and final status.

### Verification

- Run widget typecheck/build/tests where available.
- Inspect widget repo git status and recent commit.
- Run any final focused root smoke checks needed after template/host changes.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before root final closeout:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files/repo path.
  - Set `Current Phase` to `Complete`.
  - Set `Phase Exit Criteria` to final completion criteria.
  - Set `Next Action` to final response.
  - Record any remaining risks or blockers.
- Commit the widget repo locally. Do not push it because the user explicitly said they will push later.
- Commit and push root checkpoint updates if root files changed in this phase.
- Read the session checkpoint again to verify `Current Phase: Complete`.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
