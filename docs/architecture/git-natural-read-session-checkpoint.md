# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Pivot Budabit read-only repository browsing to prefer Git natural Smart HTTP reads over provider REST APIs and clone-first worker reads.
- Preserve repo-state events as the immediate signed ref/UI seed, then prefer Git natural object reads, then provider REST fallback/exception, then worker-backed `isomorphic-git` fallback.
- Incorporate lessons from `~/Work/gitworkshop`, `~/Work/git-natural-api`, and Budabit's partial GRASP REST/Smart HTTP implementation.

## Current Phase

- Phase 7: Diff, Merge Analysis Reads, And Cleanup.

## Phase Exit Criteria

- Diff metadata can use object-addressed `blob:none` full-tree reads where compatible and fetch changed blobs lazily by hash.
- Commit-range/merge-analysis read-only discovery can use natural reads where safe, while actual merge, checkout, write, and push remain `isomorphic-git`/worker clone responsibilities.
- Clone-depth repair paths are no longer invoked for normal browsing when Git natural succeeds.
- Dead or misleading GRASP REST read paths, docs, and flags are removed or clearly marked as non-primary.
- Documentation explains remaining cases where clone fallback is intentionally required.
- Cache metrics/debug logs center on source metadata and immutable object cache behavior.

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
- Phase 4 started by rereading this checkpoint, the whole `docs/architecture/git-natural-read-pivot.md`, Phase 4 details, Gitworkshop `pool.ts`/`useGitExplorer.ts`, `~/Work/git-natural-api/refs.ts`, and Budabit `VendorReadRouter.ts`, `Repo.svelte.ts`, `WorkerManager.ts`, and router tests.
- Added `gitNaturalReads?: "disabled" | "enabled" | "shadow"` and `gitNaturalCorsProxy?: string | null` to `VendorReadRouterConfig`, defaulting Git natural reads to disabled so existing production-visible read order remains unchanged unless explicitly enabled.
- Added Git natural normalization helpers in `VendorReadRouter.ts` for refs, directory entries, file content, and commit history, preserving source metadata with effective URL, proxy use, attempted URLs, ref, commit hash, object hash, capabilities, fallback reason, and elapsed time.
- In enabled mode, `VendorReadRouter` now tries worker Git natural RPCs before provider REST for `listRefs`, `listDirectory`, `getFileContent`, and `listCommits`, then falls back to existing provider REST and worker/local clone paths.
- In shadow mode, `VendorReadRouter` keeps the existing provider REST/git-remote/worker output as the returned result and runs a Git natural comparison in the background.
- Shadow mismatch logs include operation, remote URL, ref, commit hash, path, object hash, baseline and natural summaries, and baseline/natural source summaries.
- Worker clone fallback metadata now distinguishes natural-read fallback reasons when enabled, while preserving existing fallback behavior by default.
- Added `VendorReadRouter.test.ts` coverage for Git natural before provider REST, provider REST fallback after natural failure, worker clone fallback after natural and REST failure, shadow mode preserving provider output, and Git natural commit history before provider REST.
- Phase 4 committed and pushed as `74b8f327 feat: add git natural router shadow mode`.
- Phase 5 started by rereading this checkpoint, the whole `docs/architecture/git-natural-read-pivot.md`, Phase 5 details, Gitworkshop `git-grasp-pool` references, `~/Work/git-natural-api/refs.ts`, and Budabit GRASP/natural-read router references.
- Added `GitNaturalReadPolicy = "all-http" | "grasp-and-generic"` and `VendorReadRouterConfig.gitNaturalReadPolicy`, defaulting explicit router opt-in to `"all-http"` while allowing the app rollout to scope natural reads to GRASP and generic HTTP(S) first.
- Updated natural-read URL eligibility so `"grasp-and-generic"` includes GRASP repo HTTP URLs and non-vendor generic HTTP(S) clone URLs, while excluding hosted providers from Phase 5 natural-first behavior.
- Updated `Repo.svelte.ts` to enable Git natural reads with `gitNaturalReadPolicy: "grasp-and-generic"`, keeping hosted providers REST-first until Phase 6 adoption work.
- Verified GRASP natural-read router calls do not pass a generic `corsProxy` override by default, so core/worker GRASP URL policy keeps direct Smart HTTP behavior.
- Added Git natural failure summaries and user-visible fallback context for worker fallback failures, so clone initialization failures can report that they happened after Git natural read failure.
- Preserved worker clone fallback after natural failures for unsupported filters, protocol/CORS/proxy/auth/object errors, while Git natural successes return without clone-state calls.
- Added Phase 5 router tests for GRASP natural browsing without clone-state calls, generic HTTP natural eligibility, hosted-provider REST-first scoped rollout behavior, and natural failure context.
- Live direct GRASP `info/refs` smoke succeeded from the local Node environment: `https://pyramid.fiatjaf.com/.../societybuilder.git/info/refs?service=git-upload-pack`, HTTP 200, `application/x-git-upload-pack-advertisement`, 429 bytes, advertised `filter` capability.
- Phase 5 committed and pushed as `e365e297 feat: enable scoped git natural reads`.
- Phase 6 started by rereading this checkpoint, the whole `docs/architecture/git-natural-read-pivot.md`, Phase 6 details, Gitworkshop `CorsProxyManager` and `GitHttpClient` references, `~/Work/git-natural-api/refs.ts`, Budabit `natural-read-client.ts`, `grasp-url.ts`, and hosted provider REST implementation seams in `VendorReadRouter.ts`.
- Updated `Repo.svelte.ts` to use `gitNaturalReadPolicy: "all-http"`, expanding production natural-read eligibility to hosted provider HTTP(S) clone URLs while preserving REST fallback and the core GRASP direct/no-proxy rule.
- Confirmed default hosted natural transport can use `https://cors.isomorphic-git.org` through `loadConfig()` unless `GIT_DEFAULT_CORS_PROXY=none`, while `resolveCorsProxyForUrl()` still returns `null` for GRASP repo HTTP URLs.
- Added hosted-provider router tests proving GitHub, GitLab, Gitea, and Bitbucket clone URLs try Git natural before provider REST under `"all-http"` and do not call REST when natural succeeds.
- Added hosted-provider fallback tests proving REST still runs after natural CORS/proxy, missing filter capability, auth, and protocol failures.
- Added natural-client tests for distinct hosted failure classification: 403 as `auth-required`, 429 as `http-error` with status, fetch/CORS failure as `cors-proxy-failure`, empty advertised refs as `protocol-error`, and missing filter as `missing-filter-capability`.
- Fixed `GitNaturalReadClient.fetchInfoRefs()` in-flight cleanup to avoid unhandled rejections when a rejected in-flight request is cleaned up.
- Phase 6 hosted observations from local Node fetch: GitHub Smart HTTP refs HTTP 200 in 558 ms with 2,384 bytes and `filter`; GitHub REST refs HTTP 200 in 415 ms with 9 refs; GitHub REST root directory HTTP 200 in 246 ms with 49 entries; GitHub REST README HTTP 200 in 475 ms with 12,419 bytes; GitHub REST commits HTTP 200 in 293 ms with 30 commits.
- Phase 6 hosted observations from local Node fetch: GitLab Smart HTTP refs HTTP 200 in 408 ms with 11,656 bytes and `filter`; Gitea Smart HTTP refs HTTP 200 in 2,716 ms with 66,863 bytes and `filter`.
- Phase 6 Bitbucket public-candidate observations: `atlassian/python-bitbucket.git`, `tutorials/tutorials.bitbucket.org.git`, `mirror/git.git`, and `pypy/pypy.git` Smart HTTP refs all returned HTTP 401 in this environment, so a confirmed public Bitbucket Smart HTTP fixture remains missing.

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

