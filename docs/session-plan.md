# Session Plan

## Objective

- Reintroduce spec-correct support for both NIP-52 calendar event kinds in community calendar flows.
- Support `31922` date-based all-day and multi-day calendar events alongside `31923` time-based calendar events.
- Fix future community defaults and editing UI so Calendar sections include both compatible calendar kinds by default.
- Preserve distinct kind semantics instead of aliasing `31922` and `31923`.

## Constraints

- Current repository state is authoritative over this plan.
- Keep changes minimal and localized; avoid large rewrites unless current code requires it for correctness.
- Do not introduce any new Nostr event kind; only use existing NIP-52 `EVENT_DATE` / `31922` and `EVENT_TIME` / `31923`.
- Preserve the existing `Calendar Events` option label for the current time-based option when practical, while adding a clear all-day/date-based option.
- Default new community Calendar sections to both calendar event kinds.
- Treat `31922` and `31923` as distinct specs with different `start`/`end` tag formats and event semantics.
- Commit and push each verified phase before starting the next phase.
- Use `docs/session-checkpoint.md` as the compact durable checkpoint and update it before every phase commit.
- Never stage unrelated user changes already present in the worktree.

## Phase 1: Calendar Kinds In Community Model And Permissions

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Make both NIP-52 calendar event kinds first-class community section/default/permission targets without changing event creation behavior yet.

### Exit Criteria

- New default community setup Calendar sections include both `EVENT_DATE` / `31922` and `EVENT_TIME` / `31923`.
- Community section kind picker exposes both calendar options, preserving the existing `Calendar Events` option label for the current time-based kind and adding a clear date-based all-day option.
- Community write-target mapping recognizes both calendar event kinds and keeps them distinct.
- Community targetable publication kind lists include both calendar kinds.
- Focused core tests cover defaults, target mapping, section resolution, and targeted publication kind inclusion.

### Steps

- Update community constants/defaults to include `EVENT_DATE` in calendar defaults and targetable publication kind lists.
- Add a date-based calendar write target while keeping the existing `calendar` target for the time-based flow.
- Export a shared list of calendar write targets for UI/gate integration in later phases.
- Update CommunityCreate known kind options to include both calendar options.
- Update focused tests in community, permissions, targeting, and feed helpers.

### Verification

- Run focused tests for community defaults, permissions, targeting, and feed helpers.
- Run type/check if the focused test run exposes type uncertainty or if touched APIs are broadly consumed.

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

## Phase 2: Spec-Correct Calendar Event Utilities And Shared Form/Display

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add reusable, tested NIP-52 date/time calendar helpers and update shared calendar form/display components to serialize, parse, and render both kinds correctly.

### Exit Criteria

- Shared calendar helper code distinguishes `31922` date strings from `31923` Unix timestamps.
- Date-based event creation/editing writes `YYYY-MM-DD` `start` and exclusive `end` dates per NIP-52.
- Time-based event creation/editing keeps Unix timestamp `start`/`end` and `D` tags.
- Shared calendar form can create all-day/date-based and timed events without corrupting existing edits.
- Calendar display components render date-based events without bogus epoch times and render time-based events as before.
- Focused tests cover helper parsing, date exclusive-end conversion, timestamp parsing, serialization, and display-ready values.

### Steps

- Add a small `calendar-events` core helper module for NIP-52 kind checks, local date parsing/formatting, start ordering, and tag construction.
- Update `CalendarEventForm.svelte` and `CalendarEventEdit.svelte` to use date-only fields for date-based events and `DateTimeInput` for time-based events.
- Update calendar display components to use helper-derived date/time values instead of blind `parseInt` on `start`.
- Keep preserved unmanaged tags and editor tags behavior intact.
- Add focused helper tests.

### Verification

- Run focused calendar helper tests.
- Run focused component-adjacent tests if available.
- Run `pnpm check` if Svelte component typing is affected.

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

## Phase 3: Community Calendar Create/List/Detail Integration

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Wire both calendar event kinds through community-targeted create, list, detail, comments, notifications, and access gates.

### Exit Criteria

- Community calendar create page can publish either date-based `31922` all-day/multi-day events or time-based `31923` timed events.
- Targeted publication events use the selected original kind and reference the selected event kind correctly.
- Community calendar list and detail pages query and approve both calendar event kinds.
- Calendar comments/replies use the approved event's actual kind in `K`/`k` tags and filters.
- Calendar access gates allow users who can write either calendar kind to reach create flow, while final publish validation checks the selected kind.
- Calendar notifications and live community hydration can discover targeted publications for both kinds.
- Focused tests cover filters/helpers where practical, and `pnpm check` passes.

### Steps

- Update community calendar create route to expose a type selector, date-only fields for all-day events, and kind-specific permission checks.
- Update community calendar list/detail route filters to use both calendar kinds and actual event kind comparisons.
- Update calendar feed loading to preserve exact date-based filters while retaining `D`-windowed time-based loading.
- Update PublishGate to support alternate write targets, or add a targeted calendar gate path, using the smallest safe change.
- Update notifications or live filter code if Phase 1 targetable-kind changes are not enough.
- Add focused tests for new helper/filter behavior and run project check.

### Verification

- Run focused core and route-adjacent tests touched by calendar filtering/permissions.
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

## Phase 4: Regression Sweep And Completion

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Run a final regression sweep for both calendar kinds, update any missed tests/references, and close the durable plan.

### Exit Criteria

- Searches show no remaining community calendar create/list/detail path hardcoded to only `EVENT_TIME` where both kinds are required.
- Valid `EVENT_DATE` events are not parsed as Unix timestamps in calendar UI components touched by the community flow.
- Default community creation/editing, permission grants, targeted publication routing, calendar feed loading, and comments are covered by focused tests or explicit verification notes.
- Final focused tests and `pnpm check` pass, or any failure is recorded as a real blocker.
- Checkpoint says `Current Phase: Complete` before final commit/push.

### Steps

- Search for remaining `EVENT_TIME`, `EVENT_DATE`, `31922`, and `31923` references in community calendar paths and core helpers.
- Add small missing tests or documentation comments only where evidence shows a gap.
- Run final focused test set and `pnpm check`.
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
