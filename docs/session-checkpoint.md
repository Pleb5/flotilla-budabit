# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Make Smart Widget community publishing/discovery/install/update minimally usable at product quality.
- Let publishers target widgets to one or more communities where they have widget-write permission.
- Support Blossom-backed widget app artifacts with mirrored/fallback app URLs in the widget event.
- Let members discover trusted/community-curated widgets, install them, see manual update badges/details, and swap to newer widget events.
- Keep owner/widget-moderator trusted display behavior and viable slot constraints intact.
- Align the nested template generator/CLI/docs with BudaBit's supported event shape and workflow.

## Current Phase

- Phase 1: Multi-URL Widget Event Foundation

## Phase Exit Criteria

- `SmartWidgetEvent` can represent ordered app URLs with a primary `appUrl` and fallback URLs.
- `parseSmartWidget` reads all secure app URLs from supported tags while preserving compatibility with the existing first `button`/`app` URL.
- Widget update diffs include app URL/fallback changes.
- Runtime/widget card open behavior can use the ordered app URL list and attempt fallback on iframe load failure.
- Focused tests cover parsing multi-URL events and diffing fallback URL changes.

## Completed With Evidence

- Previous Smart Widget update/publish workflow is complete through root commit `6ada5638 docs: complete widget update workflow` and template commit `48c454d feat: add widget release metadata`.
- Root branch `dev` and nested template branch `main` were clean at new workflow start.

## Decisions

- Use `docs/session-plan.md` and `docs/session-checkpoint.md` for this durable workflow.
- Keep installed widget updates manual; no auto-update.
- Same widget line remains publisher pubkey + kind `30033` + same `d` identifier.
- Use newer `created_at` for update freshness; `version`/`changelog` are display metadata.
- Preserve community trusted/endorsed vs other curated widget distinction.
- Use only viable slots: `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, `global-menu`.
- Reuse existing Blossom upload primitives where practical.
- Template changes require separate nested repo commit/push before root submodule pointer update.

## Current State

- Branch `dev` tracks `origin/dev`.
- Nested template repo `packages/flotilla-extension-template` is on branch `main` tracking `origin/main`.
- Current community widget publisher exists at `src/routes/c/[community]/widgets/+page.svelte`, but is manual URL-based and does not upload artifacts to Blossom.
- Current Smart Widget parser stores a single `appUrl` from the first `button`/`app` URL.
- Settings update UI exists for manually installed widgets.
- Community curation/trust helpers already filter targeting events by widget-write permissions and distinguish trusted owner/moderator authors.

## Next Action

- Start Phase 1 by inspecting Smart Widget types/parser/card/update diff tests and implementing multi-URL app fallback support.

## Verification

- Not run yet for this workflow.

## Risks Or Blockers

- Full Blossom upload UI may need a minimal server/mirror input first rather than a complete target picker.
- Playwright E2E may need deterministic mock relay and mocked Blossom server plumbing; if browser environment blocks this, record the blocker and keep unit/integration coverage strong.
- Multi-URL event shape must remain compatible with existing installed widgets and template-generated events.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/extensions/types.ts`
- `src/app/extensions/registry.ts`
- `src/app/extensions/widget-updates.ts`
- `src/app/components/ExtensionCard.svelte`
- `src/routes/c/[community]/widgets/+page.svelte`
- `src/app/extensions/widget-targeting.ts`
- `packages/flotilla-extension-template`
