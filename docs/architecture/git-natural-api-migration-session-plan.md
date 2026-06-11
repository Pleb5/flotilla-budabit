# Git Natural API Migration Session Plan

## Objective

- Migrate Budabit Git natural reads away from hand-rolled low-level Git protocol code and onto `@fiatjaf/git-natural-api` primitives.
- Keep Budabit responsible for product orchestration: URL policy, source metadata, caching, in-flight dedupe, fallback routing, worker integration, and UI adaptation.
- Let the library own low-level Git mechanics: `info/refs`, upload-pack response handling, pack parsing, object parsing, tree loading, commit parsing, and delta mechanics.
- Use `~/Work/gitworkshop` as the stable integration reference, especially `src/lib/git-grasp-pool/git-http.ts`, `pool.ts`, `diff-utils.ts`, `cors-proxy.ts`, and `cache.ts`.
- Use `~/Work/git-natural-api` as local source reference for the library implementation, especially `index.ts`, `packs.ts`, `refs.ts`, `tree.ts`, `commits.ts`, and `parse-packfile.ts`.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint file is authoritative over compacted conversation summaries and older chat history.
- Existing unstaged changes not made by this workflow must not be reverted or staged.
- Stage only files intentionally changed for each phase.
- Keep fallback semantics intact: natural read failure must fall back to provider REST and/or worker clone where those paths already exist.
- Preserve GRASP direct-read behavior; do not route GRASP through the generic CORS proxy by default.
- Avoid expanding Budabit's low-level protocol ownership while migrating.
- If a library primitive is insufficient, prefer a small local adapter around the library and record the gap; do not fork large protocol logic back into Budabit without explicit evidence.

## Phase 1: Install Git Natural API Dependency

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add `@fiatjaf/git-natural-api` as a dependency of `@nostr-git/core` using the package form proven by `~/Work/gitworkshop`.
- Do not change natural-read behavior in this phase.

### Exit Criteria

- `packages/nostr-git-core/package.json` declares `@fiatjaf/git-natural-api`.
- The lockfile is updated consistently by pnpm.
- No production code behavior is changed in this phase.
- Typecheck for `@nostr-git/core` passes, or any dependency-resolution blocker is recorded in the checkpoint.

### Steps

- Confirm `~/Work/gitworkshop/package.json` dependency form: `@fiatjaf/git-natural-api: npm:@jsr/fiatjaf__git-natural-api@^0.2.4`.
- Confirm local source exists at `~/Work/git-natural-api` for API inspection.
- Install the dependency into `@nostr-git/core` with pnpm.
- Run focused verification.

### Verification

- `pnpm -F @nostr-git/core typecheck`
- `git diff --check -- packages/nostr-git-core/package.json pnpm-lock.yaml docs/architecture/git-natural-api-migration-session-plan.md docs/architecture/git-natural-api-migration-session-checkpoint.md`

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
- Commit and push the phase, including dependency and checkpoint/plan updates. This is a phase transition, not a stopping point.
- Read the session checkpoint again to verify status and next action.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and reading the session checkpoint all succeeded.
- Do not consider the whole plan complete unless the session checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
- Do not send a final response before starting the next phase.
- Do not treat commit/push output as completion of the command.

## Phase 2: Introduce Library Adapter And Protocol Regression Tests

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add a thin Budabit adapter around `@fiatjaf/git-natural-api` low-level primitives without switching production reads yet.
- Add protocol regression tests that prove library-backed upload-pack handling does not reproduce `Invalid packfile header: shal`.

### Exit Criteria

- A library-backed adapter exists for low-level operations Budabit needs: cached `info/refs`, capability selection from cached info, `blob:none`, `tree:0`, object-by-hash fetch, tree loading, and commit parsing.
- The adapter avoids calling high-level library helpers that refetch capabilities when cached info is already available, following `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts`.
- Tests cover upload-pack responses containing `shallow <oid>`, `unshallow <oid>`, side-band progress, and missing/invalid pack responses.
- Existing natural-read behavior remains routed through the old implementation until the tests are in place.

### Steps

- Read `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts` for the low-level pattern: use `getInfoRefs`, local capability selection, `createWantRequest`, `fetchPackfile`, `loadTree`, and `parseCommit`.
- Read `~/Work/git-natural-api/packs.ts`, `refs.ts`, `tree.ts`, and `commits.ts` to confirm exports and error behavior.
- Create a minimal adapter module in `packages/nostr-git-core/src/git/`.
- Add tests beside `packages/nostr-git-core/test/git/natural-read.spec.ts` or a new focused test file.

