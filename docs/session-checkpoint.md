# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Harmonize Budabit extensions around Smart Widgets only.
- Remove the widget display selector and generic `/widgets` launcher so widgets are reachable through declared slots plus the settings preview action.
- Drop NIP-89 manifest extensions from app extension support because Smart Widgets are the only fully supported model and breaking changes are acceptable.

## Current Phase

- Phase 2: Drop NIP-89 Runtime And Settings Support

## Phase Exit Criteria

- `ExtensionManifest`, `LoadedNip89Extension`, and `installed.nip89` app code paths are removed.
- NIP-89 install-by-URL, manifest URL tracking, manifest update checks, discovery, and registry iframe loading are removed.
- Extension provider, bridge permissions, enable/disable/uninstall commands, and repo-tab rendering operate on widgets only.
- Settings Extensions UI lists and manages widgets only.
- Repo extension routes resolve repo-tab Smart Widgets only.
- Focused unit tests are updated and pass for widget-only settings/commands/registry behavior.
- Phase 2 changes are verified, committed, pushed, and the checkpoint is reread.

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

## Decisions

- Smart Widgets are the only supported extension model going forward.
- NIP-89 manifest extension support can be removed with breaking changes.
- Widget placement is declared by Smart Widget `slot` tags, not by a per-user display selector.
- Widgets remain previewable from settings when they expose a secure app URL.
- Generic `/widgets` sidebar launcher should be removed rather than repaired.

## Current State

- Root repo `/home/johnd/Work/budabit` is on branch `dev` tracking `origin/dev`.
- Worktree was clean when this workflow started; Phase 1 changes are ready for commit.
- Branch was already ahead of `origin/dev` by one existing commit when this workflow started.
- Supported Smart Widget slots observed in current code: `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, and `global-menu`.
- Current display selector code has been removed from app code in Phase 1.

## Next Action

- Commit and push Phase 1, reread this checkpoint, then start Phase 2 by removing NIP-89 runtime and settings support.

## Verification

- Initial repository inspection completed with `git status --short --branch`, `git remote -v`, and `git log --oneline -10`.
- Existing extension settings, registry, widget slot, settings UI, primary nav, `/widgets`, and docs files were inspected before writing this plan.
- Phase 1 focused tests passed: `pnpm vitest run src/app/extensions/settings.test.ts src/app/core/commands.test.ts`.
- Phase 1 project check passed: `pnpm check`.

## Risks Or Blockers

- Pushing phase commits will also push the pre-existing ahead commit on `dev` unless the remote state changes.
- Removing settings fields is a breaking change and may drop old `widgetDisplay`/NIP-89 user settings as intended.
- User-facing docs still mention `/widgets` and NIP-89; planned for Phase 3 unless code verification requires earlier edits.

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
- `src/routes/widgets/+page.svelte`
- `src/app/extensions/settings.test.ts`
