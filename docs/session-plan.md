# Session Plan

## Objective

- Migrate Budabit app-level GRASP server preferences from the legacy `kind:30002` / `d=grasp-servers` event to the protocol `kind:10317` User Grasp List using ordered `g` tags.
- Keep legacy reads only as a migration fallback until the user explicitly saves the new list.
- Source the last-resort app fallback GRASP server list from the `.env` default community's published `kind:10317` list rather than hardcoded relays.
- Replace hardcoded recommended GRASP relays with community-first web-of-trust recommendations from communities and trusted individuals, mirroring the DM relay recommendation model.
- Preserve explicit user configuration as authoritative, including the ability to leave the saved GRASP list empty.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- The current worktree has many unrelated extension/widget changes; never stage unrelated files or unrelated hunks.
- The branch `dev` tracks `origin/dev` but is already ahead of upstream; inspect push state before each phase push.
- Prefer minimal changes that fit existing Svelte stores and `src/app/core/dm.ts` recommendation patterns.
- Reuse existing NIP-34 core constants/helpers for `kind:10317` where possible.
- Stop writing legacy `kind:30002` GRASP server events.
- Keep legacy `kind:30002` reads as migration fallback only while new `kind:10317` is absent.
- Commit and push each verified phase before starting the next phase.

## Phase 1: Protocol Pivot And Migration Fallback

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Switch app-owned GRASP server loading, syncing, publishing, and repo-announcement relay resolution to protocol `kind:10317`, while preserving legacy `kind:30002` as read-only migration fallback.

### Exit Criteria

- App GRASP server filters prefer `GIT_USER_GRASP_LIST` (`10317`) without a `d` tag.
- User saves publish `kind:10317` events with ordered `g` tags and empty content.
- Legacy `kind:30002` / `d=grasp-servers` events are read only when no `kind:10317` event exists.
- Explicit empty `kind:10317` lists remain authoritative and do not rehydrate from legacy or fallback lists.
- Repo announcement relay selection uses the new list first and legacy only as fallback.
- Focused tests cover new-list parsing/publishing behavior and legacy fallback.
- Phase 1 changes are committed and pushed without staging unrelated files.

### Steps

- Inspect current legacy usage in `git-requests.ts`, `git-state.ts`, `GraspServersPanel.svelte`, and package NIP-34 helpers.
- Add or reuse normalized `kind:10317` parsing/building helpers in `@nostr-git/core/events`.
- Update app sync/loading/publish paths to new kind plus legacy fallback.
- Update focused tests for protocol migration behavior.

### Verification

- Run focused tests for GRASP server helpers and app git requests/state.
- Run `pnpm check` if feasible after focused tests pass.
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

## Phase 2: Default Community Fallback And Recommendation Engine

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add app-level GRASP recommendations from the community-first web of trust and derive the last-resort fallback from the `.env` default community's `kind:10317` list.

### Exit Criteria

- A GRASP recommendation module/store exists and mirrors the DM relay ranking model for community and individual signals.
- Recommendation sources include active community relay evidence, starred/default community evidence, community/admin/moderator/member `kind:10317` lists, own list, and unmuted follow `kind:10317` lists.
- Recommendation authors are community-first: viewer, active community pubkeys, default community pubkey, moderators, starred community pubkeys, follows, then members, with sensible limits.
- Default community fallback loads `VITE_DEFAULT_COMMUNITY`, resolves its definition with existing community lookup helpers, then loads that community author's `kind:10317` list from default/indexer/community relays.
- The last-resort fallback is used only when the user has no authoritative saved list and no community/social recommendation items.
- No hardcoded GRASP recommendation URLs remain in app recommendation logic.
- Focused tests cover ranking, default-community fallback, empty-list authority, and muted follow exclusion.
- Phase 2 changes are committed and pushed without staging unrelated files.

### Steps

- Extract or reuse generic recommendation helpers from `dm.ts` only where it reduces duplication without broad churn.
- Implement `src/app/core/grasp.ts` or equivalent with pure scorer, loader/state, source labels, and fallback resolver.
- Wire app sync so `graspServersStore` receives the authoritative user list, migrated legacy list, recommendation fallback, or empty explicit list according to state.
- Add focused tests for the pure recommendation and fallback behavior.

### Verification

- Run focused GRASP recommendation tests.
- Run affected app/core tests.
- Run `pnpm check` if feasible after focused tests pass.
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

## Phase 3: UI Wiring, Cleanup, And Final Verification

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Replace hardcoded GRASP recommendation surfaces with the recommendation store, expose evidence in settings, remove obsolete legacy defaults, and complete verification.

### Exit Criteria

- `packages/nostr-git-ui/src/lib/stores/graspServers.ts` no longer exports hardcoded recommended GRASP server URLs.
- New repo, import, fork, and GRASP settings surfaces use app-provided recommendations or saved/fallback state instead of hardcoded defaults.
- GRASP settings shows recommended relays from communities/individuals with evidence, and keeps one-click add behavior.
- All app-level legacy `kind:30002` usage is either removed or explicitly marked as migration fallback only.
- Docs/comments/tests reflect `kind:10317` as the current protocol list kind.
- Focused tests and project-level verification pass or a concrete blocker is recorded.
- Checkpoint records `Current Phase: Complete` and final closeout is committed and pushed without staging unrelated files.

### Steps

- Wire recommendation store into `GraspServersPanel.svelte` and GRASP selection components.
- Remove package hardcoded recommendation constants and update tests.
- Update docs that reference GRASP server settings semantics.
- Run final focused and project-level verification.

### Verification

- Run focused GRASP/store tests.
- Run affected app/core tests.
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
