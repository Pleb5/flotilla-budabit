# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Keep only these Smart Widget slots for now: `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, and `global-menu`.
- Convert Smart Widget slot naming to dashed IDs for chat/global slots and remove or ignore old unsupported colon-separated slot placeholders.
- Make `chat-message-actions` and `global-menu` community-targetable and render them as semantic launchers, not blind inline iframes.
- Treat `global-menu` as always accessible only within targeted community routes.
- Update Budabit and the extension template with sufficient focused tests.

## Current Phase

- Phase 2: Community Slot Loading And Budabit Renderers

## Phase Exit Criteria

- Old unsupported `SlotRenderer` mounts are removed from composer actions, room header actions, community sidebar widgets, settings panel, and room panel paths.
- `chat-message-actions` renders compact action launchers in `ChannelMessage.svelte` and `RoomItem.svelte` and passes message/community context only when the user clicks.
- `chat-message-actions` does not load curation data once per message row.
- `global-menu` renders only on community routes and only for widgets targeted to that community, as an always-accessible community launcher.
- Community home slots use the same supported slot typing and continue to render installed+enabled targeted widgets.
- Widget launchers open widgets without inline iframes in compact slots.
- Focused tests or `pnpm check` cover changed components/helpers.

## Completed With Evidence

- Previous calendar workflow in these session files was already complete and has been replaced for this Smart Widget slot workflow.
- Phase 1: Supported Slot Model And Community Management.
- Evidence: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/community-curation.test.ts src/app/extensions/community-widget-trust.test.ts` passed with 9 tests.
- Evidence: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/community-curation.test.ts src/app/extensions/community-widget-trust.test.ts src/app/extensions/builtin.test.ts` passed with 10 tests.
- Evidence: `pnpm check` passed with 0 errors and 0 warnings.
- Implemented a strict supported Smart Widget slot union for `repo-tab`, both community home slots, `chat-message-actions`, and `global-menu`.
- Updated `parseSmartWidget` to parse supported dashed community slots and ignore unsupported old colon slot names.
- Updated community widget creation/list UI and settings cards to publish/display all supported non-repo slot labels.
- Added focused parser tests for supported community slots, `repo-tab`, label fallback, and ignored legacy colon slot tags.
- Removed unsupported old typed `SlotRenderer` mounts from composer, room header, and primary nav; message placeholder mounts now use `chat-message-actions` pending Phase 2 renderer replacement.
- Incorporated current in-progress community widget curation/trust/home-slot/default-owner files that are required by the current community widget workflow.

## Decisions

- Use `docs/session-plan.md` and `docs/session-checkpoint.md` because the repository already has durable session files there.
- Use dashed slot IDs for Smart Widgets: `chat-message-actions` and `global-menu`.
- Do not render full iframes inline in compact chat message action rows.
- `global-menu` means always accessible while browsing a targeted community, not globally across all Budabit routes.
- Existing dirty extension/widget files are in-progress work and must be preserved rather than reverted.

## Current State

- Branch `dev` tracks `origin/dev` and was already ahead by one commit before this workflow began.
- Phase 1 is verified and ready to commit/push with only related slot/community-widget files staged.
- Several unrelated pre-existing git UI route/component files remain dirty and must not be staged for this phase.

## Next Action

- Commit and push Phase 1, then reread this checkpoint and start Phase 2 by adding cached community slot loading plus chat/global semantic launchers.

## Verification

- Phase 1 focused tests passed: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/community-curation.test.ts src/app/extensions/community-widget-trust.test.ts`.
- Phase 1 expanded focused tests passed: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/community-curation.test.ts src/app/extensions/community-widget-trust.test.ts src/app/extensions/builtin.test.ts`.
- Phase 1 project check passed: `pnpm check`.

## Risks Or Blockers

- Pre-existing dirty files overlap the extension/widget area, so every phase must inspect diffs carefully and stage only intended files.
- Branch is already ahead of `origin/dev`; a phase push will also push any pre-existing unpushed local commit on this branch.
- No blocker yet.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/components/ChannelMessage.svelte`
- `src/app/components/ChatCompose.svelte`
- `src/app/components/ExtensionCard.svelte`
- `src/app/components/PrimaryNav.svelte`
- `src/app/components/RoomItem.svelte`
- `src/app/components/community/CommunityExtensionsPrompt.svelte`
- `src/app/components/community/CommunityHomeWidgetSlot.svelte`
- `src/app/extensions/builtin-filter.ts`
- `src/app/extensions/builtin.test.ts`
- `src/app/extensions/builtin.ts`
- `src/app/extensions/community-curation.test.ts`
- `src/app/extensions/community-curation.ts`
- `src/app/extensions/community-extension-prompt.ts`
- `src/app/extensions/community-widget-trust.test.ts`
- `src/app/extensions/community-widget-trust.ts`
- `src/app/extensions/registry.test.ts`
- `src/app/extensions/registry.ts`
- `src/app/extensions/types.ts`
- `src/routes/c/[community]/+page.svelte`
- `src/routes/c/[community]/rooms/[room]/+page.svelte`
- `src/routes/c/[community]/widgets/+page.svelte`
- `src/routes/settings/extensions/+page.svelte`
