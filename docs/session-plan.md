# Session Plan

## Objective

- Make import, new-repository, and fork operations use consistent, fail-closed metadata admission and GRASP-first synchronization.
- Preserve exact relay ACK, state-before-push, post-push verification, reconciliation, rollback, and recovery evidence.
- Provide continuous, truthful UI feedback for long Git operations, including real object/delta/file/ref/target counts when available and indeterminate elapsed activity when no denominator exists.
- Make repository manipulation dialogs usable at narrow mobile widths and keyboard-reduced visual viewport heights.
- Make transaction progress durable enough to recover or safely classify interrupted work without deleting ambiguous remote data.
- Add operation-scoped cancellation and wait for a terminal worker result before cleanup where the underlying APIs permit it.

## Constraints

- Current repository state is authoritative over this plan.
- `docs/session-checkpoint.md` is authoritative over compacted conversation summaries and older chat history.
- Branch `dev` tracks `origin/dev`; every verified phase must be committed and pushed there.
- Stage only intentional phase files. Do not stage the generated `packages/nostr-git-core/coverage/src/worker/workers/sync.ts.html` or unrelated HiveTalk documents.
- Do not modify or repair GitHub repositories as part of lifecycle verification. Use unit/integration tests and local mocks unless separate approval is provided.
- Never persist provider tokens or signing secrets in transaction records.
- A queued send, timeout, disconnect, or EOSE without the exact event is not relay admission evidence.
- A determinate progress percentage is shown only when a real denominator exists. Push packing/upload remains indeterminate unless the underlying library supplies truthful counts.
- Unknown or partially populated remote outcomes are retained for manual attention rather than deleted speculatively.
- Successful new repositories retain their canonical local repository. Import and fork mirrors are temporary and should be removed after worker settlement.
- Existing-coordinate reuse is intentional only for import. New and fork must fail closed on an existing destination.
- Keep desktop design language intact while adding base-breakpoint stacking, dynamic viewport sizing, wrapping, and accessible touch targets.
- Never amend or force-push. After each phase push, reread the checkpoint and the entire plan and continue immediately unless complete or blocked.

## Phase 1: Durable Import And GRASP Baseline

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, every phase, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Verify and commit the existing import/GRASP work as the reference lifecycle for later new/fork changes.

### Exit Criteria

- Initial announcement admission precedes import clone, hosted creation, and push.
- Every new selected GRASP relay ACKs admission; existing GRASP announcements are queried and reused.
- GRASP runs before hosted targets, state is ACKed before push, partial ref pushes fail, and exact post-push reads distinguish event, empty EOSE, disconnect, and timeout.
- Final metadata excludes failed targets and recovery preserves only verified retained targets.
- Imported pull-request refs are materialized and pushed with complete-result checks.
- Development publication diagnostics correlate event, relay, socket generation, send, matching OK, notice, auth, error, and close.
- The architecture document accurately records implemented behavior and known recovery/cancellation limits.
- Generated coverage and unrelated HiveTalk documents remain unstaged.
- Focused UI/core/main tests, typechecks, formatting, and `git diff --check` pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Inspect the classified dirty diff and confirm every phase file is repository manipulation work.
- Run focused tests for relay reads, GRASP pipeline, remote sync, transaction recovery, import metadata/state, PR ref conversion, and worker push APIs.
- Run root/UI/core typechecks and formatting checks for changed files.
- Fix only regressions within the existing repository manipulation diff.
- Advance the checkpoint to Phase 2 before committing.

### Verification

- `pnpm --dir packages/nostr-git-ui exec vitest run src/lib/utils/grasp-pipeline.test.ts src/lib/utils/remote-sync.test.ts src/lib/utils/repo-creation-transaction.test.ts src/lib/utils/import-dialog-state.test.ts src/lib/utils/import-repo-metadata.test.ts`.
- `pnpm --dir packages/nostr-git-core exec vitest run test/git/platform-to-nostr.spec.ts test/worker/push-worker-api.spec.ts`.
- `pnpm exec vitest run --project=main src/app/util/fetch-relay-events.test.ts`.
- `pnpm --dir packages/nostr-git-core typecheck`.
- `pnpm --dir packages/nostr-git-ui typecheck`.
- `pnpm check`.
- Prettier check on intentional changed files.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing with completed evidence, verification results, changed files, next phase, next exit criteria, next action, and remaining risks.
- Inspect `git status`, `git diff`, and recent commits; stage only intentional phase files.
- Commit and push the phase. This is a transition, not a stopping point.
- Reread the checkpoint after push and confirm the next phase.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and checkpoint reread succeed.
- Do not consider the whole plan complete unless the checkpoint says `Current Phase: Complete`.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- Otherwise immediately begin the next phase startup without an intermediate summary.

