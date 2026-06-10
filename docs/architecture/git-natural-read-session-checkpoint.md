# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Pivot Budabit read-only repository browsing to prefer Git natural Smart HTTP reads over provider REST APIs and clone-first worker reads.
- Preserve repo-state events as the immediate signed ref/UI seed, then prefer Git natural object reads, then provider REST fallback/exception, then worker-backed `isomorphic-git` fallback.
- Incorporate lessons from `~/Work/gitworkshop`, `~/Work/git-natural-api`, and Budabit's partial GRASP REST/Smart HTTP implementation.

## Current Phase

- Phase 4: VendorReadRouter Shadow Integration With Git-Natural Preference.

## Phase Exit Criteria

- `VendorReadRouter` can call Git natural worker RPCs for refs, directory, file content, and commit history under a feature flag or shadow mode.
- When enabled, Git natural is attempted before provider REST for supported operations.
- Shadow mode compares Git natural results against existing provider REST or worker results without changing user-visible output.
- Mismatch logs include operation, remote URL, ref, commit hash, path, object hash, and source result summaries.
- Stale result suppression is preserved during fast branch switches, path navigation, repo changes, and tab changes.
- Existing router fallback behavior and tests continue to pass.

## Completed With Evidence

- Planning setup completed earlier: converted `docs/architecture/git-natural-read-pivot.md` into durable session-plan format and added this checkpoint.
- Planning references inspected earlier: `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts`, `pool.ts`, `cache.ts`, `types.ts`, `cors-proxy.ts`, `~/Work/gitworkshop/src/hooks/useGitExplorer.ts`, `~/Work/git-natural-api/refs.ts`, `packs.ts`, and `index.ts`.
- Budabit baseline references inspected earlier: GRASP REST/provider files, `packages/nostr-git-core/src/utils/advertised-refs.ts`, `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`, and related router/worker tests.
- Phase 1 started by rereading this checkpoint, the full `docs/architecture/git-natural-read-pivot.md`, Phase 1 details, and reference code in `~/Work/gitworkshop` and `~/Work/git-natural-api`.
- Added `ReadSourceKind`, `ReadOperation`, and `ReadSourceMetadata` in `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`.
- Source kinds now include distinct `git-natural` and `provider-rest`, plus `repo-state`, `git-remote`, `worker-clone`, and `local`.
- Source metadata can report operation, remote URL, effective URL, proxy status, attempted URLs, ref, commit hash, object hash, capability/capabilities, fallback reason, elapsed time, default branch, and details.
- Added optional source metadata to directory listing, file content, and commit history router results, and retained ref discovery source metadata.
- Updated repo-state source metadata to identify `listRefs` seeding in `BranchManager.ts` and `Repo.svelte.ts`.
- Updated `BranchSelector.svelte` to display `provider-rest` and future `git-natural` sources.
- Updated `VendorReadRouter.test.ts` with source metadata assertions and a compile/runtime fixture for the planned `git-natural` metadata shape.
- Updated `BranchManager.test.ts` fixtures for the `provider-rest` source-kind split.
- Documented the read source contract in `docs/architecture/git-natural-read-pivot.md`, including current Phase 1 baseline behavior and the target default order.
- No production read ordering was changed in Phase 1: selected provider REST still runs first where currently supported, refs still use current git advertised refs before local fallback, and directory/file/commit worker fallback remains unchanged.
- Phase 1 committed and pushed as `3e52a4d3 feat: add read source metadata contract`.
- Phase 2 started by rereading this checkpoint, the whole `docs/architecture/git-natural-read-pivot.md`, Phase 2 details, Gitworkshop cache/client code, and `~/Work/git-natural-api` protocol/parser code.
- Phase 2 used a narrow local implementation instead of adding `@fiatjaf/git-natural-api` because the reference parser source uses Deno-style `npm:` imports and Budabit does not currently depend on that package.
- Added `packages/nostr-git-core/src/git/natural-read-cache.ts` with short-TTL URL-scoped `infoRefs` and object-addressed keys for commits, blobs, trees, raw object batches, and history batches.
- Added `packages/nostr-git-core/src/git/natural-read-client.ts` with `info/refs` parsing, in-flight `infoRefs` dedupe, CORS/proxy transport resolution, upload-pack want request construction, capability selection, side-band packfile extraction, and fetch primitives for object-by-hash, `blob:none`, and `tree:0` requests.
- Natural-read transport resolution reuses `resolveCorsProxyForUrl()`, so GRASP repo HTTP URLs stay direct even when a generic CORS proxy is configured.
- Added structured `GitNaturalReadError` codes including auth, HTTP, network, protocol, missing capability, missing filter capability, and ref-not-found cases.
- Exported the Phase 2 natural-read cache/client from `packages/nostr-git-core/src/git/index.ts`.
- Added `packages/nostr-git-core/test/git/natural-read.spec.ts` covering cache keys/TTL, infoRefs parsing, dedupe, GRASP direct/no-proxy policy, capability selection, missing filter errors, side-band extraction, and upload-pack primitive request bodies.
- No UI or worker read path depends on Git natural yet.
- Phase 3 started by rereading this checkpoint, the whole `docs/architecture/git-natural-read-pivot.md`, Phase 3 details, Gitworkshop `git-http.ts`/`useGitExplorer.ts`, and `~/Work/git-natural-api` operation/parser code.
- Added direct `@nostr-git/core` dependencies on `@noble/hashes@2.0.1` and `fflate@0.8.2` for explicit pack parser hashing/decompression imports.
- Added `packages/nostr-git-core/src/git/natural-read-objects.ts` with local packfile parsing for commit/tree/blob/tag objects, OFS/REF delta handling, Git object hashing, tree parsing, commit parsing, and annotated-tag parsing primitives.
- Added `packages/nostr-git-core/src/git/natural-read-provider.ts` with disabled-by-default `GitNaturalReadProvider` operations for `listRefs`, `resolveRef`, `listDirectory`, `getFileContent`, `listCommits`, and `getCommit`.
- Phase 3 provider results include `git-natural` source metadata with operation, remote URL, effective URL/proxy use, attempted URL, ref, commit hash, object hash, capability/filter detail, elapsed time, default branch, and details.
- Ref resolution now handles `HEAD` symrefs, full refs, short branches, short tags, peeled annotated tag advertisements, and direct 40-character commit hashes.
- Directory listing fetches and caches `blob:none` raw object batches, derives the root tree from the commit object, traverses tree metadata, and returns normalized directory/file entries without blob content.
- File content resolves the path through `blob:none` tree metadata, then fetches the selected blob by object hash and returns base64 content plus object/source metadata.
- Commit history fetches `tree:0` packs, parses commit objects, normalizes first-parent order from the requested tip, caches history batches, and `getCommit` uses the same path with depth 1.
- Extended structured natural-read errors to include `feature-disabled`, `cors-proxy-failure`, `transient-network-failure`, and `object-not-found` in addition to Phase 2 codes.
- Added opt-in internal worker RPCs `gitNaturalListRefs`, `gitNaturalResolveRef`, `gitNaturalListDirectory`, `gitNaturalGetFileContent`, `gitNaturalListCommits`, and `gitNaturalGetCommit`; each requires `enabled: true` before executing.
- Added typed `WorkerManager` wrappers for the opt-in natural RPCs without changing production router read order.
- Added `packages/nostr-git-core/test/git/natural-read-provider.spec.ts` with in-memory valid packfile fixtures covering feature gating, refs/ref resolution, `blob:none` directory reads, object-hash blob reads, `tree:0` commit history, single commit, missing filter capability, missing refs, and source metadata.

