# Session Plan

## Objective

- Replace the extension-facing logical community write-target taxonomy with descriptor-based APIs.
- Expose community write checks and event queries in terms of `CommunityEventDescriptor` values: `{kind, subtype?}`.
- Keep BudaBit's community section, grant, moderation, and targeted-publication logic host-side.
- Remove `writeTargets` and `community:queryTargetEvents` from the public SDK/template/widget surface.
- Add runtime context versioning and `community:contextChanged` so widgets can refetch when host community context changes.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Do not stage unrelated user changes.
- Keep descriptor resolution generic; do not expose BudaBit target IDs such as `calendar`, `repository`, or `widget` to extensions.
- No section-name fallback may determine eligibility. If no active community section supports a descriptor, the bridge must error.
- If multiple sections match a descriptor, union matches; any matching writable section means `canWrite`. Prevent duplicates in BudaBit UI separately.
- Preserve the existing authorized targeted-publication query semantics for targetable events.
- `contextVersion` is runtime-only and resets on host/widget remount. Pair it with `contextSessionId` for stale-response detection.
- Use `community:contextChanged` for host-to-widget updates after init.
- No backward compatibility is required for the current logical-target API because it has not shipped.
- Commit and push each verified BudaBit/root phase before starting the next phase.
- Commit and push the nested `packages/flotilla-extension-template` phase before updating the root submodule pointer.
- Commit the local `/home/johnd/Work/budabit-calendar-widget` phase locally, but do not push it.

## Phase 1: Budabit Host Descriptor Community API

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Replace root host logical-target community APIs with descriptor-based capability and query APIs plus runtime community context updates.

### Exit Criteria

- Root `CommunityWidgetContext` no longer exposes `writeTargets` keyed by BudaBit taxonomy names.
- Root types expose `CommunityEventDescriptor`, descriptor write capability responses, and `community:checkWriteCapabilities` / `community:queryEvents` bridge actions.
- Host descriptor resolution maps `{kind, subtype?}` to active community sections by current definition only, with no default section fallback; missing mappings return errors.
- Write capability checks report actual matching and writable section names, with any matching writable section meaning `canWrite`.
- Community event queries accept descriptors, preserve the two-hop authorized targeted-publication lookup for targetable events, and return descriptor/context version metadata.
- `WidgetFrame` sends runtime `contextSessionId` / `contextVersion` in `communityContext` and emits `community:contextChanged` when community context changes while the iframe is alive.
- Focused root tests cover descriptor mapping, missing mappings, capability checks, descriptor queries, and bridge behavior.
- Root verification passes for focused tests and `pnpm check`.
- Root changes are committed and pushed without staging unrelated files.

### Steps

- Inspect root extension types, bridge handlers, community context helpers, widget frame lifecycle, and existing tests.
- Update `src/app/extensions/types.ts` with descriptor request/response/action-map types and slimmed `CommunityWidgetContext`.
- Refactor `src/app/extensions/community-context.ts` to build context without `writeTargets` and add descriptor resolution/query planning helpers.
- Replace `community:queryTargetEvents` bridge handling with `community:checkWriteCapabilities` and `community:queryEvents`.
- Add runtime `contextSessionId` / `contextVersion` handling in inline/modal community widget contexts and `WidgetFrame` context-change posting.
- Update focused root tests.

### Verification

- Run `pnpm vitest run src/app/extensions/community-context.test.ts src/app/extensions/bridge.test.ts`.
- Run `pnpm check`.
- Inspect root `git status`, `git diff`, and recent commits before committing.

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

## Phase 2: Flotilla Extension Template Descriptor SDK And Docs

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Update `packages/flotilla-extension-template` SDK, generated template, and docs to use descriptor community APIs.

### Exit Criteria

- SDK/shared types expose descriptor community context, capability, query, and action-map types matching the root bridge.
- Generated sample widget uses `{kind, subtype?}` descriptors, `community:checkWriteCapabilities`, and `community:queryEvents`.
- Template docs explain descriptor APIs, missing-section errors, context runtime versioning, and `community:contextChanged`.
- Manifest examples request `community:checkWriteCapabilities` and `community:queryEvents` where needed.
- Template verification passes: `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Nested template repo is committed and pushed; root records the updated submodule pointer and checkpoint advancement.

### Steps

- Inspect template SDK/shared types, docs, manifest examples, tests, and generated app.
- Replace logical-target types/docs/examples with descriptor APIs.
- Update sample app capability/query logic and stale context response handling.
- Run template verification.
- Commit and push inside `packages/flotilla-extension-template`.
- Commit and push root submodule pointer plus checkpoint update.

### Verification

- In `packages/flotilla-extension-template`, run `pnpm typecheck`.
- In `packages/flotilla-extension-template`, run `pnpm test`.
- In `packages/flotilla-extension-template`, run `pnpm build`.
- Inspect nested and root git status before commits.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing root closeout:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push nested template changes before root submodule pointer changes.
- Commit and push root checkpoint/submodule pointer changes. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not consider the phase complete until verification, template commit/push, root checkpoint update, root commit/push, and checkpoint reread succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 3: Featured Calendar Widget Descriptor Migration

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Update `/home/johnd/Work/budabit-calendar-widget` to use descriptor community APIs and local runtime context version handling.

### Exit Criteria

- Calendar widget no longer references `writeTargets`, `calendar`, `calendarDate`, or `community:queryTargetEvents` as extension API concepts.
- Calendar widget declares descriptor constants for event kinds `31923` and `31922` and uses `community:checkWriteCapabilities` for configuration gating.
- Calendar widget uses `community:queryEvents` with descriptors to load community events.
- Calendar widget reacts to `community:contextChanged`, refetches capabilities/events, and ignores stale responses using `contextSessionId` / `contextVersion`.
- Widget docs and manifest helper scripts request the descriptor bridge permissions.
- Widget verification passes: `pnpm check`.
- Widget changes are committed locally and not pushed.
- Root checkpoint is updated to `Current Phase: Complete`, committed, and pushed.

### Steps

- Inspect widget source/docs/package metadata.
- Update widget bridge request permissions, capability checks, query calls, context update handling, and docs.
- Run widget verification.
- Commit widget repo locally.
- Update root checkpoint final status and commit/push root closeout.

### Verification

- In `/home/johnd/Work/budabit-calendar-widget`, run `pnpm check`.
- Inspect widget git status and recent commits.
- Inspect root git status and latest checkpoint before final commit.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before root final closeout:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files/repo path.
  - Set `Current Phase` to `Complete`.
  - Set `Phase Exit Criteria` to final completion criteria.
  - Set `Next Action` to final response.
  - Record any remaining risks or blockers.
- Commit the widget repo locally. Do not push it because the user explicitly said they will push later.
- Commit and push root checkpoint updates if root files changed in this phase.
- Read the session checkpoint again to verify `Current Phase: Complete`.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
