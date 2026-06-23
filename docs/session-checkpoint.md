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

- Phase 2: Blossom-Backed Community Widget Publisher

## Phase Exit Criteria

- Community widget publisher can upload/select a built widget app artifact through existing Blossom primitives/settings where practical.
- Publisher emits widget events with primary `button`/`app` URL plus ordered fallback `app-url` tags.
- Targeting UI only exposes communities where the current user can write widget targets.
- Publisher can target one or more eligible communities in one flow without exposing ineligible communities.
- Focused tests cover event tag construction and permission-gated target option behavior where helper boundaries allow.

## Completed With Evidence

- Previous Smart Widget update/publish workflow is complete through root commit `6ada5638 docs: complete widget update workflow` and template commit `48c454d feat: add widget release metadata`.
- Root branch `dev` and nested template branch `main` were clean at new workflow start.
- Phase 1 implemented ordered Smart Widget app URL support with primary `appUrl` compatibility and `appUrls` fallbacks.
- Phase 1 parser now reads secure fallback URLs from repeatable `app-url` tags and rejects insecure fallback URLs.
- Phase 1 update diff now compares the ordered app URL list, including fallback changes.
- Phase 1 runtime/card/modal paths use the ordered app URL list and attempt fallback on iframe load failure.
- Phase 1 verification passed: `pnpm vitest run src/app/extensions/registry.test.ts src/app/extensions/widget-updates.test.ts`.
- Phase 1 verification passed: `pnpm check`.

## Decisions

- Use `docs/session-plan.md` and `docs/session-checkpoint.md` for this durable workflow.
- Keep installed widget updates manual; no auto-update.
- Same widget line remains publisher pubkey + kind `30033` + same `d` identifier.
- Use newer `created_at` for update freshness; `version`/`changelog` are display metadata.
- Preserve community trusted/endorsed vs other curated widget distinction.
- Use only viable slots: `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, `global-menu`.
- Reuse existing Blossom upload primitives where practical.
- Template changes require separate nested repo commit/push before root submodule pointer update.
- Preserve existing `button`/`app` as the compatible primary app URL and use repeatable `app-url` tags for ordered fallback app URLs.

## Current State

- Branch `dev` tracks `origin/dev`.
- Nested template repo `packages/flotilla-extension-template` is on branch `main` tracking `origin/main`.
- Current community widget publisher exists at `src/routes/c/[community]/widgets/+page.svelte`, but is manual URL-based and does not upload artifacts to Blossom.
- Current Smart Widget parser stores the compatible primary `appUrl` from the first `button`/`app` URL and ordered `appUrls` from primary plus repeatable `app-url` fallback tags.
- Settings update UI exists for manually installed widgets.
- Community curation/trust helpers already filter targeting events by widget-write permissions and distinguish trusted owner/moderator authors.

## Next Action

- Start Phase 2 by inspecting the community widget publisher, existing Blossom upload helpers/settings, and widget targeting permission helpers.

## Verification

- `pnpm vitest run src/app/extensions/registry.test.ts src/app/extensions/widget-updates.test.ts`
- `pnpm check`

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
