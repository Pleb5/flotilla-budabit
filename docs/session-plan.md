# Session Plan

## Objective

- Add user-side community renunciation so a member can leave/rejoin a group for Budabit's own recommendations, discovery, and web-of-trust logic without changing the underlying community moderator grants.
- Store renounced communities as a private NIP-51 list using Welshman list utilities wherever possible.
- Add a subtle Membership page `Leave group` / `Rejoin group` action with confirmation modals.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Commit and push each verified phase before starting the next phase.
- Branch `dev` tracks `origin/dev`; inspect push state before each phase push.
- Stage only files intentionally changed for this renounced-community workflow.
- Use Welshman utilities for NIP-51 lists where possible: `readList`, `makeList`, `addToListPrivately`, `removeFromList`, `updateList`, `getListTags`, `asDecryptedEvent`, and `nip44EncryptToSelf`.
- Recommended list type is NIP-51 kind `30000` / Welshman `NAMED_PEOPLE`, with `d = app/budabit/renounced-communities` and only encrypted private `p` tags for community pubkeys.
- Because Budabit also uses kind `30000` for community profile lists, explicitly guard the Budabit renunciation list from profile-list membership handling.
- Do not artificially gate publishing access or direct section permission checks for a renounced community. Do not change `userHasSectionProfileListAccess` or `getGrantCapability` to deny permissions based on renunciation.
- Do not allow admin/community-owner keys to renounce their own community. If such a pubkey appears in the renounced list, ignore it for effective membership filtering.
- Renunciation is one-sided and reversible: rejoining only removes the community pubkey from the private renunciation list.

## Phase 1: Core Renunciation List And Effective Membership

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add the Welshman-backed private renounced-community list and wire it into central effective membership/preference state without changing direct permission checks.

### Exit Criteria

- New renunciation core module reads a private NIP-51 `NAMED_PEOPLE` list with `d = app/budabit/renounced-communities` and exposes user renounced community pubkeys.
- Leave/rejoin core helpers update private list `p` tags via Welshman list utilities and NIP-44 self-encryption.
- Budabit profile-list helpers ignore the renounced-communities `30000` list so it cannot create membership evidence.
- `selectUserCommunityRefs` can exclude renounced non-admin communities while preserving admin refs.
- `activeUserCommunityRefs` is effective membership and filters renounced non-admin communities.
- Raw active membership remains available for UI that must detect rejoin eligibility.
- `activePreferredCommunities` excludes renounced communities even when starred/member/moderator-derived; admin renunciations are ignored.
- Focused unit tests cover renunciation list parsing/updating, profile-list guard, effective membership filtering, and preference filtering.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Add `src/app/core/community-renunciations.ts` using Welshman list primitives and existing encrypted-list patterns from `src/app/core/nip85.ts`.
- Add constants and guard helpers for `RENOUNCED_COMMUNITIES_DTAG` and the NIP-51 `NAMED_PEOPLE` list kind.
- Extend community membership selection with an exclusion option.
- Split `activeUserCommunityRefs` into raw/effective stores in `community-state.ts` while preserving the exported effective store name.
- Pass effective membership and renounced pubkeys into preferred-community selection.
- Add or update focused tests.

### Verification

- Run `pnpm vitest run src/app/core/community-renunciations.test.ts src/app/core/community-membership.test.ts src/app/util/community-preferences.test.ts --project=main`.
- Run `pnpm check` if touched types or store wiring require broader validation.
- Run `git diff --check`.
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

## Phase 2: Trust, Search, And Recommendation Integration

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Ensure renounced communities do not contribute to web-of-trust, shared-community evidence, search ranking, or recommendation inputs while leaving direct community access untouched.

### Exit Criteria

- Community trust builders accept viewer-renounced community pubkeys and exclude those communities from viewer/target trust refs and shared evidence.
- Callers that compute global or active-community trust pass the current user renounced set where available.
- People search/community candidate discovery ignores renounced community definitions/profile-list evidence where appropriate.
- Recommendation paths relying on `activeUserCommunityRefs` naturally use effective membership; any direct raw community evidence paths are filtered.
- Profile trust badges and flag/report evidence use effective membership and do not include renounced community evidence.
- Focused tests cover trust exclusion and search/community candidate exclusion.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Extend `community-trust.ts` inputs with renounced/excluded community pubkeys and filter refs by community before scoring.
- Pass `userRenouncedCommunityPubkeys` into `/explore`, `/people`, `/git`, profile selectors, chat search, and profile-collab trust calls as needed.
- Add filtering support to `getCommunityPeoplePubkeys` or pre-filter its inputs so renounced communities do not seed people search candidates.
- Verify recommendation paths are covered by the central effective membership store and adjust only direct evidence paths.
- Add or update focused tests.

### Verification

- Run `pnpm vitest run src/app/core/community-trust.test.ts src/app/util/people-search.test.ts --project=main`.
- Run any additional focused tests for touched recommendation/search modules.
- Run `pnpm check` if Svelte callers or shared types changed.
- Run `git diff --check`.
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

## Phase 3: Membership Page Leave And Rejoin UI

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add the Membership page leave/rejoin action with confirmation modals and state-aware labeling.

### Exit Criteria

- Membership page shows a subtle red `Leave group` button to the right of the normal tabs when the current signed-in user is a non-admin raw member and has not renounced the group.
- Membership page shows `Rejoin group` in the same location when the current group is renounced and raw membership evidence still exists.
- No leave/rejoin button is shown for the community owner/admin key.
- Both actions require confirmation via modal before publishing the encrypted list update.
- Leave confirmation explains that underlying grants are not revoked and direct community access is not blocked.
- Rejoin confirmation explains that the group is restored to Budabit membership lists, recommendations, and trust calculations.
- UI reports success/failure through toasts and avoids duplicate publishes while an action is in flight.
- Phase 3 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Import raw/effective membership and renunciation stores/helpers into `src/routes/c/[community]/access/+page.svelte`.
- Derive raw membership, current renounced state, admin-owner state, and button eligibility.
- Add right-aligned action button near the existing tabs with subtle destructive styling.
- Add `Confirm` modals for leave and rejoin actions.
- Publish via core helper functions and update local repository/store state through existing publish patterns.
- Keep direct section permission UI unchanged except the explanatory renounced status if needed.

### Verification

- Run `pnpm check`.
- Run focused unit tests touched in earlier phases if core helpers changed.
- Run `git diff --check`.
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

## Phase 4: Final Verification And Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Run final verification, ensure checkpoint completeness, and close the durable workflow.

### Exit Criteria

- Targeted tests from phases 1 and 2 pass after all changes.
- `pnpm check` passes.
- `git diff --check` passes.
- Final diff review shows only intentional Budabit files plus session docs.
- Checkpoint records `Current Phase: Complete` and final verification evidence.
- Final closeout commit is pushed before final response.

### Steps

- Rerun targeted core/preference/trust/search tests.
- Run full Svelte/TypeScript project check.
- Inspect final diffs and status.
- Update checkpoint to `Complete` with evidence and residual risks.

### Verification

- Run `pnpm vitest run src/app/core/community-renunciations.test.ts src/app/core/community-membership.test.ts src/app/util/community-preferences.test.ts src/app/core/community-trust.test.ts src/app/util/people-search.test.ts --project=main`.
- Run `pnpm check`.
- Run `git diff --check`.
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