## Phase 2: Truthful Progress And Mobile Surfaces

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, every phase, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Surface real Git and synchronization activity throughout import/new/fork and make all repository manipulation dialogs responsive on mobile.

### Exit Criteria

- Long operations have an operation ID and structured activity containing operation, phase, target/ref identity, loaded, total, and unit when known.
- Clone forwards real isomorphic-git counting, receiving, resolving, and worktree counts without weighted synthetic percentages.
- Remote synchronization exposes real target and ref counts; push packing/upload remains visibly active but indeterminate.
- Import, new, and fork ignore unrelated operation events, unsubscribe on settlement, and show elapsed/last-activity feedback during indeterminate work.
- Determinate bars appear only for real `loaded/total` values.
- Import, new, and fork shells use dynamic viewport height, fixed chrome with scrollable content, mobile-stacked actions, safe long-text wrapping, and accessible touch targets.
- Mobile geometry and progress semantics have focused regression coverage.
- Focused tests, UI typecheck, root check, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Add a serializable Git operation progress contract and subscriber fan-out on the existing worker message channel.
- Pass operation IDs into clone and push calls and forward real clone counts.
- Add target/ref activity callbacks to remote synchronization and consume them in all three hooks.
- Render shared progress detail rules: determinate only with a real total, otherwise spinner plus elapsed and last activity.
- Apply responsive viewport, scrolling, wrapping, footer, dropdown, and touch-target changes to repository dialogs and shared steps.
- Add focused bridge, hook/state, source-surface, and mobile geometry tests.

### Verification

- Focused core worker progress tests.
- Focused UI remote-sync/progress tests.
- `pnpm test:repo -- newRepoWizardSurface.test.ts` and responsive repository UI tests.
- `pnpm --dir packages/nostr-git-core typecheck`.
- `pnpm --dir packages/nostr-git-ui typecheck`.
- `pnpm check`.
- Prettier and `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, advance the checkpoint to Phase 3, inspect/stage only phase files, commit, push, and reread the checkpoint.
- Do not stop at the phase boundary unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 3: Fail-Closed Preconditions And Coordinates

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, every phase, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Prevent new/fork side effects when metadata prerequisites are missing or a destination coordinate already exists.

### Exit Criteria

- Shared validation requires owner, targets, at least one effective metadata relay, publisher outcome evidence, GRASP reads when applicable, and compensation capability before mutation.
- New performs authoritative hook-level preflight for every hosted and GRASP target with existing reuse disabled.
- New checks every relevant relay for an existing kind `30617` coordinate and blocks timeout/incomplete evidence.
- New blocks pre-existing local repositories before creation; final atomic protection is added in Phase 6.
- Wizard pending/conflict/unknown states block creation and hook revalidation prevents stale UI bypass.
- Fork validates metadata relays and destination absence before cloning.
- Focused preflight/hook/wizard tests prove no worker mutation occurs after failed validation.
- Typechecks, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Extract shared creation prerequisites and exact coordinate absence checks.
- Move new target/token construction and validation before local creation.
- Invoke `preflightRemoteTargets` with `allowExistingRepoReuse: false` in new and fork orchestration.
- Check local existence through the worker before new initialization.
- Make wizard navigation and Create fail closed on pending, conflict, unknown, or stale checks.
- Add focused orchestration tests with worker-call order assertions.

### Verification

- Focused `remote-targets-preflight`, `useNewRepo`, `useForkRepo`, and wizard tests.
- `pnpm --dir packages/nostr-git-ui typecheck`.
- `pnpm check`.
- Prettier and `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, advance the checkpoint to Phase 4, inspect/stage only phase files, commit, push, and reread the checkpoint.
- Do not stop at the phase boundary unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 4: Admission-First New And Fork

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, every phase, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Apply import's admission-first, GRASP-first transaction ordering and exact rollback scope to new and fork.

### Exit Criteria

- New admits a provisional announcement and waits for all selected GRASP endpoints before local creation.
- Fork admits a provisional announcement and waits for all selected GRASP endpoints before source clone.
- Both pass exact prepublished events/readiness into synchronization and process every GRASP target before hosted targets.
- Existing destination reuse remains disabled for new/fork.
- Admission-only failures compensate only event-specific ACKed relay scopes, even if no target ran.
- Final metadata is newer than every provisional event and describes only successful targets.
- Pure GRASP, pure hosted, and hybrid ordering/partial-failure tests pass.
- Typechecks, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Reuse `publishRepoSyncAnnouncement` in new and fork before Git side effects.
- Pass admitted announcement maps and preprovisioned relays to remote synchronization.
- Make GRASP-first the shared safe default and explicit in each orchestration call.
- Refactor rollback callbacks to preserve `{event, relayUrls}` per-event evidence.
- Correct obsolete-event cleanup scope after relay intersection.
- Add sequence and partial-success tests.