## Phase 1 Baseline Observations

- Live timing sample command used Node `fetch` from the local environment on 2026-06-10; these samples are observational and are not browser CORS validation.
- `github-smart-refs`: `https://github.com/Pleb5/flotilla-budabit.git/info/refs?service=git-upload-pack`, HTTP 200, 414 ms, 2,384 bytes, `application/x-git-upload-pack-advertisement`.
- `github-rest-root-directory`: GitHub contents API for `Pleb5/flotilla-budabit` `dev`, HTTP 200, 440 ms, 37,259 bytes.
- `github-rest-readme`: GitHub contents API for `README.md` on `dev`, HTTP 200, 338 ms, 12,419 bytes.
- `github-rest-commits`: GitHub commits API for `dev`, 30 commits, HTTP 200, 304 ms, 95,895 bytes.
- `grasp-smart-refs`: `https://pyramid.fiatjaf.com/npub1elta7cneng3w8p9y4dw633qzdjr4kyvaparuyuttyrx6e8xp7xnq32cume/societybuilder.git/info/refs?service=git-upload-pack`, HTTP 200, 485 ms, 429 bytes.
- Baseline current router behavior: refs use repo-state seed first in UI, then selected provider REST if eligible, then current git advertised refs, then local refs.
- Baseline current router behavior: root directory and file open use selected provider REST if eligible, then worker-backed git fallback.
- Baseline current router behavior: commit history uses selected provider REST if eligible, then worker-backed `getCommitHistory` fallback.
- Worker clone fallback was not live-benchmarked separately in this environment; Phase 1 metadata now labels worker fallback results as `worker-clone` when those paths succeed.

## Representative Remotes

