# Session Plan

## Objective

- Make Budabit's GRASP/NIP-34 repository state handling conform to ngit, ngit-grasp, gitworkshop, and NIP-34 from both read and write perspectives.
- Keep fixes self-contained in Budabit; do not require ngit-grasp server changes.
- Ensure state events use `d` as the addressable identity tag, full `refs/*` tag names for refs, and canonical `HEAD` tags.
- Preserve complete known state when publishing replacement state events so Budabit does not accidentally drop refs.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Commit and push each verified phase before starting the next phase.
- Branch `dev` tracks `origin/dev`; inspect push state before each phase push.
- Stage only files intentionally changed for this GRASP workflow.
- Do not stage unrelated dirty files, including `docs/architecture/rely-nostr-sqlite-learning-plan.md`.
- Do not depend on or commit changes in `/home/johnd/Work/ngit-grasp`; Budabit must work against current upstream-style ngit-grasp behavior.
- Use gitworkshop/ngit conventions as the compatibility target:
  - `kind:30618` state identity is `pubkey + kind + d`.
  - State queries use `#d`, with trusted authors/maintainers when available.
  - Ref tags are full names such as `refs/heads/main` and `refs/tags/v1`.
  - HEAD is `HEAD = ref: refs/heads/<branch>`.
  - State updates should be built from existing known state plus changes, not as lossy deltas.

## Phase 1: Core GRASP State Semantics

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Fix core Budabit GRASP state parsing, lookup, HEAD normalization, and provider state publishing so the core package reads and writes ngit-compatible `kind:30618` events.

### Exit Criteria

- `createRepoStateEvent()` accepts branch names, full `refs/heads/*`, and `ref: refs/heads/*` inputs without double-prefixing HEAD.
- Core HEAD/default-branch helper correctly parses `ref: refs/heads/<branch>` and full ref paths.
- `GraspApiProvider.fetchLatestState()` queries state by `#d` and author when appropriate, not by `#a`.
- `GraspApiProvider.parseRepoStateFromEvent()` reads full `refs/heads/*` and `refs/tags/*` tags, including HEAD.
- `GraspApiProvider.publishStateFromLocal()` emits full ref tags without doubled refs and never turns a commit OID into a HEAD branch name.
- Receive-pack readiness probes use only `?service=git-receive-pack` and do not require ngit-grasp query-parser changes.
- Focused core/provider and availability tests pass.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Update core state helpers and event builder normalization.
- Update `GraspApiProvider` state query/parsing/publishing logic.
- Keep the existing no-cache-buster receive-pack fix and test.
- Add or adjust focused tests for `#d` lookup, full-ref parsing, HEAD normalization, and no doubled refs.

### Verification

- Run `corepack pnpm vitest run -c packages/nostr-git-core/vitest.config.ts test/events/nip34-builders.spec.ts test/api/providers/grasp-state.spec.ts test/api/providers/grasp-api-provider.spec.ts`.
- Run `corepack pnpm vitest run -c packages/nostr-git-ui/vitest.config.ts src/lib/utils/grasp-availability.test.ts src/lib/utils/grasp-pipeline.test.ts`.
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

## Phase 2: UI State Writer Cleanup

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Fix active Budabit UI write paths so state events published during create/import/fork/edit/sync flows are ngit-compatible and do not accidentally discard known refs or add non-standard state tags.

### Exit Criteria

- Active UI GRASP state writers do not add `relays` tags to `kind:30618`; relay hints remain on announcements.
- Edit flows preserve refs from the current state event when publishing a replacement state event and only update HEAD when appropriate.
- Import/create/fork/sync paths publish state refs only when real commit IDs are known.
- Existing GRASP state merge behavior still preserves existing refs and HEAD for push/sync.
- Focused UI tests cover absence of state `relays` tags and ref preservation where practical.
- Focused UI tests and project type/check verification pass.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Remove non-standard `relays` state tags from active state event writers.
- Use existing state refs in edit flows instead of replacing state with HEAD-only events.
- Add helper/test coverage around active UI state writer behavior.
- Keep changes minimal and avoid unrelated UI rewrites.

### Verification

- Run focused UI tests for touched state writer utilities/components.
- Run `corepack pnpm vitest run -c packages/nostr-git-ui/vitest.config.ts src/lib/utils/grasp-pipeline.test.ts src/lib/utils/import-repo-metadata.test.ts`.
- Run `corepack pnpm vitest run -c packages/nostr-git-core/vitest.config.ts test/events/nip34-builders.spec.ts` if shared state helpers changed in this phase.
- Run `corepack pnpm check` or the repository's equivalent check command if available and scoped verification is not sufficient.
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

## Phase 3: End-to-End Verification And Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Perform final targeted verification, ensure no ngit-grasp dependency remains, and close the durable workflow with a complete checkpoint.

### Exit Criteria

- Targeted core and UI GRASP tests pass after all phases.
- `git diff --check` passes.
- Final diff review shows only intentional Budabit files plus session docs.
- No ngit-grasp changes are required for Budabit behavior.
- Checkpoint records `Current Phase: Complete` and final verification evidence.
- Final closeout commit is pushed before final response.

### Steps

- Rerun the focused GRASP test set from Phases 1 and 2.
- Inspect final diffs and status.
- Update checkpoint to `Complete` with evidence and residual risks.

### Verification

- Run targeted core GRASP tests.
- Run targeted UI GRASP tests.
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
