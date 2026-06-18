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

- Phase 4: Regression Sweep And Completion

## Phase Exit Criteria

- Searches show no remaining active Budabit UI mount for unsupported slots.
- Searches show no remaining template docs/examples for removed colon slot names except explicit migration notes, if intentionally kept.
- Supported slots parse, publish, display labels, and render as semantic launchers in their intended places.
- Final focused tests and `pnpm check` pass, or any failure is recorded as a real blocker.
- Checkpoint says `Current Phase: Complete` before final commit/push.

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
- Phase 1 commit pushed: `ca17e34e feat: narrow smart widget slots`.
- Phase 2: Community Slot Loading And Budabit Renderers.
- Evidence: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/community-curation.test.ts src/app/extensions/community-widget-trust.test.ts src/app/extensions/builtin.test.ts src/app/extensions/community-widget-slots.test.ts` passed with 11 tests.
- Evidence: `pnpm check` passed with 0 errors and 0 warnings.
- Added cached community curation loading and slot filtering helper in `community-widget-slots.ts`.
- Added shared `CommunityWidgetSlotLaunchers.svelte` for compact message actions and top-bar global menu launchers.
- Rewired community home slots to use cached curation and shared installed/enabled filtering.
- Replaced message placeholder `SlotRenderer` usage with compact `chat-message-actions` launchers that pass message/community context only on click.
- Replaced old global top-menu widget display with community-route-only `global-menu` slot launchers in `TopMenuWidgets.svelte`.
- Updated `WidgetModal.svelte` to pass slot/context/user data via bridge lifecycle events and legacy postMessage context, while keeping iframe rendering inside the modal only.
- Phase 2 commit pushed: `e01003a6 feat: render community widget slots`.
- Phase 3: Extension Template And SDK Alignment.
- Evidence: `pnpm vitest run packages/sdk/src/manifest/generator.test.ts` passed with 22 tests in `packages/flotilla-extension-template`.
- Evidence: `pnpm --filter budabit-sdk typecheck` passed in `packages/flotilla-extension-template`.
- Evidence: `pnpm --filter @budabit/ext-shared build && pnpm --filter @budabit/ext-manifest typecheck` passed in `packages/flotilla-extension-template`.
- Evidence: `grep` search for removed colon slots under `packages/flotilla-extension-template` returned no files.
- Added supported slot union types to the template SDK and manifest generators.
- Updated generators to emit `repo-tab` slot tags with label/path and community slot tags with label only.
- Added CLI slot validation for the five supported slots in both template generator CLIs.
- Added focused generator/CLI validation tests for supported slot generation and invalid slot handling.
- Rewrote template and scaffold slot docs to document only `repo-tab`, community home slots, `chat-message-actions`, and community-scoped `global-menu`.
- Updated template quickstart and host bridge docs to use supported `repo-tab` examples.

## Decisions

- Use `docs/session-plan.md` and `docs/session-checkpoint.md` because the repository already has durable session files there.
- Use dashed slot IDs for Smart Widgets: `chat-message-actions` and `global-menu`.
- Do not render full iframes inline in compact chat message action rows.
- `global-menu` means always accessible while browsing a targeted community, not globally across all Budabit routes.
- Existing dirty extension/widget files are in-progress work and must be preserved rather than reverted.
- Top-bar global widget launchers now come from community-targeted `global-menu` slots, not old `top-menu` display settings.

## Current State

- Branch `dev` tracks `origin/dev`.
- Nested template repo `packages/flotilla-extension-template` is on branch `main` tracking `origin/main`.
- Phase 3 is verified and ready to commit/push in the nested template repo, then record the updated template pointer and this checkpoint in the root repo.
- Several unrelated pre-existing git UI route/component files remain dirty and must not be staged for this phase.

## Next Action

- Commit and push Phase 3 in `packages/flotilla-extension-template`, commit and push the root checkpoint/template pointer, then start Phase 4 regression sweep.

## Verification

- Phase 1 focused tests passed: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/community-curation.test.ts src/app/extensions/community-widget-trust.test.ts`.
- Phase 1 expanded focused tests passed: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/community-curation.test.ts src/app/extensions/community-widget-trust.test.ts src/app/extensions/builtin.test.ts`.
- Phase 1 project check passed: `pnpm check`.
- Phase 2 focused tests passed: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/community-curation.test.ts src/app/extensions/community-widget-trust.test.ts src/app/extensions/builtin.test.ts src/app/extensions/community-widget-slots.test.ts`.
- Phase 2 project check passed: `pnpm check`.
- Phase 3 focused template tests passed: `pnpm vitest run packages/sdk/src/manifest/generator.test.ts`.
- Phase 3 SDK typecheck passed: `pnpm --filter budabit-sdk typecheck`.
- Phase 3 manifest typecheck passed after shared build: `pnpm --filter @budabit/ext-shared build && pnpm --filter @budabit/ext-manifest typecheck`.
- Phase 3 removed-slot scan passed: no matches for unsupported colon slot names under `packages/flotilla-extension-template`.

