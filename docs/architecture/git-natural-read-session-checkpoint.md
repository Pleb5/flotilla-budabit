# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Pivot Budabit read-only repository browsing to prefer Git natural Smart HTTP reads over provider REST APIs and clone-first worker reads.
- Preserve repo-state events as the immediate signed ref/UI seed, then prefer Git natural object reads, then provider REST fallback/exception, then worker-backed `isomorphic-git` fallback.
- Incorporate lessons from `~/Work/gitworkshop`, `~/Work/git-natural-api`, and Budabit's partial GRASP REST/Smart HTTP implementation.

## Current Phase

- Phase 3: GitNaturalReadProvider Operations Behind A Feature Flag.

## Phase Exit Criteria

- `GitNaturalReadProvider` or equivalent worker RPC can list refs, resolve refs, list a directory, fetch a file blob, list commit history, and get one commit from compatible public remotes.
- Results include source metadata: source kind, remote URL, effective URL/proxy, ref, commit hash, object hash when applicable, and fallback/capability info.
- Ref resolution handles full refs, short branches, tags, peeled annotated tags, `HEAD` symrefs, and direct 40-character commit hashes.
- Directory reads fetch tree metadata with `blob:none`; file content fetches selected blobs by object hash.
- Commit history uses `tree:0` where supported and has a fallback/decline path when `filter` is missing.
- Structured errors exist for missing filter capability, CORS/proxy failure, auth required, ref not found, object not found, protocol error, and transient network failure.
- Feature flag or internal-only worker RPC prevents production UI from depending on the provider yet.

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

- Phase 2 implementation and verification are complete in this checkpoint.
- Current working tree changes are intentional Phase 2 closeout changes.
- Phase 3 is next and should add worker/provider operations behind a feature flag or internal-only RPC, without production UI dependence.

## Next Action

- Begin Phase 3 by rereading this checkpoint, the whole `docs/architecture/git-natural-read-pivot.md` plan from start to finish, Phase 3 details, and the operation references in Gitworkshop `git-http.ts`, Gitworkshop UI async code, `~/Work/git-natural-api/index.ts`, and Budabit worker RPC read methods.
- Implement natural read provider or worker RPC operations for refs, ref resolution, directory listing, file content, commit history, and single commit behind a disabled/opt-in feature flag or internal-only path.

## Verification

- Passed: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`.
- Passed: `pnpm check`.
- Passed: `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/BranchManager.test.ts`.
- Passed: `git diff --check`.
- Passed: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false packages/nostr-git-core/test/git/natural-read.spec.ts`.
- Passed: `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`.

## Risks Or Blockers

- Future benchmark/manual validation may be limited by network, browser CORS, or authentication availability.
- Node fetch timings are not browser CORS validation and should not be treated as proof of browser reachability.
- If GRASP direct reads fail because CORS headers are missing, treat that as a GRASP server/endpoint conformance problem rather than silently proxying the request.
- Phase 2 intentionally did not add a packfile object parser dependency; upload-pack primitives return unwrapped packfile bytes and Phase 3 must parse or integrate parsing before object operations return content.
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
- `packages/nostr-git-core/src/git/index.ts`
- `packages/nostr-git-core/test/git/natural-read.spec.ts`
