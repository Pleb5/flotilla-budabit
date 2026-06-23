# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Prevent Smart Widget identity collisions by replacing bare `d` identifier usage with canonical widget line IDs for runtime, settings, discovery, updates, and bridge storage.
- Preserve legacy installed widgets and legacy bridge storage reads where practical.
- Keep widget line semantics as publisher pubkey + kind `30033` + same `d` identifier.

## Current Phase

- Phase 3: Bridge Storage Namespace Migration

## Phase Exit Criteria

- New bridge storage writes use a versioned BudaBit prefix such as `budabit:ext:v2:` and encoded canonical extension/widget IDs.
- Repo-scoped storage uses an encoded repo address component rather than raw `repo:{pubkey}:{name}` delimiters.
- `storage:get` falls back to legacy `flotilla:ext:` keys when no v2 value exists.
- `storage:keys` can report v2 keys and legacy keys during transition without duplicates.
- `storage:set`/`storage:remove` write/remove v2 keys and do not create new legacy keys.
- Focused bridge tests cover v2 keys, legacy fallback, repo-scoped keys, and duplicate widget identifiers from different publishers.

## Completed With Evidence

- Previous Smart Widget publish/discover/update workflow completed and pushed through root commit `686e6284 test: cover widget product workflow` and template commit `43243f9 feat: add widget fallback app URLs`.
- Root branch `dev` tracks `origin/dev` and was clean at this workflow start.
- Review found widget runtime/settings/storage currently conflate `widget.identifier` (`d` tag) with host identity, risking collisions for dash-based identifiers reused by different publishers.
- Phase 1 added `getWidgetLineId` to compute `30033:<pubkey>:<identifier>` with a legacy bare identifier fallback.
- Phase 1 registry now stores and loads widgets by canonical widget line ID, while retaining bare-identifier lookup/unregister fallback until settings migration lands.
- Phase 1 discovery now dedupes widgets by canonical widget line ID instead of bare `d` identifier.
- Phase 1 verification passed: `pnpm vitest run src/app/extensions/widget-identity.test.ts src/app/extensions/registry.test.ts src/app/extensions/widget-updates.test.ts src/app/core/commands.test.ts`.
- Phase 1 verification passed: `pnpm check`.
- Phase 2 settings normalization now migrates installed widget maps, enabled IDs, disabled default IDs, widget display config, and widget install sources from legacy bare identifiers to canonical widget line IDs when widget pubkey + identifier are available.
- Phase 2 default widgets, settings UI installed lists, update-check maps, community curated widgets, community slot launchers, prompt checks, primary nav links, and `/widgets` route selection now use canonical widget line IDs for identity while preserving `SmartWidgetEvent.identifier` as raw `d` display data.
- Phase 2 widget install, uninstall cleanup, refresh, and update-check command paths now store and address widgets by canonical widget line IDs.
- Phase 2 tests cover settings migration, same-`d` widgets from different publishers, command install/update/refresh canonical keys, and community slot duplicate-identifier selection.
- Phase 2 verification passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts src/app/extensions/community-widget-slots.test.ts src/app/extensions/community-curation.test.ts`.
- Phase 2 verification passed: `pnpm check`.

## Decisions

- Keep `SmartWidgetEvent.identifier` as the raw Nostr `d` tag.
- Use widget line identity for host/runtime/settings/storage identity: publisher pubkey + kind `30033` + `d` identifier.
- If widget pubkey is missing, retain legacy bare identifier fallback rather than generating unstable identity.
- New bridge storage writes should use a versioned BudaBit prefix; legacy `flotilla:ext:` storage should be read-compatible only.
- Commit and push every verified phase before continuing.

## Current State

- `src/app/extensions/registry.ts` registers widgets under canonical widget line IDs and supports bare identifier fallback lookup during migration.
- `src/app/extensions/settings.ts` normalizes installed widget maps and widget-scoped settings to canonical widget line IDs, retaining bare identifier fallback for widgets missing pubkey metadata.
- `src/app/core/commands.ts` installs/checks/refreshes widgets by canonical widget line ID.
- Settings and route/community UI paths use canonical widget line IDs for installed/default/enabled/update maps and Svelte keys.
- Smart widget discovery and community curation dedupe by canonical widget line ID.
- `src/app/extensions/bridge.ts` still uses `flotilla:ext:{ext.id}:...` storage keys; bridge storage namespace migration is the next phase.

## Next Action

- Start Phase 3 by inspecting `src/app/extensions/bridge.ts` and `src/app/extensions/bridge.test.ts`, then add encoded v2 storage key helpers with legacy read fallback.

## Verification

- `pnpm vitest run src/app/extensions/widget-identity.test.ts src/app/extensions/registry.test.ts src/app/extensions/widget-updates.test.ts src/app/core/commands.test.ts`
- `pnpm check`
- `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts src/app/extensions/community-widget-slots.test.ts src/app/extensions/community-curation.test.ts`
- `pnpm check`

## Risks Or Blockers

- Bridge storage migration must avoid silently hiding existing widget data.
- Widget modal bridge setup still passes bare widget identifiers as bridge IDs until Phase 3 changes canonicalize bridge runtime/storage identity.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/extensions/types.ts`
- `src/app/extensions/registry.ts`
- `src/app/extensions/settings.ts`
- `src/app/extensions/bridge.ts`
- `src/app/core/commands.ts`
- `src/routes/settings/extensions/+page.svelte`
- `src/app/extensions/settings.test.ts`
- `src/app/core/commands.test.ts`
- `src/app/extensions/community-widget-slots.ts`
- `src/app/extensions/community-widget-slots.test.ts`
- `src/app/extensions/community-curation.ts`
- `src/app/components/PrimaryNav.svelte`
- `src/app/components/community/CommunityExtensionsPrompt.svelte`
- `src/app/components/community/CommunityHomeWidgetSlot.svelte`
- `src/app/components/community/CommunityWidgetSlotLaunchers.svelte`
- `src/routes/widgets/+page.svelte`
