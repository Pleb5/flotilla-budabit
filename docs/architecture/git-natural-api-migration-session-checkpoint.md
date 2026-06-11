# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Migrate Budabit Git natural reads away from hand-rolled low-level Git protocol code and onto `@fiatjaf/git-natural-api`, using `~/Work/gitworkshop` as integration reference and `~/Work/git-natural-api` as local library source reference.

## Current Phase

- Phase 2: Introduce Library Adapter And Protocol Regression Tests

## Phase Exit Criteria

- A library-backed adapter exists for low-level operations Budabit needs: cached `info/refs`, capability selection from cached info, `blob:none`, `tree:0`, object-by-hash fetch, tree loading, and commit parsing.
- The adapter avoids calling high-level library helpers that refetch capabilities when cached info is already available, following `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts`.
- Tests cover upload-pack responses containing `shallow <oid>`, `unshallow <oid>`, side-band progress, and missing/invalid pack responses.
- Existing natural-read behavior remains routed through the old implementation until the tests are in place.

## Completed With Evidence

- Phase 1 completed: installed `@fiatjaf/git-natural-api` into `@nostr-git/core` as `npm:@jsr/fiatjaf__git-natural-api@^0.2.4`.
- Evidence: `packages/nostr-git-core/package.json` declares `@fiatjaf/git-natural-api`.
- Evidence: `pnpm-lock.yaml` contains `@jsr/fiatjaf__git-natural-api@0.2.4`.
- Evidence: no production code files were changed in Phase 1.

## Decisions

- Use `@fiatjaf/git-natural-api` for protocol primitives instead of expanding Budabit's low-level implementation.
- Use the package form proven by `~/Work/gitworkshop`: `@fiatjaf/git-natural-api` aliased to `npm:@jsr/fiatjaf__git-natural-api@^0.2.4` unless pnpm proves a better canonical install.
- Use `~/Work/gitworkshop/src/lib/git-grasp-pool/` for cache/fallback/diff/CORS integration inspiration.
- Read `~/Work/git-natural-api` source when API behavior is unclear.
- Leave pre-existing unrelated unstaged changes untouched.

## Current State

- Phase 1 complete; checkpoint advanced to Phase 2.
- Pre-existing unstaged change observed: `docs/architecture/git-natural-read-pivot.md`.
- Previous hardening analysis is available at `docs/architecture/git-natural-read-hardening-analysis.md`.

## Next Action

- Begin Phase 2 by reading `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts` and `~/Work/git-natural-api` source, then create a library-backed adapter and protocol regression tests.

## Verification

- Phase 1: `pnpm -F @nostr-git/core typecheck` passed.
- Phase 1: `git diff --check -- packages/nostr-git-core/package.json pnpm-lock.yaml docs/architecture/git-natural-api-migration-session-plan.md docs/architecture/git-natural-api-migration-session-checkpoint.md` passed with no output.
- Phase 1 install command succeeded: `pnpm --filter @nostr-git/core add @fiatjaf/git-natural-api@npm:@jsr/fiatjaf__git-natural-api@^0.2.4`.

## Risks Or Blockers

- `git-natural-api` high-level helpers refetch capabilities; Budabit should prefer low-level primitives and a local adapter pattern inspired by `gitworkshop`.
- `~/Work/git-natural-api/packs.ts` handles upload-pack response parsing differently from Budabit, but Phase 2 must verify behavior with explicit protocol regression tests.
- `pnpm add` ran existing prepare scripts; no generated `dist` files are tracked in the current status.

## Files

- `docs/architecture/git-natural-api-migration-session-plan.md`
- `docs/architecture/git-natural-api-migration-session-checkpoint.md`
- `packages/nostr-git-core/package.json`
- `pnpm-lock.yaml`
- `packages/nostr-git-core/src/git/natural-read-client.ts`
- `packages/nostr-git-core/src/git/natural-read-provider.ts`
- `packages/nostr-git-core/src/git/natural-read-cache.ts`
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
