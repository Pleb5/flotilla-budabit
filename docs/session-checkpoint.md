# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Add true inline community home Smart Widget iframes in BudaBit.
- Provide generic host-computed `communityContext` to widgets with section-aware write target capability data.
- Add a dynamic community target query bridge action that maps logical targets to renamed per-community sections before constructing filters.
- Update `flotilla-extension-template` SDK/docs for the context/query API.
- Create a separate local featured calendar widget repo at `/home/johnd/Work/bubdabit-calendar-widget`; the user will push it later.

## Current Phase

- Phase 3: Featured Calendar Widget Repository

## Phase Exit Criteria

- The widget repo exists at `/home/johnd/Work/bubdabit-calendar-widget` and is initialized as a git repository.
- The widget is based on the template structure and builds independently.
- The widget declares the home community slots, permissions needed for community target queries and publishing configuration, and default header `Featured event`.
- The widget reads generic `communityContext`, derives calendar configuration permission from `writeTargets.calendar` or `writeTargets.calendarDate`, and never relies on a host-provided calendar-specific boolean.
- The widget shows the selected featured event to all viewers when configured.
- The widget restricts only configuration controls. If no selected event exists and the viewer lacks calendar-event write capability, it displays `Request access to create calendar events in order to use this plugin`.
- The widget queries already-published community calendar events through the dynamic community query action, mapping logical targets rather than hard-coded section names.
- The widget has a local git commit for durability. No push is attempted because the user said they will push this repo later.

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

## Decisions

- Use generic community context rather than calendar-specific host fields such as `canCreateCalendarEvents`.
- Widgets derive calendar configuration permission from logical write targets `calendar` and `calendarDate`.
- Visibility is not gated by calendar grant. Only configuration controls are gated.
- Community section names are dynamic per community; host query APIs must map logical targets to current community sections before querying.
- `community:queryTargetEvents` is a privileged bridge action requiring an explicit widget `permission` tag.
- The featured calendar widget belongs in `/home/johnd/Work/bubdabit-calendar-widget` as a separate local repo. Do not push it; the user will push later.
- Commit and push every verified BudaBit/root phase before continuing.

## Current State

- Phase 1 root host changes are committed and pushed.
- Phase 2 template changes are committed and pushed in the nested template repo.
- Phase 2 root submodule pointer/checkpoint closeout is committed and pushed.
- Root repo and template repo are clean at the start of Phase 3.

## Next Action

- Start Phase 3 by creating `/home/johnd/Work/bubdabit-calendar-widget` as a separate local widget repo.

## Verification

- Root Phase 1: `pnpm vitest run src/app/extensions/community-context.test.ts src/app/extensions/bridge.test.ts`
- Root Phase 1: `pnpm check`
- Template Phase 2: `pnpm typecheck`
- Template Phase 2: `pnpm test`
- Template Phase 2: `pnpm build`

## Risks Or Blockers

- Inline iframe height is currently host-controlled with a fixed minimum; richer widgets may later need a resize protocol.
- Widget repo push is intentionally skipped by user instruction; create a local commit for durability instead.
- The widget repo should depend on the local template SDK during development, but publish-time package metadata may need adjustment before the user pushes publicly.

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
- `/home/johnd/Work/bubdabit-calendar-widget`