- GRASP Smart HTTP: `https://pyramid.fiatjaf.com/npub1elta7cneng3w8p9y4dw633qzdjr4kyvaparuyuttyrx6e8xp7xnq32cume/societybuilder.git`; fixtures also use `https://gitnostr.com/.../repo.git` and `https://relay.ngit.dev/npub1example/repo.git`.
- Generic Smart HTTP: any non-provider HTTP(S) clone URL accepted by `filterValidCloneUrls`; current tests use `https://example.com/owner/repo.git` as the policy fixture, and Phase 2 should add a real public generic remote if available.
- GitHub: `https://github.com/Pleb5/flotilla-budabit.git`.
- GitLab/Gitea: candidates for Phase 2/3 smoke tests are `https://gitlab.com/gitlab-org/gitlab-test.git` and `https://gitea.com/gitea/tea.git` if network access allows.
- Bitbucket: no confirmed public Bitbucket fixture was validated in Phase 1; identify one before hosted-provider adoption.
- Private/auth-required: not available in the current environment.
- CORS/proxy-required: hosted Smart HTTP URLs such as GitHub are likely browser CORS/proxy candidates even when Node fetch succeeds; validate in browser/worker phases.
- Server without `filter` support: not identified yet.

## Decisions

- Detailed plan path: `docs/architecture/git-natural-read-pivot.md`.
- Checkpoint path: `docs/architecture/git-natural-read-session-checkpoint.md`.
- Preferred read source order remains repo-state seed, Git natural Smart HTTP reads, provider REST fallback/exception, worker clone fallback.
- Phase 1 intentionally did not change production read ordering.
- Existing current advertised-ref reads remain labeled `git-remote` until they are routed through the new Git natural provider.
- GRASP servers are assumed to attach required CORS headers; GRASP natural-read requests should go direct by default and should not use the generic CORS proxy unless a future explicit override is designed.
- Existing partial GRASP REST code is useful evidence but should not become the primary architecture.

## Current State

- Phase 3 implementation and verification are complete in this checkpoint.
- Current working tree changes are intentional Phase 3 closeout changes.
- Phase 4 is next and should integrate natural worker RPCs into `VendorReadRouter` under a feature flag or shadow mode, without changing user-visible behavior unless explicitly enabled.

## Next Action

- Begin Phase 4 by rereading this checkpoint, the whole `docs/architecture/git-natural-read-pivot.md` plan from start to finish, Phase 4 details, and the references in Gitworkshop `pool.ts`/`useGitExplorer.ts`, Budabit `VendorReadRouter.ts`, `Repo.svelte.ts`, and `WorkerManager.ts`.
- Add natural-read router configuration flags and shadow/feature-flagged calls to the opt-in worker RPCs while preserving existing fallback behavior by default.

## Verification

- Passed: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`.
- Passed: `pnpm check`.
- Passed: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/BranchManager.test.ts`.
- Passed: `git diff --check`.
- Passed: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read.spec.ts`.
- Passed: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`.
- Passed: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read.spec.ts packages/nostr-git-core/test/git/natural-read-provider.spec.ts`.
- Passed: `pnpm -F @nostr-git/core typecheck`.
- Passed: `pnpm check`.
- Passed: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`.
- Passed: `git diff --check`.

## Risks Or Blockers

- Future benchmark/manual validation may be limited by network, browser CORS, or authentication availability.
- Node fetch timings are not browser CORS validation and should not be treated as proof of browser reachability.
- If GRASP direct reads fail because CORS headers are missing, treat that as a GRASP server/endpoint conformance problem rather than silently proxying the request.
- Phase 3 parser/provider coverage uses mocked valid packfile fixtures; no live public-remote smoke test was run in this phase.
- Large live remotes, unusual delta ordering, thin packs, or server-specific upload-pack behavior may still expose parser/performance limits.
- A confirmed public Bitbucket fixture and a server without `filter` support are still missing.

## Files

- `docs/architecture/git-natural-read-pivot.md`
- `docs/architecture/git-natural-read-session-checkpoint.md`
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- `packages/nostr-git-ui/src/lib/components/git/BranchManager.ts`
- `packages/nostr-git-ui/src/lib/components/git/BranchManager.test.ts`
- `packages/nostr-git-ui/src/lib/components/git/Repo.svelte.ts`
- `packages/nostr-git-ui/src/lib/components/git/BranchSelector.svelte`
- `packages/nostr-git-core/src/git/natural-read-cache.ts`
- `packages/nostr-git-core/src/git/natural-read-client.ts`
- `packages/nostr-git-core/src/git/natural-read-objects.ts`
- `packages/nostr-git-core/src/git/natural-read-provider.ts`
- `packages/nostr-git-core/src/git/index.ts`
- `packages/nostr-git-core/test/git/natural-read.spec.ts`
- `packages/nostr-git-core/test/git/natural-read-provider.spec.ts`
- `packages/nostr-git-core/src/worker/worker.ts`
- `packages/nostr-git-ui/src/lib/components/git/WorkerManager.ts`
- `packages/nostr-git-core/package.json`
- `pnpm-lock.yaml`
