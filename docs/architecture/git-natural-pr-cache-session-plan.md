# Git Natural PR And Durable Cache Session Plan

## Objective

- Close out the current dirty work first: git-natural file-content normalization, commit-detail natural-first loading, binary diff propagation, and related UI changes.
- Keep merge analysis, merge, and push clone-backed because those paths require a real `isomorphic-git` repository, refs, index/worktree semantics, and LightningFS persistence.
- Move PR read-only loading toward git-natural-first where safe: PR commits tab, files changed tab, diff loading, individual commit expansion, and PR update preview.
- Add a durable async cache for immutable git-natural object data, backed by IndexedDB when available, while keeping `infoRefs` memory-only with a short TTL.
- Use `~/Work/gitworkshop/src/lib/git-grasp-pool/` as the reference for object-addressed caching, low-level natural-read orchestration, binary diff handling, and URL fallback behavior.
- Use current Budabit code as authoritative. If this plan conflicts with code, inspect code, update the checkpoint with evidence, and continue from the code.

## Constraints

- This plan is ready for review only. Do not execute implementation phases until the user explicitly says to launch.
- Current repository state is authoritative over this plan.
- The checkpoint file is authoritative over compacted conversation summaries and older chat history.
- Read the checkpoint and the entire plan at the start of every phase, even after compaction.
- Stage only files intentionally changed for each phase.
- Never revert or overwrite unrelated user changes. If an unrelated dirty file overlaps a phase, stop and ask.
- The currently dirty `docs/architecture/git-natural-read-pivot.md` was pre-existing before this plan; Phase 1 must inspect it before deciding whether it belongs in the closeout commit.
- Keep `infoRefs` out of persistent storage. It is ref/advertisement state, not immutable object data, and must remain memory-only with a short TTL.
- Persist only immutable content-addressed or immutable-by-input data in the async natural cache: commit objects, tree objects, blob objects, raw filtered object batches by commit/filter, and history batches by start commit/limit.
- Preserve L1 memory cache behavior for hot reads. IndexedDB is L2 durability, not a replacement for in-memory session speed.
- Keep provider REST and clone-backed worker paths as compatibility fallbacks.
- Do not replace merge analysis or merge/push with git-natural reads in this workflow.

## Phase 1: Close Out Current Dirty Work And Prepare A Clean Repo

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Audit, verify, commit, and push the current dirty work before starting new implementation.
- Leave the repository clean and ready for the durable cache and PR natural-read phases.

### Exit Criteria

- Current dirty work is inspected and classified as intentional or unrelated.
- Current git-natural file-content and commit-detail changes are verified.
- `docs/architecture/git-natural-read-pivot.md` is either intentionally included with evidence or left unstaged with an explicit checkpoint note/blocker.
- The phase is committed and pushed, or a real blocker is recorded.
- Worktree is clean after commit/push, except for explicitly documented unrelated files if any remain.

### Steps

- Run `git status --short --branch`, `git diff --stat`, `git diff`, and `git log --oneline -10`.
- Inspect current dirty files:
  - `packages/nostr-git-ui/src/lib/components/git/DiffViewer.svelte`
  - `packages/nostr-git-ui/src/lib/components/git/FileManager.ts`
  - `packages/nostr-git-ui/src/lib/components/git/FileView.svelte`
  - `packages/nostr-git-ui/src/lib/utils/prDiffUtils.ts`
  - `src/app/core/commit-api.ts`
  - `src/routes/git/[id=naddr]/code/+page.svelte`
  - `src/routes/git/[id=naddr]/commits/[commitid]/+page.svelte`
  - `src/routes/git/[id=naddr]/commits/[commitid]/+page.ts`
  - `docs/architecture/git-natural-read-pivot.md`
  - this session plan and checkpoint.
- Confirm the file-content fix follows the agreed contract: natural provider/router may preserve base64 bytes, but text-display callers decode before rendering and binary/media callers preserve base64.
- Confirm commit detail loading is natural-first before REST metadata and clone-backed worker fallback.
- Confirm binary natural diffs preserve `binary: true` to UI adapters.
- Run verification commands.
- Update the checkpoint with actual evidence and changed files.
- Stage only intentional files.
- Commit with a concise message, for example `fix: align git natural content and commit reads`.
- Push the current branch.
- Confirm `git status --short --branch` after push.

