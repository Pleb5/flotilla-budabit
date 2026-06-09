# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Prepare a durable implementation session for the Git natural read pivot by converting `docs/architecture/git-natural-read-pivot.md` into session-plan format, with Budabit explicitly preferring Git natural reads over provider REST APIs.
- Incorporate lessons from `~/Work/gitworkshop`, `~/Work/git-natural-api`, and Budabit's partial GRASP REST/Smart HTTP implementation.

## Current Phase

- Phase 1: Baseline, Guardrails, And Read Source Contract.

## Phase Exit Criteria

- A documented source contract exists for directory listing, file content, refs, commit history, and future diff reads.
- The documented default read order is repo-state seed, Git natural, provider REST fallback/exception, worker clone fallback.
- Source metadata includes a distinct `git-natural` source and can report remote URL, effective URL/proxy, ref, commit hash, capability/fallback reason, and elapsed time.
- Baseline timings and behavior are recorded for representative reads: refs, root directory, README/file open, commit history, and worker clone fallback.
- Representative remotes are identified: GRASP Smart HTTP, generic Smart HTTP, GitHub, GitLab/Gitea, Bitbucket if available, private/auth-required, CORS/proxy-required, and a server without filter support if available.
- No production read ordering changes yet.

## Completed With Evidence

- Planning-only setup performed for review; implementation phases have not started.
- Read existing project session workflow convention: `docs/architecture/pr-loading-session-plan.md` and `docs/architecture/pr-loading-session-checkpoint.md`.
- Read current architecture plan: `docs/architecture/git-natural-read-pivot.md`.
- Inspected Gitworkshop natural-read implementation for lessons and snippets: `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts`, `~/Work/gitworkshop/src/lib/git-grasp-pool/pool.ts`, `~/Work/gitworkshop/src/lib/git-grasp-pool/cache.ts`, `~/Work/gitworkshop/src/lib/git-grasp-pool/types.ts`, `~/Work/gitworkshop/src/lib/git-grasp-pool/cors-proxy.ts`, and `~/Work/gitworkshop/src/hooks/useGitExplorer.ts`.
- Inspected low-level reference implementation: `~/Work/git-natural-api/refs.ts`, `~/Work/git-natural-api/packs.ts`, and `~/Work/git-natural-api/index.ts`.
- Inspected Budabit GRASP/REST and router code: `packages/nostr-git-core/src/api/providers/grasp-rest.ts`, `packages/nostr-git-core/src/api/providers/grasp-rest-utils.ts`, `packages/nostr-git-core/src/api/providers/grasp.ts`, `packages/nostr-git-core/src/api/providers/grasp-capabilities.ts`, `packages/nostr-git-core/src/utils/advertised-refs.ts`, `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`, and related tests/worker methods.
- Updated `docs/architecture/git-natural-read-pivot.md` into a durable session plan with phases, exit criteria, expected touched areas, verification commands, risks, mandatory closeout, per-phase reference checks, and per-phase code snippets.

## Decisions

- Detailed plan path: `docs/architecture/git-natural-read-pivot.md`.
- Checkpoint path: `docs/architecture/git-natural-read-session-checkpoint.md`.
- Do not execute implementation yet; user will review this planning update first.
- Preferred read source order is repo-state seed, Git natural Smart HTTP reads, provider REST fallback/exception, worker clone fallback.
- GRASP and generic Smart HTTP reads should prefer Git natural before GRASP REST and before worker clone fallback.
- GRASP servers are assumed to attach required CORS headers; GRASP natural-read requests should go direct by default and should not use the generic CORS proxy unless a future explicit override is designed.
- Existing partial GRASP REST code is useful evidence but should not become the primary architecture.

## Current State

- Planning document and checkpoint have been updated for review.
- No implementation code has been changed for the Git natural pivot.
- The older PR-loading durable workflow files are unrelated and were left untouched.

## Next Action

- Wait for user review. After approval, reread this checkpoint and the whole `docs/architecture/git-natural-read-pivot.md` plan from start to finish, then reread Phase 1, inspect current repository state, and begin Phase 1.

## Verification

- Passed: `git diff --check`.
- No build or test run is required for this planning-only documentation update unless requested.

## Risks Or Blockers

- Implementation is intentionally blocked pending user review.
- Future benchmark/manual validation may be limited by network, CORS, or authentication availability.
- If GRASP direct reads fail because CORS headers are missing, treat that as a GRASP server/endpoint conformance problem rather than silently proxying the request.
- The dependency choice for `@fiatjaf/git-natural-api` versus local low-level helpers remains an implementation-phase decision.

## Files

- `docs/architecture/git-natural-read-pivot.md`
- `docs/architecture/git-natural-read-session-checkpoint.md`
