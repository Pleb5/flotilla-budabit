# Git Natural Read Hardening Session Plan

## Objective

- Produce an analysis-only hardening report for Budabit Git natural reads.
- Compare critical Budabit natural-read implementations against the stable `~/Work/gitworkshop` implementation.
- Use `gitworkshop` test-harness patterns as inspiration for missing Budabit coverage.
- Diagnose the observed browser failures, especially `GitNaturalReadError: Invalid packfile header: shal` during overview, README, code-tab, and commits browsing.
- Do not change production code in this workflow; write durable analysis and recommendations only.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint file is authoritative over compacted conversation summaries and older chat history.
- Existing unstaged changes not made by this workflow must not be reverted or staged.
- This workflow is analysis-only: no source-code edits, no test implementation, no production behavior changes.
- The deliverable must include detailed comparison findings, concrete bug analysis, suggested fix order, quality improvements, and test-harness recommendations.
- If commit/push is possible, commit only intentionally changed analysis/checkpoint/plan files.

## Phase 1: Compare And Document Hardening Findings

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Inspect Budabit Git natural read transport, pack parsing, provider, router, worker, and tests.
- Inspect `~/Work/gitworkshop` Smart HTTP / pack handling and its test-harness style.
- Write a durable analysis report with severity-ranked findings and a concrete fix strategy.

### Exit Criteria

- A hardening analysis document exists in `docs/architecture/`.
- The analysis explicitly covers the observed `Invalid packfile header: shal` failures.
- The analysis compares Budabit and `gitworkshop` implementations for transport/protocol handling, upload-pack response parsing, pack/object parsing, tree/blob strategy, routing/fallback, CORS/proxy behavior, and tests.
- The analysis includes proposed bug fixes and code-quality improvements without changing production code.
- The checkpoint records completed evidence, verification, changed files, residual risks, and `Current Phase: Complete`.

### Steps

- Inventory Budabit natural-read files and test coverage.
- Inventory `~/Work/gitworkshop` natural-read files and test-harness patterns.
- Compare critical function implementations and identify behavior differences.
- Tie differences to the reported browser failures.
- Write the analysis document.
- Update the checkpoint to complete.

### Verification

- Read the completed analysis document for completeness against exit criteria.
- Run `git status --short` to confirm only expected files are changed in this workflow plus any pre-existing unrelated changes.
- Run `git diff --check -- docs/architecture/git-natural-read-hardening-session-plan.md docs/architecture/git-natural-read-hardening-session-checkpoint.md docs/architecture/git-natural-read-hardening-analysis.md` if those files exist.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to `Complete`.
  - Set `Phase Exit Criteria` to `Complete`.
  - Set `Next Action` to final response.
  - Record any remaining risks or blockers.
- Commit and push the phase if possible, including only analysis/checkpoint/plan files from this workflow. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push if possible, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Phase Transition

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.
