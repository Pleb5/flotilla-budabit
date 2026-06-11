# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Migrate Budabit Git natural reads away from hand-rolled low-level Git protocol code and onto `@fiatjaf/git-natural-api`, using `~/Work/gitworkshop` as integration reference and `~/Work/git-natural-api` as local library source reference.

## Current Phase

- Phase 5: Remove Or Quarantine Legacy Low-Level Code And Validate

## Phase Exit Criteria

- Legacy upload-pack extraction and pack parsing are deleted, moved to test helpers, or explicitly marked non-production if still needed for fixtures.
- Documentation states Budabit uses `@fiatjaf/git-natural-api` for protocol primitives and owns only orchestration.
- Full focused natural-read test suite passes.
- Full project checks pass or any unrelated pre-existing blocker is recorded.
- Checkpoint says `Current Phase: Complete`.

## Completed With Evidence

- Phase 1 completed: installed `@fiatjaf/git-natural-api` into `@nostr-git/core` as `npm:@jsr/fiatjaf__git-natural-api@^0.2.4`.
- Evidence: `packages/nostr-git-core/package.json` declares `@fiatjaf/git-natural-api`.
- Evidence: `pnpm-lock.yaml` contains `@jsr/fiatjaf__git-natural-api@0.2.4`.
- Evidence: no production code files were changed in Phase 1.
- Phase 2 completed: introduced `GitNaturalApiAdapter` as a thin library-backed adapter without switching production provider behavior.
- Evidence: adapter calls low-level `getInfoRefs`, `fetchPackfile`, `loadTree`, and `parseCommit` from `@fiatjaf/git-natural-api`.
- Evidence: adapter vendors only the small pkt-line want builder and local capability selector because the installed package entrypoint does not export `createWantRequest` or capability constants.
- Evidence: adapter has cached `info/refs`, local capability selection from cached info, object-by-hash, `blob:none`, `tree:0`, tree loading, and commit parsing operations.
- Evidence: protocol regressions in `packages/nostr-git-core/test/git/natural-read.spec.ts` cover `shallow <oid>`, `unshallow <oid>`, side-band progress, missing pack responses, and invalid pack responses.
- Evidence: production natural-read provider still imports and uses `GitNaturalReadClient` and `natural-read-objects`; Phase 2 only exports the adapter for later phases.
- Phase 3 completed: routed `GitNaturalReadProvider` normal read paths through `GitNaturalApiAdapter` while preserving public result/source shapes.
- Evidence: `fetchInfoRefs`, `blob:none`, `tree:0`, and object-by-hash reads in `GitNaturalReadProvider` now call adapter methods.
- Evidence: provider no longer imports or calls `GitNaturalReadClient`, `parseGitNaturalPackfile`, `parseGitNaturalTree`, or `parseGitNaturalCommit` for normal paths.
- Evidence: provider adapts library parsed objects into Budabit cache/result shapes while source metadata remains in the provider layer.
- Evidence: existing directory, file content, commit history, get-commit, diff, and missing-filter provider tests pass against the adapter-backed provider.
- Phase 4 completed: hardened Budabit-owned cache/CORS/binary/diff orchestration around the adapter-backed provider.
- Evidence: provider-level in-flight filtered-pack dedupe now covers concurrent `blob:none` and `tree:0` fetches by URL, direct/proxy mode, commit, and filter/depth key.
- Evidence: explicit `corsProxy: null` is preserved through adapter, provider, and worker natural RPCs as direct mode instead of falling back to the default proxy.
- Evidence: UI natural file adaptation preserves base64 payloads and provider byte size instead of lossy UTF-8 conversion.
- Evidence: natural diff marks binary file changes as metadata-only with `binary: true` and empty text hunks.
- Evidence: generic worker `getDiffBetween` natural diff fast path is now explicitly opt-in via `gitNaturalDiff: true`; the dedicated natural diff RPC remains guarded by `enabled: true`.
- Evidence: `Status.svelte` missing status-constant imports were fixed after the mandated UI typecheck exposed the unrelated blocker.

## Decisions

- Use `@fiatjaf/git-natural-api` for protocol primitives instead of expanding Budabit's low-level implementation.
- Use the package form proven by `~/Work/gitworkshop`: `@fiatjaf/git-natural-api` aliased to `npm:@jsr/fiatjaf__git-natural-api@^0.2.4` unless pnpm proves a better canonical install.
- Use `~/Work/gitworkshop/src/lib/git-grasp-pool/` for cache/fallback/diff/CORS integration inspiration.
- Read `~/Work/git-natural-api` source when API behavior is unclear.
- Leave pre-existing unrelated unstaged changes untouched.

## Current State

