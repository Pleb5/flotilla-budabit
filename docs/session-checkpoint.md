# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Prevent Smart Widget identity collisions by replacing bare `d` identifier usage with canonical widget line IDs for runtime, settings, discovery, updates, and bridge storage.
- Preserve legacy installed widgets and legacy bridge storage reads where practical.
- Keep widget line semantics as publisher pubkey + kind `30033` + same `d` identifier.

## Current Phase

- Phase 2: Settings And UI Key Migration

## Phase Exit Criteria

- New widget installs persist under canonical widget line IDs.
- Existing settings keyed by bare identifiers migrate to canonical IDs when stored widgets include pubkey + identifier.
- Enabled IDs, disabled default IDs, widget display config, widget install sources, and update state use canonical widget line IDs.
- Settings UI can display and operate on two installed widgets with the same `d` identifier from different publishers.
- Focused settings/UI helper tests cover migration and duplicate identifiers.

## Completed With Evidence

- Previous Smart Widget publish/discover/update workflow completed and pushed through root commit `686e6284 test: cover widget product workflow` and template commit `43243f9 feat: add widget fallback app URLs`.
- Root branch `dev` tracks `origin/dev` and was clean at this workflow start.
- Review found widget runtime/settings/storage currently conflate `widget.identifier` (`d` tag) with host identity, risking collisions for dash-based identifiers reused by different publishers.
- Phase 1 added `getWidgetLineId` to compute `30033:<pubkey>:<identifier>` with a legacy bare identifier fallback.
- Phase 1 registry now stores and loads widgets by canonical widget line ID, while retaining bare-identifier lookup/unregister fallback until settings migration lands.
- Phase 1 discovery now dedupes widgets by canonical widget line ID instead of bare `d` identifier.
- Phase 1 verification passed: `pnpm vitest run src/app/extensions/widget-identity.test.ts src/app/extensions/registry.test.ts src/app/extensions/widget-updates.test.ts src/app/core/commands.test.ts`.
- Phase 1 verification passed: `pnpm check`.

## Decisions

- Keep `SmartWidgetEvent.identifier` as the raw Nostr `d` tag.
- Use widget line identity for host/runtime/settings/storage identity: publisher pubkey + kind `30033` + `d` identifier.
- If widget pubkey is missing, retain legacy bare identifier fallback rather than generating unstable identity.
- New bridge storage writes should use a versioned BudaBit prefix; legacy `flotilla:ext:` storage should be read-compatible only.
- Commit and push every verified phase before continuing.

## Current State

- `src/app/extensions/registry.ts` registers widgets under canonical widget line IDs and supports bare identifier fallback lookup during migration.
- `src/app/extensions/settings.ts` stores installed widgets, enabled IDs, display configs, and install sources keyed by bare widget identifier.
- `src/app/core/commands.ts` installs/checks/refreshes widgets by bare identifier.
- `src/app/extensions/bridge.ts` uses `flotilla:ext:{ext.id}:...` storage keys, and widget `ext.id` is currently the bare identifier.
- `discoverSmartWidgets` dedupes by canonical widget line ID.

## Next Action

- Start Phase 2 by migrating settings and UI widget-keyed records from bare identifiers to canonical widget line IDs.

## Verification

- `pnpm vitest run src/app/extensions/widget-identity.test.ts src/app/extensions/registry.test.ts src/app/extensions/widget-updates.test.ts src/app/core/commands.test.ts`
- `pnpm check`

## Risks Or Blockers

- Settings migration must avoid losing user-installed widgets, enabled state, display config, and install source hints.
- Some legacy/default widgets may lack pubkey; they must keep working with fallback identity.
- Bridge storage migration must avoid silently hiding existing widget data.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/extensions/types.ts`
- `src/app/extensions/registry.ts`
- `src/app/extensions/settings.ts`
- `src/app/extensions/bridge.ts`
- `src/app/core/commands.ts`
- `src/routes/settings/extensions/+page.svelte`
