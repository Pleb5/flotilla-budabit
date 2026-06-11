# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Migrate Budabit Git natural reads away from hand-rolled low-level Git protocol code and onto `@fiatjaf/git-natural-api`, using `~/Work/gitworkshop` as integration reference and `~/Work/git-natural-api` as local library source reference.

## Current Phase

- Phase 3: Switch Natural Read Provider To Library Adapter

## Phase Exit Criteria

- `listDirectory`, `getFileContent`, `listCommits`, `getCommit`, and `getDiffBetween` no longer depend on Budabit's hand-rolled upload-pack extraction for normal paths.
- `GitNaturalReadProvider` still returns the same external result contracts consumed by worker RPCs and `VendorReadRouter`.
- Natural read failures remain typed and fall back cleanly through existing router/worker paths.
- Tests cover directory, file content, commit history, and diff behavior using library-backed fixtures.

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

## Decisions

- Use `@fiatjaf/git-natural-api` for protocol primitives instead of expanding Budabit's low-level implementation.
- Use the package form proven by `~/Work/gitworkshop`: `@fiatjaf/git-natural-api` aliased to `npm:@jsr/fiatjaf__git-natural-api@^0.2.4` unless pnpm proves a better canonical install.
- Use `~/Work/gitworkshop/src/lib/git-grasp-pool/` for cache/fallback/diff/CORS integration inspiration.
- Read `~/Work/git-natural-api` source when API behavior is unclear.
- Leave pre-existing unrelated unstaged changes untouched.

## Current State

- Phase 2 complete; checkpoint advanced to Phase 3.
- Pre-existing unstaged change observed: `docs/architecture/git-natural-read-pivot.md`.
- Previous hardening analysis is available at `docs/architecture/git-natural-read-hardening-analysis.md`.

## Next Action

- Begin Phase 3 by rereading this checkpoint and the full plan, inspecting repo state, then route `GitNaturalReadProvider` through `GitNaturalApiAdapter` while preserving result contracts and fallback behavior.

## Verification

- Phase 1: `pnpm -F @nostr-git/core typecheck` passed.
- Phase 1: `git diff --check -- packages/nostr-git-core/package.json pnpm-lock.yaml docs/architecture/git-natural-api-migration-session-plan.md docs/architecture/git-natural-api-migration-session-checkpoint.md` passed with no output.
- Phase 1 install command succeeded: `pnpm --filter @nostr-git/core add @fiatjaf/git-natural-api@npm:@jsr/fiatjaf__git-natural-api@^0.2.4`.
- Phase 2: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read.spec.ts` passed with 13 tests.
- Phase 2: `pnpm -F @nostr-git/core typecheck` passed.
- Phase 2: `git diff --check` passed with no output.

## Risks Or Blockers

- `git-natural-api` high-level helpers refetch capabilities; Budabit should continue using `GitNaturalApiAdapter` low-level methods instead of high-level helpers in Phase 3.
- The installed `@fiatjaf/git-natural-api@0.2.4` JavaScript omits `mode` fields from `loadTree()` results even though local source/types include them; Phase 3 should use raw objects/`parseTree` for mode-sensitive provider contracts unless the package is updated and verified.
- Library `fetchPackfile` owns upload-pack parsing and pack parsing but uses global `fetch` and `Response.bytes()` with no fetcher injection; Phase 3 must preserve Budabit fallback semantics around any runtime/network failures.
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
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`
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