### Verification

- `nix develop -c pnpm -F @nostr-git/ui typecheck`
- `nix develop -c pnpm exec vitest run --coverage.enabled=false src/routes/git/[id=naddr]/commits/[commitid]/page.load.test.ts`
- `nix develop -c pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- `nix develop -c pnpm check`
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
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 2: Add IndexedDB-Backed Immutable Git Natural Object Cache

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Add an async durable L2 cache for immutable git-natural object data in the worker/core layer.
- Keep existing in-memory `GitNaturalObjectCache` as L1 and keep `infoRefs` memory-only with short TTL.

### Exit Criteria

- A worker/core IndexedDB-backed natural object store exists for immutable data only.
- Persisted data includes commits, trees, blobs, raw object batches by commit/filter, and history batches by start commit/limit.
- `infoRefs` is not persisted and continues to use the existing short memory TTL.
- The natural provider reads L1 memory first, then async L2, then network; successful network reads populate both L1 and L2.
- The implementation gracefully degrades to memory-only when IndexedDB is unavailable or throws.
- Tests prove cached immutable objects survive provider/cache re-instantiation without persisting `infoRefs`.

### Steps

- Read `packages/nostr-git-core/src/git/natural-read-cache.ts` and `natural-read-provider.ts`.
- Read `packages/nostr-git-core/src/worker/workers/cache.ts` for existing worker IndexedDB patterns.
- Read `~/Work/gitworkshop/src/lib/git-grasp-pool/cache.ts` for L1/L2 object-addressed cache structure.
- Add a core/worker natural cache persistence module, for example `natural-read-indexed-cache.ts` or a small `GitNaturalAsyncObjectStore` abstraction.
- Use deterministic keys aligned with `gitNaturalCacheKeys`:
  - `commit:<hash>`
  - `tree:<hash>`
  - `blob:<hash>`
  - `raw:<commitHash>:<filter>`
  - `history:<startCommitHash>:<limit>`
- Store `Uint8Array` data without lossy string conversion.
- Add size/version metadata and a bounded cleanup strategy. Prefer simple versioned schema plus conservative entry/byte limits over a complex eviction policy in the first pass.
- Modify `GitNaturalReadProvider` to hydrate missing L1 entries from L2 before network calls.
- Modify `storeObjects()` / history writes to persist immutable data asynchronously after writing L1.
- Do not persist `infoRefs`. Keep existing `DEFAULT_NATURAL_INFO_REFS_TTL_MS` behavior.
- Add tests for L1 miss/L2 hit, provider re-instantiation, binary blob round trip, raw batch round trip, and non-persistence of `infoRefs`.

### Verification

- `nix develop -c pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read-provider.spec.ts packages/nostr-git-core/test/git/natural-read.spec.ts`
- `nix develop -c pnpm -F @nostr-git/core typecheck`
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
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 3: Make PR Read-Only Review Data Git Natural First

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Use git-natural reads for PR commits/files/diffs where local Git semantics are not required.
- Keep clone-backed fallback for forks/remotes where natural diff cannot fetch both sides from one URL or where merge-base resolution needs local history.

### Exit Criteria

- PR files changed tab tries git-natural diff before clone-backed `getDiffBetween`.
- PR commits tab can load commit metadata from git-natural history/commit reads before clone fallback.
- PR individual commit expansion tries natural commit details before clone-backed `getCommitDetails`.
- Same-repo PRs and forks whose source remote contains the base objects can render commits/files without full clone.
- Fork PRs whose base/head are not available from a single natural remote fall back cleanly to the current clone-backed behavior.
- Merge analysis and merge/push remain clone-backed and unchanged.

### Steps

- Read `src/app/components/PRView.svelte` for PR tabs, individual commit expansion, and retry paths.
- Read `packages/nostr-git-core/src/worker/worker.ts` methods `getPRReviewData`, `getDiffBetween`, `gitNaturalGetCommit`, `gitNaturalListCommits`, and `gitNaturalGetDiffBetween`.
- Add a worker/core helper for natural PR review data rather than duplicating logic in Svelte.
- For non-applied PRs:
  - Use provided `mergeBase` when available.
  - Resolve target branch with natural refs only when needed.
  - Use natural commit history from `tipCommitOid` to list PR commits until merge base when possible.
  - Use natural diff for `baseOid -> headOid` with source URLs first, then target URLs, then ordered union.
  - If natural cannot load both commits/trees from a single remote, fall back to current clone-backed review data.
- For applied/merged PR diff ranges:
  - Try natural commit metadata for merge/applied commits.
  - Try natural diff for resolved ranges before clone-backed `getDiffBetween`.
- Update PRView to pass/read source metadata and warnings if available.
- Preserve existing error phase labels: `source`, `target`, and `review`.
- Add tests for same-repo natural success, fork natural fallback, and clone fallback preservation.

### Verification

- `nix develop -c pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false` with focused PR/natural tests if available.
- `nix develop -c pnpm -F @nostr-git/core typecheck`
- `nix develop -c pnpm -F @nostr-git/ui typecheck`
- `git diff --check`
- Manual browser check if practical: open a PR detail page and confirm commits/files load without `ensureFullClone` for same-repo natural-capable remotes.

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
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 4: Add Clone-To-Natural Cache Bridge For Objects Already Fetched By Fallbacks

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Reduce duplicate network work after clone-backed fallbacks by writing immutable objects observed by `isomorphic-git` paths into the natural object cache.
- Do not attempt natural-cache-to-clone hydration in this phase.

### Exit Criteria

- Clone-backed file/diff/commit paths opportunistically populate the natural immutable object cache when object hashes and bytes are available.
- The bridge stores only immutable objects and never stores refs or mutable clone state.
- Bridge failures are non-fatal and never break clone-backed fallback behavior.
- Tests show a clone-backed fallback can populate cache entries that a later natural read can reuse.

### Steps

- Read worker clone-backed paths:
  - `getRepoFileContentFromEvent`
  - `getCommitDetails`
  - `getDiffBetween`
  - `getPRReviewData`
- Identify safe object bytes available without expensive pack parsing:
  - Blob OIDs and blob bytes from `WalkerEntry.content()` and `git.readBlob()`.
  - Commit metadata from `git.readCommit()`; raw commit bytes only if `isomorphic-git.readObject()` returns a safe byte representation.
  - Tree objects only when raw bytes are available safely. If not, skip tree bridging rather than inventing lossy serialization.
- Add a small bridge API near the natural cache provider, for example `cacheObservedGitObject()` / `cacheObservedBlob()`.
- Wire clone-backed diff and file-content reads to store blobs by OID.
- Wire commit detail reads to store commit objects only if raw bytes are available; otherwise store parsed commit metadata in a separate immutable commit metadata cache only if it does not pollute raw object cache contracts.
- Add tests with mocked git provider/cache to prove non-fatal behavior and cache reuse.

### Verification

- `nix develop -c pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read-provider.spec.ts`
- `nix develop -c pnpm -F @nostr-git/core typecheck`
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
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 5: Natural-First PR Preview And Observability Cleanup

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Extend natural-first behavior to read-only PR update/preview paths where safe.
- Improve source metadata/logging so future reports clearly show natural, REST, git remote, or clone fallback source.

### Exit Criteria

- PR update preview tries natural refs/history before clone-backed `getPRPreview` when enough OIDs/refs are available.
- Merge-base helper uses natural history where safe before clone fallback, without changing merge analysis.
- `ensureFullClone` logs on PR detail are reduced to merge analysis/merge/push or documented fallback cases.
- Read source metadata or logs distinguish natural cache hit, natural network, provider REST, git remote refs, and clone fallback.
- Documentation/checkpoint records the final read/fallback table.

### Steps

- Read `NewPRForm.svelte`, `PRView.svelte`, worker `getPRPreview`, `getCommitsAheadOfTip`, and `getMergeBaseBetween`.
- Add natural-first read helpers for preview where target/source refs can be resolved by natural `info/refs` or provided OIDs.
- Keep existing clone-backed preview as fallback.
- Add concise debug/source metadata for PR natural success and fallback reasons.
- Update the checkpoint or a small architecture note with the final fetching-method table.
- Run broad verification.

### Verification

- `nix develop -c pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`
- `nix develop -c pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false`
- `nix develop -c pnpm check`
- `git diff --check`
- Manual browser check if practical: PR detail commits/files, PR update preview, merge analysis button, code file open.

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
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.