## Risks Or Blockers

- Pre-existing unrelated dirty git UI files remain in the worktree; do not stage them unless a later phase explicitly requires them.
- Template verification required installing template dependencies with `pnpm install --frozen-lockfile`; no lockfile changes were made.
- Template manifest typecheck requires the shared package declarations to exist, so `pnpm --filter @budabit/ext-shared build` was run before typechecking `@budabit/ext-manifest`.
- No blocker yet.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/components/ChannelMessage.svelte`
- `src/app/components/ChatCompose.svelte`
- `src/app/components/ExtensionCard.svelte`
- `src/app/components/PrimaryNav.svelte`
- `src/app/components/RoomItem.svelte`
- `src/app/components/TopMenuWidgets.svelte`
- `src/app/components/WidgetModal.svelte`
- `src/app/components/community/CommunityExtensionsPrompt.svelte`
- `src/app/components/community/CommunityHomeWidgetSlot.svelte`
- `src/app/components/community/CommunityWidgetSlotLaunchers.svelte`
- `src/app/extensions/builtin-filter.ts`
- `src/app/extensions/builtin.test.ts`
- `src/app/extensions/builtin.ts`
- `src/app/extensions/community-curation.test.ts`
- `src/app/extensions/community-curation.ts`
- `src/app/extensions/community-extension-prompt.ts`
- `src/app/extensions/community-widget-slots.test.ts`
- `src/app/extensions/community-widget-slots.ts`
- `src/app/extensions/community-widget-trust.test.ts`
- `src/app/extensions/community-widget-trust.ts`
- `src/app/extensions/registry.test.ts`
- `src/app/extensions/registry.ts`
- `src/app/extensions/types.ts`
- `src/routes/c/[community]/+page.svelte`
- `src/routes/c/[community]/rooms/[room]/+page.svelte`
- `src/routes/c/[community]/widgets/+page.svelte`
- `src/routes/settings/extensions/+page.svelte`
- `packages/flotilla-extension-template/docs/host-bridge.md`
- `packages/flotilla-extension-template/docs/quickstart.md`
- `packages/flotilla-extension-template/docs/slots.md`
- `packages/flotilla-extension-template/packages/create-budabit-widget/template/docs/host-bridge.md`
- `packages/flotilla-extension-template/packages/create-budabit-widget/template/docs/quickstart.md`
- `packages/flotilla-extension-template/packages/create-budabit-widget/template/docs/slots.md`
- `packages/flotilla-extension-template/packages/manifest/src/cli.ts`
- `packages/flotilla-extension-template/packages/manifest/src/generator.ts`
- `packages/flotilla-extension-template/packages/sdk/src/manifest/cli.ts`
- `packages/flotilla-extension-template/packages/sdk/src/manifest/generator.test.ts`
- `packages/flotilla-extension-template/packages/sdk/src/manifest/generator.ts`
- `packages/flotilla-extension-template/packages/sdk/src/manifest/index.ts`
