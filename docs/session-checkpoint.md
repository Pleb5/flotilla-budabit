# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Add true inline community home Smart Widget iframes in BudaBit.
- Provide generic host-computed `communityContext` to widgets with section-aware write target capability data.
- Add a dynamic community target query bridge action that maps logical targets to renamed per-community sections before constructing filters.
- Update `flotilla-extension-template` SDK/docs for the context/query API.
- Create a separate local featured calendar widget repo at `/home/johnd/Work/budabit-calendar-widget`; the user will push it later.

## Current Phase

- Complete

## Phase Exit Criteria

- BudaBit root host changes are committed and pushed.
- `flotilla-extension-template` changes are committed and pushed, and root records the updated submodule pointer.
- The widget repo exists at `/home/johnd/Work/budabit-calendar-widget`, builds independently, is committed locally, and was not pushed.

## Completed With Evidence

- Existing stale widget identity/storage workflow in this file was superseded by the user request to create and execute the featured calendar widget workflow.
- Root repo `/home/johnd/Work/budabit` started clean on branch `dev` tracking `origin/dev`.
- Template submodule `/home/johnd/Work/budabit/packages/flotilla-extension-template` started clean on branch `main` tracking `origin/main`.
- Phase 1 added `CommunityWidgetContext`, write-target context types, and community target query request/response types in `src/app/extensions/types.ts`.
- Phase 1 added `src/app/extensions/community-context.ts` to build generic community context from active community definitions, renamed sections, profile lists, report state, relays, and current user.
- Phase 1 added dynamic `makeCommunityTargetQueryPlan` logic that maps logical targets such as `calendar` to current community target sections/writers before producing targeting/original filters.
- Phase 1 added `community:queryTargetEvents` bridge handling in `src/app/extensions/bridge.ts`, gated by widget permission but not by viewer write access.
- Phase 1 moved iframe lifecycle and `widget:init` payload creation into shared `src/app/components/WidgetFrame.svelte`; init payload includes top-level `communityContext` when provided.
- Phase 1 updated `CommunityHomeWidgetSlot.svelte` to render enabled home-slot widgets as inline `WidgetFrame` iframes.
- Phase 1 preserved modal/action slot behavior and updated `CommunityWidgetSlotLaunchers.svelte` to pass standard `communityContext` into modal-launched widgets.
- Phase 1 tests cover renamed section mapping, calendar target query filter construction, and bridge community target query behavior.
- Phase 1 verification passed: `pnpm vitest run src/app/extensions/community-context.test.ts src/app/extensions/bridge.test.ts`.
- Phase 1 verification passed: `pnpm check`.
- Phase 1 was committed and pushed to `origin/dev` as root commit `1690a4de feat: add inline community widget context`.
- Phase 2 updated `packages/flotilla-extension-template` SDK/shared source types with `CommunityWidgetContext`, logical community write target IDs, and `community:queryTargetEvents` request/response/action-map types.
- Phase 2 updated the generated sample app to read `communityContext`, derive calendar configuration access from `writeTargets.calendar`/`calendarDate`, and demonstrate `community:queryTargetEvents`.
- Phase 2 updated template docs/README examples for inline home slots, generic community context, dynamic section-aware querying, and write-access-only configuration gates.
- Phase 2 updated template manifest generation examples to include `community:queryTargetEvents` permission.
- Phase 2 verification passed in the template repo: `pnpm typecheck`.
- Phase 2 verification passed in the template repo: `pnpm test`.
- Phase 2 verification passed in the template repo: `pnpm build`.
- Phase 2 template repo commit `4eb42f8 feat: document community widget context` was pushed to `origin/main`.
- Phase 2 root submodule pointer/checkpoint closeout was committed and pushed to `origin/dev` as root commit `40ba5e11 chore: update widget template context`.
- Phase 3 created `/home/johnd/Work/budabit-calendar-widget` as a separate local git repository.
- Phase 3 widget is template-derived Svelte/Vite and reads generic `communityContext` from `widget:init`.
- Phase 3 widget derives configuration permission from `writeTargets.calendar` or `writeTargets.calendarDate`, never from a calendar-specific host boolean.
- Phase 3 widget queries calendar events with `community:queryTargetEvents` using logical targets `calendar` and `calendarDate`.
- Phase 3 widget renders the selected event to all viewers when configured, and gates only configuration controls.
- Phase 3 widget displays `Request access to create calendar events in order to use this plugin` when there is no configured event and the viewer lacks calendar-event write capability.
- Phase 3 widget includes `manifest:before` and `manifest:after` scripts for the two community home quicklink slots and uses default header `Featured event`.
- Phase 3 verification passed in the widget repo: `pnpm check`.
- Phase 3 widget repo local commit `27db937 feat: add featured calendar widget` was created on branch `master` and intentionally not pushed.

## Decisions

- Use generic community context rather than calendar-specific host fields such as `canCreateCalendarEvents`.
- Widgets derive calendar configuration permission from logical write targets `calendar` and `calendarDate`.
- Visibility is not gated by calendar grant. Only configuration controls are gated.
- Community section names are dynamic per community; host query APIs must map logical targets to current community sections before querying.
- `community:queryTargetEvents` is a privileged bridge action requiring an explicit widget `permission` tag.
- The featured calendar widget belongs in `/home/johnd/Work/budabit-calendar-widget` as a separate local repo. Do not push it; the user will push later.
- Commit and push every verified BudaBit/root phase before continuing.

## Current State

- BudaBit root host/API/template pointer work is complete and pushed.
- The template repo is complete and pushed.
- The calendar widget repo is complete, verified, and locally committed but not pushed by user instruction.

## Next Action

- Final response.

## Verification

- Root Phase 1: `pnpm vitest run src/app/extensions/community-context.test.ts src/app/extensions/bridge.test.ts`
- Root Phase 1: `pnpm check`
- Template Phase 2: `pnpm typecheck`
- Template Phase 2: `pnpm test`
- Template Phase 2: `pnpm build`
- Widget Phase 3: `pnpm check`
- Widget Phase 3: `git status --short --branch`
- Widget Phase 3: `git log --oneline -5`

## Risks Or Blockers

- Inline iframe height is currently host-controlled with a fixed minimum; richer widgets may later need a resize protocol.
- The widget repo currently uses `budabit-sdk` through a local `file:` dependency for development; update package metadata before publishing publicly if needed.
- The widget repo branch is Git's default `master`; rename to `main` before pushing if that is the desired convention.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/extensions/types.ts`
- `src/app/extensions/community-context.ts`
- `src/app/extensions/community-context.test.ts`
- `src/app/extensions/bridge.ts`
- `src/app/extensions/bridge.test.ts`
- `src/app/components/WidgetFrame.svelte`
- `src/app/components/WidgetModal.svelte`
- `src/app/components/community/CommunityHomeWidgetSlot.svelte`
- `src/app/components/community/CommunityWidgetSlotLaunchers.svelte`
- `packages/flotilla-extension-template`
- `/home/johnd/Work/budabit-calendar-widget`
