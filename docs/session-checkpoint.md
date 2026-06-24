# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Replace extension-facing community write target taxonomy with generic event-descriptor APIs.
- Use `{kind, subtype?}` descriptors for write capability checks and community event queries.
- Remove section-name fallbacks from eligibility decisions; missing descriptor mappings must error.
- Add runtime community context versioning and `community:contextChanged` to mitigate stale iframe state.
- Update the SDK/template/docs and local featured calendar widget to use descriptor APIs.

## Current Phase

- Complete

## Phase Exit Criteria

- Root host descriptor API changes are committed and pushed.
- Template SDK/docs/sample descriptor API changes are committed and pushed, and root records the updated submodule pointer.
- Local calendar widget descriptor API changes are committed locally and intentionally not pushed.
- Root checkpoint records `Current Phase: Complete` and is committed/pushed.

## Completed With Evidence

- Previous inline-widget/logical-target workflow was completed and superseded by the descriptor API redesign.
- Phase 1 replaced root extension-facing logical target APIs with descriptor APIs in `src/app/extensions/types.ts`, `src/app/extensions/community-context.ts`, and `src/app/extensions/bridge.ts`.
- Phase 1 removed `CommunityWidgetContext.writeTargets` from root public context and added runtime `contextSessionId` / `contextVersion`.
- Phase 1 added descriptor resolution by active community sections only, with missing descriptor mappings throwing errors instead of falling back to default section names.
- Phase 1 added `community:checkWriteCapabilities` and `community:queryEvents` bridge actions with descriptor request/response metadata.
- Phase 1 preserved authorized two-hop targeted-publication event loading for targetable community event kinds.
- Phase 1 updated `WidgetFrame.svelte` to emit `community:contextChanged` when `contextSessionId` / `contextVersion` changes after init.
- Phase 1 focused verification passed: `pnpm vitest run src/app/extensions/community-context.test.ts src/app/extensions/bridge.test.ts`.
- Phase 1 root verification passed: `pnpm check`.
- Phase 2 updated `packages/flotilla-extension-template` SDK/shared types to expose `CommunityEventDescriptor`, descriptor write capabilities, `community:checkWriteCapabilities`, `community:queryEvents`, `contextSessionId`, `contextVersion`, and `community:contextChanged`.
- Phase 2 updated the generated sample app to use descriptor constants, descriptor capability checks, descriptor event queries, and stale-response/context-change handling.
- Phase 2 updated template docs, READMEs, manifest examples, and package scripts to use `community:checkWriteCapabilities` and `community:queryEvents` permissions.
- Phase 2 verification passed in the template repo: `pnpm typecheck`.
- Phase 2 verification passed in the template repo: `pnpm test`.
- Phase 2 verification passed in the template repo: `pnpm build`.
- Phase 2 template repo commit `564ec8f feat: document descriptor community APIs` was pushed to `origin/main`.
- Phase 2 root submodule pointer/checkpoint closeout was committed and pushed to `origin/dev` as root commit `a0335f5b chore: update descriptor widget template`.
- Phase 3 updated `/home/johnd/Work/budabit-calendar-widget` to remove extension-facing `writeTargets`, `calendar`/`calendarDate` target IDs, and `community:queryTargetEvents` usage.
- Phase 3 widget now declares descriptors `{kind: 31923}` and `{kind: 31922}`, checks configuration access through `community:checkWriteCapabilities`, and loads events through `community:queryEvents`.
- Phase 3 widget listens for `community:contextChanged`, refetches capabilities/events, and ignores stale responses whose `contextSessionId` / `contextVersion` do not match the current context.
- Phase 3 widget manifest helper scripts and docs now request `community:checkWriteCapabilities` and `community:queryEvents` permissions.
- Phase 3 widget verification passed: `pnpm check`.
- Phase 3 widget repo local commit `0d79708 feat: use descriptor community APIs` was created on branch `master` and intentionally not pushed.

## Decisions

- Extension APIs should speak in event descriptors `{kind, subtype?}`, not BudaBit target names such as `calendar` or `calendarDate`.
- `COMMUNITY_WRITE_TARGETS` can remain an internal UI/default taxonomy, but must not be required by extension APIs.
- No section-name fallback is allowed for eligibility. If a descriptor maps to no active community section, the host cannot answer and must error.
- If multiple sections match a descriptor in imported/malformed data, union them; any matching writable section means `canWrite`. The BudaBit interface should prevent duplicate kind/subtype sections.
- `community:contextChanged` is the host-to-widget update event name.
- `contextVersion` is runtime-only and resets on BudaBit/widget remount; use `contextSessionId` plus `contextVersion` for stale-response detection.
- No backward compatibility is needed for the existing `community:queryTargetEvents` / `writeTargets` feature because it has not shipped.
- The local calendar widget repo at `/home/johnd/Work/budabit-calendar-widget` remains local-only and should not be pushed.

## Current State

- Root repo `/home/johnd/Work/budabit` is on branch `dev` tracking `origin/dev`.
- Root host descriptor API work is committed and pushed as `2fd96217 feat: add descriptor community APIs`.
- Template descriptor SDK/docs/sample work is committed and pushed in the nested repo as `564ec8f feat: document descriptor community APIs`.
- Root records the template submodule pointer via `a0335f5b chore: update descriptor widget template`.
- Local widget descriptor migration is verified and locally committed as `0d79708 feat: use descriptor community APIs`; it remains local-only.

## Next Action

- Final response.

## Verification

- Phase 1 focused tests passed: `pnpm vitest run src/app/extensions/community-context.test.ts src/app/extensions/bridge.test.ts`
- Phase 1 root check passed: `pnpm check`
- Phase 2 template typecheck passed: `pnpm typecheck`
- Phase 2 template tests passed: `pnpm test`
- Phase 2 template build passed: `pnpm build`
- Phase 3 widget check passed: `pnpm check`
- Phase 3 widget status checked clean after local commit: `git status --short --branch`

## Risks Or Blockers

- Descriptor APIs must avoid false negative write capabilities when community data is not ready; root bridge now returns `COMMUNITY_CONTEXT_NOT_READY` for missing definition or relays.
- Host events should not require widgets to request permission; permissions gate widget requests, not host lifecycle/update events.
- The local widget repo remains unpushed by instruction; the user will push it later if desired.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/extensions/types.ts`
- `src/app/extensions/community-context.ts`
- `src/app/extensions/community-context.test.ts`
- `src/app/extensions/bridge.ts`
- `src/app/extensions/bridge.test.ts`
- `src/app/components/WidgetFrame.svelte`
- `src/app/components/community/CommunityHomeWidgetSlot.svelte`
- `src/app/components/community/CommunityWidgetSlotLaunchers.svelte`
- `packages/flotilla-extension-template`
- `/home/johnd/Work/budabit-calendar-widget`
