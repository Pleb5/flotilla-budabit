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

- Phase 2: Flotilla Extension Template SDK And Docs

## Phase Exit Criteria

- SDK types include `communityContext`, logical community write targets, and `community:queryTargetEvents` request/response types.
- Template docs explain inline home slots, generic community context, dynamic section-aware target querying, and write-access-only configuration gating.
- Template sample code demonstrates reading `communityContext` without relying on calendar-specific host fields.
- Template tests/build pass.
- The nested template repo is committed and pushed; the root repo records the updated submodule pointer if it changes.

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

## Decisions

- Use generic community context rather than calendar-specific host fields such as `canCreateCalendarEvents`.
- Widgets derive calendar configuration permission from logical write targets `calendar` and `calendarDate`.
- Visibility is not gated by calendar grant. Only configuration controls are gated.
- Community section names are dynamic per community; host query APIs must map logical targets to current community sections before querying.
- `community:queryTargetEvents` is a privileged bridge action requiring an explicit widget `permission` tag.
- The featured calendar widget belongs in `/home/johnd/Work/bubdabit-calendar-widget` as a separate local repo. Do not push it; the user will push later.
- Commit and push every verified BudaBit/root phase before continuing.

## Current State

- Phase 1 implementation, verification, commit, push, and checkpoint reread are complete.
- Root repo is clean at the start of Phase 2.
- `packages/flotilla-extension-template` is not modified yet for this workflow.

## Next Action

- Start Phase 2 by updating template SDK types/docs/sample code for `communityContext` and `community:queryTargetEvents`.

## Verification

- `pnpm vitest run src/app/extensions/community-context.test.ts src/app/extensions/bridge.test.ts`
- `pnpm check`

## Risks Or Blockers

- Inline iframe height is currently host-controlled with a fixed minimum; richer widgets may later need a resize protocol.
- Template SDK/docs must match the Phase 1 host payload and bridge request names exactly.
- Widget repo push is intentionally skipped by user instruction; create a local commit for durability instead.

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
