# Session Plan

## Objective

- Restore NIP-46 bunker login and restored-session reliability on `dev` using `test` (`24b4fe34`) as the known-good baseline.
- Remove or gate Budabit-side regressions introduced after `test` that make Amber/Android bunker sessions hang or receive unsolicited signer requests.
- Preserve page-loading performance work where it does not introduce hidden signer traffic or interfere with the NIP-46 handshake.
- Keep notification reads and UI behavior where possible, but prevent passive notification/background services from silently encrypting/signing/publishing during login or startup.

## Constraints

- Current repository state is authoritative over this plan.
- The checkpoint at `docs/session-checkpoint.md` is the compact resume source.
- Branch `dev` tracks `origin/dev` and is the implementation target.
- Branch `test` at `24b4fe34` is the known-good bunker baseline for behavioral comparison.
- The workflow began from `test`, then switched to `dev`; the submodule gitlinks that appeared dirty on `test` matched `dev` and became clean after checkout.
- Stage only files intentionally changed for each phase.
- Never revert unrelated user changes. If unrelated changes appear in files needed by a phase, stop and ask.
- Reliability has priority over startup/performance optimizations when the two conflict.
- Do not add a Welshman/applesauce transport patch during this workflow; first restore the simpler known-good Budabit-side lifecycle.
- Notifications may read from relays and derive UI state, but must not silently invoke the user signer in passive startup/background paths.
- Explicit user actions such as publishing content, installing extensions, changing settings, or updating repo-watch preferences may still use the signer.
- Commit and push each verified phase before starting the next phase.
- Keep the checkpoint compact; put phase design and rationale here.

## Phase 1: Plan Bootstrap

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Replace the completed prior repo-navigation workflow files with this new bunker-regression workflow and record the branch/baseline facts.

### Exit Criteria

- `docs/session-plan.md` describes all phases with `Phase Startup`, `Mandatory Closeout`, and `Continue` sections.
- `docs/session-checkpoint.md` records the new objective, current phase, branch/upstream facts, known-good baseline, decisions, and next action.
- No application code files are intentionally changed in this phase.
- Checkpoint is advanced to Phase 2 before commit.
- Phase 1 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Read the previous checkpoint and full plan.
- Inspect `git status --short --branch`, `git branch -vv`, recent log, and relevant `test..dev` differences.
- Replace the plan/checkpoint with this bunker-regression workflow.
- Commit only `docs/session-plan.md` and `docs/session-checkpoint.md`.

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

## Phase 2: Restore NIP-46 Login Handshake

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Restore the known-good QR/nostrconnect login path and prevent login finalization from hanging on unhandled NIP-46 errors.

### Exit Criteria

- QR `nostrconnect://` URLs generated by `Nip46Controller` no longer include explicit `perms`, matching known-good `test` behavior.
- `Nip46Controller.start()` awaits/catches `onNostrConnect` so failures reset loading and surface an error instead of leaving `Establishing connection...` forever.
- QR login finalization avoids an unnecessary post-approval `get_public_key` round trip when the approval event already provides the signer/user pubkey.
- Burrow/password nostrconnect finalization receives the same no-hang handling.
- Bunker URL login remains compatible with explicit `connect(..., NIP46_PERMS)` permissions.
- Focused NIP-46 tests are updated and pass.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect `src/app/util/nip46.ts`, `src/app/components/LogInBunker.svelte`, `src/app/components/LogInPassword.svelte`, and `src/app/util/nip46.test.ts` against `test`.
- Remove QR `perms` from `Nip46Controller.makeNostrconnectUrl`.
- Change `Nip46Controller.onNostrConnect` to support async handlers and catch finalization failures.
- Use the approved response event pubkey for QR/login finalization where safe, avoiding a second immediate NIP-46 RPC.
- Add or update focused tests for QR URL metadata and finalization failure behavior.

### Verification

- Run `pnpm exec vitest run src/app/util/nip46.test.ts`.
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

## Phase 3: Remove Bunker-Hostile Startup And Resume Work

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Remove automatic signer work and mobile resume behavior that can interfere with Amber app-switches or restored NIP-46 sessions.

### Exit Criteria

