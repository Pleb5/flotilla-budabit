# Session Plan

## Objective

- Improve direct-message relay recommendations so they are community-first rather than starred-community-only.
- Use explicit `kind:10050` messaging relay lists from trusted community actors when available.
- Keep community relay definitions from active/starred communities as recommendation evidence, with starred communities ranked higher than social follows.
- Preserve current one-click settings UI behavior while showing richer recommendation evidence.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Do not stage unrelated user changes; the current worktree contains unrelated extension/widget edits.
- Prefer minimal changes that fit existing patterns in `src/app/core/cashu-mint-recommendations.ts` and `src/routes/settings/relays/+page.svelte`.
- Keep recommendation scoring deterministic and unit-tested.
- Starred community evidence must rank higher than social follow evidence.
- Direct follows are fallback evidence only and must not outrank starred or active community evidence.
- Commit and push each verified phase before starting the next phase.

## Phase 1: DM Relay Recommendation Scorer

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Replace the existing star-only pure scorer with an evidence-based scorer that can rank active communities, starred communities, community roles, explicit `kind:10050` lists, and social follows.

### Exit Criteria

- `src/app/core/dm.ts` exposes evidence/source types that distinguish active community relay, starred community relay, community/admin/moderator/member messaging list, own messaging list, and follow messaging list evidence.
- `getDmRelayRecommendations` remains a pure function and keeps already-configured relays visible.
- Scoring is deterministic, deduplicates repeated relay/source evidence, and ranks starred community evidence above social follow evidence.
- Tests cover active community recommendations without stars, starred communities above follows, moderator/member messaging-list evidence, configured relays, and duplicate evidence dedupe.
- Focused verification passes: `pnpm vitest run src/app/core/dm.test.ts`.
- Phase 1 changes are committed and pushed without staging unrelated files.

### Steps

- Inspect current `dm.ts` scorer and tests.
- Extend recommendation source/evidence types with source kind, recommender pubkey, community pubkey, role, and timestamps as needed.
- Implement deterministic score weights and sorting, preserving the existing exported scorer name where practical.
- Update `dm.test.ts` for the new evidence shape and ranking rules.

### Verification

- Run `pnpm vitest run src/app/core/dm.test.ts`.
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

## Phase 2: Loader And Settings UI Wiring

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Load community-first `kind:10050` recommendation events and wire the messaging relay settings UI to the new recommendation model.

### Exit Criteria

- A loader/store path fetches trusted authors' `kind:10050` messaging relay lists using active community refs, profile-list events, report state, follows, mutes, community relay hints, user relays, author relays, and index relays.
- Recommendation authors are community-first: viewer, active community pubkeys, moderators, starred community pubkeys, follows, then members, with sensible limits.
- Starred community `kind:10222` relay evidence remains included and ranks above social follows.
- Muted social follows do not contribute follow evidence.
- `src/routes/settings/relays/+page.svelte` uses the loader/store and shows evidence labels that are not limited to starred communities.
- Focused verification passes for DM tests and a Svelte/type check command if practical.
- Phase 2 changes are committed and pushed without staging unrelated files.

### Steps

- Add loader/state helpers either in `src/app/core/dm.ts` or a small dedicated core module if that keeps responsibilities clearer.
- Reuse patterns from `cashu-mint-recommendations.ts` for author selection, relay selection, event loading, state, and report/mute handling.
- Wire settings relay page to active community refs, profile-list events, report state, community stars, current messaging relays, and recommendation state.
- Update UI copy and badges from “starred communities” to community-first messaging relay evidence.
- Add focused tests for author selection/build behavior where practical.

### Verification

- Run `pnpm vitest run src/app/core/dm.test.ts`.
- Run a relevant Svelte/type check command, preferring `pnpm check` if feasible.
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

## Phase 3: Final Verification And Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Verify the full DM relay recommendation workflow and mark the durable session complete.

### Exit Criteria

- Focused DM tests pass after all changes.
- Project-level verification is run or a concrete blocker is recorded.
- Checkpoint records `Current Phase: Complete` with final evidence and changed files.
- Final checkpoint closeout is committed and pushed without staging unrelated files.

### Steps

- Reread touched code and tests for consistency.
- Run focused tests and project-level verification if not already sufficient from Phase 2.
- Update checkpoint to complete with final evidence.
- Commit and push final checkpoint changes if any.

### Verification

- Run `pnpm vitest run src/app/core/dm.test.ts`.
- Run `pnpm check` if feasible or record the exact blocker/failure.
- Inspect root `git status`, `git diff`, and recent commits before committing.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to `Complete`.
  - Set `Phase Exit Criteria` to final completion criteria.
  - Set `Next Action` to final response.
  - Record any remaining risks or blockers.
- Commit and push checkpoint updates if files changed in this phase.
- Read the session checkpoint again to verify `Current Phase: Complete`.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
