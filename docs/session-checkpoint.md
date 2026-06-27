# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Harmonize Budabit extensions around Smart Widgets only.
- Remove the widget display selector and generic `/widgets` launcher so widgets are reachable through declared slots plus the settings preview action.
- Drop NIP-89 manifest extensions from app extension support because Smart Widgets are the only fully supported model and breaking changes are acceptable.

## Current Phase

- Phase 3: Documentation Cleanup And Final Verification

## Phase Exit Criteria

- User-facing extension docs no longer say Budabit supports NIP-89 manifest extensions.
- Smart Widget template docs no longer direct developers to NIP-89 as a supported alternative.
- Remaining `NIP-89`/`31990` references are either outside the app extension feature or explicitly unrelated to extension support.
- End-to-end comments or docs that mention `installed.nip89` are updated.
- Final focused tests and project-level verification pass, or a concrete blocker is recorded.
- Checkpoint records `Current Phase: Complete` and final closeout is committed and pushed.

## Completed With Evidence

- Previous GRASP durable workflow was complete before this extension harmonization workflow started.
- New extension harmonization durable plan created in `docs/session-plan.md`.
- New extension harmonization checkpoint created in `docs/session-checkpoint.md`.
- Phase 1 removed `WidgetDisplayLocation`, `widgetDisplay`, `getWidgetDisplayConfig`, `setWidgetDisplayConfig`, and `getWidgetsForLocation` from app settings/types.
- Phase 1 removed the display-location dropdown from `ExtensionCard` and renamed the widget action to `Preview app`.
- Phase 1 removed display-location props from Settings > Extensions.
- Phase 1 removed display-driven widget entries from primary navigation.
- Phase 1 deleted the generic `/widgets` route; community `/c/[community]/widgets` is unrelated and remains.
- Phase 1 removed obsolete `widgetDisplay` cleanup from `uninstallExtension` and focused test fixtures/assertions.
- Phase 1 verification passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts`.
- Phase 1 project verification passed: `pnpm check`.
- Phase 1 was committed and pushed as `0e8bc3b0 fix: remove widget display selector`.
- Phase 2 removed `ExtensionManifest`, `LoadedNip89Extension`, `ExtensionPolicy`, manifest policy signing, `installed.nip89`, and manifest URL settings from app extension code.
- Phase 2 removed NIP-89 install/update/discovery commands and registry manifest loading/runtime methods.
- Phase 2 simplified extension provider, bridge permission handling, settings UI, repo-tab discovery, and repo extension routes to Smart Widgets only.
- Phase 2 removed NIP-89 install-by-URL UI from Settings > Extensions; only Smart Widget naddr manual install remains.
- Phase 2 updated focused settings, commands, registry, and bridge tests to widget-only fixtures.
- Phase 2 grep found no NIP-89 extension support references left under `src`; the only remaining `31990` under `src` is an unrelated notifier handler address in `src/app/core/commands.ts`.
- Phase 2 focused tests passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts src/app/extensions/registry.test.ts src/app/extensions/bridge.test.ts`.
- Phase 2 project verification passed: `pnpm check`.

## Decisions

- Smart Widgets are the only supported extension model going forward.
- NIP-89 manifest extension support can be removed with breaking changes.
- Widget placement is declared by Smart Widget `slot` tags, not by a per-user display selector.
- Widgets remain previewable from settings when they expose a secure app URL.
- Generic `/widgets` sidebar launcher should be removed rather than repaired.

## Current State

- Root repo `/home/johnd/Work/budabit` is on branch `dev` tracking `origin/dev`.
- Worktree was clean when this workflow started; Phase 2 changes are ready for commit.
- Branch is synced with `origin/dev` as of the Phase 1 push, before committing Phase 2.
- Supported Smart Widget slots observed in current code: `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, and `global-menu`.
- Current display selector code has been removed from app code in Phase 1.
- NIP-89 app extension support has been removed from app code in Phase 2.

## Next Action

- Commit and push Phase 2, reread this checkpoint, then start Phase 3 by updating docs/templates and final references.

## Verification

- Initial repository inspection completed with `git status --short --branch`, `git remote -v`, and `git log --oneline -10`.
- Existing extension settings, registry, widget slot, settings UI, primary nav, `/widgets`, and docs files were inspected before writing this plan.
- Phase 1 focused tests passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts`.
- Phase 1 project check passed: `pnpm check`.
- Phase 2 focused tests passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts src/app/extensions/registry.test.ts src/app/extensions/bridge.test.ts`.
- Phase 2 project check passed: `pnpm check`.

## Risks Or Blockers

- Removing settings fields is a breaking change and may drop old `widgetDisplay`/NIP-89 user settings as intended.
- User-facing docs still mention `/widgets` and NIP-89; planned for Phase 3 unless code verification requires earlier edits.
- `src/app/core/commands.ts` still contains a `31990` notifier handler address unrelated to app extension support.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/extensions/types.ts`
- `src/app/extensions/settings.ts`
- `src/app/components/ExtensionCard.svelte`
- `src/routes/settings/extensions/+page.svelte`
- `src/app/components/PrimaryNav.svelte`
- `src/app/core/commands.ts`
- `src/app/core/commands.test.ts`
- `src/app/core/state.ts`
- `src/app/extensions/bridge.ts`
- `src/app/extensions/bridge.test.ts`
- `src/app/extensions/index.ts`
- `src/app/extensions/policySigner.ts`
- `src/app/extensions/provider.svelte`
- `src/app/extensions/registry.ts`
- `src/app/extensions/registry.test.ts`
- `src/routes/widgets/+page.svelte`
- `src/app/extensions/settings.test.ts`
- `src/routes/git/[id=naddr]/+layout.svelte`
- `src/routes/git/[id=naddr]/extensions/[extId]/+page.svelte`