- No eager restored-session `signer.getPubkey()` warm-up remains in `src/routes/+layout.svelte`.
- No `setupSignerNudgeWatcher()` startup subscription remains.
- `src/app/util/signer-nudge.ts` is removed if it has no remaining legitimate callers.
- Community and command signing paths use the standard Welshman `sign` unless a bounded timeout is still explicitly justified and not harmful to bunker sessions.
- The Android `3s` relay resume path is removed or restored to a non-invasive behavior that does not run during normal Amber approval app-switches.
- `setupRelayResumeRecovery()` is not installed during startup unless it is proven safe for NIP-46 handshakes.
- Focused searches show no leftover bunker warm-up/nudge imports or startup signer calls.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 3 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect `src/routes/+layout.svelte`, `src/app/util/signer-nudge.ts`, `src/app/core/community-state.ts`, `src/app/core/commands.ts`, and `src/app/core/state.ts`.
- Remove the eager NIP-46 warm-up block.
- Remove signer-nudge startup watcher and any unused helper file/imports.
- Revert timeout wrapper imports back to Welshman `sign` where they were introduced for bunker mitigation.
- Remove or disable startup relay resume recovery that clears or mutates global relay sockets during normal mobile signer app-switches.
- Search for leftover references.

### Verification

- Run focused `grep`/searches for `signer-nudge`, `setupSignerNudgeWatcher`, `Bunker warm-up`, `signer.getPubkey`, and `setupRelayResumeRecovery`.
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

## Phase 4: Gate Passive Notification And Autosync Writes

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Keep notification/background reads, but prevent passive startup services from silently invoking the user signer.

### Exit Criteria

- `setupRepoWatchNotifications()` no longer auto-publishes repo-watch notification baseline state during passive startup.
- Notification services may subscribe/load relay data but do not call `nip44.encrypt`, `sign`, or `publishThunk` merely because the app started or notification stores initialized.
- Extension settings autosync does not publish materialized/default settings during initial remote hydration or startup without a user action.
- Explicit user actions that update repo-watch settings or extension settings still publish as before.
- Focused searches identify no passive startup path from notification setup to signer encryption/signing/publish.
- Relevant focused tests are updated or added where practical.
- `pnpm check` passes.
- `git diff --check` passes.
- Phase 4 changes are committed, pushed, and the checkpoint is reread.

### Steps

- Inspect `src/app/util/repo-watch-notifications.ts`, `src/app/core/repo-watch.ts`, `src/app/extensions/settings.ts`, `src/app/core/sync.ts`, and notification setup in `src/routes/+layout.svelte`.
- Remove the passive `updateRepoWatchNotificationSeen(...)` subscription from notification setup, or replace it with local-only state if an existing local mechanism is available.
- Ensure extension settings remote/default materialization does not force `syncExtensionSettingsNow()` during startup; keep explicit install/uninstall/settings update publishes intact.
- Add or update focused tests for passive notification setup not publishing if practical.

### Verification

- Run focused tests for repo-watch notifications/settings if changed.
- Run focused searches for passive setup calls to `updateRepoWatchNotificationSeen`, `syncExtensionSettingsNow`, `publishExtensionSettings`, `nip44.encrypt`, and `publishThunk`.
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

## Phase 5: Final Verification And Closeout

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Verify the final diff against the bunker reliability objective and close the workflow.

### Exit Criteria

- Final diff shows QR login restored to known-good no-perms behavior.
- Final diff shows no hidden startup NIP-46 warm-up or nudge watcher.
- Final diff shows passive notifications/background services do not silently sign/encrypt/publish on startup.
- `pnpm check` passes or a fresh successful result remains valid with no code changes after it.
- `git diff --check` passes.
- Checkpoint records `Current Phase: Complete` and final evidence.
- Final closeout commit is pushed before final response if files changed.

### Steps

- Inspect final diff and focused searches against the objective.
- Re-run required verification if code changed since prior successful checks.
- Update checkpoint to `Complete` with final evidence and residual risks.
- Commit and push final checkpoint updates if needed.

### Verification

- Run `pnpm check` unless no code changed since a passing prior phase check.
- Run `git diff --check`.
- Run focused searches for known regression markers.
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
