# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Harmonize Budabit extensions around Smart Widgets only.
- Remove the widget display selector and generic `/widgets` launcher so widgets are reachable through declared slots plus the settings preview action.
- Drop NIP-89 manifest extensions from app extension support because Smart Widgets are the only fully supported model and breaking changes are acceptable.

## Current Phase

- Complete

## Completion Criteria

- App extension runtime, settings, commands, and repo extension routes are Smart Widget only.
- Widget placement is controlled by Smart Widget `slot` tags, not a per-user display selector.
- The generic `/widgets` route and sidebar launcher are removed; community `/c/[community]/widgets` remains.
- User-facing extension docs no longer say Budabit supports NIP-89 manifest extensions.
- Smart Widget template docs no longer direct developers to NIP-89 as a supported alternative.
- Remaining `NIP-89`/`31990` references are either this workflow record, GRASP repository-state references, or the unrelated notifier handler address in `src/app/core/commands.ts`.
- Focused extension tests and `pnpm check` passed.
- Phase 3 closeout, including this checkpoint, is committed and pushed.

## Completed With Evidence

- Previous GRASP durable workflow was complete before this extension harmonization workflow started.
- Extension harmonization durable plan was created in `docs/session-plan.md`.
- Extension harmonization checkpoint was created in `docs/session-checkpoint.md`.
- Phase 1 removed `WidgetDisplayLocation`, `widgetDisplay`, `getWidgetDisplayConfig`, `setWidgetDisplayConfig`, and `getWidgetsForLocation` from app settings/types.
- Phase 1 removed the display-location dropdown from `ExtensionCard` and renamed the widget action to `Preview app`.
- Phase 1 removed display-location props from Settings > Extensions.
- Phase 1 removed display-driven widget entries from primary navigation.
- Phase 1 deleted the generic `/widgets` route; community `/c/[community]/widgets` is unrelated and remains.
- Phase 1 removed obsolete `widgetDisplay` cleanup from `uninstallExtension` and focused test fixtures/assertions.
- Phase 1 focused verification passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts`.
- Phase 1 project verification passed: `pnpm check`.
- Phase 1 was committed and pushed as `0e8bc3b0 fix: remove widget display selector`.
- Phase 2 removed `ExtensionManifest`, `LoadedNip89Extension`, `ExtensionPolicy`, manifest policy signing, `installed.nip89`, and manifest URL settings from app extension code.
- Phase 2 removed NIP-89 install/update/discovery commands and registry manifest loading/runtime methods.
- Phase 2 simplified extension provider, bridge permission handling, settings UI, repo-tab discovery, and repo extension routes to Smart Widgets only.
- Phase 2 removed NIP-89 install-by-URL UI from Settings > Extensions; only Smart Widget naddr manual install remains.
- Phase 2 updated focused settings, commands, registry, and bridge tests to widget-only fixtures.
- Phase 2 grep found no NIP-89 extension support references left under `src`; the only remaining `31990` under `src` is an unrelated notifier handler address in `src/app/core/commands.ts`.
- Phase 2 focused verification passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts src/app/extensions/registry.test.ts src/app/extensions/bridge.test.ts`.
- Phase 2 project verification passed: `pnpm check`.
- Phase 2 was committed and pushed as `36147296 feat: make extensions widget only`.
- Phase 3 updated top-level, architecture, operations, feature, extension guide, inventory, interoperability, package, and e2e docs/comments to describe Smart Widgets as the supported extension model.
- Phase 3 updated the `packages/flotilla-extension-template` submodule docs and pushed `c818ded docs: align widget extension docs`.
- Phase 3 updated the `packages/budabit-kanban-extension` submodule docs and pushed `db36659 docs: align widget extension docs`.
- Phase 3 updated the root `packages/budabit-pipelines-extension` docs to remove stale NIP-89 support claims.
- Phase 3 updated the widget e2e persistence comment that mentioned `installed.nip89`.
- Phase 3 updated the widget interop client-tag fixture from a `31990` address hint to a URL origin hint.
- Phase 3 grep for `NIP-89|NIP‑89|31990|installed\.nip89` found only workflow records, GRASP repository-state references, and the unrelated notifier handler address.
- Phase 3 grep for `manifest URL|manifest URLs|/widgets|display selector|WidgetDisplay` found no stale user-facing generic `/widgets` or display-selector docs; remaining `/c/[community]/widgets` references are the active community route.
- Phase 3 focused verification passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts src/app/extensions/registry.test.ts src/app/extensions/bridge.test.ts`.
- Phase 3 project verification passed: `pnpm check`.

## Decisions

- Smart Widgets are the only supported extension model going forward.
- NIP-89 manifest extension support can be removed with breaking changes.
- Widget placement is declared by Smart Widget `slot` tags, not by a per-user display selector.
- Widgets remain previewable from settings when they expose a secure app URL.
- Generic `/widgets` sidebar launcher should be removed rather than repaired.
- Community `/c/[community]/widgets` is separate from the removed generic `/widgets` launcher and remains supported.

## Current State

- Root repo `/home/johnd/Work/budabit` is on branch `dev` tracking `origin/dev`.
- Supported Smart Widget slots observed in current code: `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, and `global-menu`.
- Display selector code has been removed from app code.
- NIP-89 app extension support has been removed from app code.
- User-facing extension docs and Smart Widget package docs are aligned to the widget-only model.
- Submodule doc commits have been pushed and the root closeout includes pointer updates.

## Next Action

- Final response.

## Verification

- Initial repository inspection completed with `git status --short --branch`, `git remote -v`, and `git log --oneline -10`.
- Existing extension settings, registry, widget slot, settings UI, primary nav, `/widgets`, and docs files were inspected before writing this plan.
- Phase 1 focused tests passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts`.
- Phase 1 project check passed: `pnpm check`.
- Phase 2 focused tests passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts src/app/extensions/registry.test.ts src/app/extensions/bridge.test.ts`.
- Phase 2 project check passed: `pnpm check`.
- Phase 3 focused tests passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts src/app/extensions/registry.test.ts src/app/extensions/bridge.test.ts`.
- Phase 3 project check passed: `pnpm check`.

## Risks Or Blockers

- None open.
- Removing settings fields is a breaking change and may drop old `widgetDisplay`/NIP-89 user settings as intended.
- `src/app/core/commands.ts` still contains a `31990` notifier handler address unrelated to app extension support.
- `packages/nostr-git-core` still uses `31990` for GRASP repository state events; this is unrelated to app extension support.

## Files

- `README.md`
- `docs/session-checkpoint.md`
- `docs/session-plan.md`
- `docs/Overview.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
- `docs/extensions/README.md`
- `docs/extensions/INVENTORY.md`
- `docs/extensions/INTEROPERABILITY.md`
- `docs/features/ENABLED_FEATURES.md`
- `docs/ops/SERVING_INSTRUCTIONS.md`
- `docs/ops/self-hosting.md`
- `packages/budabit-pipelines-extension/docs/architecture.md`
- `packages/budabit-pipelines-extension/docs/manifest.md`
- `packages/budabit-pipelines-extension/docs/quickstart.md`
- `packages/flotilla-extension-template` submodule pointer
- `packages/budabit-kanban-extension` submodule pointer
- `tests/e2e/widget-acceptance.spec.ts`
- `tests/e2e/widget-interop.spec.ts`