- Phase 4 complete; checkpoint advanced to Phase 5.
- Pre-existing unstaged change observed: `docs/architecture/git-natural-read-pivot.md`.
- Previous hardening analysis is available at `docs/architecture/git-natural-read-hardening-analysis.md`.

## Next Action

- Begin Phase 5 by rereading this checkpoint and the full plan, inspecting repo state, then search for remaining production imports/usages of legacy natural-read upload-pack extraction and pack parsing.

## Verification

- Phase 1: `pnpm -F @nostr-git/core typecheck` passed.
- Phase 1: `git diff --check -- packages/nostr-git-core/package.json pnpm-lock.yaml docs/architecture/git-natural-api-migration-session-plan.md docs/architecture/git-natural-api-migration-session-checkpoint.md` passed with no output.
- Phase 1 install command succeeded: `pnpm --filter @nostr-git/core add @fiatjaf/git-natural-api@npm:@jsr/fiatjaf__git-natural-api@^0.2.4`.
- Phase 2: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read.spec.ts` passed with 13 tests.
- Phase 2: `pnpm -F @nostr-git/core typecheck` passed.
- Phase 2: `git diff --check` passed with no output.
- Phase 3: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read.spec.ts packages/nostr-git-core/test/git/natural-read-provider.spec.ts` passed with 19 tests.
- Phase 3: `pnpm -F @nostr-git/core typecheck` passed.
- Phase 3: `git diff --check` passed with no output.
- Phase 4: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read-provider.spec.ts` passed with 9 tests.
- Phase 4: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts` passed with 22 tests.
- Phase 4: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false` passed with 119 files passed, 1 skipped; 929 tests passed, 2 skipped, 1 todo.
- Phase 4: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false` passed with 29 files and 183 tests after the final UI import fix.
- Phase 4: `pnpm -F @nostr-git/core typecheck` passed.
- Phase 4: `pnpm -F @nostr-git/ui typecheck` initially failed on missing `GIT_STATUS_*` imports in untouched `Status.svelte`; after fixing those imports it passed with 0 errors and 0 warnings.
- Phase 4: `git diff --check` passed with no output.

## Risks Or Blockers

- `git-natural-api` high-level helpers refetch capabilities; Budabit should continue using `GitNaturalApiAdapter` low-level methods instead of high-level helpers.
- The installed `@fiatjaf/git-natural-api@0.2.4` JavaScript omits `mode` fields from `loadTree()` results even though local source/types include them; provider now uses adapter `parseTree()` for mode-sensitive contracts.
- Library `fetchPackfile` owns upload-pack parsing and pack parsing but uses global `fetch` and `Response.bytes()` with no fetcher injection; adapter uses a scoped temporary fetch bridge only when a Budabit test/custom fetcher is supplied.
- Old `natural-read-client` and `natural-read-objects` remain for exported helpers/tests and should be removed or quarantined in Phase 5 after Phase 4 hardening.
- Phase 5 must decide whether old `natural-read-client` and `natural-read-objects` can be deleted, moved to tests, or explicitly marked non-production without breaking exported helpers/tests.
- Pre-existing unstaged change remains: `docs/architecture/git-natural-read-pivot.md`.

## Files

- `docs/architecture/git-natural-api-migration-session-plan.md`
- `docs/architecture/git-natural-api-migration-session-checkpoint.md`
- `packages/nostr-git-core/package.json`
- `pnpm-lock.yaml`
- `packages/nostr-git-core/src/git/natural-read-api-adapter.ts`
- `packages/nostr-git-core/src/git/natural-read-client.ts`
- `packages/nostr-git-core/src/git/natural-read-provider.ts`
- `packages/nostr-git-core/src/git/natural-read-cache.ts`
- `packages/nostr-git-core/src/git/index.ts`
- `packages/nostr-git-core/src/worker/worker.ts`
- `packages/nostr-git-ui/src/lib/components/git/Status.svelte`
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`
- `packages/nostr-git-ui/src/lib/components/git/WorkerManager.ts`
- `packages/nostr-git-core/test/git/natural-read.spec.ts`
- `packages/nostr-git-core/test/git/natural-read-provider.spec.ts`
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts`
- `~/Work/gitworkshop/src/lib/git-grasp-pool/pool.ts`
- `~/Work/gitworkshop/src/lib/git-grasp-pool/diff-utils.ts`
- `~/Work/gitworkshop/src/lib/git-grasp-pool/cors-proxy.ts`
- `~/Work/gitworkshop/src/lib/git-grasp-pool/cache.ts`
- `~/Work/git-natural-api/index.ts`
- `~/Work/git-natural-api/packs.ts`
- `~/Work/git-natural-api/refs.ts`
- `~/Work/git-natural-api/tree.ts`
- `~/Work/git-natural-api/commits.ts`
- `~/Work/git-natural-api/parse-packfile.ts`
