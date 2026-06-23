# Session Plan

## Objective

- Make the Smart Widget community publish/discover/install/update workflow minimally usable at product quality.
- Support a publisher creating a widget for one or more communities, using only viable widget slots and only communities where the user has widget-write permission.
- Support Blossom-backed widget app artifacts using the same upload target/mirroring concepts as normal media uploads.
- Preserve all loadable app artifact URLs in the widget event so BudaBit can fall back when the primary app URL fails.
- Let a community member discover trusted/community-curated widgets, install one, later see an update badge/details, and manually swap to the newer widget event.
- Keep community owner/widget-moderator trusted display behavior intact.
- Keep the Flotilla/BudaBit extension template aligned with BudaBit's supported event shape, slots, release metadata, Blossom upload behavior, and docs.
- Add meaningful automated coverage, including a realistic E2E path where feasible, without building a full marketplace or auto-update system.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Keep update application manual; do not auto-update installed widgets.
- Treat the same publisher pubkey plus kind `30033` plus same `d` identifier as one widget line.
- Use newer `created_at` as the update freshness signal; `version` and `changelog` remain display metadata.
- Preserve existing community-endorsed/trusted vs other curated widget distinction.
- Preserve NIP-89 update behavior.
- Use existing Blossom upload primitives where possible; avoid inventing a parallel Blossom implementation.
- Use only currently viable widget slots: `repo-tab`, `community-home-before-quicklinks`, `community-home-after-quicklinks`, `chat-message-actions`, and `global-menu`.
- Community widget publishing/targeting UI should only expose communities where the current user can write the widget target.
- The nested template repo at `packages/flotilla-extension-template` has its own git history and must be committed/pushed before updating the root submodule pointer.
- Commit and push each verified phase before starting the next phase.
- Stage only files intentionally changed for the current phase.

## Phase 1: Multi-URL Widget Event Foundation

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add a minimal BudaBit-supported event shape for multiple app URLs and wire parsing/diff/runtime selection without changing publisher UI yet.

### Exit Criteria

- `SmartWidgetEvent` can represent ordered app URLs with a primary `appUrl` and fallback URLs.
- `parseSmartWidget` reads all secure app URLs from supported tags while preserving compatibility with the existing first `button`/`app` URL.
- Widget update diffs include app URL/fallback changes.
- Runtime/widget card open behavior can use the ordered app URL list and attempt fallback on iframe load failure.
- Focused tests cover parsing multi-URL events and diffing fallback URL changes.

### Steps

- Inspect `src/app/extensions/types.ts`, `registry.ts`, `widget-updates.ts`, `ExtensionCard.svelte`, and relevant tests.
- Choose the smallest event shape that keeps current compatibility. Prefer preserving the existing `button`/`app` primary URL and adding repeatable app-url fallback tags, unless code evidence suggests additional `button`/`app` tags are safer.
- Extend parsing and types.
- Update card/runtime iframe source selection and fallback-on-error behavior.
- Update update summary/diff helpers.
- Add focused tests.

### Verification

- Run focused extension parser/update tests.
- Run `pnpm check` if Svelte/types changed.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 2: Blossom-Backed Community Widget Publisher

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Upgrade BudaBit's community widget publisher from manual URL-only publishing to minimally usable Blossom-backed publishing with multi-community targeting and release metadata.

### Exit Criteria

- Community widget publisher can upload a widget HTML artifact to Blossom using existing upload primitives and available server target/mirroring behavior.
- Publisher can still use a manual app URL when no artifact upload is needed.
- Published widget event includes primary and fallback app URLs from successful canonical/mirror upload results.
- Publisher can set stable identifier, version, changelog, icon/description, and one viable slot.
- Target communities list only includes communities where the current user can write widget targets.
- Publishing targets multiple selected communities through existing targeted publication events.
- Permission-denied users cannot publish or target widgets through the UI.
- Focused tests cover event tag construction and permission/target filtering where practical.

### Steps

- Inspect `src/routes/c/[community]/widgets/+page.svelte`, Blossom `uploadFile` APIs in `src/app/core/commands.ts`, and community permission helpers.
- Extract small pure helpers for building widget event tags from publisher form/upload results.
- Add file input/upload state to the community widget publisher.
- Reuse existing Blossom upload target options with minimal UI for manual server/mirror input if full target picker reuse is too large.
- Ensure fallback URLs are emitted in the Phase 1 shape.
- Preserve existing viable slot options and permission gating.
- Add focused tests for helpers and permission filtering.

### Verification

- Run focused widget targeting/community/blossom/helper tests.
- Run `pnpm check`.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 3: Template Parity For Multi-URL Blossom Releases

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Align the nested extension template CLI, generator, publish flow, tests, and docs with BudaBit's multi-URL Blossom-backed widget event shape and viable slots.

### Exit Criteria

- Template generator copies can emit the same primary/fallback app URL tags BudaBit parses.
- Template publish flow preserves Blossom canonical and mirror URLs in the event before signing.
- Template CLI/docs explain stable identifiers, version/changelog, viable slots, multi-community targeting expectations, and fallback app URLs.
- Template tests cover primary plus fallback URL tag generation and supported slot validation.
- Nested template repo is committed and pushed before root submodule pointer update.

### Steps

- Inspect current template `packages/sdk/src/manifest` and `packages/manifest/src` generator/publish copies.
- Update generator options and publish URL update behavior to preserve fallback app URLs.
- Update scaffold defaults and docs.
- Add focused template tests.
- Commit/push nested template repo, then update root submodule pointer and checkpoint.

### Verification

- Run focused template generator tests.
- Run template SDK/manifest/scaffold typechecks where practical.
- Inspect root submodule pointer status before root commit.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 4: E2E And Regression Coverage

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add meaningful automated coverage for the minimally usable product path and close the durable plan.

### Exit Criteria

- Playwright or equivalent E2E covers a realistic community widget discover/install/update path using deterministic mocks where feasible.
- Coverage asserts trusted owner/moderator widgets display in the correct Settings section and unauthorized/other widgets remain distinct.
- Coverage asserts update badge/details/manual update swap to the newer event.
- Coverage asserts publisher slot options are limited to viable slots or unit coverage proves this if full E2E is too brittle.
- Final focused root tests, template tests, and `pnpm check` pass, or any failure is recorded as a blocker.
- Checkpoint says `Current Phase: Complete` before final commit/push.

### Steps

- Inspect existing Playwright mock relay helpers and widget acceptance tests.
- Prefer improving or replacing weak widget E2E assertions with deterministic community-curation/update flow.
- Add unit tests for any behavior too costly to prove in Playwright.
- Run final verification.
- Update checkpoint to `Current Phase: Complete` and commit/push final closeout.

### Verification

- Run final focused root widget/community/update tests.
- Run relevant Playwright widget E2E tests if feasible in the environment.
- Run `pnpm check`.
- Run focused template tests/typechecks if Phase 3 changed template files.
- Inspect final diff and status before committing.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to `Complete`.
  - Set `Phase Exit Criteria` to the final completion criteria.
  - Set `Next Action` to final response.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates. This is the final transition.
- Read the session checkpoint again to verify `Current Phase: Complete`.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