- Phase 6 implementation and verification are complete in this checkpoint.
- Current intentional Phase 6 changes are limited to `natural-read-client.ts`, `natural-read.spec.ts`, `VendorReadRouter.test.ts`, `Repo.svelte.ts`, and this checkpoint.
- `docs/architecture/git-natural-read-pivot.md` still has pre-existing unstaged modifications that were present before Phase 4 work and were intentionally not edited during Phase 6.
- Phase 7 is next and should extend object-addressed natural reads to diff/merge-analysis read-only discovery where safe, while preserving worker clone paths for local git semantics.

## Next Action

- Begin Phase 7 by rereading this checkpoint, the whole `docs/architecture/git-natural-read-pivot.md` plan from start to finish, Phase 7 details, Gitworkshop `getCommitRange`, `fetchFullTree`, and `getBlob` references, and Budabit PR/merge worker paths.
- Add or evaluate natural commit-range/read-only diff discovery using full-tree `blob:none` metadata and lazy blob fetches without replacing local merge, checkout, write, push, or worktree semantics.

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
- Phase 4 passed: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`.
- Phase 4 passed: `pnpm -F @nostr-git/ui typecheck`.
- Phase 4 passed: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read-provider.spec.ts`.
- Phase 4 passed: `pnpm check`.
- Phase 4 passed: `git diff --check`.
- Phase 5 passed: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`.
- Phase 5 passed: `pnpm -F @nostr-git/ui typecheck`.
- Phase 5 passed: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`.
- Phase 5 passed: `pnpm check`.
- Phase 5 passed: `git diff --check`.
- Phase 5 smoke passed: Node direct GRASP `info/refs?service=git-upload-pack` fetch returned HTTP 200 with upload-pack advertisement and `filter` capability.
- Phase 6 passed: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`.
- Phase 6 passed: `pnpm -F @nostr-git/ui typecheck`.
- Phase 6 passed: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`.
- Phase 6 passed: `pnpm check`.
- Phase 6 passed: `git diff --check`.
- Phase 6 smoke observations recorded through Node `fetch` for GitHub REST and Smart HTTP, GitLab Smart HTTP, Gitea Smart HTTP, and Bitbucket Smart HTTP candidates.

## Risks Or Blockers

- Future benchmark/manual validation may be limited by network, browser CORS, or authentication availability.
- Node fetch timings are not browser CORS validation and should not be treated as proof of browser reachability.
- If GRASP direct reads fail because CORS headers are missing, treat that as a GRASP server/endpoint conformance problem rather than silently proxying the request.
- Phase 3 parser/provider coverage uses mocked valid packfile fixtures; no live public-remote smoke test was run in this phase.
- Phase 4 did not run a manual shadow-mode browser/network comparison; Phase 5 should cover live GRASP/generic HTTP(S) smoke testing if network and server behavior allow.
- Phase 5 live smoke covered direct GRASP `info/refs` reachability from Node, but did not complete a full browser/worker directory/file/commit natural-read smoke against a live public remote.
- Phase 6 live hosted-provider observation did not execute full natural directory/file/commit reads through the TypeScript provider because `tsx`/`vite-node` were unavailable and inline `ts-node` ESM imports were blocked by repo module settings.
- Bitbucket Smart HTTP public fixtures remain unconfirmed because all tested candidates returned HTTP 401.
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