### Verification

- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read.spec.ts`
- `pnpm -F @nostr-git/core typecheck`
- `git diff --check`

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
- Commit and push the phase.
- Read the session checkpoint again to verify status and next action.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.

## Phase 3: Switch Natural Read Provider To Library Adapter

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Route `GitNaturalReadProvider` operations through the library-backed adapter while preserving its public result shapes and source metadata.

### Exit Criteria

- `listDirectory`, `getFileContent`, `listCommits`, `getCommit`, and `getDiffBetween` no longer depend on Budabit's hand-rolled upload-pack extraction for normal paths.
- `GitNaturalReadProvider` still returns the same external result contracts consumed by worker RPCs and `VendorReadRouter`.
- Natural read failures remain typed and fall back cleanly through existing router/worker paths.
- Tests cover directory, file content, commit history, and diff behavior using library-backed fixtures.

### Steps

- Use `gitworkshop` `fetchFullTree`, `getRawObjects`, and `fetchBlob` patterns as inspiration without importing product-specific pool logic.
- Keep Budabit-specific source metadata in the provider layer.
- Keep object cache and in-flight dedupe in Budabit, not the protocol adapter.
- Prefer adapter methods over direct imports throughout the provider.

### Verification

- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read.spec.ts packages/nostr-git-core/test/git/natural-read-provider.spec.ts`
- `pnpm -F @nostr-git/core typecheck`
- `git diff --check`

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing with evidence, verification, changed files, next phase, and risks.
- Commit and push the phase.
- Read the session checkpoint again to verify status and next action.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.

## Phase 4: Align Caching, CORS, Binary, And Diff Behavior

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Harden the Budabit-owned orchestration around the library-backed protocol layer.

### Exit Criteria

- In-flight `blob:none` / `tree:0` fetches are deduped by URL, proxy mode, commit, and filter.
- Explicit `corsProxy: null` means direct mode in worker natural RPCs.
- Natural file content preserves bytes and byte size through the UI adapter.
- Natural diff handles binary files or falls back intentionally.
- Router rollout/fallback controls cover worker natural diff or worker natural diff has an explicit kill switch.

### Steps

- Use `~/Work/gitworkshop/src/lib/git-grasp-pool/cache.ts` and `git-http.ts` for raw-object in-flight dedupe inspiration.
- Use `~/Work/gitworkshop/src/lib/git-grasp-pool/cors-proxy.ts` for direct/proxy decision inspiration while preserving GRASP direct semantics.
- Use `~/Work/gitworkshop/src/lib/git-grasp-pool/diff-utils.ts` for binary detection, unique blob fetches, and subtree hash short-circuit inspiration.
- Add UI router tests for binary content and null CORS override.

### Verification

- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`
- `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false`
- `pnpm -F @nostr-git/core typecheck`
- `pnpm -F @nostr-git/ui typecheck`
- `git diff --check`

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing with evidence, verification, changed files, next phase, and risks.
- Commit and push the phase.
- Read the session checkpoint again to verify status and next action.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.

## Phase 5: Remove Or Quarantine Legacy Low-Level Code And Validate

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Remove Budabit's obsolete low-level Git natural implementation from production paths and validate the migrated architecture end-to-end.

### Exit Criteria

- Legacy upload-pack extraction and pack parsing are deleted, moved to test helpers, or explicitly marked non-production if still needed for fixtures.
- Documentation states Budabit uses `@fiatjaf/git-natural-api` for protocol primitives and owns only orchestration.
- Full focused natural-read test suite passes.
- Full project checks pass or any unrelated pre-existing blocker is recorded.
- Checkpoint says `Current Phase: Complete`.

### Steps

- Search for remaining production imports of old low-level parser/client helpers.
- Remove obsolete code only after tests prove production paths no longer need it.
- Update architecture docs with the final boundary between library and Budabit.
- Run focused and broader verification.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`
- `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false`
- `git diff --check`

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
- Commit and push the final phase.
- Read the session checkpoint again to verify `Current Phase: Complete`.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- If the checkpoint does not say `Current Phase: Complete`, immediately begin the next phase startup.
