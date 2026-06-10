# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Pivot Budabit read-only repository browsing to prefer Git natural Smart HTTP reads over provider REST APIs and clone-first worker reads.
- Preserve repo-state events as the immediate signed ref/UI seed, then prefer Git natural object reads, then provider REST fallback/exception, then worker-backed `isomorphic-git` fallback.
- Incorporate lessons from `~/Work/gitworkshop`, `~/Work/git-natural-api`, and Budabit's partial GRASP REST/Smart HTTP implementation.

## Current Phase

- Phase 2: Git Object Cache And Low-Level Natural Client Foundation.

## Phase Exit Criteria

- A Git natural cache exists with object-addressed keys for commits, blobs, trees, raw `blob:none` object batches, and history batches, plus short-TTL URL-scoped `infoRefs`.
- `infoRefs` fetches are cached, deduped, parse capabilities and symrefs, and can use existing CORS/proxy policy.
- The CORS/proxy policy treats GRASP repo HTTP URLs as direct-only by default; no generic CORS proxy is used for GRASP natural reads unless a later explicit override is designed.
- Low-level `git-upload-pack` fetch primitives exist for object-by-hash, `blob:none`, and `tree:0` requests.
- Capability selection happens from cached `infoRefs`; high-level helpers that refetch capabilities are avoided unless benchmarks prove acceptable.
- The incomplete `grasp-rest-utils.ts` path is not expanded as the primary implementation; useful parsing concepts are either replaced by a tested dependency or moved into the shared natural client.
- No UI read path depends on Git natural yet.

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

- Phase 1 implementation and documentation are complete locally.
- Phase 1 verification passed.
- The working tree contains intentional Phase 1 changes only, pending commit and push.

## Next Action

- Begin Phase 2 by rereading this checkpoint, the whole `docs/architecture/git-natural-read-pivot.md` plan from start to finish, Phase 2 details, and the cache/protocol references in `~/Work/gitworkshop` and `~/Work/git-natural-api`.
- Decide whether to add `@fiatjaf/git-natural-api` as a dependency or implement a narrow local low-level module, based on build/test compatibility and browser/worker import boundaries.

## Verification

- Passed: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`.
- Passed: `pnpm check`.
- Passed: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/BranchManager.test.ts`.
- Passed: `git diff --check`.

## Risks Or Blockers

- Future benchmark/manual validation may be limited by network, browser CORS, or authentication availability.
- Node fetch timings are not browser CORS validation and should not be treated as proof of browser reachability.
- If GRASP direct reads fail because CORS headers are missing, treat that as a GRASP server/endpoint conformance problem rather than silently proxying the request.
- The dependency choice for `@fiatjaf/git-natural-api` versus local low-level helpers remains a Phase 2 decision.
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
