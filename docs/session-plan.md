# Session Plan

## Objective

- Make repository opening from `/git` and post-import `View repository` feel immediate by reducing work that blocks navigation into `/git/[id]` routes.
- Preserve the existing post-import modal sequencing: do not dismiss import or other modals until navigation to the target route succeeds.
- Preserve the existing repository-card selection outline/paint behavior before `goto`; only improve the visible `Opening...` feedback with pulsing text.
- Defer non-essential repository activity hydration until after the repo route has landed and painted.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Branch `dev` tracks `origin/dev`; inspect status, diff, and recent commits before each phase commit.
- Existing staged and unstaged work predates this workflow and must not be staged unless intentionally touched by a phase.
- At initial workflow bootstrap, these unrelated files were staged and were later committed outside this workflow as `b594978c fix: stabilize community loading` before the Phase 1 docs commit:
  - `src/app/components/community/CommunityPreviewCard.svelte`
  - `src/app/core/commands.test.ts`
  - `src/app/core/commands.ts`
  - `src/app/core/community-admin.test.ts`
  - `src/app/core/community-admin.ts`
  - `src/app/core/community-state-loading.test.ts`
  - `src/app/core/community-state.test.ts`
  - `src/app/core/community-state.ts`
  - `src/app/util/nip46.test.ts`
  - `src/app/util/nip46.ts`
  - `src/app/util/policies.ts`
  - `src/routes/+layout.svelte`
  - `src/routes/c/[community]/+page.svelte`
  - `src/routes/explore/+page.svelte`
- Current pre-existing unstaged files after the outside commit:
  - `src/app/core/sync.test.ts`
  - `src/app/core/sync.ts`
- Stage only files intentionally changed for each phase.
- Do not change import modal close semantics to hide the modal before successful target navigation.
- Do not change the existing `waitForNavigationIntentPaint`/selection-paint timing around repo-card navigation.
- Prefer minimal changes in the existing route layout rather than introducing new architectural packages.
- Commit and push each verified phase before starting the next phase.
- Keep the checkpoint compact; put durable design details here.

## Phase 1: Plan Bootstrap

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Replace the completed prior workflow checkpoint/plan with this new repository navigation performance workflow and record current repository facts.

### Exit Criteria

- `docs/session-plan.md` describes all phases with `Phase Startup`, `Mandatory Closeout`, and `Continue` sections.
- `docs/session-checkpoint.md` records the new objective, current phase, dirty/staged state, branch/upstream facts, decisions, and next action.
- No code files are intentionally changed in this phase.
- Checkpoint is advanced to Phase 2 before commit.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Create the durable plan and checkpoint for this workflow.
- Inspect `git status --short --branch`, `git log --oneline --decorate -12`, remotes, and relevant diffs.
- Commit only the plan/checkpoint changes for Phase 1.

### Verification

- Read both durable files after editing.
- Inspect `git status --short --branch`, `git diff -- docs/session-plan.md docs/session-checkpoint.md`, and `git log --oneline --decorate -12` before committing.

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

## Phase 2: Fast Repo Route Entry

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Reduce work that runs before or during first paint of `/git/[id]` by deferring non-essential activity hydration, and add pulsing opening feedback on repo cards.

### Exit Criteria

- Existing card outline/selection paint timing remains unchanged.
- `Opening...` overlays in repo cards pulse while navigation is pending.
- Post-import navigation still waits for successful `goto` before clearing the import modal.
- Initial repo detail route can render shell/header before activity-heavy issue, PR, comment, report, delete, live, star, and branch-update hydration starts.
- Context consumers still receive compatible stores immediately, initially empty where hydration is deferred.
- Deferred hydration starts after mount and at least one paint, then progressively loads activity.
- Focused checks pass.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect repo detail layout store creation, data-load effects, and render boundary.
- Add a post-paint hydration flag in `src/routes/git/[id=naddr]/+layout.svelte`.
- Use deferred readable stores for activity contexts so children can mount with empty values before real subscriptions attach.
- Gate expensive load effects and subscriptions behind the hydration flag without gating repo identity/header setup.
- Add `animate-pulse` to existing opening overlays in `src/app/components/GitItem.svelte` and `src/routes/git/+page.svelte`.
- Avoid changing modal hash retention or `clearModals()` ordering in `navigateToCreatedRepo`.

### Verification

- Run `pnpm check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline --decorate -12` before committing.

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

## Phase 3: Final Review And Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Verify final behavior and close the workflow with the checkpoint marked complete.

### Exit Criteria

- Modal sequencing remains unchanged by final diff inspection.
- Deferred hydration code is documented by clear names and does not hide required context from child routes.
- Focused navigation-performance changes remain limited to intended files.
- `pnpm check` passes or a fresh successful Phase 2 result remains valid with no code changes after it.
- `git diff --check` passes.
- Checkpoint records `Current Phase: Complete` and final evidence.
- Final closeout commit is pushed before final response if files changed.

### Steps

- Inspect final diff for accidental modal close sequencing changes.
- Re-run required verification if code changed since Phase 2 verification.
- Update checkpoint to `Complete` with final evidence and residual risks.
- Commit and push final checkpoint updates if needed.

### Verification

- Run `pnpm check` unless no code changed since a passing Phase 2 check.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline --decorate -12` before committing.

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