### Verification

- Focused `remote-sync`, `grasp-pipeline`, `useNewRepo`, `useForkRepo`, and rollback tests.
- `pnpm --dir packages/nostr-git-ui typecheck`.
- `pnpm check`.
- Prettier and `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, advance the checkpoint to Phase 5, inspect/stage only phase files, commit, push, and reread the checkpoint.
- Do not stop at the phase boundary unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 5: Durable Checkpoints Recovery And Cleanup

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, every phase, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Persist side-effect progress as targets settle and safely reconcile interrupted transactions and temporary local repositories.

### Exit Criteria

- Journal schema records versioned local ownership, per-target/per-ref stages, remote receipts, exact event ACK scopes, cleanup state, and manual-attention reasons without secrets.
- Initial journal persistence fails closed and target checkpoints are saved immediately after each side effect boundary.
- Unresolved records are retained instead of silently discarded by age.
- Recovery handles metadata-pending, cleanup-pending, syncing, and failed records through conservative probes and never repeats ambiguous hosted creation/push automatically.
- Verified surviving targets produce reconciled final metadata; known total failure compensates exact provisional evidence.
- Import/fork temporary mirrors are removed after worker settlement; failed deletion remains retryable.
- New retains successful local state and deletes failed transaction-owned local state only with proof it did not pre-exist.
- Focused journal migration, interruption, recovery, and cleanup tests pass.
- Typechecks, formatting, and whitespace checks pass.
- Phase files and checkpoint advancement are committed and pushed.

### Steps

- Introduce journal schema migration and explicit persistence errors.
- Add target/ref checkpoint callbacks to remote synchronization.
- Extract route startup recovery into a tested coordinator.
- Probe remote refs and exact GRASP metadata to classify interrupted work.
- Implement operation-owned local cleanup policies and retryable cleanup records.
- Add interruption tests at each target boundary.

### Verification

- Focused transaction, remote-sync, recovery, and worker deletion tests.
- `pnpm --dir packages/nostr-git-core typecheck`.
- `pnpm --dir packages/nostr-git-ui typecheck`.
- `pnpm check`.
- Prettier and `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, advance the checkpoint to Phase 6, inspect/stage only phase files, commit, push, and reread the checkpoint.
- Do not stop at the phase boundary unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 6: Operation Cancellation And Final Validation

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, every phase, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add operation-scoped cancellation and atomic local creation, then validate and document the complete repository manipulation architecture.

### Exit Criteria

- Mutating worker RPCs accept operation IDs and expose terminal status with whether a side effect may have occurred.
- Clone, provider requests, and push observe cancellation where supported; accepted/ambiguous remote operations end as `unknown`, not falsely clean cancellation.
- Import/new/fork request cancellation, wait for terminal or unknown status, checkpoint it, and only then clean up.
- New local creation atomically enforces `mustNotExist` inside the worker immediately before initialization.
- Concurrent operation IDs do not cross-talk in progress, cancellation, or status.
- Architecture documentation covers all three flows, progress truthfulness, mobile behavior, recovery, cancellation boundaries, and residual server/idempotency limits.
- Focused and broad UI/core/main tests, typechecks, build, formatting, and whitespace checks pass, or a real blocker is recorded.
- Checkpoint says `Current Phase: Complete` with final evidence and residual risks.
- Final closeout commit is pushed and the checkpoint is reread.

### Steps

- Add worker operation registry, cancellation/status RPCs, and `mustNotExist` local creation.
- Thread abort signals through clone, push, and provider HTTP calls where APIs support them.
- Integrate terminal cancellation sequencing in all three hooks and UIs.
- Add concurrent operation and ambiguous-side-effect tests.
- Update architecture documentation and run broad verification.
- Advance the checkpoint to Complete, commit, push, and reread it.

### Verification

- Focused worker operation/cancellation, progress, push, delete, and hook tests.
- Full `packages/nostr-git-core` test suite.
- Full `packages/nostr-git-ui` test suite.
- `pnpm check`.
- `pnpm run e2e:check`.
- `pnpm run build`.
- Prettier and `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion.
- Update the checkpoint to `Current Phase: Complete` with final evidence, changed files, verification, and residual risks.
- Inspect status/diff/log, stage only phase files, commit, and push.
- Reread the checkpoint and confirm it says Complete before the final response.
- Do not claim completion before that reread.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- Otherwise immediately resume the unresolved phase or stop only for a recorded blocker.
