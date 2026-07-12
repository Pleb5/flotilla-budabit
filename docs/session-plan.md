# Session Plan

## Objective

- Upgrade Budabit's Welshman packages from `0.7.1` to `0.8.16` so the upstream NIP-46/Nostr Connect and relay connection fixes are available.
- Remove the old pnpm Welshman store override and Welshman util patch instead of carrying version-specific `0.7.1` package-manager state forward.
- Adapt Budabit code for Welshman `0.8.16` API changes, especially NIP-46 relay switching and signer log shape changes.
- Verify behavior with focused NIP-46/signing checks, full Svelte/type checks, and broader test/build checks where feasible.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Branch `dev` tracks `origin/dev` and is the implementation target.
- Stage only files intentionally changed for each phase.
- Never revert unrelated user or other-agent changes. If unrelated changes appear in files needed by a phase, stop and ask.
- Use the existing `docs/session-plan.md` and `docs/session-checkpoint.md` durable workflow files.
- Commit and push every verified phase before continuing.
- After every phase push, reread the checkpoint and immediately start the next phase unless the checkpoint says `Current Phase: Complete` or a blocker stops the loop.

## Phase 1: Dependency Migration

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Move the package graph to Welshman `0.8.16` without carrying stale `0.7.1` overrides or patches.

### Exit Criteria

- Root `package.json` depends on all `@welshman/*` packages at `^0.8.16`.
- Root `package.json` removes the `@welshman/store` `0.7.1` override.
- Root `package.json` removes the `@welshman/util@0.7.1` patched dependency entry.
- The old `patches/@welshman__util@0.7.1.patch` file is removed if no longer referenced.
- Required Welshman `0.8.16` peers are represented in the root dependency graph, including `@pomade/core`, `@noble/curves`, and `@noble/hashes` versions compatible with Welshman.
- Workspace package `packages/nostr-git-ui/package.json` no longer depends on `@welshman/store` `0.7.1`.
- `pnpm install` succeeds and updates `pnpm-lock.yaml`.
- Lockfile/package inspection shows no remaining direct `@welshman/*@0.7.1` resolution for Budabit's app graph.
- `git diff --check` passes.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect package manifests and current pnpm lockfile for Welshman package references.
- Update Welshman package versions and required peers in root/package workspace manifests.
- Remove stale pnpm override and patched dependency configuration.
- Delete the old Welshman util patch file if it is no longer referenced.
- Run `pnpm install` and inspect resulting dependency graph.

### Verification

- Run `pnpm install`.
- Run package/lockfile inspection commands proving Welshman `0.8.16` is installed and stale `0.7.1` references are gone from the app graph.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10` before committing.

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

## Phase 2: Budabit Code Adaptation

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Adapt Budabit to Welshman `0.8.16` API and NIP-46 behavior while preserving current login UX.

### Exit Criteria

- `SignerLogEntryStatus` imports/usages are removed.
- Signer status UI and unresponsive-signer toast logic use Welshman `0.8.16` signer log entries: pending when `finished_at` is absent, success when `ok === true`, failure when `ok === false`, duration from timestamps.
- NIP-46/Bunker/password login persists relay lists after Welshman's `switchRelays()` succeeds.
- NIP-46 login tolerates signers that do not support or permit `switch_relays`, falling back to the original relay list instead of failing a completed login.
- Budabit's NIP-46 permissions include `switch_relays` where explicit permissions are requested.
- Focused NIP-46 tests cover the safe switch-relay fallback and unchanged QR permission behavior.
- `pnpm exec vitest run src/app/util/nip46.test.ts` passes.
- `pnpm run check` passes.
- `git diff --check` passes.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect NIP-46 login components, signer status components, and root signer toast code.
- Add a minimal Budabit NIP-46 broker helper if needed to wrap `switchRelays()` safely.
- Store `broker.params.relays` after NIP-46 connection instead of stale configured relays.
- Update signer status calculations for the new signer log shape.
- Add or update focused tests.

### Verification

- Run `pnpm exec vitest run src/app/util/nip46.test.ts`.
- Run `pnpm run check`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10` before committing.

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

## Phase 3: Thorough Verification And Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Verify the upgraded Welshman package graph and Budabit login/relay adaptations broadly enough to catch integration regressions.

### Exit Criteria

- Focused NIP-46 tests pass after dependency and code upgrades.
- `pnpm run check` passes.
- `pnpm run test:main` passes, or any failure is proven unrelated and recorded as a blocker/risk.
- `pnpm run e2e:check` passes, or any failure is proven unrelated and recorded as a blocker/risk.
- `pnpm run build` passes, or any failure is proven environment-only/unrelated and recorded as a blocker/risk.
- `git diff --check` passes.
- Final package inspection confirms no stale Welshman `0.7.1` override or patched dependency remains.
- Checkpoint records `Current Phase: Complete` with final evidence.
- Final closeout commit is pushed before final response if files changed.

### Steps

- Rerun focused NIP-46 tests and full Svelte/type check.
- Run broader unit, e2e type, and build verification.
- Inspect package graph and lockfile for stale Welshman `0.7.1` app dependencies.
- Update checkpoint to `Complete` with verification evidence and residual risks.

### Verification

- Run `pnpm exec vitest run src/app/util/nip46.test.ts`.
- Run `pnpm run check`.
- Run `pnpm run test:main`.
- Run `pnpm run e2e:check`.
- Run `pnpm run build`.
- Run `git diff --check`.
- Inspect `git status --short --branch`, `git diff`, and `git log --oneline -10` before committing.

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
