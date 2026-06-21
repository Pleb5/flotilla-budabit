# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Bridge the Smart Widget update/publish UX gaps with a minimal user-controlled workflow.
- Detect newer installed Smart Widget events and notify users with update badges, but do not auto-update.
- Let users manually apply widget updates while preserving existing settings.
- Improve publisher release UX for stable Blossom-backed widget versions without building a complex marketplace/review system.

## Current Phase

- Phase 4: Regression Sweep And Completion

## Phase Exit Criteria

- Installed widget update detection exists and is manually applied, not automatic.
- Settings exposes update badges/actions for installed widgets.
- Widget install source relay hints are preserved and normalized.
- Template publisher flow supports stable identifier, version/changelog metadata, and Blossom-backed release explanation.
- Final focused tests and `pnpm check` pass, or any failure is recorded as a real blocker.
- Checkpoint says `Current Phase: Complete` before final commit/push.

## Completed With Evidence

- Previous Smart Widget slot narrowing workflow is complete and pushed through root commit `236919b2 docs: finalize smart widget checkpoint` and template commit `481ac7c feat: align smart widget slots`.
- Phase 1: Widget Update Foundations.
- Evidence: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/settings.test.ts src/app/extensions/widget-updates.test.ts src/app/core/commands.test.ts` passed with 55 tests.
- Evidence: `pnpm check` passed with 0 errors and 0 warnings.
- Added optional Smart Widget `version` and `changelog` parsing.
- Added normalized `widgetInstallSources` settings metadata for naddr/relay hints.
- Added `widget-updates.ts` helpers for same-line update matching, update filters, relay selection, and diff summaries.
- Added `checkForWidgetUpdate` and `refreshWidget` commands.
- Updated widget install-by-naddr to preserve source naddr and relays.
- Phase 1 commit pushed: `ccf6a1dd feat: add widget update foundations`.
- Phase 2: Manual Widget Update UX.
- Evidence: `pnpm vitest run --project=main src/app/extensions/widget-updates.test.ts src/app/core/commands.test.ts` passed with 40 tests.
- Evidence: `pnpm check` passed with 0 errors and 0 warnings.
- Settings now checks manually installed Smart Widgets for newer same-line events without auto-applying them.
- Installed section shows widget update checking and available-update badges.
- Widget cards show widget update availability, a manual update button, release version metadata, and a concise diff/changelog summary.
- Manual widget update application calls `refreshWidget`, preserving existing display/settings and reloading enabled widgets through the Phase 1 command.
- Phase 2 root commit pushed: `b1a1c599 feat: surface widget updates in settings`.
- Phase 3: Publisher Release UX.
- Evidence: `pnpm --filter budabit-sdk test -- src/manifest/generator.test.ts` passed with 23 tests.
- Evidence: `pnpm --filter budabit-sdk typecheck` passed.
- Evidence: `pnpm --filter @budabit/ext-manifest typecheck` passed.
- Evidence: `pnpm --filter create-budabit-widget typecheck` passed.
- Template manifest generator copies now support optional `version` and `changelog` tags.
- Generator CLI accepts `--version` and `--changelog`, warns to use explicit stable `--identifier` for releases, and previews identifier, release metadata, app URL, and relay targets.
- Publish dry-run and publish details preview identifier, release metadata, app URL, and relay targets.
- Template README/quickstart/manifest docs and scaffold defaults describe the Blossom-backed same-`d` release workflow.
- Phase 3 template commit pushed: `48c454d feat: add widget release metadata`.

## Decisions

- Use `docs/session-plan.md` and `docs/session-checkpoint.md` for this durable workflow.
- Keep update application manual for now; no auto-update.
- Treat same publisher pubkey plus same kind `30033` plus same `d` identifier as the same widget line.
- Use newer `created_at` as the update freshness signal; `version`/`changelog` are display metadata only for now.
- Preserve existing community-endorsed vs other widget sections.
- Use Welshman utilities where they fit; Welshman `Address`/`getAddress` and tag helpers are the preferred reference for addressable event identity.

## Current State

- Branch `dev` tracks `origin/dev`.
- Nested template repo `packages/flotilla-extension-template` is on branch `main` tracking `origin/main`.
- Phase 1 is committed and pushed.
- Phase 2 is committed and pushed.
- Phase 3 nested template commit is pushed; root submodule pointer is updated in this phase transition.
- Existing NIP-89 update UX remains intact.
- Smart Widget installed update UI exists for non-default, manually installed widgets; community defaults remain distinguished as defaults.

## Next Action

- Start Phase 4 by searching update helper usage and stale TODO/doc contradictions, then run final focused root/template verification.

## Verification

- Phase 1 focused tests passed: `pnpm vitest run --project=main src/app/extensions/registry.test.ts src/app/extensions/settings.test.ts src/app/extensions/widget-updates.test.ts src/app/core/commands.test.ts`.
- Phase 1 project check passed: `pnpm check`.
- Phase 2 focused tests passed: `pnpm vitest run --project=main src/app/extensions/widget-updates.test.ts src/app/core/commands.test.ts`.
- Phase 2 project check passed: `pnpm check`.
- Phase 3 template generator test passed: `pnpm --filter budabit-sdk test -- src/manifest/generator.test.ts`.
- Phase 3 SDK typecheck passed: `pnpm --filter budabit-sdk typecheck`.
- Phase 3 manifest typecheck passed: `pnpm --filter @budabit/ext-manifest typecheck`.
- Phase 3 scaffold typecheck passed: `pnpm --filter create-budabit-widget typecheck`.

## Risks Or Blockers

- Template repo was committed and pushed before updating the root submodule pointer.
- Widget update checks need useful relay hints; Phase 1 preserves manual naddr relays and falls back to existing Smart Widget/indexer relays.
- No blocker yet.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/extensions/types.ts`
- `src/app/extensions/registry.ts`
- `src/app/extensions/settings.ts`
- `src/app/extensions/widget-updates.ts`
- `src/app/extensions/widget-updates.test.ts`
- `src/app/core/commands.ts`
- `src/app/core/commands.test.ts`
- `src/app/extensions/registry.test.ts`
- `src/app/extensions/settings.test.ts`
- `src/routes/settings/extensions/+page.svelte`
- `src/app/components/ExtensionCard.svelte`
- `packages/flotilla-extension-template`
- `packages/flotilla-extension-template/packages/sdk/src/manifest/generator.ts`
- `packages/flotilla-extension-template/packages/sdk/src/manifest/cli.ts`
- `packages/flotilla-extension-template/packages/sdk/src/manifest/publish.ts`
- `packages/flotilla-extension-template/packages/sdk/src/manifest/generator.test.ts`
- `packages/flotilla-extension-template/packages/manifest/src/generator.ts`
- `packages/flotilla-extension-template/packages/manifest/src/cli.ts`
- `packages/flotilla-extension-template/packages/manifest/src/publish.ts`
- `packages/flotilla-extension-template/docs/quickstart.md`
- `packages/flotilla-extension-template/docs/manifest.md`
- `packages/flotilla-extension-template/README.md`
